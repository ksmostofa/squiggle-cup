#!/usr/bin/env node
// Standalone relay for LAN play: serves the built game from dist/ and the
// room relay on /relay. `npm run build && npm run relay`, then open
// http://<this machine>:8787 on every device. (`npm run dev` runs the same
// relay inside Vite, so this is only needed for a built copy.)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRelay } from './rooms.mjs';
import { attach } from './ws.mjs';

const PORT = Number(process.env.PORT ?? 8787);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = path.join(root, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('Run `npm run build` first.'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

attach(server, createRelay({ log: (m) => console.log(m) }));
server.listen(PORT, () => console.log(`Squiggle Cup relay on http://localhost:${PORT}`));
