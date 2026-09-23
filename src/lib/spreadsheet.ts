/**
 * Reads a spreadsheet in the browser, with no library.
 *
 * An .xlsx file is a ZIP of XML, and the browser already has both halves of
 * what that needs: DecompressionStream inflates the entries and DOMParser reads
 * the XML. So the shop gets a preview of its own file before anything is saved,
 * the package stays a few hundred kilobytes, and the server keeps its rule of
 * importing nothing but node: built-ins.
 *
 * Everything comes back as a string, with dates already normalised to
 * YYYY-MM-DD. The import screen and the server both validate strings anyway, so
 * handing them a half-typed mixture of numbers, dates and text would only move
 * the parsing problem somewhere less visible.
 */

export interface Sheet {
  name: string;
  rows: string[][];
}

export class SpreadsheetError extends Error {}

/** Reads .xlsx or .csv. Rejects .xls with an explanation rather than a stack trace. */
export async function readSpreadsheet(file: File): Promise<Sheet[]> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // The old binary .xls is a different format entirely — an OLE2 compound file.
  // A shopkeeper on an old Excel hits this, so it gets a sentence they can act
  // on rather than a parser crash.
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new SpreadsheetError(
      'This is an old .xls file, which cannot be read directly. Open it in Excel and use ' +
      'File → Save As to save it as .xlsx or CSV, then try again.',
    );
  }

  // PK\003\004 — a zip, so a modern .xlsx.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readXlsx(bytes);

  return [{ name: file.name.replace(/\.[^.]+$/, ''), rows: parseCsv(new TextDecoder().decode(bytes)) }];
}

/* --------------------------------------------------------------------- CSV */

/**
 * A CSV parser that respects quotes.
 *
 * Shop data is full of commas inside item names — "Rice, Basmati" — and a split
 * on commas silently shifts every column after it, which shows up much later as
 * a price in the barcode field.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  // A file saved by Excel on Windows starts with a byte-order mark, which would
  // otherwise become part of the first column heading and match nothing.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/* -------------------------------------------------------------------- xlsx */

async function readXlsx(bytes: Uint8Array): Promise<Sheet[]> {
  const zip = await readZip(bytes);
  const text = (path: string) => {
    const entry = zip.get(path);
    return entry ? new TextDecoder().decode(entry) : null;
  };

  const workbookXml = text('xl/workbook.xml');
  if (!workbookXml) throw new SpreadsheetError('That file is not a readable Excel workbook.');

  const workbook = parseXml(workbookXml);
  // Some workbooks count days from 1904 instead of 1900. Getting this wrong
  // shifts every date in the file by just over four years.
  const epoch1904 = workbook.querySelector('workbookPr')?.getAttribute('date1904');
  const use1904 = epoch1904 === '1' || epoch1904 === 'true';

  const relsXml = text('xl/_rels/workbook.xml.rels');
  const targets = new Map<string, string>();
  if (relsXml) {
    for (const rel of parseXml(relsXml).querySelectorAll('Relationship')) {
      const id = rel.getAttribute('Id');
      const target = rel.getAttribute('Target');
      if (id && target) targets.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''));
    }
  }

  const shared = readSharedStrings(text('xl/sharedStrings.xml'));
  const dateStyles = readDateStyles(text('xl/styles.xml'));

  const sheets: Sheet[] = [];
  const sheetNodes = [...workbook.querySelectorAll('sheets > sheet')];
  for (let i = 0; i < sheetNodes.length; i += 1) {
    const node = sheetNodes[i];
    const name = node.getAttribute('name') ?? `Sheet ${i + 1}`;
    const relId = node.getAttribute('r:id') ?? node.getAttributeNS(
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id',
    );
    const path = (relId && targets.get(relId)) || `worksheets/sheet${i + 1}.xml`;
    const xml = text(`xl/${path}`);
    if (!xml) continue;
    sheets.push({ name, rows: readSheet(xml, shared, dateStyles, use1904) });
  }

  if (sheets.length === 0) throw new SpreadsheetError('That workbook has no readable sheets.');
  return sheets;
}

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new SpreadsheetError('That file could not be read as a spreadsheet.');
  return doc;
}

/** The shared string table Excel itself writes; openpyxl and others inline instead. */
function readSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  return [...parseXml(xml).querySelectorAll('sst > si')].map(
    // A cell's text can be split across several runs when part of it is
    // formatted differently. Joining them keeps "Tapal Danedar" one name.
    (si) => [...si.querySelectorAll('t')].map((t) => t.textContent ?? '').join(''),
  );
}

/**
 * Which style indexes mean "this number is a date".
 *
 * A date in a spreadsheet is just a number; only its format says otherwise. So
 * the number formats have to be read to know that 46203 is 30 June 2027 rather
 * than a quantity of forty-six thousand.
 */
