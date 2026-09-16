import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routes, HttpError } from './api.mjs';
import { DB_FILE } from './db.mjs';
import { ensureSeed } from './seed.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', 'dist');
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Splits '/api/sales/:id/void' into segments once, at startup. */
const compiled = routes.map(([method, pattern, handler]) => ({
  method,
  segments: pattern.split('/').filter(Boolean),
  handler,
}));

function match(method, pathname) {
  const parts = pathname.split('/').filter(Boolean);
  for (const route of compiled) {
    if (route.method !== method || route.segments.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i += 1) {
      const seg = route.segments[i];
      if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(parts[i]);
      else if (seg !== parts[i]) { ok = false; break; }
    }
    if (ok) return { handler: route.handler, params };
  }
  return null;
}

function send(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // A backup restore is the biggest legitimate payload; anything past this is abuse.
    if (size > 12 * 1024 * 1024) throw new HttpError(413, 'Request body is too large.');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON.');
  }
}

/** Serves the built frontend, falling back to index.html for client-side routes. */
async function serveStatic(req, res, pathname) {
  if (!fs.existsSync(DIST)) {
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>MediPOS</title>
       <style>body{font:16px/1.6 system-ui,sans-serif;margin:0;display:grid;place-items:center;height:100vh;background:#0b1120;color:#e2e8f0}
       div{max-width:34rem;padding:2rem}code{background:#1e293b;padding:.15rem .4rem;border-radius:.3rem}</style>
       <div><h1>MediPOS is not built yet</h1>
       <p>Run <code>npm run build</code> to produce the app, or <code>npm run dev</code> for the dev server with hot reload.</p></div>`,
    );
    return;
  }

  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  // Resolve then confirm containment, so '..' segments can't escape dist/.
  let file = path.resolve(DIST, rel);
  if (!file.startsWith(DIST + path.sep) && file !== DIST) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');

  const ext = path.extname(file).toLowerCase();
  const immutable = file.includes(`${path.sep}assets${path.sep}`);
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  // The dev server runs on a different port and proxies /api, but allow direct
  // calls from localhost origins too so the API is easy to poke at with curl.
  res.setHeader('access-control-allow-origin', req.headers.origin ?? '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!pathname.startsWith('/api/')) {
    await serveStatic(req, res, pathname);
    return;
  }

  const route = match(req.method, pathname);
  if (!route) {
    send(res, 404, { error: `No API route for ${req.method} ${pathname}` });
    return;
  }

  try {
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    const query = Object.fromEntries(url.searchParams);
    const result = await route.handler(route.params, body, query);
    const download = pathname === '/api/backup' && req.method === 'GET';
    send(res, 200, result, download
      ? { 'content-disposition': `attachment; filename="medipos-backup-${new Date().toISOString().slice(0, 10)}.json"` }
      : {});
  } catch (err) {
    if (err instanceof HttpError) {
      send(res, err.status, { error: err.message, details: err.details });
    } else {
      console.error('[api]', err);
      send(res, 500, { error: 'Something went wrong on the server.' });
    }
  }
});

ensureSeed();

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`\n  MediPOS server running\n`);
  console.log(`  ➜  App:   http://${shown}:${PORT}`);
  console.log(`  ➜  API:   http://${shown}:${PORT}/api/health`);
  console.log(`  ➜  Data:  ${DB_FILE}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
