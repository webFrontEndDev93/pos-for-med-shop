/**
 * Bulk import of a stock list from a spreadsheet.
 *
 * Built around the assumption that the file will not match our column names,
 * because it never does — it comes from a supplier, an old till, or whatever a
 * cousin typed up. So the shop picks its file, the columns are guessed and then
 * corrected by hand, and the whole thing is shown row by row before a single
 * record changes.
 *
 * The preview is the point. It says what will be created, what will be matched
 * to something already here, what is wrong with row 47, and — importantly —
 * what each item's stock will become, so a file imported twice by accident
 * shows up as a doubled weight before it is written rather than after.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { readSpreadsheet, SpreadsheetError, type Sheet } from '../lib/spreadsheet';
import { Badge, Button, Field, Modal } from './ui';
import { Icon } from './Icon';

/** A column we can fill from the sheet, with the header names people actually use. */
interface ImportField {
  key: string;
  label: string;
  hint?: string;
  required?: boolean;
  aliases: string[];
}

const FIELDS: ImportField[] = [
  { key: 'name', label: 'Brand name', required: true, aliases: ['name', 'item', 'item name', 'product', 'product name', 'brand name', 'description', 'particulars', 'medicine', 'title'] },
  { key: 'genericName', label: 'Generic / salt', aliases: ['generic', 'generic name', 'salt', 'composition', 'molecule'] },
  { key: 'manufacturer', label: 'Manufacturer', aliases: ['manufacturer', 'company', 'make', 'mfr', 'brand'] },
  { key: 'category', label: 'Category', aliases: ['category', 'type', 'group', 'therapeutic'] },
  { key: 'form', label: 'Form', hint: 'Tablet, Syrup, Injection…', aliases: ['form', 'dosage form', 'presentation'] },
  { key: 'strength', label: 'Strength', aliases: ['strength', 'mg', 'dose', 'potency'] },
  { key: 'packSize', label: 'Pack size', aliases: ['pack', 'pack size', 'packing', 'size', 'units per pack'] },
  { key: 'batchNo', label: 'Batch number', hint: 'Needed to put stock on the shelf', aliases: ['batch', 'batch no', 'batch number', 'lot', 'lot no'] },
  { key: 'expiry', label: 'Expiry date', hint: 'Needed to put stock on the shelf', aliases: ['expiry', 'exp', 'expiry date', 'exp date', 'use by'] },
  { key: 'mrp', label: 'Printed MRP', hint: 'Needed to put stock on the shelf', aliases: ['mrp', 'printed price', 'list price', 'retail price'] },
  { key: 'salePrice', label: 'Sale price', hint: 'Leave blank to sell at MRP', aliases: ['price', 'rate', 'sale price', 'selling price', 'net rate'] },
  { key: 'costPrice', label: 'Purchase cost', aliases: ['cost', 'cost price', 'purchase', 'purchase price', 'trade price', 'tp'] },
  { key: 'quantity', label: 'Quantity in stock', aliases: ['qty', 'quantity', 'stock', 'count', 'balance', 'on hand'] },
  { key: 'supplier', label: 'Supplier', aliases: ['supplier', 'vendor', 'party', 'distributor'] },
  { key: 'barcode', label: 'Barcode', aliases: ['barcode', 'bar code', 'ean', 'upc', 'code', 'sku'] },
  { key: 'taxRate', label: 'Tax %', aliases: ['tax', 'tax %', 'tax rate', 'gst', 'sales tax'] },
  { key: 'hsCode', label: 'HS code', aliases: ['hs', 'hs code', 'hsn'] },
  { key: 'prescriptionRequired', label: 'Prescription only', hint: 'Yes / No', aliases: ['rx', 'prescription', 'prescription only', 'schedule', 'pom'] },
  { key: 'rack', label: 'Rack / shelf', aliases: ['rack', 'shelf', 'location', 'bin'] },
  { key: 'reorderLevel', label: 'Reorder level', aliases: ['reorder', 'reorder level', 'min', 'min stock', 'minimum'] },
];

interface PreviewRow {
  line: number;
  name: string;
  action: 'create' | 'update' | 'error';
  matchedBy: string | null;
  unit: string;
  errors: string[];
  stockBefore: number;
  stockAfter: number;
  addingLabel: string;
}

