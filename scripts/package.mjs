#!/usr/bin/env node
/**
 * Builds the folder that actually goes on the shop laptop.
 *
 * The server imports only Node built-ins, so the till needs no node_modules and
 * no npm — just Node and these files. The result is a few hundred kilobytes.
 *
 *   npm run build && npm run package
 *
 * Pass --with-node=win-x64 to embed an official Node runtime, so the shop
 * installs nothing at all. The binary is checksum-verified before it is copied
 * in; see scripts/fetch-node.mjs.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchNode, TARGETS, NODE_VERSION } from './fetch-node.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'medipos-shop');

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

// Optionally embed a Node runtime so the shop needs no install and no internet.
const requested = process.argv.find((a) => a.startsWith('--with-node'));
let bundledFor = null;
if (requested) {
  const target = requested.includes('=') ? requested.split('=')[1] : 'win-x64';
  const binary = await fetchNode(target);
  const dest = path.join(out, 'runtime', target, path.basename(binary));
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(binary, dest);
  await fsp.chmod(dest, 0o755).catch(() => undefined);
  bundledFor = target;
}

// One file to run on each platform, so nobody has to find a terminal.
await fsp.writeFile(
  path.join(out, 'SETUP-Windows.bat'),
  [
    '@echo off',
    'REM Sets up MediPOS: checks Node, puts an icon on the desktop.',
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

// Only promise "nothing to install" for the platform whose runtime is actually
// in the box. Telling a Mac user they need nothing when they do is worse than
// telling them nothing at all.
const BUNDLE_PLATFORM = { 'win-x64': 'Windows', 'linux-x64': 'Linux', 'darwin-arm64': 'Mac', 'darwin-x64': 'Mac' };
const bundledPlatform = bundledFor ? BUNDLE_PLATFORM[bundledFor] : null;

const steps = bundledPlatform
  ? [
      `On ${bundledPlatform} this takes one step. Nothing to install, no internet needed.`,
      ...(bundledPlatform === 'Windows'
        ? ['On Mac or Linux you would need Node.js from https://nodejs.org first.']
        : ['On other systems you would need Node.js from https://nodejs.org first.']),
      '',
      '',
      'STEP 1 — Run the setup file for your computer',
      '',
    ]
  : [
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
    'MediPOS',
    '=======',
    '',
    ...steps,
    '  Windows   double-click  SETUP-Windows.bat',
    '  Mac       double-click  SETUP-Mac.command',
    '  Linux     run           ./SETUP-Linux.sh',
    '',
    '  It puts a MediPOS icon on the desktop and offers to start the till',
    '  automatically whenever the computer is switched on.',
    '',
    '',
    'THEN — day to day',
    '',
    '  Double-click the MediPOS icon on the desktop. The first time, it asks',
    '  you to set up who works the till: your name and passcode as the owner,',
    '  and optionally a counter person for your staff.',
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
console.log(bundledFor
  ? `  Runtime: Node ${NODE_VERSION} for ${TARGETS[bundledFor].label} is included — the shop installs nothing.`
  : '  Runtime: not included — the shop must install Node. Use --with-node=win-x64 to embed it.');
if (archive) {
  const zipped = (await fsp.stat(archive)).size;
  console.log(`  Zipped → ${archive} (${Math.round(zipped / 1024)} KB)`);
}
console.log(bundledFor
  ? '\n  Hand that to the shop. They unzip it and run the SETUP file. That is all.\n'
  : '\n  Hand that to the shop. They install Node once, then run the SETUP file.\n');
