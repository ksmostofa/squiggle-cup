import type { Stroke } from '../src/analyze';
import type { Pt } from '../src/geom';
import { type Rng, mulberry32, range } from '../src/rng';

// Hand-style test drawings in pad pixels (600×600, y down): wobbly lines and
// lumpy ellipses, the way people actually draw. Each fixture is a function of
// a seed, so tests can draw the same idea many slightly different ways.

export type Draw = (r: Rng) => Pt[][];

const C = Math.cos, S = Math.sin;

export function ell(r: Rng, cx: number, cy: number, rx: number, ry: number, a0 = 0, a1 = Math.PI * 2, n = 28): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n, k = 1 + range(r, -0.04, 0.04);
    out.push([cx + C(a) * rx * k, cy + S(a) * ry * k]);
  }
  return out;
}

export function ln(r: Rng, pts: Pt[], n = 5): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const f = k / n;
      out.push([a[0] + (b[0] - a[0]) * f + range(r, -1.5, 1.5), a[1] + (b[1] - a[1]) * f + range(r, -1.5, 1.5)]);
    }
  }
  return out;
}

export const eye = (x: number, y: number): Pt[] => [[x, y], [x + 1, y + 1]];
// Body at (300, 320), 140 × 90, facing right.
const BODY = (r: Rng) => ell(r, 300, 320, 70, 45);
const birdLegs = (r: Rng) => [ln(r, [[285, 362], [280, 430]]), ln(r, [[315, 362], [322, 430]])];

export const WINGS: Record<string, Draw> = {
  'raised, side view': (r) => [BODY(r), ln(r, [[300, 280], [255, 215], [230, 170]]), ...birdLegs(r), eye(345, 305)],
  'raised pair (V)': (r) => [BODY(r), ln(r, [[290, 280], [250, 190]]), ln(r, [[315, 280], [350, 190]]), ...birdLegs(r)],
  'flung out, diagonal': (r) => [BODY(r), ln(r, [[320, 290], [420, 230], [460, 200]]), ln(r, [[280, 290], [180, 230], [140, 200]])],
  'flung out from the ends (front view)': (r) => [ell(r, 300, 320, 55, 55), ln(r, [[355, 300], [440, 270], [500, 250]]), ln(r, [[245, 300], [160, 270], [100, 250]]), eye(285, 310), eye(315, 310)],
  'loop above the back': (r) => [BODY(r), ell(r, 290, 228, 24, 52), ...birdLegs(r)],
  'loop overlapping the back': (r) => [BODY(r), ell(r, 300, 268, 58, 26), ...birdLegs(r)],
  'zigzag feathers, raised': (r) => [BODY(r), ln(r, [[285, 282], [270, 220], [295, 235], [280, 175], [305, 195], [300, 150]], 3), ...birdLegs(r)],
  'zigzag along the back': (r) => [BODY(r), ln(r, [[250, 285], [270, 245], [290, 285], [310, 245], [330, 285], [350, 245]], 3)],
  'folded wing inside the body': (r) => [BODY(r), ell(r, 290, 310, 45, 20), ...birdLegs(r), eye(345, 305)],
  'bat wings, scalloped': (r) => [ell(r, 300, 320, 40, 40), ln(r, [[330, 300], [400, 250], [480, 270], [450, 300], [420, 290], [400, 320]], 3), ln(r, [[270, 300], [200, 250], [120, 270], [150, 300], [180, 290], [200, 320]], 3)],
  'one big sweeping wing': (r) => [BODY(r), ln(r, [[310, 280], [300, 200], [240, 140], [200, 130]], 4), ln(r, [[300, 362], [300, 420]])],
  'arched wing over the back': (r) => [BODY(r), ell(r, 295, 280, 40, 70, Math.PI, Math.PI * 2, 16), ...birdLegs(r)],
};

export const NOT_WINGS: Record<string, { kind: string; draw: Draw }> = {
  'cat, tail curling up from the rear': { kind: 'quadruped', draw: (r) => [BODY(r), ln(r, [[232, 315], [205, 280], [200, 230], [215, 205]], 4), ...[255, 285, 320, 350].map((x) => ln(r, [[x, 360], [x + 2, 420]])), eye(350, 300)] },
  'giraffe, neck and head': { kind: 'quadruped', draw: (r) => [BODY(r), ln(r, [[355, 290], [375, 220], [385, 170]]), ell(r, 395, 155, 22, 18), ...[255, 285, 320, 350].map((x) => ln(r, [[x, 360], [x + 2, 450]]))] },
  'dog with ears': { kind: 'quadruped', draw: (r) => [BODY(r), ln(r, [[345, 282], [350, 262]]), ln(r, [[360, 286], [368, 266]]), ...[255, 285, 320, 350].map((x) => ln(r, [[x, 360], [x + 2, 420]])), eye(350, 300)] },
  'person, two legs': { kind: 'biped', draw: (r) => [ell(r, 300, 300, 45, 60), ln(r, [[285, 355], [275, 440]]), ln(r, [[315, 355], [325, 440]]), eye(290, 285), eye(312, 285)] },
  'snake, long wavy line': { kind: 'worm', draw: (r) => [ln(r, Array.from({ length: 9 }, (_, i): Pt => [120 + i * 45, 320 + (i % 2 ? -14 : 14)]), 4)] },
  'snake, long outline': { kind: 'worm', draw: (r) => [ell(r, 300, 320, 190, 32), eye(470, 312)] },
  'ball': { kind: 'roller', draw: (r) => [ell(r, 300, 300, 90, 90), eye(320, 280)] },
  'blob': { kind: 'jelly', draw: (r) => [ell(r, 300, 320, 110, 70), eye(330, 300)] },
};

// Scale and shift a drawing about the pad centre: small and large drawings must read the same.
export function strokes(draw: Draw, seed: number, scale = 1, dx = 0, dy = 0): Stroke[] {
  const r = mulberry32(seed);
  return draw(r).map((pts) => ({
    pts: pts.map(([x, y]): Pt => [300 + (x - 300) * scale + dx, 300 + (y - 300) * scale + dy]),
    color: '#15171c',
    w: 7,
  }));
}
