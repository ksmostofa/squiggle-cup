import type { Kind } from '../src/analyze';
import { analyze } from '../src/analyze';
import { RIVAL_KINDS, rivalDrawing } from '../src/bots';
import { INKS, LANES } from '../src/course';
import { BEAT, COUNTDOWN, MAX_BOOST, REACTION, Race } from '../src/race';
import { DT } from '../src/creature';
import { stats } from '../src/creature';
import { mulberry32 } from '../src/rng';

// Fairness (PRD §7.5). Lanes never interact, so a race is just each
// creature's own run: we race a pool of varied creatures of every kind once
// each, then deal thousands of mixed fields from the pool and see who wins.
// A better-drawn creature is meant to win, and the bot pools vary in quality
// more for some kinds than others, so wins are judged with the quality bonus
// taken out: at equal quality, no kind may be favoured.

const PER_KIND = Number(process.env.PER_KIND ?? 40);
const RACES = Number(process.env.RACES ?? 5000);

let failed = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

const kinds: Kind[] = [...RIVAL_KINDS];
const pool = new Map<Kind, number[]>();
for (const kind of kinds) {
  const times: number[] = [];
  for (let i = 0; i < PER_KIND; i++) {
    const a = analyze(rivalDrawing(mulberry32(9000 + i * 17 + kind.length * 101), INKS, kind));
    if (!a || a.kind !== kind) continue;
    const r = new Race([{ anatomy: a, name: kind, kind: 'player' }], (i * 2654435761) >>> 0);
    while (!r.over) r.step();
    times.push((r.racers[0].finishTime ?? Infinity) * (0.95 + 0.1 * stats(a).quality));
  }
  pool.set(kind, times);
}

const rng = mulberry32(42);
const wins = new Map<Kind, number>(kinds.map((k) => [k, 0]));
const seen = new Map<Kind, number>(kinds.map((k) => [k, 0]));
for (let n = 0; n < RACES; n++) {
  let best = Infinity, who: Kind | null = null;
  for (let l = 0; l < LANES; l++) {
    const k = kinds[Math.floor(rng() * kinds.length)];
    const ts = pool.get(k)!;
    const t = ts[Math.floor(rng() * ts.length)];
    seen.set(k, seen.get(k)! + 1);
    if (t < best) { best = t; who = k; }
  }
  if (who) wins.set(who, wins.get(who)! + 1);
}

const fair = 1 / LANES;
console.log(`  ${RACES} races of ${LANES}, pool of ${PER_KIND} drawings per kind; fair share ${(100 * fair).toFixed(0)}% per entry`);
console.log('  (times with the drawing-quality bonus taken out)');
console.log('  kind        mean s   best–worst s    win rate   × fair');
const ratios: number[] = [];
const means: number[] = [];
for (const k of kinds) {
  const ts = pool.get(k)!;
  const mean = ts.reduce((a, b) => a + b, 0) / ts.length;
  means.push(mean);
  const rate = wins.get(k)! / seen.get(k)!;
  ratios.push(rate / fair);
  console.log(`  ${k.padEnd(11)} ${mean.toFixed(2).padStart(6)}   ${Math.min(...ts).toFixed(2)}–${Math.max(...ts).toFixed(2)}     ${(100 * rate).toFixed(1).padStart(5)}%    ${(rate / fair).toFixed(2)}`);
}
check(pool.size === kinds.length && [...pool.values()].every((t) => t.length >= PER_KIND * 0.8), 'pool drawings read as their kind');
check(means.every(Number.isFinite), 'every kind finishes');
check(Math.max(...means) - Math.min(...means) < 0.8, `mean times within 0.8 s across kinds (spread ${(Math.max(...means) - Math.min(...means)).toFixed(2)} s)`);
const all = [...pool.values()].flat();
check(Math.max(...all) - Math.min(...all) < 0.2, `at equal quality every kind runs the same time, ±0.1 s (range ${Math.min(...all).toFixed(2)}–${Math.max(...all).toFixed(2)} s)`);

// The same drawing runs the same time in every race, whatever the seed.
{
  const a = analyze(rivalDrawing(mulberry32(3), INKS, 'flyer'))!;
  const run = (seed: number, taps?: number[]) => { const r = new Race([{ anatomy: a, name: 'x', kind: 'player', taps }], seed); while (!r.over) r.step(); return r.racers[0].finishTime!; };
  const ts = [1, 99, 123456, 0xdeadbeef].map((s) => run(s));
  check(ts.every((t) => t === ts[0]), `same drawing, same time in every race (${ts.map((t) => t.toFixed(3)).join(', ')})`);

  // Rhythm: a perfect groove is a real edge with a hard ceiling; mashing earns nothing.
  const beat = BEAT.flyer, ticks = (dt: number) => Array.from({ length: 200 }, (_, k) => Math.round((COUNTDOWN * DT + REACTION + k * dt) / DT));
  const base = ts[0], perfect = run(1, ticks(beat)), mash = run(1, ticks(DT * 3));
  const gain = base / perfect - 1;
  check(gain > 0.06 && gain <= MAX_BOOST + 0.005, `perfect rhythm is worth ${(100 * gain).toFixed(1)}% (ceiling ${100 * MAX_BOOST}%): ${base.toFixed(2)} → ${perfect.toFixed(2)} s`);
  check(mash >= base - 0.05, `button mashing earns nothing (${mash.toFixed(2)} s)`);
}


if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('all passed');
