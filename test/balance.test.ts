import { type Anatomy, type Kind, type Stroke, analyze } from '../src/analyze';
import { rivalDrawing } from '../src/bots';
import { INKS } from '../src/course';
import { canonical } from '../src/drawing';
import { BEAT, COUNTDOWN, MAX_BOOST, REACTION, Race } from '../src/race';
import { DT } from '../src/creature';
import { mulberry32 } from '../src/rng';
import { score, speedFactor } from '../src/score';
import { FAMILIES, FAMILY_KIND, lineup, template } from '../src/templates';
import { BEGINNERS } from './beginners';
import { strokes } from './fixtures';

// Fairness and scoring (PRD §7.5). Lanes never interact, so a creature's race
// time is its own run. Pools here use different seeds from scripts/tune.ts.

let failed = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const read = (st: Stroke[]) => analyze(canonical(st))!;
const time = (a: Anatomy, s?: number, seed = 0) => { const r = new Race([{ anatomy: a, name: '', kind: 'player', score: s }], seed); while (!r.over) r.step(); return r.racers[0].finishTime ?? Infinity; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// ---- One ceiling for every kind ----
const kinds: Kind[] = ['quadruped', 'biped', 'centipede', 'hopper', 'flyer', 'worm', 'roller', 'jelly'];
const ceil = new Map<Kind, number[]>();
for (const kind of kinds) {
  const fams = FAMILIES.filter((f) => FAMILY_KIND[f] === kind);
  const ts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const st = fams.length ? template(mulberry32(91000 + i * 37), fams[i % fams.length], i / 9).strokes : rivalDrawing(mulberry32(91000 + i * 37), INKS, kind);
    const a = read(st);
    if (a.kind === kind) ts.push(time(a, 1));
  }
  ceil.set(kind, ts);
}
console.log('  kind        best possible (perfect score), s');
for (const [k, ts] of ceil) console.log(`  ${k.padEnd(11)} mean ${mean(ts).toFixed(3)}  range ${Math.min(...ts).toFixed(2)}–${Math.max(...ts).toFixed(2)}`);
const means = [...ceil.values()].map(mean), all = [...ceil.values()].flat();
check([...ceil.values()].every((ts) => ts.length >= 8), 'ceiling pools read as their kind');
check(Math.max(...means) - Math.min(...means) <= 0.05, `every kind shares one ceiling: means within 0.05 s (spread ${(Math.max(...means) - Math.min(...means)).toFixed(3)} s)`);
check(Math.max(...all) - Math.min(...all) <= 0.3, `any drawing at a perfect score lands within ±0.15 s of it (range ${Math.min(...all).toFixed(2)}–${Math.max(...all).toFixed(2)} s)`);

// ---- Harder near the top ----
const steps = [0.2, 0.4, 0.6, 0.8, 1].map((s, i, xs) => (i ? speedFactor(s) - speedFactor(xs[i - 1]) : 0)).slice(1);
check(steps.every((d, i) => i === 0 || d < steps[i - 1]), `each step of score is worth less speed near the ceiling (${steps.map((d) => (100 * d).toFixed(1) + '%').join(' > ')})`);

// ---- The same drawing runs the same time, whatever the race ----
{
  const a = read(template(mulberry32(3), 'bird', 0.5).strokes);
  const ts = [1, 99, 123456, 0xdeadbeef].map((s) => time(a, undefined, s));
  check(ts.every((t) => t === ts[0]), `same drawing, same time in every race (${ts.map((t) => t.toFixed(3)).join(', ')})`);
  check(score(read(template(mulberry32(3), 'bird', 0.5).strokes)).total === score(a).total, 'same drawing, same score');

  // Rhythm (switched off in the game): a real edge with a hard ceiling; mashing earns nothing.
  const run = (taps?: number[]) => { const r = new Race([{ anatomy: a, name: 'x', kind: 'player', taps }], 1); while (!r.over) r.step(); return r.racers[0].finishTime!; };
  const beat = BEAT[a.kind], ticks = (dt: number) => Array.from({ length: 200 }, (_, k) => Math.round((COUNTDOWN * DT + REACTION + k * dt) / DT));
  const base = run(), perfect = run(ticks(beat)), mash = run(ticks(DT * 3));
  const gain = base / perfect - 1;
  check(gain > 0.06 && gain <= MAX_BOOST + 0.005, `perfect rhythm is worth ${(100 * gain).toFixed(1)}% (ceiling ${100 * MAX_BOOST}%)`);
  check(mash >= base - 0.05, `button mashing earns nothing (${mash.toFixed(2)} s)`);
}

