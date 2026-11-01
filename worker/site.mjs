// The game Worker: static assets, same-origin rooms (/relay) and the global
// leaderboard (/api/board). The leaderboard is one Durable Object that
// re-races every submitted drawing itself (server/board.ts), so a time on the
// board is always the drawing's real time.
import { createBoard } from '../server/board.ts';
import { Lobby } from './index.mjs';

export { Lobby };

export class Board {
  constructor(state, env) {
    this.handle = createBoard({
      load: async () => [...(await state.storage.list({ prefix: 'e:' })).values()],
      save: (e) => state.storage.put(`e:${e.id}`, e),
      remove: (id) => state.storage.delete(`e:${id}`),
    }, () => Date.now(), env.BOARD_ADMIN ?? '');
  }

  fetch(req) {
    return this.handle(req, req.headers.get('cf-connecting-ip') ?? 'anon');
  }
}

export default {
  fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/relay') return env.LOBBY.get(env.LOBBY.idFromName('lobby')).fetch(req);
    if (url.pathname === '/api/board') return env.BOARD.get(env.BOARD.idFromName('global')).fetch(req);
    return env.ASSETS.fetch(req);
  },
};
