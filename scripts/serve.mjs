// Static server for local preview. Run: npm run serve
//
// The page must be served rather than opened from the filesystem: module scripts are
// CORS-checked and a file:// origin is opaque, so browsers refuse to load them.
//
// Everything is sent with Cache-Control: no-store. Without it a browser will happily keep an
// old js/data.js after npm run seed and show stale numbers, which is a bad way to lose an hour.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.env.PORT ?? 8137);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  // normalize collapses any ../ before it can escape dist/
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  let path = join(ROOT, relative || 'index.html');

  try {
    if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
    if (!path.startsWith(ROOT)) throw new Error('outside root');
    const body = await readFile(path);
    response.writeHead(200, {
      'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store, must-revalidate',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('not found\n');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`serving dist/ at http://127.0.0.1:${PORT}/  (no-store; re-run npm run build to update)`);
});
