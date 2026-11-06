// Room relay logic, transport-agnostic. One room per 4-letter code; the first
// player is the host. The relay never simulates anything: races are
// deterministic, so clients only share drawings and a seed, and the relay
// just forwards ("cast") them to everyone in the room. Moving to a Cloudflare
// Durable Object means one Room per object and the same connect() calls.
//
// Seats outlive connections. A phone that switches apps to send the invite
// link loses its socket, so a dropped seat is held for HOLD_MS: the player
// rejoins with their token and gets back the same seat (and the host role),
// plus every cast of this round they missed. Only an explicit leave, or the
// hold running out, frees a seat. (On Cloudflare the pending timer also keeps
// the Durable Object, and so the room, in memory.)

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_PLAYERS = 5;
const MAX_MESSAGE = 64 * 1024;
const HOLD_MS = 3 * 60 * 1000;
const LOG_MAX = 64; // casts kept for rejoining players: this round's, from its 'draw' or 'lobby'

export function createRelay({ log = () => {}, hold = HOLD_MS } = {}) {
  const rooms = new Map(); // code -> { code, seats: Seat[], log: { seq, from, data }[], seq }
  let next = 1;

  const newCode = () => {
    for (let tries = 0; tries < 1000; tries++) {
      let c = '';
      for (let i = 0; i < 4; i++) c += ALPHA[Math.floor(Math.random() * ALPHA.length)];
      if (!rooms.has(c)) return c;
    }
    throw new Error('no free room codes');
  };
  const newToken = () => Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 8)).join('');

  const roster = (room) => ({ t: 'players', host: room.seats[0]?.id ?? null, players: room.seats.map((s) => ({ id: s.id, name: s.name, away: !s.send })) });
  const tell = (room, msg) => { const s = JSON.stringify(msg); for (const seat of room.seats) seat.send?.(s); };
  const openRoom = (code) => { const room = { code, seats: [], log: [], seq: 0 }; rooms.set(code, room); log(`room ${code} opened`); return room; };

  function free(seat) {
    const room = seat.room;
    clearTimeout(seat.timer);
    room.seats = room.seats.filter((s) => s !== seat);
    if (!room.seats.length) { rooms.delete(room.code); log(`room ${room.code} closed`); }
    else tell(room, roster(room));
  }

  return {
    rooms,
    connect(send) {
      let seat = null; // this connection's seat
      const reply = (msg) => send(JSON.stringify(msg));
      const sit = (room, s, seen) => {
        clearTimeout(s.timer);
        s.timer = null;
        s.send = send;
        seat = s;
        reply({ t: 'welcome', code: room.code, id: s.id, token: s.token });
        tell(room, roster(room));
        for (const c of room.log) if (c.seq > seen) reply({ t: 'cast', seq: c.seq, from: c.from, data: c.data, replay: true });
      };
      const enter = (room, name, token = newToken()) => {
        const s = { id: `p${(next++).toString(36)}`, token, name: String(name || '').trim().slice(0, 22) || `Player ${room.seats.length + 1}`, send: null, room, timer: null };
        room.seats.push(s);
        sit(room, s, room.seq);
      };
      const drop = () => {
        if (!seat || seat.send !== send) return;
        const s = seat;
        seat = null;
        s.send = null;
        s.timer = setTimeout(() => free(s), hold);
        tell(s.room, roster(s.room));
      };
      return {
        message(raw) {
          if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return;
          let m;
          try { m = JSON.parse(raw); } catch { return; }
          if (m.t === 'create') {
            if (seat) free(seat);
            enter(openRoom(newCode()), m.name);
          } else if (m.t === 'join') {
            const code = String(m.code || '').toUpperCase();
            const token = typeof m.token === 'string' ? m.token.slice(0, 64) : '';
            let room = rooms.get(code);
            const mine = token && room?.seats.find((s) => s.token === token);
            if (mine) {
              if (seat && seat !== mine) free(seat);
              mine.send?.(JSON.stringify({ t: 'replaced' })); // the same seat opened in another tab
              sit(room, mine, Number(m.seen) || 0);
              return;
            }
            // A returning player whose room is gone (the relay restarted) opens it again under the same code.
            if (!room && token && /^[A-Z]{4}$/.test(code)) room = openRoom(code);
            if (!room) return reply({ t: 'error', error: 'No room with that code.' });
            if (room.seats.length >= MAX_PLAYERS) return reply({ t: 'error', error: 'That room is full.' });
            if (seat) free(seat);
            enter(room, m.name, token || undefined);
          } else if (m.t === 'cast' && seat) {
            const room = seat.room;
            const c = { seq: ++room.seq, from: seat.id, data: m.data };
            const k = m.data?.k;
            if (k === 'draw' || k === 'lobby') room.log = [];
            if (k !== 'tap') { room.log.push(c); if (room.log.length > LOG_MAX) room.log.shift(); }
            tell(room, { t: 'cast', ...c });
          } else if (m.t === 'leave' && seat) {
            const s = seat;
            seat = null;
            free(s);
          }
        },
        close() { drop(); },
      };
    },
  };
}
