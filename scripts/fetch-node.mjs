/**
 * Downloads an official Node runtime so the shop does not have to install one.
 *
 * The binary is checksum-verified against nodejs.org's published SHASUMS256.txt
 * before it is ever written into a package — we are handing an executable to a
 * pharmacy, so "probably the right file" is not good enough.
 *
 * Extraction is done here rather than by shelling out to unzip/tar, so
 * packaging works the same on whatever machine a future build happens on.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(root, '.node-cache');

/** Pinned so every package built from this commit ships an identical runtime. */
export const NODE_VERSION = 'v24.21.0';

export const TARGETS = {
  'win-x64': { archive: `node-${NODE_VERSION}-win-x64.zip`, binary: 'node.exe', label: 'Windows (64-bit)' },
  // Only the Windows archive is a zip; the others are tarballs, which the
  // extractor here does not read. They are listed so a cached runtime dropped
  // into .node-cache can still be bundled for testing or a one-off build.
  'linux-x64': { archive: `node-${NODE_VERSION}-linux-x64.tar.xz`, binary: 'node', label: 'Linux (64-bit)' },
};

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Pulls one file out of a zip, using only zlib. */
function extractFromZip(zip, wantSuffix) {
  // End of central directory: scan back for its signature.
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0 && i > zip.length - 66_000; i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('Not a zip file: no end-of-central-directory record.');

  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('Corrupt zip central directory.');
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    if (name.endsWith(wantSuffix)) {
      // The local header repeats the name/extra lengths, which can differ.
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const body = zip.subarray(start, start + compressedSize);
      if (method === 0) return Buffer.from(body);
      if (method === 8) return zlib.inflateRawSync(body);
      throw new Error(`Unsupported zip compression method ${method}.`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`${wantSuffix} not found inside the archive.`);
}

/**
 * Returns the path to a verified runtime binary, downloading it once and
 * caching it so repeat packaging is offline and instant.
 */
export async function fetchNode(target) {
  const spec = TARGETS[target];
  if (!spec) throw new Error(`Unknown target "${target}". Known: ${Object.keys(TARGETS).join(', ')}`);

  const cached = path.join(CACHE, `${NODE_VERSION}-${target}`, spec.binary);
  if (fs.existsSync(cached)) {
    console.log(`  Runtime: cached ${NODE_VERSION} ${spec.label}`);
    return cached;
  }

  const base = `https://nodejs.org/dist/${NODE_VERSION}`;
  console.log(`  Runtime: downloading Node ${NODE_VERSION} for ${spec.label}…`);

  const [archive, sums] = await Promise.all([
    download(`${base}/${spec.archive}`),
    download(`${base}/SHASUMS256.txt`).then((b) => b.toString('utf8')),
  ]);

  const expected = sums.split('\n').find((line) => line.trim().endsWith(spec.archive))?.split(/\s+/)[0];
  if (!expected) throw new Error(`No published checksum for ${spec.archive}.`);
  const actual = crypto.createHash('sha256').update(archive).digest('hex');
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${spec.archive}.\n  expected ${expected}\n  got      ${actual}`);
  }
  console.log(`  Runtime: checksum verified (${expected.slice(0, 16)}…)`);

  const binary = extractFromZip(archive, `/${spec.binary}`);
  await fsp.mkdir(path.dirname(cached), { recursive: true });
  await fsp.writeFile(cached, binary);
  console.log(`  Runtime: extracted ${spec.binary} (${Math.round(binary.length / 1024 / 1024)} MB)`);
  return cached;
}
