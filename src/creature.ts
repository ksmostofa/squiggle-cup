import type { Anatomy, Kind } from './analyze';
import { bbox } from './geom';

// What kind of creature a drawing is, how big it is, and how it races.
// Fairness (PRD §7.5): every kind gets a profile that trades off against the
// others, tuned so expected finish times fall in a narrow band:
//   top    – cruising speed it settles at, m/s
//   ramp   – seconds to reach it (slow starters cruise faster)
//   streak – how much its pace wobbles, seeded (steady vs streaky)
// Within a kind, a better-drawn creature (the proportions that kind rewards)
// runs a few percent faster; that, plus a little seeded luck, decides races.

export const DT = 1 / 60;

export interface KindInfo { label: string; verb: string; blurb: string }
export const KINDS: Record<Kind, KindInfo> = {
  biped: { label: 'Two-legged', verb: 'runs', blurb: 'Quick off the line. Long, even legs run faster.' },
  quadruped: { label: 'Four-legged', verb: 'trots', blurb: 'Steady all the way. Even legs keep a clean trot.' },
  centipede: { label: 'Many-legged', verb: 'scuttles', blurb: 'Fast start, modest top speed. More legs, smoother ripple.' },
  hopper: { label: 'One-legged', verb: 'hops', blurb: 'Bounds in streaks. A longer leg means bigger hops.' },
  flyer: { label: 'Flying', verb: 'flaps', blurb: 'Slow to take off, fast once up. Bigger wings carry it better.' },
  roller: { label: 'Rolling', verb: 'rolls', blurb: 'Slow to get going, then rolls fast. Rounder is better.' },
  worm: { label: 'Slithering', verb: 'slithers', blurb: 'Off at once, never quick. Longer bodies slither faster.' },
  jelly: { label: 'Wobbly', verb: 'oozes', blurb: 'Off at once, wobbles along. A clean blob oozes best.' },
  scribble: { label: 'Scribble', verb: 'flails', blurb: 'Pure chaos. Sometimes it works.' },
};

export interface Profile { top: number; ramp: number; streak: number }
// Every kind has the same expected finish time (about 15.3 s over 40 m) and
// the same chance to win a mixed field: tops calibrated by scripts/tune.ts,
// checked on a separate pool of drawings by test/balance.test.ts.
export const PROFILES: Record<Kind, Profile> = {
  biped: { top: 2.618, ramp: 1.6, streak: 0.06 },
  quadruped: { top: 2.68, ramp: 2.6, streak: 0.03 },
  centipede: { top: 2.674, ramp: 0.9, streak: 0.02 },
  hopper: { top: 2.637, ramp: 2.4, streak: 0.12 },
  flyer: { top: 2.887, ramp: 5.6, streak: 0.05 },
  roller: { top: 2.788, ramp: 4.8, streak: 0.04 },
  worm: { top: 2.638, ramp: 0.6, streak: 0.04 },
  jelly: { top: 2.613, ramp: 0.8, streak: 0.1 },
  scribble: { top: 2.7, ramp: 2.2, streak: 0.3 },
};

export interface Stats {
  size: number;    // metres per pad pixel
  height: number;  // metres
  length: number;  // metres
  quality: number; // 0..1, how well it's drawn for its kind
  vTarget: number; // m/s it settles at
  legM: number;    // mean leg length, metres
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
// 1 at the ideal, falling to 0 at ±width.
const near = (v: number, ideal: number, width: number) => clamp(1 - Math.abs(v - ideal) / width, 0, 1);

// How well a drawing suits its kind: the proportions that would really help it move.
export function quality(a: Anatomy): number {
  const legs = a.parts.filter((p) => p.kind === 'leg').map((p) => bbox(p.pts).h);
  const meanLeg = legs.length ? legs.reduce((s, h) => s + h, 0) / legs.length : 0;
  const spread = legs.length > 1 ? Math.sqrt(legs.reduce((s, h) => s + (h - meanLeg) * (h - meanLeg), 0) / legs.length) : 0;
  const evenness = clamp(1 - spread / Math.max(1, meanLeg) / 0.4, 0, 1);
  const span = a.parts.filter((p) => p.kind === 'wing').reduce((s, p) => { const b = bbox(p.pts); return s + Math.max(b.w, b.h); }, 0);
  const bodyB = bbox(a.body.pts);
  const bodyS = Math.max(bodyB.w, bodyB.h, 1);
  switch (a.kind) {
    case 'biped': return 0.6 * near(a.legLen, 0.5, 0.4) + 0.4 * evenness;
    case 'quadruped': return 0.5 * near(a.legLen, 0.42, 0.35) + 0.5 * evenness;
    case 'centipede': return 0.4 * clamp((a.legs - 4) / 6, 0, 1) + 0.3 * evenness + 0.3 * near(a.legLen, 0.3, 0.3);
    case 'hopper': return near(a.legLen, 0.5, 0.4);
    case 'flyer': return 0.7 * near(span / bodyS, 2.2, 1.8) + 0.3 * clamp(a.wings / 2, 0, 1);
    case 'roller': return clamp((a.roundness - 0.7) / 0.28, 0, 1);
    case 'worm': return clamp((a.aspect - 1.9) / 4, 0, 1);
    case 'jelly': return clamp(1 - a.crossings / 6, 0, 1) * (0.5 + 0.5 * a.roundness);
    default: return 0.5;
  }
}

export function stats(a: Anatomy): Stats {
  const M = Math.max(a.box.w, a.box.h, 24);
  // Every drawing becomes a creature about a metre across, whatever its size
  // on the pad, so a doodle in the corner races a page-filler on equal terms.
  const size = 1 / M;
  const height = a.box.h * size, length = a.box.w * size;
  const q = quality(a);
  const vTarget = PROFILES[a.kind].top * (0.95 + 0.1 * q);
  return { size, height, length, quality: q, vTarget, legM: a.legLen * height };
}
