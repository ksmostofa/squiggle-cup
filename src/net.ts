// Room client. The relay (server/rooms.mjs) forwards casts to everyone in the
// room, sender included, so every client sees the same messages in the same
// order. The host (first player) runs the room's flow; races are
// deterministic, so a drawing per player and one seed are all that travel.
//
// A dropped socket isn't the end of the room: phones drop it whenever the
// player switches apps (to send the invite link, say). The relay holds the
// seat, and the client quietly reconnects with its seat token, at once when
// the tab is back in view, and catches up on the casts it missed.

export interface Player { id: string; name: string; away?: boolean }
export interface Entrant { id: string; name: string; code: string }

export type Cast =
  | { k: 'draw'; round: number; time?: number; lineup?: number; bots?: boolean }
  | { k: 'drawing'; round: number; code: string; name: string }
  | { k: 'race'; round: number; seed: number; entrants: Entrant[]; bots?: boolean }
  | { k: 'tap'; round: number; tick: number }
  | { k: 'taps'; round: number; ticks: number[] }
  | { k: 'bots'; on: boolean }
  | { k: 'lobby' };

type ServerMsg =
  | { t: 'welcome'; code: string; id: string; token: string }
  | { t: 'players'; host: string | null; players: Player[] }
  | { t: 'cast'; seq: number; from: string; data: Cast; replay?: boolean }
  | { t: 'replaced' }
  | { t: 'error'; error: string };

const relayUrl = () => (import.meta.env.VITE_RELAY_URL as string | undefined) ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/relay`;

// The seat token lives as long as the tab (it survives a reload), so a
// second tab is a second player.
const SEAT = 'sc:seat';
const HOLD_MS = 3 * 60 * 1000; // as long as the relay holds a seat
const savedToken = (code: string): string | undefined => {
  try { const s = JSON.parse(sessionStorage.getItem(SEAT) ?? 'null'); return s?.code === code ? s.token : undefined; } catch { return undefined; }
};
const saveToken = (code: string, token: string | null) => {
  try { if (token) sessionStorage.setItem(SEAT, JSON.stringify({ code, token })); else sessionStorage.removeItem(SEAT); } catch { /* storage off */ }
};

export class Room {
  id = '';
  code = '';
  host: string | null = null;
  players: Player[] = [];
  away = false; // our own socket is down and we're reconnecting
  // replay: a cast this player missed while away, sent again as they rejoin.
  onCast: (from: string, c: Cast, replay: boolean) => void = () => {};
  onPlayers: () => void = () => {};
  onAway: () => void = () => {};
  onLost: (why: string) => void = () => {};
  private ws: WebSocket | null = null;
  private name: string;
  private seen = 0;
  private droppedAt = 0;
  private retry = 0;
  private attempts = 0;
  private gone = false;

  private constructor(name: string) { this.name = name; }

  get isHost() { return this.id !== '' && this.id === this.host; }

  // Opens a room (no code) or joins one. Resolves once the relay has seated us.
  static open(name: string, code?: string): Promise<Room> {
    const room = new Room(name);
    return new Promise((resolve, reject) => {
      room.dial(code?.toUpperCase(), () => resolve(room), (msg) => reject(new Error(msg)));
    });
  }

  private dial(code: string | undefined, seated?: () => void, failed?: (msg: string) => void) {
    let ws: WebSocket;
    try { ws = new WebSocket(relayUrl()); } catch { failed ? failed('Could not reach the room server.') : this.redial(); return; }
    this.ws = ws;
    let sat = false;
    ws.onopen = () => {
      const token = code ? savedToken(code) : undefined;
      ws.send(JSON.stringify(code ? { t: 'join', code, name: this.name, token, seen: this.seen } : { t: 'create', name: this.name }));
    };
    ws.onclose = () => {
      if (this.ws !== ws || this.gone) return;
      if (!sat && failed) { failed('Could not reach the room server.'); return; }
      this.redial();
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data)) as ServerMsg;
      if (m.t === 'error') {
        if (!sat) { if (failed) failed(m.error); else this.lose(m.error); this.gone = true; ws.close(); }
      } else if (m.t === 'replaced') this.lose('This room is open in another tab.');
      else if (m.t === 'welcome') { this.id = m.id; this.code = m.code; saveToken(m.code, m.token); }
      else if (m.t === 'players') {
        this.host = m.host; this.players = m.players;
        if (!sat && this.id) {
          sat = true; this.attempts = 0;
          if (this.away) { this.away = false; this.onAway(); }
          seated?.();
        }
        this.onPlayers();
      } else if (m.t === 'cast') { this.seen = Math.max(this.seen, m.seq); this.onCast(m.from, m.data, !!m.replay); }
    };
  }

  // Try again, sooner the first few times, until the relay would have let the seat go.
  private redial() {
    if (this.gone) return;
    if (!this.away) { this.away = true; this.droppedAt = Date.now(); this.onAway(); addEventListener('visibilitychange', this.wake); addEventListener('online', this.wake); }
    if (Date.now() - this.droppedAt > HOLD_MS) { this.lose('Lost the connection to the room.'); return; }
    clearTimeout(this.retry);
    this.retry = window.setTimeout(() => this.dial(this.code), Math.min(8000, 500 * 2 ** this.attempts++));
  }

  // Back in view: reconnect now rather than at the next retry.
  private wake = () => {
    if (!this.away || this.gone || document.visibilityState !== 'visible') return;
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return; // already dialling
    clearTimeout(this.retry);
    this.dial(this.code);
  };

  private lose(why: string) {
    if (this.gone) return;
    this.close();
    this.onLost(why);
  }

  private close() {
    this.gone = true;
    clearTimeout(this.retry);
    removeEventListener('visibilitychange', this.wake);
    removeEventListener('online', this.wake);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  cast(c: Cast) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'cast', data: c })); }

  leave() {
    this.onLost = () => {};
    saveToken(this.code, null);
    try { this.ws?.send(JSON.stringify({ t: 'leave' })); } catch { /* already gone */ }
    this.close();
  }
}
