import { type Stroke, analyze } from '../src/analyze';
import { canonical } from '../src/drawing';
import { mulberry32, range } from '../src/rng';
import { wobble } from '../src/score';
import { FAMILIES, template } from '../src/templates';
import { BEGINNERS } from '../test/beginners';
import { strokes } from '../test/fixtures';

// Line steadiness across styles of drawing: what a careful pen, a beginner
// and a shaky mouse measure. node scripts/run-ts.mjs scripts/wobble.ts
const w = (st: Stroke[]) => wobble(analyze(canonical(st))!);
const mean = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3);

// A smooth pen-drawn dog: dense points, no shake (or a given amount).
function penDog(shake: number, seed: number): Stroke[] {
  const r = mulberry32(seed), j = () => range(r, -shake, shake);
  const ell = (cx: number, cy: number, rx: number, ry: number) => Array.from({ length: 90 }, (_, i) => [cx + Math.cos((i / 89) * 6.2832) * rx + j(), cy + Math.sin((i / 89) * 6.2832) * ry + j()] as [number, number]);
  const line = (x0: number, y0: number, x1: number, y1: number) => Array.from({ length: 30 }, (_, i) => [x0 + ((x1 - x0) * i) / 29 + j(), y0 + ((y1 - y0) * i) / 29 + j()] as [number, number]);
  return [ell(290, 300, 90, 45), ell(395, 250, 32, 30), ...[225, 255, 325, 355].map((x) => line(x, 338, x + 4, 420)), line(202, 290, 170, 250)].map((pts) => ({ pts, color: '#15171c', w: 6 }));
}
for (const shake of [0, 0.5, 1, 2, 3, 5]) console.log(`pen dog, shake ±${shake} px`.padEnd(26), mean([1, 2, 3].map((s) => w(penDog(shake, s)))));
console.log('beginners'.padEnd(26), mean(Object.values(BEGINNERS).map((d) => w(strokes(d, 3)))));
for (const skill of [0, 0.5, 1]) console.log(`house, skill ${skill}`.padEnd(26), mean(FAMILIES.map((f, i) => w(template(mulberry32(i), f, skill).strokes))));
