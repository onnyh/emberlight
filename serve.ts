// A small static file server for developing Emberlight: it serves the
// game/ folder next to this file so the game can be played in a desktop
// browser with no build step and no network beyond localhost.
//
//   node serve.ts [--port 8080]   →   http://localhost:8080
//
// It answers only files inside game/, sends the content types a browser
// game needs, and refuses everything else. Not a production server.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const gameDir = resolve(fileURLToPath(new URL('./game/', import.meta.url)));

const argv = process.argv.slice(2);
const portFlag = argv.indexOf('--port');
const parsed = portFlag >= 0 ? Number(argv[portFlag + 1]) : 8080;
const port = Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : 8080;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

async function handle(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse): Promise<void> {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end('bad request');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const target = resolve(join(gameDir, '.' + pathname));
  if (target !== gameDir && !target.startsWith(gameDir + sep)) {
    response.writeHead(403).end('forbidden');
    return;
  }
  let size: number;
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not a regular file');
    size = info.size;
  } catch {
    response.writeHead(404).end('not found');
    return;
  }
  response.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
    'content-length': size,
    'cache-control': 'no-store',
  });
  createReadStream(target).pipe(response);
}

createServer((request, response) => {
  void handle(request, response);
}).listen(port, '127.0.0.1', () => {
  console.log(`emberlight: game/ is being served at http://localhost:${port}`);
});
