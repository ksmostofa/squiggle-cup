// Room client. The relay (server/rooms.mjs) forwards casts to everyone in the
// room, sender included, so every client sees the same messages in the same
// order. The host (first player) runs the room's flow; races are
// deterministic, so a drawing per player and one seed are all that travel.

export interface Player { id: string; name: string }
export interface Entrant { id: string; name: string; code: string }

export type Cast =
  | { k: 'draw'; round: number }
  | { k: 'drawing'; round: number; code: string; name: string }
  | { k: 'race'; round: number; seed: number; entrants: Entrant[] }
  | { k: 'tap'; round: number; tick: number }
  | { k: 'taps'; round: number; ticks: number[] }
  | { k: 'lobby' };

type ServerMsg =
  | { t: 'welcome'; code: string; id: string }
  | { t: 'players'; host: string | null; players: Player[] }
  | { t: 'cast'; from: string; data: Cast }
  | { t: 'error'; error: string };

const relayUrl = () => (import.meta.env.VITE_RELAY_URL as string | undefined) ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/relay`;

export class Room {
  id = '';
  code = '';
  host: string | null = null;
  players: Player[] = [];
  onCast: (from: string, c: Cast) => void = () => {};
  onPlayers: () => void = () => {};
  onLost: () => void = () => {};
  private ws: WebSocket;

  private constructor(ws: WebSocket) { this.ws = ws; }

  get isHost() { return this.id !== '' && this.id === this.host; }

  // Opens a room (no code) or joins one. Resolves once the relay has seated us.
  static open(name: string, code?: string): Promise<Room> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try { ws = new WebSocket(relayUrl()); } catch { reject(new Error('Could not reach the room server.')); return; }
      const room = new Room(ws);
      let seated = false;
      const fail = (msg: string) => { if (!seated) { reject(new Error(msg)); ws.close(); } };
      ws.onopen = () => ws.send(JSON.stringify(code ? { t: 'join', code: code.toUpperCase(), name } : { t: 'create', name }));
      ws.onerror = () => fail('Could not reach the room server.');
      ws.onclose = () => { if (seated) room.onLost(); else fail('Could not reach the room server.'); };
      ws.onmessage = (ev) => {
        const m = JSON.parse(String(ev.data)) as ServerMsg;
        if (m.t === 'error') fail(m.error);
        else if (m.t === 'welcome') { room.id = m.id; room.code = m.code; }
        else if (m.t === 'players') {
          room.host = m.host; room.players = m.players;
          if (!seated && room.id) { seated = true; resolve(room); }
          room.onPlayers();
        } else if (m.t === 'cast') room.onCast(m.from, m.data);
      };
    });
  }

  cast(c: Cast) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'cast', data: c })); }

  leave() {
    this.onLost = () => {};
    try { this.ws.send(JSON.stringify({ t: 'leave' })); } catch { /* already gone */ }
    this.ws.close();
  }
}
