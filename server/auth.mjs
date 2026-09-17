import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './db.mjs';

/**
 * Passcode gate for the till.
 *
 * The credential lives in its own file, NOT in db.json, so that a backup a shop
 * emails to itself or hands to someone never carries the hash. Restoring a
 * backup onto a new machine therefore asks for a new passcode, which is the
 * behaviour you want.
 *
 * Set POS_AUTH=off to disable the gate entirely — for development, or a
 * single-owner shop that keeps the laptop locked instead.
 */

const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
export const COOKIE = 'medipos_session';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;   // a long counter shift
const MIN_PASSCODE = 4;
const MAX_FAILS = 5;
const LOCK_BASE_MS = 30_000;

export const authEnabled = () => String(process.env.POS_AUTH ?? '').toLowerCase() !== 'off';

/* ------------------------------------------------------------- credential */

function readAuth() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export const isConfigured = () => readAuth() !== null;

function hash(passcode, salt) {
  // scrypt is deliberately slow; these parameters take ~100ms on a cheap laptop,
  // which is invisible at a counter but expensive for anyone guessing.
  return crypto.scryptSync(passcode, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}

export async function setPasscode(passcode) {
  const value = String(passcode ?? '');
  if (value.length < MIN_PASSCODE) {
    throw new Error(`The passcode must be at least ${MIN_PASSCODE} characters.`);
  }
  const salt = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${AUTH_FILE}.tmp`;
  await fsp.writeFile(
    tmp,
    JSON.stringify({ algorithm: 'scrypt', salt, hash: hash(value, salt), updatedAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 },
  );
  await fsp.rename(tmp, AUTH_FILE);
}

export function verifyPasscode(passcode) {
  const stored = readAuth();
  if (!stored) return false;
  const candidate = Buffer.from(hash(String(passcode ?? ''), stored.salt), 'hex');
  const expected = Buffer.from(stored.hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

/* ---------------------------------------------------------------- sessions */

// In memory on purpose: a restart signs the counter out, which is the safer
// default for a shared machine. Staff re-enter the passcode in a few seconds.
const sessions = new Map();

function sweep() {
  const now = Date.now();
  for (const [token, expires] of sessions) if (expires <= now) sessions.delete(token);
}

export function createSession() {
  sweep();
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

/** Valid session tokens slide forward, so an active till never times out mid-shift. */
export function validateSession(token) {
  if (!token) return false;
  const expires = sessions.get(token);
  if (!expires || expires <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return true;
}

export const destroySession = (token) => sessions.delete(token);
export const destroyAllSessions = () => sessions.clear();

/* ------------------------------------------------------------ rate limits */

const attempts = new Map();

/** Remaining lockout in ms, or 0 if this caller may try a passcode now. */
export function lockedFor(key) {
  const record = attempts.get(key);
  if (!record?.lockedUntil) return 0;
  const left = record.lockedUntil - Date.now();
  if (left <= 0) {
    attempts.delete(key);
    return 0;
  }
  return left;
}

export function recordFailure(key) {
  const record = attempts.get(key) ?? { fails: 0, lockedUntil: 0 };
  record.fails += 1;
  if (record.fails >= MAX_FAILS) {
    // Back off harder each time a locked-out caller keeps guessing.
    const over = record.fails - MAX_FAILS;
    record.lockedUntil = Date.now() + LOCK_BASE_MS * 2 ** Math.min(over, 5);
  }
  attempts.set(key, record);
  return record;
}

export const clearFailures = (key) => attempts.delete(key);

/* ----------------------------------------------------------------- cookie */

export function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * Secure is deliberately omitted: a shop till is served over plain http on
 * localhost or the shop LAN, and a Secure cookie would simply never be sent.
 */
export const sessionCookie = (token) =>
  `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`;

export const clearCookie = () => `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;

export const MIN_PASSCODE_LENGTH = MIN_PASSCODE;
