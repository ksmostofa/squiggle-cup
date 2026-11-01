import type { Anatomy, Kind } from './analyze';
import { type Score, score, speedFactor } from './score';

// What kind of creature a drawing is, how big it is, and how it races.
// Fairness (PRD §7.5): every kind gets a profile that trades off against the
// others, tuned so expected finish times fall in a narrow band:
//   top    – cruising speed it settles at, m/s
//   ramp   – seconds to reach it (slow starters cruise faster)
// On top of that, a better-drawn creature runs faster (src/score.ts), up to
// a ceiling every kind shares. No luck: the drawing decides.

export const DT = 1 / 60;

export interface KindInfo { label: string; verb: string; blurb: string }
export const KINDS: Record<Kind, KindInfo> = {
  biped: { label: 'Two-legged', verb: 'runs', blurb: 'Quick off the line. Long, even legs run faster.' },
  quadruped: { label: 'Four-legged', verb: 'trots', blurb: 'Steady all the way. Even legs keep a clean trot.' },
  centipede: { label: 'Many-legged', verb: 'scuttles', blurb: 'Fast start, modest top speed. More legs, smoother ripple.' },
  hopper: { label: 'One-legged', verb: 'hops', blurb: 'Bounds in streaks. A longer leg means bigger hops.' },
  flyer: { label: 'Flying', verb: 'flaps', blurb: 'Slow to take off, fast once up. Bigger wings carry it better.' },
  roller: { label: 'Rolling', verb: 'rolls', blurb: 'Slow to get going, then rolls fast. Rounder is better.' },
  wheeled: { label: 'Wheeled', verb: 'drives', blurb: 'Rides level on its wheels. Round, even wheels set wide apart drive best.' },
  worm: { label: 'Slithering', verb: 'slithers', blurb: 'Off at once, never quick. Longer bodies slither faster.' },
  jelly: { label: 'Wobbly', verb: 'oozes', blurb: 'Off at once, wobbles along. A clean blob oozes best.' },
  scribble: { label: 'Scribble', verb: 'flails', blurb: 'Pure chaos. Sometimes it works.' },
};

export interface Profile { top: number; ramp: number }
// The shared ceiling: at a perfect score every kind runs 14.60 s over 40 m.
// Tops calibrated by scripts/tune.ts, checked on a separate pool of drawings
// by test/balance.test.ts. Wheels wait for the vehicle mode, uncalibrated.
export const PROFILES: Record<Kind, Profile> = {
  biped: { top: 2.837, ramp: 1.2 },
  quadruped: { top: 2.868, ramp: 1.8 },
  centipede: { top: 2.82, ramp: 0.8 },
  hopper: { top: 2.858, ramp: 1.6 },
  flyer: { top: 2.909, ramp: 2.6 },
  roller: { top: 2.93, ramp: 2.4 },
  wheeled: { top: 2.75, ramp: 1.5 },
  worm: { top: 2.854, ramp: 0.6 },
  jelly: { top: 2.865, ramp: 0.8 },
  scribble: { top: 2.85, ramp: 1.4 },
};

export interface Stats {
  size: number;    // metres per pad pixel
  height: number;  // metres
  length: number;  // metres
  score: Score;    // how well it's drawn (src/score.ts)
  quality: number; // 0..1, the total score
  vTarget: number; // m/s it settles at
  legM: number;    // mean leg length, metres
}

export function stats(a: Anatomy, override?: number): Stats {
  const M = Math.max(a.box.w, a.box.h, 24);
  // Every drawing becomes a creature about a metre across, whatever its size
  // on the pad, so a doodle in the corner races a page-filler on equal terms.
  const size = 1 / M;
  const height = a.box.h * size, length = a.box.w * size;
  const sc = score(a);
  const q = override ?? sc.total;
  const vTarget = PROFILES[a.kind].top * speedFactor(q);
  return { size, height, length, score: sc, quality: q, vTarget, legM: a.legLen * height };
}