// ---- Drawing well is what's fast; ink and bare shapes are not ----
const beginners = Object.fromEntries(Object.entries(BEGINNERS).map(([n, d]) => [n, read(strokes(d, 3))]));
const bTimes = Object.values(beginners).map((a) => time(a)).sort((a, b) => a - b);
const median = bTimes[bTimes.length >> 1];
check(time(beginners['just a circle']) > median && time(beginners.squiggle) > median, `a bare circle (${time(beginners['just a circle']).toFixed(2)} s) and a squiggle (${time(beginners.squiggle).toFixed(2)} s) are slower than an ordinary drawing (${median.toFixed(2)} s)`);
check(time(beginners['dog, face and tail']) < time(beginners['potato dog']), 'a face and a tail make a dog faster');
{
  // Spots are a detail, once: fifty earn no more than five. Scribbling over it costs.
  const base = template(mulberry32(5), 'dog', 0.6).strokes;
  const r = mulberry32(8);
  const spots = (n: number): Stroke[] => Array.from({ length: n }, () => { const x = 230 + r() * 120, y = 265 + r() * 40; return { pts: [[x, y], [x + 2, y + 1]], color: INKS[0], w: 6 }; });
  const scribble: Stroke = { pts: Array.from({ length: 60 }, (_, i) => [220 + (i % 2) * 140 + r() * 10, 240 + i * 1.2]), color: INKS[0], w: 6 };
  const s0 = score(read(base)).total, s5 = score(read([...base, ...spots(5)])).total, s50 = score(read([...base, ...spots(50)])).total, sx = score(read([...base, scribble])).total;
  check(s50 <= s5 + 0.005, `fifty spots earn no more than five (${s0.toFixed(2)} → five ${s5.toFixed(2)}, fifty ${s50.toFixed(2)})`);
  check(sx < s0, `scribbling over it costs (${s0.toFixed(2)} → ${sx.toFixed(2)})`);
}

// ---- The house is beatable ----
{
  const fieldTimes = (seed: number) => lineup(seed).map((t) => time(read(t.strokes)));
  const N = Number(process.env.LINEUPS ?? 60);
  let places = 0, wins = 0, carefulWins = 0, carefulPlaces = 0;
  const careful = time(read(template(mulberry32(77), 'cat', 1).strokes));
  for (let s = 0; s < N; s++) {
    const house = fieldTimes(5000 + s);
    const place = 1 + house.filter((t) => t < median).length;
    places += place; if (place === 1) wins++;
    const cp = 1 + house.filter((t) => t < careful).length;
    carefulPlaces += cp; if (cp === 1) carefulWins++;
  }
  console.log(`  ordinary drawing (${median.toFixed(2)} s): mean place ${(places / N).toFixed(2)} of 5, wins ${((100 * wins) / N).toFixed(0)}%`);
  console.log(`  careful drawing (${careful.toFixed(2)} s): mean place ${(carefulPlaces / N).toFixed(2)} of 5, wins ${((100 * carefulWins) / N).toFixed(0)}%`);
  check(places / N <= 3.3 && wins / N >= 0.1, 'an ordinary first drawing finishes mid-pack against the house and sometimes wins');
  check(carefulWins / N >= 0.6, 'a careful drawing usually beats the house');
  const a = lineup(42).map((t) => t.family).join(), b = lineup(42).map((t) => t.family).join(), c = lineup(43).map((t) => t.family).join();
  check(a === b && a !== c && new Set(lineup(42).map((t) => t.family)).size === 4, 'a lineup is fixed by its seed, with four different families');
}

if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('all passed');
