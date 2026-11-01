import { analyze } from '../src/analyze';
import { canonical } from '../src/drawing';
import type { Pt } from '../src/geom';
import { Race } from '../src/race';
import { mulberry32, range } from '../src/rng';

// Fuzz: drawings of two or three loops stacked or overlapping, plus a loose
// curve. Does any non-leg part end up below the floor during the race?
const loop = (r: () => number, cx: number, cy: number, rx: number, ry: number, n = 30): Pt[] => {
  const ph = r() * 6;
  return Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos((i / n) * 6.2832) * rx * (1 + 0.1 * Math.sin(i * 3 + ph)), cy + Math.sin((i / n) * 6.2832) * ry]);
};
let bad = 0;
for (let seed = 0; seed < 200; seed++) {
  const r = mulberry32(seed);
  const top = range(r, 22, 50), bot = range(r, 25, 55);
  const pts = [loop(r, 300, 240, top, top * range(r, 0.8, 1.1)), loop(r, 300 + range(r, -20, 20), 240 + top + range(r, 0, bot), bot, bot * range(r, 0.6, 1))];
  if (r() < 0.5) pts.push([[350, 310], [385, 300], [400, 330], [395, 370]]);
  const a = analyze(canonical(pts.map((p) => ({ pts: p, color: '#15171c', w: 6 }))));
  if (!a) continue;
  const race = new Race([{ anatomy: a, name: '', kind: 'player' }]);
  let lowest = Infinity;
  while (!race.over) {
    race.step();
    const p = race.racers[0], b = p.body, s = p.s.size, [cx, cy] = a.center;
    for (const part of a.parts) if (part.kind !== 'leg') for (const q of part.pts) lowest = Math.min(lowest, b.toWorld([(q[0] - cx) * s, -(q[1] - cy) * s])[1]);
  }
  if (lowest < -0.03) { bad++; if (bad <= 6) console.log('seed', seed, a.kind, a.parts.map((x) => x.kind).join(','), 'lowest', lowest.toFixed(2)); }
}
console.log(`${bad} of 200 sink through the floor`);
