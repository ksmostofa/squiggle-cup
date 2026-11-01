// Room relay logic, transport-agnostic. One room per 4-letter code; the first
// player is the host. The relay never simulates anything: races are
// deterministic, so clients only share drawings and a seed, and the relay
// just forwards ("cast") them to everyone in the room. Moving to a Cloudflare
// Durable Object means one Room per object and the same connect() calls.

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_PLAYERS = 5;
const MAX_MESSAGE = 64 * 1024;

export function createRelay({ log = () => {} } = {}) {
  const rooms = new Map(); // code -> { code, players: Client[] }
  let next = 1;

  const newCode = () => {
    for (let tries = 0; tries < 1000; tries++) {
      let c = '';
      for (let i = 0; i < 4; i++) c += ALPHA[Math.floor(Math.random() * ALPHA.length)];
      if (!rooms.has(c)) return c;
    }
    throw new Error('no free room codes');
  };

  const roster = (room) => ({ t: 'players', host: room.players[0]?.id ?? null, players: room.players.map((p) => ({ id: p.id, name: p.name })) });
  const tell = (room, msg) => { const s = JSON.stringify(msg); for (const p of room.players) p.send(s); };

  function leave(client) {
    const room = client.room;
    if (!room) return;
    room.players = room.players.filter((p) => p !== client);
    client.room = null;
    if (!room.players.length) { rooms.delete(room.code); log(`room ${room.code} closed`); }
    else tell(room, roster(room));
  }

  return {
    rooms,
    connect(send) {
      const client = { id: `p${(next++).toString(36)}`, name: 'Player', send, room: null };
      const reply = (msg) => send(JSON.stringify(msg));
      const enter = (room, name) => {
        leave(client);
        client.name = String(name || '').trim().slice(0, 22) || `Player ${room.players.length + 1}`;
        room.players.push(client);
        client.room = room;
        reply({ t: 'welcome', code: room.code, id: client.id });
        tell(room, roster(room));
      };
      return {
        message(raw) {
          if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return;
          let m;
          try { m = JSON.parse(raw); } catch { return; }
          if (m.t === 'create') {
            const room = { code: newCode(), players: [] };
            rooms.set(room.code, room);
            log(`room ${room.code} opened`);
            enter(room, m.name);
          } else if (m.t === 'join') {
            const room = rooms.get(String(m.code || '').toUpperCase());
            if (!room) return reply({ t: 'error', error: 'No room with that code.' });
            if (room.players.length >= MAX_PLAYERS) return reply({ t: 'error', error: 'That room is full.' });
            enter(room, m.name);
          } else if (m.t === 'cast' && client.room) {
            tell(client.room, { t: 'cast', from: client.id, data: m.data });
          } else if (m.t === 'leave') leave(client);
        },
        close() { leave(client); },
      };
    },
  };
}