function readDateStyles(xml: string | null): Set<number> {
  const dateStyles = new Set<number>();
  if (!xml) return dateStyles;
  const doc = parseXml(xml);

  // Excel's built-in date and time formats.
  const builtinDate = new Set([14, 15, 16, 17, 22, 30, 45, 46, 47, 57, 58]);
  const custom = new Map<number, string>();
  for (const fmt of doc.querySelectorAll('numFmts > numFmt')) {
    const id = Number(fmt.getAttribute('numFmtId'));
    if (Number.isFinite(id)) custom.set(id, fmt.getAttribute('formatCode') ?? '');
  }

  const looksLikeDate = (code: string) => {
    // Strip quoted literals and colour codes first, or the "d" in a literal
    // like "Paid" would make every such number a date.
    const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
    return /[dmyhs]/i.test(bare) && !/^[#0.,%\s]*$/.test(bare);
  };

  const xfs = [...doc.querySelectorAll('cellXfs > xf')];
  xfs.forEach((xf, index) => {
    const numFmtId = Number(xf.getAttribute('numFmtId') ?? 0);
    if (builtinDate.has(numFmtId)) { dateStyles.add(index); return; }
    const code = custom.get(numFmtId);
    if (code && looksLikeDate(code)) dateStyles.add(index);
  });
  return dateStyles;
}

function readSheet(xml: string, shared: string[], dateStyles: Set<number>, use1904: boolean): string[][] {
  const doc = parseXml(xml);
  const rows: string[][] = [];

  for (const rowNode of doc.querySelectorAll('sheetData > row')) {
    const cells: string[] = [];
    for (const cell of rowNode.querySelectorAll('c')) {
      // Cells are sparse: an empty one is simply absent, so the column has to
      // come from the cell's own reference or every row after a gap shifts left.
      const column = columnIndex(cell.getAttribute('r') ?? '');
      const value = cellText(cell, shared, dateStyles, use1904);
      if (column >= 0) {
        while (cells.length < column) cells.push('');
        cells[column] = value;
      } else {
        cells.push(value);
      }
    }
    const index = Number(rowNode.getAttribute('r'));
    if (Number.isFinite(index) && index > 0) {
      while (rows.length < index - 1) rows.push([]);
      rows[index - 1] = cells;
    } else {
      rows.push(cells);
    }
  }
  return rows;
}

/** "BC12" -> 54. Column letters are base-26 with no zero. */
function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0];
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function cellText(cell: Element, shared: string[], dateStyles: Set<number>, use1904: boolean): string {
  const type = cell.getAttribute('t');

  if (type === 's') {
    const index = Number(cell.querySelector('v')?.textContent);
    return shared[index] ?? '';
  }
  if (type === 'inlineStr') {
    return [...cell.querySelectorAll('is t')].map((t) => t.textContent ?? '').join('');
  }
  if (type === 'b') return cell.querySelector('v')?.textContent === '1' ? 'TRUE' : 'FALSE';
  // A formula that failed. Better empty than "#REF!" landing in a price.
  if (type === 'e') return '';

  // 'str' is a formula's cached text result; no type at all means a number.
  const raw = cell.querySelector('v')?.textContent ?? '';
  if (raw === '') return '';
  if (type === 'str') return raw;

  const style = Number(cell.getAttribute('s') ?? 0);
  if (dateStyles.has(style)) {
    const iso = serialToISO(Number(raw), use1904);
    if (iso) return iso;
  }
  return raw;
}

/**
 * Excel's day numbers to YYYY-MM-DD.
 *
 * 1900 was not a leap year, but Lotus 1-2-3 thought it was and Excel kept the
 * bug for compatibility. So serial 60 is 29 February 1900 — a day that never
 * happened — and every serial after it is shifted by one. The two bases below
 * undo that shift, which is why 59 and 61 come back exactly as Excel shows
 * them. Serial 60 itself cannot be represented as a real date and lands on
 * 28 February; that only matters to a file containing dates from 1900, which a
 * shop's stock list does not.
 */
function serialToISO(serial: number, use1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const days = Math.floor(serial);
  const base = use1904
    ? Date.UTC(1904, 0, 1)
    : days < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const ms = base + days * 86_400_000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/* --------------------------------------------------------------------- zip */

/**
 * Just enough ZIP to read the handful of XML parts an .xlsx keeps inside.
 *
 * Read from the central directory at the end of the file rather than by walking
 * local headers from the front: a local header may declare sizes of zero and
 * defer them to a trailing descriptor, and the central directory always has the
 * real ones.
 */
async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map<string, Uint8Array>();

  // Find the end-of-central-directory record, scanning back from the end
  // because it is followed by a comment of unknown length.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66_000; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new SpreadsheetError('That file is not a readable Excel workbook.');

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();

  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    // The local header's own name and extra fields vary in length, so where the
    // data starts can only be worked out from the local header itself.
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(start, start + compressedSize);

    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, await inflateRaw(data));
    // Anything else (bzip2, LZMA) is vanishingly rare in .xlsx; skipping the
    // part is better than failing the whole file, and a missing sheet is
    // reported by the caller.

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new SpreadsheetError(
      'This browser is too old to open Excel files. Open the till in Chrome or Edge, ' +
      'or save the file as CSV and import that instead.',
    );
  }
  // Copied into its own buffer: `data` is a view into the whole file, and Blob
  // wants a standalone ArrayBuffer rather than a slice of a larger one.
  const stream = new Blob([data.slice().buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
