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

/** Shape of an empty database. Every collection is a plain array. */
export function emptyDb() {
  return {
    version: 1,
    settings: {
      shopName: 'MediPOS Pharmacy',
      addressLine1: '12 Gandhi Road',
      addressLine2: 'Bengaluru, Karnataka 560001',
      phone: '+91 98450 00000',
      email: 'care@medipos.example',
      gstin: '29ABCDE1234F1Z5',
      drugLicense: 'KA-B-20-123456',
      pharmacist: 'Dr. A. Rao, B.Pharm',
      currency: 'INR',
      currencySymbol: '₹',
      invoicePrefix: 'INV',
      nextInvoiceSeq: 1,
      lowStockThreshold: 20,
      expiryAlertDays: 90,
      roundOffTotals: true,
      footerNote: 'Medicines once sold are not returnable without a valid bill.',
    },
    products: [],
    batches: [],
    customers: [],
    sales: [],
    payments: [],
  };
}

let cache = null;
/** Serializes writes so concurrent requests can't interleave read-modify-write. */
let writeChain = Promise.resolve();

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
