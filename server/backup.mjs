import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, readDb } from './db.mjs';

/**
 * Unattended backups.
 *
 * The shop's entire record is one JSON file on one laptop, so the realistic
 * failure is not corruption — it is the laptop being dropped, stolen or dying.
 * This writes a dated copy on a schedule, ideally onto a USB stick or a synced
 * folder so a copy leaves the building.
 *
 * Every failure here is non-fatal and logged: an unplugged USB drive must never
 * stop the shop from selling.
 */

const DEFAULT_DIR = path.join(DATA_DIR, 'backups');
const TICK_MS = 5 * 60 * 1000;
const PREFIX = 'dawakhana-';

// Backups written before the product was renamed. They are still ours, so they
// must stay listed and stay subject to pruning — otherwise a shop that has been
// running a while keeps every pre-rename file for ever.
const LEGACY_PREFIXES = ['medipos-'];
const ALL_PREFIXES = [PREFIX, ...LEGACY_PREFIXES];

const isBackup = (name) => name.endsWith('.json') && ALL_PREFIXES.some((p) => name.startsWith(p));

// Sort on the timestamp, never the whole filename: 'dawakhana-' sorts before
// 'medipos-' whatever the dates say, which would have pruning delete the newest
// backups and keep the oldest.
const stampOf = (name) => name.slice((ALL_PREFIXES.find((p) => name.startsWith(p)) ?? '').length);
const byStamp = (a, b) => stampOf(a).localeCompare(stampOf(b));

// A half-disconnected USB stick or an unreachable network share makes fs calls
// hang rather than fail, which would otherwise freeze the request — and, on the
// schedule, quietly consume libuv threadpool slots until the till stops
// responding. Every backup is therefore time-boxed and single-flight.
const IO_TIMEOUT_MS = 20_000;

let timer = null;
let lastRunAt = 0;
let lastResult = null;
let running = false;

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} did not respond within ${IO_TIMEOUT_MS / 1000}s — is the drive connected?`)),
        IO_TIMEOUT_MS,
      ).unref(),
    ),
  ]);
}

export function backupFolder(settings) {
  const configured = String(settings?.backupFolder ?? '').trim();
  return configured ? path.resolve(configured) : DEFAULT_DIR;
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

/** Writes one dated copy and prunes old ones. Returns a result, never throws. */
export async function runBackup(reason = 'manual') {
  if (running) {
    return { ok: false, at: new Date().toISOString(), reason, error: 'A backup is already in progress.' };
  }
  running = true;

  const db = readDb();
  const folder = backupFolder(db.settings);
  const keep = Math.max(1, Math.round(Number(db.settings.backupKeep) || 14));

  try {
    await withTimeout(fsp.mkdir(folder, { recursive: true }), 'The backup folder');
    const file = path.join(folder, `${PREFIX}${stamp()}.json`);
    const tmp = `${file}.tmp`;
    await withTimeout(fsp.writeFile(tmp, JSON.stringify(db, null, 2)), 'Writing the backup');
    await withTimeout(fsp.rename(tmp, file), 'Saving the backup');

    const pruned = await withTimeout(prune(folder, keep), 'Tidying old backups');
    lastRunAt = Date.now();
    lastResult = { ok: true, at: new Date().toISOString(), file, reason, pruned };
    console.log(`[backup] ${reason} → ${file}${pruned ? ` (removed ${pruned} old)` : ''}`);
    return lastResult;
  } catch (err) {
    lastRunAt = Date.now();
    lastResult = { ok: false, at: new Date().toISOString(), reason, error: err.message, folder };
    console.error(`[backup] FAILED (${reason}): ${err.message}`);
    console.error(`[backup] Wanted to write to ${folder} — is the drive connected and writable?`);
    return lastResult;
  } finally {
    running = false;
  }
}

/** Deletes all but the newest `keep` backups. Only touches files we wrote. */
async function prune(folder, keep) {
  const entries = (await fsp.readdir(folder)).filter(isBackup).sort(byStamp);
  const excess = entries.slice(0, Math.max(0, entries.length - keep));
  for (const name of excess) {
    await fsp.unlink(path.join(folder, name)).catch(() => undefined);
  }
  return excess.length;
}

export async function listBackups() {
  const db = readDb();
  const folder = backupFolder(db.settings);
  try {
    const names = (await withTimeout(fsp.readdir(folder), 'Reading the backup folder'))
      .filter(isBackup)
      .sort(byStamp)
      .reverse()
      .slice(0, 30);

    const files = [];
    for (const name of names) {
      const info = await fsp.stat(path.join(folder, name)).catch(() => null);
      if (info) files.push({ name, size: info.size, at: info.mtime.toISOString() });
    }
    return { folder, writable: true, files, last: lastResult };
  } catch (err) {
    return { folder, writable: false, error: err.message, files: [], last: lastResult };
  }
}

/**
 * Ticks every few minutes and backs up once the configured interval has passed.
 * Re-reads settings each tick, so changing the schedule takes effect without a
 * restart.
 */
export function startBackupSchedule() {
  stopBackupSchedule();

  const db = readDb();
  if (db.settings.backupEnabled === false) {
    console.log('[backup] automatic backups are switched off in Settings.');
    return;
  }

  // One on startup, so every day the till is opened leaves at least one copy.
  runBackup('startup');

  timer = setInterval(() => {
    const settings = readDb().settings;
    if (settings.backupEnabled === false) return;
    const hours = Math.max(1, Number(settings.backupIntervalHours) || 6);
    if (Date.now() - lastRunAt >= hours * 3600_000) runBackup('scheduled');
  }, TICK_MS);
  timer.unref?.();
}

export function stopBackupSchedule() {
  if (timer) clearInterval(timer);
  timer = null;
}

export const lastBackup = () => lastResult;
export const defaultBackupFolder = () => DEFAULT_DIR;
export const backupFolderExists = (folder) => fs.existsSync(folder);
