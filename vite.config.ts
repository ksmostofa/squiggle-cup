import { type Plugin, defineConfig } from 'vite';
import { createBoard, memoryStore } from './server/board';
import { createRelay } from './server/rooms.mjs'; // plain JS, shared with the standalone relay
import { attach } from './server/ws.mjs';

// Runs the room relay on /relay and an in-memory leaderboard on /api/board
// inside the dev and preview servers, so `npm run dev` is all LAN play needs.
function relay(): Plugin {
  const hook = (server: { httpServer: import('node:http').Server | null; middlewares: import('vite').Connect.Server }) => {
    if (server.httpServer) attach(server.httpServer, createRelay({ log: (m: string) => console.log(`  relay: ${m}`) }));
    const board = createBoard(memoryStore());
    server.middlewares.use('/api/board', async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = req.method === 'POST' ? Buffer.concat(chunks).toString('utf8') : undefined;
      const out = await board(new Request(`http://local/api/board${req.url === '/' ? '' : req.url}`, { method: req.method, body }), req.socket.remoteAddress ?? 'anon');
      res.statusCode = out.status;
      out.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(await out.text());
    });
  };
  return { name: 'squiggle-relay', configureServer: hook, configurePreviewServer: hook };
}

export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  plugins: [relay()],
});
