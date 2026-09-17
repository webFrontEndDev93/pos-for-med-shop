#!/usr/bin/env node
/**
 * Builds the folder that actually goes on the shop laptop.
 *
 * The server imports only Node built-ins, so the till needs no node_modules and
 * no npm — just Node and these files. The result is a few hundred kilobytes.
 *
 *   npm run build && npm run package
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'medipos-shop');

if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('\n  No build found. Run "npm run build" first.\n');
  process.exit(1);
}

await fsp.rm(out, { recursive: true, force: true });
await fsp.mkdir(out, { recursive: true });

// The runtime is the server plus the built frontend — never the data folder,
// which belongs to whichever shop is running it.
await fsp.cp(path.join(root, 'server'), path.join(out, 'server'), {
  recursive: true,
  filter: (src) => !src.includes(`${path.sep}data`),
});
await fsp.cp(path.join(root, 'dist'), path.join(out, 'dist'), { recursive: true });
await fsp.cp(path.join(root, 'install'), path.join(out, 'install'), { recursive: true });

await fsp.writeFile(
  path.join(out, 'start.sh'),
  '#!/bin/sh\ncd "$(dirname "$0")"\nexec node server/index.mjs\n',
  { mode: 0o755 },
);
await fsp.writeFile(
  path.join(out, 'start.bat'),
  '@echo off\r\ncd /d "%~dp0"\r\nnode server\\index.mjs\r\npause\r\n',
);
await fsp.writeFile(
  path.join(out, 'README.txt'),
  [
    'MediPOS — shop install',
    '',
    '1. Install Node 20 or newer from https://nodejs.org (one time).',
    '2. Copy this whole folder onto the shop computer.',
    '3. Double-click start.bat (Windows) or run ./start.sh (Mac/Linux).',
    '4. Open http://localhost:4173 and set a passcode.',
    '',
    'To have it start by itself when the computer boots, see install/README.md.',
    '',
    'Your data lives in server/data/db.json. Back it up — see Settings.',
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

console.log(`\n  Packaged → ${out}`);
console.log(`  Size: ${Math.round((await size(out)) / 1024)} KB (no node_modules needed)\n`);
