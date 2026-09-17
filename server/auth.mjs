import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './db.mjs';

/**
 * Passcode gate for the till, with two roles.
 *
 * - admin: the owner. Can do everything.
 * - staff: the counter. Can bill, look up stock and take udhaar payments, but
 *   cannot void a bill, see takings, change prices or open Settings.
 *
 * A staff session can be lifted to admin for a few minutes by entering the
 * admin passcode ("manager override"), which is how a shop actually works: the
 * owner walks over and approves the void rather than everyone sharing one code.
 *
 * Credentials live in their own file, NOT in db.json, so that a backup a shop
 * emails to itself never carries the hashes. Restoring a backup onto a new
 * machine therefore asks for new passcodes, which is the behaviour you want.
 *
 * Set POS_AUTH=off to disable the gate entirely — for development, or a
 * single-owner shop that keeps the laptop locked instead.
 */

const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
export const COOKIE = 'medipos_session';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;   // a long counter shift
const ELEVATION_MS = 5 * 60 * 1000;           // long enough to approve a few things
const MIN_PASSCODE = 4;
const MAX_FAILS = 5;
const LOCK_BASE_MS = 30_000;

export const ROLES = ['admin', 'staff'];

export const authEnabled = () => String(process.env.POS_AUTH ?? '').toLowerCase() !== 'off';

/* ------------------------------------------------------------- credential */

function readAuth() {
  let stored;
  try {
    stored = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  } catch {
    return null;
  }
  // A till set up before roles existed had one passcode at the top level.
  // That person is the owner, so it becomes the admin code and the counter
  // carries on unchanged until a staff code is added.
  if (!stored.version && stored.salt && stored.hash) {
    return { version: 2, algorithm: 'scrypt', admin: { salt: stored.salt, hash: stored.hash }, staff: null };
  }
  return stored;
}

/** True once an admin passcode exists. A staff passcode is always optional. */
export const isConfigured = () => Boolean(readAuth()?.admin);

/** Whether a separate counter passcode has been set up. */
export const hasStaffPasscode = () => Boolean(readAuth()?.staff);

function hash(passcode, salt) {
  // scrypt is deliberately slow; these parameters take ~100ms on a cheap laptop,
  // which is invisible at a counter but expensive for anyone guessing.
  return crypto.scryptSync(passcode, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}

function credential(passcode) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: hash(passcode, salt) };
}

/**
 * Writes one role's passcode. Passing an empty staff passcode removes it, which
 * puts the shop back to a single shared admin code.
 */
export async function setPasscode(passcode, role = 'admin') {
  if (!ROLES.includes(role)) throw new Error('Unknown role.');
  const value = String(passcode ?? '');
  const current = readAuth() ?? { version: 2, admin: null, staff: null };

  if (role === 'staff' && value === '') {
    current.staff = null;
  } else {
    if (value.length < MIN_PASSCODE) {
      throw new Error(`The passcode must be at least ${MIN_PASSCODE} characters.`);
    }
    // Two identical codes would silently collapse the two roles into one.
    const other = role === 'admin' ? current.staff : current.admin;
    if (other && matches(value, other)) {
      throw new Error('The counter and owner passcodes must be different.');
    }
    current[role] = credential(value);
  }

  current.version = 2;
  current.algorithm = 'scrypt';
  current.updatedAt = new Date().toISOString();

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${AUTH_FILE}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(current, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, AUTH_FILE);
}

function matches(passcode, stored) {
  if (!stored?.salt || !stored?.hash) return false;
  const candidate = Buffer.from(hash(String(passcode ?? ''), stored.salt), 'hex');
  const expected = Buffer.from(stored.hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

/** Returns the role this passcode unlocks, or null. Admin wins if both match. */
export function roleFor(passcode) {
  const stored = readAuth();
  if (!stored) return null;
  if (matches(passcode, stored.admin)) return 'admin';
  if (matches(passcode, stored.staff)) return 'staff';
  return null;
}

export const verifyAdmin = (passcode) => roleFor(passcode) === 'admin';

/* ---------------------------------------------------------------- sessions */

// In memory on purpose: a restart signs the counter out, which is the safer
// default for a shared machine. Staff re-enter the passcode in a few seconds.
const sessions = new Map();

function sweep() {
  const now = Date.now();
  for (const [token, expires] of sessions) if (expires <= now) sessions.delete(token);
}

export function createSession(role = 'admin') {
  sweep();
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { role, expires: Date.now() + SESSION_TTL_MS, elevatedUntil: 0 });
  return token;
}

/**
 * Returns the live session, sliding its expiry forward so an active till never
 * times out mid-shift. Null when there is no valid session.
 */
export function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expires <= Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  session.expires = Date.now() + SESSION_TTL_MS;
  return session;
}

export const validateSession = (token) => getSession(token) !== null;

/** True for an admin session, or a staff session currently under manager override. */
export function isAdmin(session) {
  if (!session) return false;
  return session.role === 'admin' || session.elevatedUntil > Date.now();
}

/** Lifts a staff session to admin for a few minutes. */
export function elevate(token) {
  const session = getSession(token);
  if (!session) return false;
  session.elevatedUntil = Date.now() + ELEVATION_MS;
  return true;
}

export function dropElevation(token) {
  const session = getSession(token);
  if (session) session.elevatedUntil = 0;
}

export const elevationSecondsLeft = (session) =>
  session && session.elevatedUntil > Date.now()
    ? Math.ceil((session.elevatedUntil - Date.now()) / 1000)
    : 0;

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
export const ELEVATION_SECONDS = ELEVATION_MS / 1000;
