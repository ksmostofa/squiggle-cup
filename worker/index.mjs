// The live room relay on Cloudflare: a Worker that hands every /relay
// WebSocket to one Durable Object, which runs the same transport-agnostic
// relay as `npm run dev` (server/rooms.mjs). One object holds every room;
// at hackathon scale that is simplest, and rooms only forward small casts.
import { createRelay } from '../server/rooms.mjs';

export class Lobby {
  constructor() {
    this.relay = createRelay();
  }

  fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Squiggle Cup relay', { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const conn = this.relay.connect((text) => { try { server.send(text); } catch { /* socket already closed */ } });
    server.addEventListener('message', (e) => conn.message(typeof e.data === 'string' ? e.data : ''));
    server.addEventListener('close', () => conn.close());
    server.addEventListener('error', () => conn.close());
    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/relay') return env.LOBBY.get(env.LOBBY.idFromName('lobby')).fetch(req);
    if (env.ASSETS) return env.ASSETS.fetch(req);
    return new Response('Squiggle Cup relay. Connect a WebSocket to /relay.', { headers: { 'content-type': 'text/plain' } });
  },
};
