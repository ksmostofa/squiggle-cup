import { type Pt, rdp } from './geom';
import { INPUT_TYPES, type InputEvent } from './race';

// PRD §6.4. A creature (and optionally its run) packed into a few hundred bytes
// of base64url, so a dare link needs no server.

const VERSION = 1;
const GRID = 3;          // pad pixels per stored unit; the 600 px pad fits in 0–200
const MAX_NAME = 36;     // bytes of UTF-8

export interface PackedStroke { pts: Pt[]; ink: number; thick: boolean }
export interface Dare { venue: number; seed: number; name: string; strokes: PackedStroke[]; inputs: InputEvent[] }

const q = (v: number) => Math.max(0, Math.min(200, Math.round(v / GRID)));

export function encode(d: Dare): string {
  const out: number[] = [VERSION, d.venue & 255];
  const seed = d.seed >>> 0;
  out.push(seed >>> 24, (seed >>> 16) & 255, (seed >>> 8) & 255, seed & 255);

  let name = new TextEncoder().encode(d.name);
  if (name.length > MAX_NAME) {
    let s = d.name;
    while (new TextEncoder().encode(s).length > MAX_NAME) s = [...s].slice(0, -1).join('');
    name = new TextEncoder().encode(s);
  }
  out.push(name.length, ...name);

  // Quantise, then split anything over 255 points into extra strokes.
  const packed: { flags: number; pts: Pt[] }[] = [];
  for (const s of d.strokes) {
    const grid = gridPoints(s.pts);
    const flags = (s.ink & 7) | (s.thick ? 8 : 0);
    for (let i = 0; i < grid.length; i += 254) packed.push({ flags, pts: grid.slice(i, i + 255) });
  }
  out.push(packed.length & 255);
  for (const s of packed.slice(0, 255)) {
    out.push(s.flags, s.pts.length, s.pts[0][0], s.pts[0][1]);
    for (let i = 1; i < s.pts.length; i++) {
      out.push((s.pts[i][0] - s.pts[i - 1][0]) & 255, (s.pts[i][1] - s.pts[i - 1][1]) & 255);
    }
  }

  varint(out, d.inputs.length);
  let prev = 0;
  for (const e of d.inputs) {
    varint(out, ((e.tick - prev) << 2) | INPUT_TYPES.indexOf(e.type));
    prev = e.tick;
  }
  return toB64(Uint8Array.from(out));
}

export function decode(s: string): Dare | null {
  try {
    const b = fromB64(s);
    let i = 0;
    const next = () => {
      if (i >= b.length) throw new Error('short');
      return b[i++];
    };
    if (next() !== VERSION) return null;
    const venue = next();
    const seed = ((next() << 24) | (next() << 16) | (next() << 8) | next()) >>> 0;
    const nameLen = next();
    const name = new TextDecoder().decode(b.slice(i, i + nameLen));
    i += nameLen;
    const strokes: PackedStroke[] = [];
    const count = next();
    for (let k = 0; k < count; k++) {
      const flags = next(), n = next();
      let x = next(), y = next();
      const pts: Pt[] = [[x * GRID, y * GRID]];
      for (let j = 1; j < n; j++) {
        x += (next() << 24) >> 24;
        y += (next() << 24) >> 24;
        pts.push([x * GRID, y * GRID]);
      }
      strokes.push({ pts, ink: flags & 7, thick: (flags & 8) !== 0 });
    }
    const inputs: InputEvent[] = [];
    if (i < b.length) {
      const nIn = readVarint(next);
      let tick = 0;
      for (let k = 0; k < nIn; k++) {
        const v = readVarint(next);
        tick += Math.floor(v / 4);
        inputs.push({ tick, type: INPUT_TYPES[v & 3] ?? 'tap' });
      }
    }
    return { venue, seed, name, strokes, inputs };
  } catch {
    return null;
  }
}

// Snap to the grid, drop repeats, simplify (RDP, 2 px) and add midpoints wherever
// one step won't fit in a signed byte. Snapping first keeps this idempotent, so
// a decoded creature re-encodes to the same bytes.
function gridPoints(pts: Pt[]): Pt[] {
  const snapped: Pt[] = [];
  for (const p of pts) {
    const g: Pt = [q(p[0]), q(p[1])];
    const last = snapped[snapped.length - 1];
    if (!last || last[0] !== g[0] || last[1] !== g[1]) snapped.push(g);
  }
  const out: Pt[] = [];
  for (const g of rdp(snapped, 2 / GRID)) {
    const last = out[out.length - 1];
    if (last) {
      const steps = Math.ceil(Math.max(Math.abs(g[0] - last[0]), Math.abs(g[1] - last[1])) / 127);
      for (let k = 1; k < steps; k++) {
        out.push([last[0] + Math.round(((g[0] - last[0]) * k) / steps), last[1] + Math.round(((g[1] - last[1]) * k) / steps)]);
      }
    }
    out.push(g);
  }
  return out;
}

function varint(out: number[], v: number) {
  while (v >= 128) { out.push((v & 127) | 128); v = Math.floor(v / 128); }
  out.push(v);
}

function readVarint(next: () => number): number {
  let v = 0, mul = 1, b: number;
  do { b = next(); v += (b & 127) * mul; mul *= 128; } while (b & 128);
  return v;
}

function toB64(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
