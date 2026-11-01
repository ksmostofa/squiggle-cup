import { dsin } from '../dmath';
import { type Rng, range } from '../rng';

// PRD §5.3 Ochre: paintings on a cave wall come alive at night and race to
// the cave mouth along a rolling rock floor. Numbers are starting values for tuning.

export interface Contact { d: number; nx: number; ny: number } // d > 0: penetration depth along the normal
export interface Course {
  finish: number;
  ground(x: number): number; // cave floor height at x, metres
  slope(x: number): number;  // d(ground)/dx
  contact(x: number, y: number): Contact;
  dark(t: number): number;   // x of the dark creeping in behind the pack at race time t
}

export interface Venue {
  id: string;
  index: number; // byte stored in dare links
  name: string;
  tagline: string;
  inks: string[];
  pad: string;
  build(rng: Rng): Course;
}

const FINISH = 100;
const DARK = { start: -9, speed: 1.55, accel: 0.03 };

function build(rng: Rng): Course {
  // Rolling rock floor: three layered sine waves, up to about ±1 m, flat at the start.
  const waves = [
    { a: range(rng, 0.35, 0.55), k: range(rng, 0.09, 0.13), p: range(rng, 0, 6.28) },
    { a: range(rng, 0.2, 0.3), k: range(rng, 0.25, 0.35), p: range(rng, 0, 6.28) },
    { a: range(rng, 0.06, 0.12), k: range(rng, 0.8, 1.1), p: range(rng, 0, 6.28) },
  ];
  const raw = (x: number) => waves.reduce((h, w) => h + w.a * dsin(w.k * x + w.p), 0);
  const base = raw(0);
  const ramp = (x: number) => (x <= 0 ? 0 : x >= 6 ? 1 : x / 6);
  const ground = (x: number) => (raw(x) - base) * ramp(x);
  const slope = (x: number) => (ground(x + 0.05) - ground(x - 0.05)) / 0.1;

  const contact = (x: number, y: number): Contact => {
    const sl = slope(x), inv = 1 / Math.sqrt(1 + sl * sl);
    return { d: (ground(x) - y) * inv, nx: -sl * inv, ny: inv };
  };
  const t0 = (t: number) => Math.max(0, t);
  return {
    finish: FINISH,
    ground,
    slope,
    contact,
    dark: (t) => DARK.start + DARK.speed * t0(t) + 0.5 * DARK.accel * t0(t) * t0(t),
  };
}

export const ochre: Venue = {
  id: 'ochre',
  index: 2,
  name: 'Ochre',
  tagline: 'Race the dark to the cave mouth.',
  inks: ['#b5452b', '#d9a441', '#1d1a19', '#efe6d8'],
  pad: '#3a2e27',
  build,
};
