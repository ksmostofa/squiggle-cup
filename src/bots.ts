import type { Kind, Stroke } from './analyze';
import type { Pt } from './geom';
import { type Rng, pick, range } from './rng';

// Rival creatures, drawn by code with a wobbly hand so they sit next to player
// drawings without looking machine-made. Built from pad-pixel strokes and read
// by analyze() like anything a player draws. Arithmetic only (the ellipse is
// walked by repeated rotation), so every device draws the same rivals.

const C15 = 0.9659258262890683, S15 = 0.25881904510252074; // cos, sin of 15°

export const RIVAL_KINDS: Kind[] = ['quadruped', 'biped', 'centipede', 'hopper', 'flyer', 'worm', 'roller', 'jelly'];

function blob(rng: Rng, cx: number, cy: number, rx: number, ry: number, lumpy: number): Pt[] {
  const n = 24;
  const raw = Array.from({ length: n }, () => range(rng, 1 - lumpy, 1 + lumpy));
  const k = raw.map((_, i) => (raw[(i + n - 1) % n] + 2 * raw[i] + raw[(i + 1) % n]) / 4);
  const pts: Pt[] = [];
  let c = 1, s = 0;
  for (let i = 0; i <= n; i++) {
    pts.push([cx + c * rx * k[i % n], cy + s * ry * k[i % n]]);
    [c, s] = [c * C15 - s * S15, s * C15 + c * S15];
  }
  return pts;
}

// A line with a little hand wobble, from a to b, bowed by `bend`.
function line(rng: Rng, a: Pt, b: Pt, bend = 0, n = 6): Pt[] {
  const pts: Pt[] = [];
  const nx = -(b[1] - a[1]), ny = b[0] - a[0];
  for (let i = 0; i <= n; i++) {
    const f = i / n, arc = bend * 4 * f * (1 - f);
    pts.push([a[0] + (b[0] - a[0]) * f + nx * arc + range(rng, -1.5, 1.5), a[1] + (b[1] - a[1]) * f + ny * arc + range(rng, -1.5, 1.5)]);
  }
  return pts;
}

export function rivalDrawing(rng: Rng, inks: string[], kind: Kind = pick(rng, RIVAL_KINDS)): Stroke[] {
  const ink = pick(rng, inks.slice(0, 2).concat(inks[3]));
  const w = rng() < 0.3 ? 14 : 7;
  const out: Stroke[] = [];
  const add = (pts: Pt[], width = w) => out.push({ pts, color: ink, w: width });
  const cx = 300, cy = range(rng, 240, 290);
  const sc = range(rng, 0.75, 1.15);

  let rx = 85 * sc, ry = 55 * sc, lumpy = 0.1;
  if (kind === 'biped') { rx = 55 * sc; ry = 65 * sc; }
  if (kind === 'centipede') { rx = 130 * sc; ry = 38 * sc; }
  if (kind === 'hopper') { rx = 60 * sc; ry = 58 * sc; }
  if (kind === 'worm') { rx = 160 * sc; ry = 30 * sc; lumpy = 0.06; }
  if (kind === 'roller') { rx = ry = 85 * sc; lumpy = 0.02; }
  if (kind === 'jelly') { rx = 95 * sc; ry = 60 * sc; lumpy = 0.22; }
  if (kind === 'flyer') { rx = 55 * sc; ry = 40 * sc; }
  add(blob(rng, cx, cy, rx, ry, lumpy));

  const bottom = cy + ry * 0.9;
  const legs = kind === 'quadruped' ? 4 : kind === 'biped' ? 2 : kind === 'centipede' ? pick(rng, [6, 7, 8]) : kind === 'hopper' ? 1 : kind === 'flyer' ? pick(rng, [0, 2]) : 0;
  const legLen = (kind === 'biped' ? range(rng, 80, 140) : kind === 'centipede' ? range(rng, 40, 60) : kind === 'flyer' ? 40 : kind === 'hopper' ? range(rng, 80, 120) : range(rng, 60, 115)) * sc;
  for (let i = 0; i < legs; i++) {
    const f = legs === 1 ? 0.5 : 0.18 + (0.64 * i) / (legs - 1);
    const x = cx - rx + 2 * rx * f;
    add(line(rng, [x, bottom - 6], [x + range(rng, -14, 14) * sc, bottom + legLen], range(rng, -0.06, 0.06)), 7);
  }

  if (kind === 'flyer') {
    const span = range(rng, 100, 140) * sc;
    add(line(rng, [cx + rx * 0.25, cy - ry * 0.7], [cx + rx + span * 0.55, cy - ry - span * 0.5], -0.15), 7);
    add(line(rng, [cx - rx * 0.25, cy - ry * 0.7], [cx - rx - span * 0.55, cy - ry - span * 0.5], 0.15), 7);
  }
  if ((kind === 'quadruped' || kind === 'biped') && rng() < 0.6) {
    add(line(rng, [cx - rx + 4, cy], [cx - rx - range(rng, 40, 70) * sc, cy - range(rng, 20, 45) * sc], 0.12), 7);
  }

  const eyes = rng() < 0.3 ? 1 : 2;
  const ex = kind === 'worm' ? cx + rx * 0.7 : cx + rx * 0.4;
  for (let e = 0; e < eyes; e++) out.push({ pts: [[ex + (e - (eyes - 1) / 2) * 16 * sc, cy - ry * 0.3]], color: '#1d1a19', w: 7 });

  for (const st of out) for (const p of st.pts) { p[0] = clamp(p[0]); p[1] = clamp(p[1]); }
  return out;
}

const clamp = (v: number) => Math.max(0, Math.min(599, v));
