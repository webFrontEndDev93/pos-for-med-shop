import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './db.mjs';

/**
 * Passcode gate for the till.
 *
 * Every person has their own passcode, which is also how the till knows who
 * they are — so a bill can record who rang it up. Two roles:
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
    return { version: 3, users: [] };
  }
  return migrateAuth(stored);
}

/**
 * Brings older credential files forward.
 *
 * v1 had a single passcode; v2 had one shared 'admin' and one shared 'staff'
 * code. Both become named people so that from here on every bill can say who
 * rang it up. The names are a starting point — rename them in Settings.
 */
function migrateAuth(stored) {
  if (stored.version === 3 && Array.isArray(stored.users)) return stored;

  const users = [];
  const add = (name, role, credential) => {
    if (!credential?.salt || !credential?.hash) return;
    users.push({
      id: newId(),
      name,
      role,
      salt: credential.salt,
      hash: credential.hash,
      active: true,
      createdAt: stored.updatedAt ?? new Date().toISOString(),
      lastSignInAt: null,
    });
  };

  if (stored.version === 2) {
    add('Owner', 'admin', stored.admin);
    add('Counter', 'staff', stored.staff);
  } else if (stored.salt && stored.hash) {
    add('Owner', 'admin', { salt: stored.salt, hash: stored.hash });
  }

  return { version: 3, users };
}