interface Preview {
  creates: number;
  updates: number;
  failed: number;
  rows: PreviewRow[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();

/**
 * Guesses which sheet column feeds which field.
 *
 * Exact header matches first, across every field, before any loose match is
 * considered. Otherwise a sheet with both "Price" and "Cost Price" could have
 * "Cost Price" grabbed by `salePrice` on a partial match before `costPrice`
 * ever got to claim it.
 */
export function guessMapping(headers: string[]): Record<string, number> {
  const mapping: Record<string, number> = {};
  const taken = new Set<number>();
  const normalised = headers.map(norm);

  for (const field of FIELDS) {
    const exact = normalised.findIndex((h, i) => !taken.has(i) && h !== '' && field.aliases.includes(h));
    if (exact >= 0) { mapping[field.key] = exact; taken.add(exact); }
  }
  for (const field of FIELDS) {
    if (mapping[field.key] !== undefined) continue;
    const loose = normalised.findIndex(
      (h, i) => !taken.has(i) && h !== '' && field.aliases.some((a) => h === a || h.startsWith(`${a} `) || h.endsWith(` ${a}`)),
    );
    if (loose >= 0) { mapping[field.key] = loose; taken.add(loose); }
  }
  return mapping;
}

/** The first row that looks like headings rather than a title or a blank. */
function guessHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
    const filled = rows[i].filter((c) => c.trim() !== '').length;
    if (filled >= 2) return i;
  }
  return 0;
}

