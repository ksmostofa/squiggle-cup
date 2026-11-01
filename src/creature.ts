import type { Anatomy, Kind } from './analyze';
import { G } from './body';

// What kind of creature a drawing is, how big it is, and the speed its body
// tries to hold. Speeds scale like real animals: by sqrt(g × leg length) (the
// Froude number), so longer legs genuinely run faster; how it actually goes
// is up to the physics in body.ts.

export const DT = 1 / 60;

export interface KindInfo { label: string; verb: string; icon: string; blurb: string }
export const KINDS: Record<Kind, KindInfo> = {
  biped: { label: 'Two-legged', verb: 'runs', icon: '🏃', blurb: 'Springy strides. Good jumper.' },
  quadruped: { label: 'Four-legged', verb: 'trots', icon: '🐎', blurb: 'Steady and quick on flat rock.' },
  centipede: { label: 'Many-legged', verb: 'scuttles', icon: '🐛', blurb: 'Grips scree. Short legs, short hops.' },
  hopper: { label: 'One-legged', verb: 'pogos', icon: '🦘', blurb: 'All bounce. Rocks are just bigger bounces.' },
  flyer: { label: 'Flying', verb: 'flaps', icon: '🦇', blurb: 'Flies if the wings can lift the body.' },
  roller: { label: 'Rolling', verb: 'rolls', icon: '🪨', blurb: 'Rockets downhill, grinds uphill.' },
  worm: { label: 'Slithering', verb: 'slithers', icon: '🐍', blurb: 'Slides forwards, grips backwards. Oozes over rocks.' },
  jelly: { label: 'Wobbly', verb: 'boings', icon: '🫧', blurb: 'Bounces along on its own squish.' },
  scribble: { label: 'Scribble', verb: 'flails', icon: '🌀', blurb: 'Nobody knows. Including it.' },
};

export interface Stats {
  size: number;    // metres per pad pixel
  height: number;  // metres
  length: number;  // metres
  vTarget: number; // m/s it tries to hold on the flat
  legM: number;    // mean leg length, metres
  grip: number;    // 0..1, how little scree slows it
}

const FROUDE: Partial<Record<Kind, number>> = { biped: 1.55, quadruped: 1.75, centipede: 1.9, hopper: 1.6, flyer: 1.5, scribble: 1.3 };
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function stats(a: Anatomy): Stats {
  const M = Math.max(a.box.w, a.box.h, 24);
  // A drawing filling the pad becomes a 1.3 m beast; a doodle in the corner, 0.55 m.
  const metres = 0.55 + 0.75 * clamp(M / 450, 0, 1);
  const size = metres / M;
  const height = a.box.h * size, length = a.box.w * size;
  const legM = a.legLen * height;
  let v: number;
  if (a.kind === 'worm') v = 0.95 * Math.sqrt(G * length * 0.5);
  else if (a.kind === 'roller') v = 1.5 * Math.sqrt(G * 0.5 * Math.min(height, length));
  else if (a.kind === 'flyer') v = 2.7 + 0.8 * clamp((metres - 0.55) / 0.75, 0, 1);
  else if (a.legs) v = (FROUDE[a.kind] ?? 1.5) * Math.sqrt(G * legM);
  else v = 1.3 * Math.sqrt(G * 0.5 * height);
  const grip = a.kind === 'worm' || a.kind === 'centipede' ? 1 : a.kind === 'roller' ? 0.35 : a.kind === 'flyer' ? 1 : clamp(0.45 + 0.08 * a.legs, 0, 0.9);
  return { size, height, length, vTarget: clamp(v, 1.6, 4.6), legM, grip };
}

// 0..1 bars for the draw screen and results.
export function bars(a: Anatomy, s: Stats) {
  const jump = a.kind === 'flyer' ? 1 : a.kind === 'worm' || a.kind === 'roller' ? 0.15 : clamp((s.legM || s.height * 0.3) / 0.6, 0.1, 1);
  return { speed: clamp((s.vTarget - 1.6) / 3, 0.05, 1), jump, grip: clamp(s.grip, 0.05, 1) };
}