async function writeAuth(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${AUTH_FILE}.tmp`;
  await fsp.writeFile(
    tmp,
    JSON.stringify({ ...data, version: 3, updatedAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 },
  );
  await fsp.rename(tmp, AUTH_FILE);
}

const newId = () => `usr_${crypto.randomBytes(8).toString('hex')}`;

/** True once at least one owner exists. */
export const isConfigured = () =>
  readAuth().users.some((u) => u.role === 'admin' && u.active);

/** Everyone, without their hashes — safe to send to the browser. */
export const listUsers = () =>
  readAuth().users.map(({ id, name, role, active, createdAt, lastSignInAt }) => ({
    id, name, role, active, createdAt, lastSignInAt,
  }));

export const countActiveAdmins = () =>
  readAuth().users.filter((u) => u.role === 'admin' && u.active).length;

function hash(passcode, salt) {
  // scrypt is deliberately slow; these parameters take ~100ms on a cheap laptop,
  // which is invisible at a counter but expensive for anyone guessing.
  return crypto.scryptSync(passcode, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}

function matches(passcode, stored) {
  if (!stored?.salt || !stored?.hash) return false;
  const candidate = Buffer.from(hash(String(passcode ?? ''), stored.salt), 'hex');
  const expected = Buffer.from(stored.hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

function assertPasscode(value) {
  if (String(value ?? '').length < MIN_PASSCODE) {
    throw new Error(`The passcode must be at least ${MIN_PASSCODE} characters.`);
  }
}

/**
 * A passcode identifies a person, so two people sharing one would make the till
 * unable to say who rang a bill up. Refuse it rather than guess.
 */
function assertUnique(data, passcode, exceptId = null) {
  const clash = data.users.find((u) => u.id !== exceptId && matches(passcode, u));
  if (clash) throw new Error(`That passcode is already used by ${clash.name}.`);
}

export async function createUser({ name, role, passcode }) {
  const data = readAuth();
  const cleanName = String(name ?? '').trim();
  if (!cleanName) throw new Error('Give this person a name.');
  if (data.users.some((u) => u.name.toLowerCase() === cleanName.toLowerCase())) {
    throw new Error(`There is already someone called ${cleanName}.`);
  }
  assertPasscode(passcode);
  assertUnique(data, passcode);

  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id: newId(),
    name: cleanName,
    role: role === 'staff' ? 'staff' : 'admin',
    salt,
    hash: hash(passcode, salt),
    active: true,
    createdAt: new Date().toISOString(),
    lastSignInAt: null,
  };
  data.users.push(user);
  await writeAuth(data);
  return { id: user.id, name: user.name, role: user.role, active: true };
}

export async function updateUser(id, { name, role, active, passcode }) {
  const data = readAuth();
  const user = data.users.find((u) => u.id === id);
  if (!user) throw new Error('That person is no longer on the list.');

  if (name !== undefined) {
    const cleanName = String(name).trim();
    if (!cleanName) throw new Error('Give this person a name.');
    if (data.users.some((u) => u.id !== id && u.name.toLowerCase() === cleanName.toLowerCase())) {
      throw new Error(`There is already someone called ${cleanName}.`);
    }
    user.name = cleanName;
  }

  // The shop must keep at least one owner who can still sign in, or nobody
  // could ever change anything again.
  const wouldRemoveLastAdmin =
    user.role === 'admin' && user.active &&
    ((role !== undefined && role !== 'admin') || active === false);
  if (wouldRemoveLastAdmin && countActiveAdmins() <= 1) {
    throw new Error('This is the only owner left — make someone else an owner first.');
  }

  if (role !== undefined) user.role = role === 'staff' ? 'staff' : 'admin';
  if (active !== undefined) user.active = Boolean(active);
  if (passcode !== undefined && passcode !== '') {
    assertPasscode(passcode);
    assertUnique(data, passcode, id);
    user.salt = crypto.randomBytes(16).toString('hex');
    user.hash = hash(passcode, user.salt);
  }

  await writeAuth(data);
  return { id: user.id, name: user.name, role: user.role, active: user.active };
}

export async function deleteUser(id) {
  const data = readAuth();
  const user = data.users.find((u) => u.id === id);
  if (!user) throw new Error('That person is no longer on the list.');
  if (user.role === 'admin' && user.active && countActiveAdmins() <= 1) {
    throw new Error('This is the only owner left — make someone else an owner first.');
  }
  data.users = data.users.filter((u) => u.id !== id);
  await writeAuth(data);
  return { id };
}

/** Who this passcode belongs to, or null. Inactive people cannot sign in. */
export function userFor(passcode) {
  const user = readAuth().users.find((u) => u.active && matches(passcode, u));
  return user ? { id: user.id, name: user.name, role: user.role } : null;
}

/** Same, but only owners — used by the manager override. */
export function adminFor(passcode) {
  const user = userFor(passcode);
  return user?.role === 'admin' ? user : null;
}

export async function noteSignIn(id) {
  const data = readAuth();
  const user = data.users.find((u) => u.id === id);
  if (!user) return;
  user.lastSignInAt = new Date().toISOString();
  await writeAuth(data);
}

/* ---------------------------------------------------------------- sessions */

// In memory on purpose: a restart signs the counter out, which is the safer
// default for a shared machine. Staff re-enter the passcode in a few seconds.
const sessions = new Map();

function sweep() {
  const now = Date.now();
  for (const [token, expires] of sessions) if (expires <= now) sessions.delete(token);
}

/** `user` is {id, name, role} — the session remembers who, not just what. */
export function createSession(user) {
  sweep();
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    userId: user.id,
    name: user.name,
    role: user.role,
    expires: Date.now() + SESSION_TTL_MS,
    elevatedUntil: 0,
    elevatedBy: null,
  });
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

/**
 * Lifts a staff session to admin for a few minutes, remembering which owner
 * approved it — so an action taken under override can be attributed honestly to
 * both the person who did it and the person who authorised it.
 */
export function elevate(token, approver) {
  const session = getSession(token);
  if (!session) return false;
  session.elevatedUntil = Date.now() + ELEVATION_MS;
  session.elevatedBy = { id: approver.id, name: approver.name };
  return true;
}

export function dropElevation(token) {
  const session = getSession(token);
  if (session) {
    session.elevatedUntil = 0;
    session.elevatedBy = null;
  }
}

/**
 * Who to record against an action: the person at the till, plus the owner who
 * authorised it when the session is running under a manager override.
 */
export function actorFor(session) {
  if (!session) return { id: null, name: 'Unknown', role: 'admin' };
  const actor = { id: session.userId, name: session.name, role: session.role };
  const elevated = session.elevatedUntil > Date.now() && session.elevatedBy;
  return elevated ? { ...actor, authorisedBy: session.elevatedBy } : actor;
}

/** Signs out every session belonging to one person, e.g. when they are removed. */
export function destroySessionsFor(userId) {
  for (const [token, session] of sessions) {
    if (session.userId === userId) sessions.delete(token);
  }
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
