import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = process.env.POS_DATA_DIR
  ? path.resolve(process.env.POS_DATA_DIR)
  : path.join(here, 'data');

export const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

/**
 * The sales-tax rates a new shop starts with. These are a starting point, not a
 * ruling: rates move with each Finance Act, so they are editable from Settings
 * and nothing in the code assumes these particular numbers.
 */
export const DEFAULT_TAX_RATES = [
  { rate: 0, label: 'Exempt / not shown' },
  { rate: 1, label: 'Registered drug' },
  { rate: 18, label: 'Standard rate' },
];

/** Shape of an empty database. Every collection is a plain array. */
export function emptyDb() {
  return {
    version: 1,
    settings: {
      // Every field a receipt prints starts blank or as an obvious placeholder,
      // and the receipt omits the blanks rather than printing something made up.
      // A drug licence number and a pharmacist's name are claims the shop makes
      // to its customers and its regulator; shipping plausible-looking ones
      // invites a shop to print somebody else's by simply not opening Settings.
      shopName: 'Your Pharmacy',
      addressLine1: '',
      addressLine2: '',
      phone: '',
      email: '',
      ntn: '',
      strn: '',
      drugLicense: '',
      pharmacist: '',
      currency: 'PKR',
      currencySymbol: 'Rs',
      invoicePrefix: 'INV',
      nextInvoiceSeq: 1,
      lowStockThreshold: 20,
      expiryAlertDays: 90,
      // Sales tax applied to a new medicine unless you change it on the product.
      // 0% suits a retailer whose registered-drug tax was already discharged
      // upstream; raise it if your shop accounts for output tax itself.
      defaultTaxRate: 0,
      // The rates offered when editing a medicine. Entirely yours to change —
      // add, remove or relabel rows from Settings.
      taxRates: DEFAULT_TAX_RATES.map((r) => ({ ...r })),
      roundOffTotals: true,
      // Unattended backups. Point backupFolder at a USB stick or synced folder
      // so a copy of the shop's records leaves the building.
      backupEnabled: true,
      backupIntervalHours: 6,
      backupKeep: 14,
      backupFolder: '',
      footerNote: 'Medicines once sold are not returnable without a valid bill.',
    },
    products: [],
    batches: [],
    customers: [],
    sales: [],
    payments: [],
    audit: [],
  };
}

let cache = null;
/** Serializes writes so concurrent requests can't interleave read-modify-write. */
let writeChain = Promise.resolve();

/**
 * Brings an older db.json up to date in memory. Kept idempotent and silent so a
 * shop that has been running for months can upgrade without losing history.
 */
function migrate(db) {
  // 'upi' was the India-era name for what is now the 'digital' tender
  // (EasyPaisa / JazzCash / QR). Past bills keep their totals, only the label moves.
  for (const sale of db.sales) {
    if (sale.paymentMode === 'upi') sale.paymentMode = 'digital';
  }
  for (const payment of db.payments) {
    if (payment.mode === 'upi') payment.mode = 'digital';
  }

  // India's GST fields become Pakistan's single sales tax. Rates and totals are
  // carried over untouched — only the names change, so past bills still add up.
  const renameTax = (row) => {
    if (row.gstRate !== undefined && row.taxRate === undefined) row.taxRate = row.gstRate;
    if (row.hsn !== undefined && row.hsCode === undefined) row.hsCode = row.hsn;
    delete row.gstRate;
    delete row.hsn;
  };
  for (const product of db.products) renameTax(product);
  for (const sale of db.sales) {
    for (const item of sale.items) renameTax(item);
    // CGST/SGST were only ever `tax` halved; the single `tax` figure is the truth.
    delete sale.cgst;
    delete sale.sgst;
  }
  if (db.settings.gstin !== undefined) {
    if (!db.settings.ntn) db.settings.ntn = db.settings.gstin;
    delete db.settings.gstin;
  }
  if (!Array.isArray(db.settings.taxRates) || db.settings.taxRates.length === 0) {
    db.settings.taxRates = DEFAULT_TAX_RATES.map((r) => ({ ...r }));
  }
  // Any rate already in use on a product must stay selectable, even if the
  // shop's list no longer mentions it — otherwise editing that product would
  // silently change its tax.
  const listed = new Set(db.settings.taxRates.map((r) => r.rate));
  for (const product of db.products) {
    if (typeof product.taxRate === 'number' && !listed.has(product.taxRate)) {
      db.settings.taxRates.push({ rate: product.taxRate, label: 'In use' });
      listed.add(product.taxRate);
    }
  }
  db.settings.taxRates.sort((a, b) => a.rate - b.rate);
}

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/** Reads the database from disk once, then serves it from memory. */
export function readDb() {
  if (cache) return cache;
  ensureDirs();
  if (!fs.existsSync(DB_FILE)) {
    cache = emptyDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(cache, null, 2));
    return cache;
  }
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    // Merge so a db.json written by an older version still boots.
    cache = { ...emptyDb(), ...parsed, settings: { ...emptyDb().settings, ...(parsed.settings ?? {}) } };
    migrate(cache);
  } catch (err) {
    const rescued = path.join(BACKUP_DIR, `corrupt-${Date.now()}.json`);
    fs.copyFileSync(DB_FILE, rescued);
    console.error(`[db] db.json is not valid JSON, moved a copy to ${rescued} and started empty.`);
    cache = emptyDb();
  }
  return cache;
}

/**
 * Applies `mutator` to the database and persists the result.
 * Writes go to a temp file first and are renamed into place, so a crash
 * mid-write can never leave a half-written db.json behind.
 */
export function writeDb(mutator) {
  const run = async () => {
    const db = readDb();
    const result = mutator(db);
    ensureDirs();
    const tmp = `${DB_FILE}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(db, null, 2));
    await fsp.rename(tmp, DB_FILE);
    return result;
  };
  writeChain = writeChain.then(run, run);
  return writeChain;
}

/** Point-in-time copy of db.json, used before destructive imports. */
export async function backup(label = 'manual') {
  ensureDirs();
  const target = path.join(BACKUP_DIR, `${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await fsp.writeFile(target, JSON.stringify(readDb(), null, 2));
  return target;
}

/** Replaces the whole database (used by the restore/import endpoint). */
export async function replaceDb(next) {
  await backup('pre-import');
  cache = { ...emptyDb(), ...next, settings: { ...emptyDb().settings, ...(next.settings ?? {}) } };
  return writeDb(() => cache);
}

export function resetCache() {
  cache = null;
}

let counter = 0;
/** Short, sortable, collision-resistant id. */
export function id(prefix = 'x') {
  counter = (counter + 1) % 4096;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(3, '0')}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}
