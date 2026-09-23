#!/usr/bin/env node
/**
 * Checks the spreadsheet reader against real files.
 *
 * The reader is deliberately built on the browser's own DecompressionStream and
 * DOMParser, so it cannot be exercised by `npm test` in Node — there is no DOM.
 * This drives it in a real browser instead.
 *
 *   node scripts/check-spreadsheet.mjs
 *
 * Needs Playwright and a Chromium. Set CHROME to point at a browser if the
 * usual locations do not apply.
 *
 * The fixtures in import-fixtures/ were written by three different producers on
 * purpose. openpyxl writes inline strings; xlsxwriter writes a shared string
 * table; Excel itself does the latter. edge.xlsx is hand-built for the cases
 * neither library produces — cached formula results, booleans, error cells, the
 * 1900 leap-year bug, sparse columns and a column past Z.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'import-fixtures');
const PORT = 4187;

const CHROME = process.env.CHROME
  ?? ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium', '/usr/bin/google-chrome']
    .find((p) => existsSync(p));

/** What each fixture must produce. Written out rather than snapshotted so a
 *  change to the reader has to be defended, not just re-recorded. */
const EXPECTED = {
  'stocktake.xlsx': {
    sheets: 2,
    checks: [
      ['inline strings', (s) => s[0].rows[0][0] === 'Item Name'],
      ['Urdu survives', (s) => s[0].rows[1][1] === 'آٹا'],
      ['decimal quantity', (s) => s[0].rows[1][7] === '25.5'],
      ['date from a custom format', (s) => s[0].rows[2][9] === '2027-06-30'],
      ['blank row stays blank', (s) => s[0].rows[4].length === 0],
      ['numbers stored as text', (s) => s[0].rows[7][6] === '178'],
      ['second sheet kept separate', (s) => s[1].name === 'Notes'],
    ],
  },
  'pricelist.xlsx': {
    sheets: 1,
    checks: [
      ['shared string table', (s) => s[0].rows[0][0] === 'Product'],
      ['date', (s) => s[0].rows[2][4] === '2028-01-31'],
      ['short row has no padding', (s) => s[0].rows[1].length === 3],
    ],
  },
  'edge.xlsx': {
    sheets: 1,
    checks: [
      ['sparse columns keep their position', (s) => s[0].rows[0][2] === 'Third'],
      ['column past Z', (s) => s[0].rows[0][26] === 'Col27'],
      ['cached formula number', (s) => s[0].rows[1][0] === '3'],
      ['cached formula string', (s) => s[0].rows[1][1] === 'abcd'],
      ['boolean', (s) => s[0].rows[1][2] === 'TRUE'],
      ['error cell is empty, not #REF!', (s) => s[0].rows[1][3] === ''],
      ['1900 bug: serial 61 is 1 March', (s) => s[0].rows[2][2] === '1900-03-01'],
      ['modern serial', (s) => s[0].rows[2][3] === '2026-06-30'],
      ['split runs joined', (s) => s[0].rows[4][1] === 'Split Runs'],
    ],
  },
};

if (!CHROME) {
  console.error('No Chromium found. Set CHROME=/path/to/chrome and try again.');
  process.exit(2);
}

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('This check needs playwright-core: npm i -D playwright-core');
  process.exit(2);
}

const bundle = await build({
  entryPoints: [join(here, '..', 'src', 'lib', 'spreadsheet.ts')],
  bundle: true,
  format: 'esm',
  write: false,
});
const js = bundle.outputFiles[0].text;

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (url === '/spreadsheet.js') {
    res.setHeader('content-type', 'text/javascript');
    return res.end(js);
  }
  if (url === '/') {
    res.setHeader('content-type', 'text/html');
    return res.end('<!doctype html><meta charset="utf-8"><title>check</title>');
  }
  const file = join(fixtures, url.slice(1));
  if (file.startsWith(fixtures) && existsSync(file)) return res.end(readFileSync(file));
  res.statusCode = 404;
  res.end('not found');
});
await new Promise((resolve) => server.listen(PORT, resolve));

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
// Must be on the server's origin: the reader is loaded as a module by a
// relative path, which about:blank cannot resolve.
await page.goto(`http://localhost:${PORT}/`);

let failures = 0;
for (const [file, spec] of Object.entries(EXPECTED)) {
  const sheets = await page.evaluate(async (name) => {
    const { readSpreadsheet } = await import('/spreadsheet.js');
    const blob = await (await fetch(`/${name}`)).blob();
    return readSpreadsheet(new File([blob], name));
  }, file).catch((err) => ({ error: err.message }));

  if (!Array.isArray(sheets)) {
    console.log(`FAIL ${file}: ${sheets?.error ?? 'did not parse'}`);
    failures += 1;
    continue;
  }
  console.log(`\n${file} — ${sheets.length} sheet(s)`);
  if (sheets.length !== spec.sheets) {
    console.log(`  FAIL expected ${spec.sheets} sheet(s)`);
    failures += 1;
  }
  for (const [label, check] of spec.checks) {
    let ok = false;
    try { ok = check(sheets); } catch { ok = false; }
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) failures += 1;
  }
}

await browser.close();
server.close();
console.log(failures === 0 ? '\nAll spreadsheet checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
