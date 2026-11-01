import { type Plugin, defineConfig } from 'vite';
import { createRelay } from './server/rooms.mjs'; // plain JS, shared with the standalone relay
import { attach } from './server/ws.mjs';

// Runs the room relay on /relay inside the dev and preview servers, so
// `npm run dev` is all LAN play needs.
function relay(): Plugin {
  const hook = (server: { httpServer: import('node:http').Server | null }) => {
    if (server.httpServer) attach(server.httpServer, createRelay({ log: (m: string) => console.log(`  relay: ${m}`) }));
  };
  return { name: 'squiggle-relay', configureServer: hook, configurePreviewServer: hook };
}

export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  plugins: [relay()],
});