export function ImportWizard({ onClose }: { onClose: () => void }) {
  const { reload, notify, reportError } = useStore();
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const sheet = sheets?.[sheetIndex] ?? null;
  const headers = sheet?.rows[headerRow] ?? [];

  const dataRows = useMemo(() => {
    if (!sheet) return [];
    return sheet.rows
      .slice(headerRow + 1)
      .filter((row) => row.some((cell) => cell.trim() !== ''));
  }, [sheet, headerRow]);

  /** Sheet rows turned into the shape the server expects, using the current mapping. */
  const mappedRows = useMemo(() => dataRows.map((row) => {
    const out: Record<string, string> = {};
    for (const field of FIELDS) {
      const column = mapping[field.key];
      if (column === undefined) continue;
      // Trailing empty cells are simply absent from a sheet row, so a short row
      // is normal rather than a problem.
      const value = (row[column] ?? '').trim();
      if (value !== '') out[field.key] = value;
    }
    return out;
  }), [dataRows, mapping]);

  const openFile = useCallback(async (file: File) => {
    setBusy(true);
    setReadError(null);
    setPreview(null);
    try {
      const parsed = await readSpreadsheet(file);
      // Sheets are often padded with empty ones; land on the first with data.
      const firstWithData = Math.max(0, parsed.findIndex((s) => s.rows.some((r) => r.some((c) => c.trim() !== ''))));
      const chosen = parsed[firstWithData] ?? parsed[0];
      const header = guessHeaderRow(chosen.rows);
      setSheets(parsed);
      setFileName(file.name);
      setSheetIndex(firstWithData);
      setHeaderRow(header);
      setMapping(guessMapping(chosen.rows[header] ?? []));
    } catch (error) {
      setSheets(null);
      setReadError(error instanceof SpreadsheetError ? error.message : 'That file could not be read.');
    } finally {
      setBusy(false);
    }
  }, []);

  const chooseSheet = (index: number) => {
    const chosen = sheets?.[index];
    if (!chosen) return;
    const header = guessHeaderRow(chosen.rows);
    setSheetIndex(index);
    setHeaderRow(header);
    setMapping(guessMapping(chosen.rows[header] ?? []));
    setPreview(null);
  };

  const changeHeaderRow = (index: number) => {
    setHeaderRow(index);
    setMapping(guessMapping(sheet?.rows[index] ?? []));
    setPreview(null);
  };

  const check = async () => {
    setBusy(true);
    try {
      setPreview(await api.importPreview(mappedRows));
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    setBusy(true);
    try {
      const result = await api.importRows(mappedRows);
      await reload();
      notify('success', 'Stock list imported', result.summary);
      onClose();
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  };

  const nameMapped = mapping.name !== undefined;
  const canCheck = nameMapped && mappedRows.length > 0 && !busy;
  const canCommit = Boolean(preview) && preview!.failed === 0 && preview!.rows.length > 0 && !busy;
  /** Rows that will pile stock on top of a count the shop already has. */
  const addsToExisting = preview
    ? preview.rows.filter((r) => r.action === 'update' && r.stockBefore > 0 && r.stockAfter > r.stockBefore).length
    : 0;

  return (
    <Modal
      title="Import a stock list"
      subtitle="Excel (.xlsx) or CSV. Nothing is saved until you have seen the preview."
      width="62rem"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {sheet && !preview && (
            <Button variant="primary" onClick={check} disabled={!canCheck}>
              {busy ? 'Checking…' : `Check ${mappedRows.length} row${mappedRows.length === 1 ? '' : 's'}`}
            </Button>
          )}
          {preview && (
            <>
              <Button onClick={() => setPreview(null)} disabled={busy}>Back to columns</Button>
              <Button variant="primary" onClick={commit} disabled={!canCommit}>
                {busy ? 'Importing…' : `Import ${preview.rows.length} row${preview.rows.length === 1 ? '' : 's'}`}
              </Button>
            </>
          )}
        </>
      }
    >
      {!sheet && (
        <div className="import-drop">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void openFile(f); }}
          />
          <span className="import-drop-icon"><Icon name="upload" size={26} /></span>
          <h3>Choose your spreadsheet</h3>
          <p className="muted">
            One row per medicine batch. It does not need our column names — you will match them up next.
          </p>
          <Button variant="primary" icon="upload" onClick={() => fileInput.current?.click()} disabled={busy}>
            {busy ? 'Reading…' : 'Choose file'}
          </Button>
          <button type="button" className="link-button" onClick={downloadTemplate}>
            Download a blank template
          </button>
          {readError && <p className="import-error">{readError}</p>}
        </div>
      )}

      {sheet && !preview && (
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <div className="row-between import-file">
            <span className="row" style={{ gap: 6 }}>
              <Icon name="receipt" size={14} className="muted" />
              <strong>{fileName}</strong>
              <span className="muted">· {dataRows.length} row{dataRows.length === 1 ? '' : 's'}</span>
            </span>
            <button type="button" className="link-button" onClick={() => { setSheets(null); setPreview(null); }}>
              Choose a different file
            </button>
          </div>

          <div className="form-grid">
            {sheets && sheets.length > 1 && (
              <Field label="Sheet">
                <select className="select" value={sheetIndex} onChange={(e) => chooseSheet(Number(e.target.value))}>
                  {sheets.map((s, i) => <option key={s.name + i} value={i}>{s.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Headings are on row" hint="Skip any title rows above your column names.">
              <select className="select" value={headerRow} onChange={(e) => changeHeaderRow(Number(e.target.value))}>
                {(sheet.rows.slice(0, 20)).map((row, i) => (
                  <option key={i} value={i}>
                    Row {i + 1} — {row.filter(Boolean).slice(0, 4).join(', ').slice(0, 48) || '(empty)'}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div>
            <h4 className="import-heading">Match your columns</h4>
            <p className="muted" style={{ fontSize: 'var(--text-xs)', marginBottom: 'var(--space-3)' }}>
              Guessed from your headings. Anything left as “Not in this file” is simply not imported —
              existing items keep whatever they already have.
            </p>
            <div className="import-map">
              {FIELDS.map((field) => (
                <label key={field.key} className="import-map-row">
                  <span className="import-map-label">
                    {field.label}
                    {field.required && <span className="import-required"> *</span>}
                    {field.hint && <span className="import-map-hint">{field.hint}</span>}
                  </span>
                  <select
                    className="select"
                    value={mapping[field.key] ?? ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      setPreview(null);
                      setMapping((current) => {
                        const next = { ...current };
                        if (value === '') delete next[field.key];
                        else next[field.key] = Number(value);
                        return next;
                      });
                    }}
                  >
                    <option value="">Not in this file</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>{h.trim() || `Column ${i + 1}`}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {!nameMapped && (
              <p className="import-error">Pick the column holding the item name before continuing.</p>
            )}
          </div>

          <details className="import-peek">
            <summary>Show the first rows as we read them</summary>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>{FIELDS.filter((f) => mapping[f.key] !== undefined).map((f) => <th key={f.key}>{f.label}</th>)}</tr>
                </thead>
                <tbody>
                  {mappedRows.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      {FIELDS.filter((f) => mapping[f.key] !== undefined).map((f) => (
                        <td key={f.key} className="truncate">{row[f.key] ?? <span className="muted">—</span>}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}

      {preview && (
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <div className="import-summary">
            <span><strong>{preview.creates}</strong> new item{preview.creates === 1 ? '' : 's'}</span>
            <span><strong>{preview.updates}</strong> matched to existing</span>
            {preview.failed > 0
              ? <span className="import-summary-bad"><strong>{preview.failed}</strong> cannot be imported</span>
              : <span className="import-summary-ok">nothing wrong</span>}
          </div>

          {/*
            * The stock column already shows the arithmetic, but "nothing wrong"
            * sitting beside it reads as reassurance at exactly the moment a
            * shopkeeper might be about to import the same file twice. Adding to
            * stock is the correct behaviour — a delivery is a delivery — so this
            * names it rather than blocking it.
            */}
          {preview.failed === 0 && addsToExisting > 0 && (
            <p className="import-warn">
              <Icon name="alert" size={13} />
              {addsToExisting === 1
                ? '1 of these items already has stock. Importing adds to it rather than replacing it.'
                : `${addsToExisting} of these items already have stock. Importing adds to what is there rather than replacing it — check the arrows below if you may have imported this file before.`}
            </p>
          )}

          {preview.failed > 0 && (
            <p className="import-error">
              Fix these rows in the spreadsheet and choose the file again. Nothing is imported while any row is wrong —
              a half-finished import is impossible to unpick.
            </p>
          )}

          <div className="table-wrap" style={{ maxHeight: '22rem' }}>
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: '3.5rem' }}>Row</th>
                  <th>Item</th>
                  <th style={{ width: '7rem' }}>What happens</th>
                  <th className="right" style={{ width: '11rem' }}>Stock</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.line} data-bad={row.action === 'error' ? 'true' : undefined}>
                    <td className="muted num">{row.line}</td>
                    <td>
                      <span className="truncate">{row.name || <span className="muted">(no name)</span>}</span>
                      {row.errors.length > 0 && <div className="import-row-error">{row.errors.join(' ')}</div>}
                    </td>
                    <td>
                      {row.action === 'create' && <Badge tone="success">New</Badge>}
                      {row.action === 'update' && <Badge tone="info">Matched{row.matchedBy === 'barcode' ? ' by barcode' : ''}</Badge>}
                      {row.action === 'error' && <Badge tone="danger">Problem</Badge>}
                    </td>
                    <td className="right num">
                      {row.action === 'error' || row.stockAfter === row.stockBefore ? (
                        <span className="muted">—</span>
                      ) : (
                        <>
                          {fmt(row.stockBefore, row.unit)} → <strong>{fmt(row.stockAfter, row.unit)}</strong>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

const fmt = (qty: number, unit: string) => `${qty} ${unit || 'unit'}`;

/**
 * A blank template.
 *
 * CSV rather than .xlsx: Excel opens it without complaint, it is legible if
 * someone opens it in Notepad, and writing a real workbook would mean shipping
 * a zip writer to solve a problem nobody has.
 */
function downloadTemplate() {
  const headers = FIELDS.map((f) => f.label);
  const example = [
    'Panadol 500mg', 'Paracetamol', 'Haleon Pakistan', 'Analgesic', 'Tablet', '500mg', '10 tablets',
    'PAN2417', '2028-03-31', '45.00', '45.00', '35.10', '120', 'Muller & Phipps', '8960001234567',
    '1', '3004', 'No', 'B3', '20',
  ];
  const second = [
    'Augmentin 625mg', 'Amoxicillin + Clavulanate', 'GSK', 'Antibiotic', 'Tablet', '625mg', '6 tablets',
    'AUG9921', '2027-11-30', '520.00', '520.00', '405.00', '40', 'United Distributors', '',
    '1', '3004', 'Yes', 'C1', '10',
  ];
  const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = [headers, example, second].map((r) => r.map(quote).join(',')).join('\r\n');

  // The BOM is what makes Excel read the Urdu column as UTF-8 rather than
  // mojibake when the file is double-clicked on a Windows machine.
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'dawakhana-stock-template.csv';
  link.click();
  URL.revokeObjectURL(url);
}

