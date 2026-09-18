#!/usr/bin/env node
/**
 * Builds the folder that actually goes on the shop laptop.
 *
 * The server imports only Node built-ins, so the till needs no node_modules and
 * no npm — just Node and these files. The result is a few hundred kilobytes.
 *
 *   npm run build && npm run package
 *
 * Node is never bundled. It is installed on the shop computer once, separately,
 * and the package stays small enough to send anywhere.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dawakhana-shop');

if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('\n  No build found. Run "npm run build" first.\n');
  process.exit(1);
}

await fsp.rm(out, { recursive: true, force: true });
await fsp.mkdir(out, { recursive: true });

// The runtime is the server plus the built frontend — never the data folder,
// which belongs to whichever shop is running it. Match that one directory
// exactly: a substring test would also swallow a future server/database.mjs
// and ship a package that is quietly missing a file.
const dataDir = path.join(root, 'server', 'data');
await fsp.cp(path.join(root, 'server'), path.join(out, 'server'), {
  recursive: true,
  filter: (src) => src !== dataDir && !src.startsWith(dataDir + path.sep),
});
await fsp.cp(path.join(root, 'dist'), path.join(out, 'dist'), { recursive: true });
await fsp.cp(path.join(root, 'install'), path.join(out, 'install'), { recursive: true });


// One file to run on each platform, so nobody has to find a terminal.
await fsp.writeFile(
  path.join(out, 'SETUP-Windows.bat'),
  [
    '@echo off',
    'REM Sets up Dawakhana: checks Node, puts an icon on the desktop.',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install\\setup-windows.ps1"',
  ].join('\r\n') + '\r\n',
);
await fsp.writeFile(
  path.join(out, 'SETUP-Mac.command'),
  '#!/bin/sh\ncd "$(dirname "$0")"\nexec ./install/setup-macos.sh\n',
  { mode: 0o755 },
);
await fsp.writeFile(
  path.join(out, 'SETUP-Linux.sh'),
  '#!/bin/sh\ncd "$(dirname "$0")"\nexec ./install/setup-linux.sh\n',
  { mode: 0o755 },
);

const steps = [
  'Setting up a new shop computer takes two steps.',
  '',
  '',
  'STEP 1 — Install Node.js (once per computer)',
  '',
  '  Go to  https://nodejs.org  and install the LTS version.',
  '  Click Next through the installer; no settings need changing.',
  '',
  '',
  'STEP 2 — Run the setup file for your computer',
  '',
];

await fsp.writeFile(
  path.join(out, 'READ ME FIRST.txt'),
  [
    'Dawakhana',
    '=========',
    '',
    ...steps,
    '  Windows   double-click  SETUP-Windows.bat',
    '  Mac       double-click  SETUP-Mac.command',
    '  Linux     run           ./SETUP-Linux.sh',
    '',
    '  It puts a Dawakhana icon on the desktop and offers to start the till',
    '  automatically whenever the computer is switched on.',
    '',
    '',
    'THEN — day to day',
    '',
    '  Double-click the Dawakhana icon on the desktop. The first time, it asks',
    '  you to set up who works the till: your name and passcode as the owner,',
    '  and optionally a counter person for your staff.',
    '',
    '',
    'FIRST — put your stock in',
    '',
    '  Dawakhana starts with about 50 common medicines already listed, so you are',
    '  not typing into an empty screen. Each one has a price but no stock, and',
    '  its batch is marked OPENING.',
    '',
    '  Open Inventory and, for every medicine you actually keep, edit its batch:',
    '  put in the real batch number printed on the box, the real expiry, and how',
    '  many you have. Delete the medicines you do not sell, and add the ones',
    '  that are missing.',
    '',
    '  Nothing can be sold until you do this, which is on purpose — a till that',
    '  invents stock counts is worse than one that has none.',
    '',
    '',
    'IMPORTANT — backups',
    '',
    '  Open Settings, scroll to Automatic backups, and set the folder to a USB',
    '  stick or a synced folder (Google Drive, OneDrive, Dropbox).',
    '',
    '  Everything the shop knows lives in one file on this computer. If it is',
    '  only ever backed up to the same computer, a theft or a dead hard disk',
    '  takes the shop records with it.',
    '',
    '',
    'If something goes wrong, the shop records are safe in:',
    '  server/data/db.json',
    '',
  ].join('\n'),
);

/** Directory size, so the packager can state the real footprint. */
async function size(dir) {
  let total = 0;
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? await size(full) : (await fsp.stat(full)).size;
  }
  return total;
}

const bytes = await size(out);

// Zip it so the whole thing can be handed over as one file. Falls back to the
// plain folder on a machine with no zip command.
let archive = null;
try {
  const { execFileSync } = await import('node:child_process');
  archive = `${out}.zip`;
  await fsp.rm(archive, { force: true });
  execFileSync('zip', ['-rq', archive, path.basename(out)], { cwd: root });
} catch {
  archive = null;
}

console.log(`\n  Packaged → ${out}`);
const mb = bytes / 1024 / 1024;
console.log(`  Size: ${mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`}`);
console.log('  Node is not included — install it once on the shop computer.');
if (archive) {
  const zipped = (await fsp.stat(archive)).size;
  console.log(`  Zipped → ${archive} (${Math.round(zipped / 1024)} KB)`);
}
console.log('\n  Hand that to the shop. They install Node once, then run the SETUP file.\n');
