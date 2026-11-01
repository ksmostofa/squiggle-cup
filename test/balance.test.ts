import type { Kind } from '../src/analyze';
import { analyze } from '../src/analyze';
import { RIVAL_KINDS, rivalDrawing } from '../src/bots';
import { INKS, LANES } from '../src/course';
import { Race } from '../src/race';
import { mulberry32 } from '../src/rng';

// Fairness (PRD §7.5). Lanes never interact, so a race is just each
// creature's own run: we race a pool of varied creatures of every kind once
// each, then deal thousands of mixed fields from the pool and see who wins.

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
    times.push(r.racers[0].finishTime ?? Infinity);
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
check(Math.max(...ratios) <= 1.5, `no kind wins more than 1.5× its fair share (max ${Math.max(...ratios).toFixed(2)}×)`);
check(Math.min(...ratios) > 0.2, `every kind wins sometimes (min ${Math.min(...ratios).toFixed(2)}×)`);

if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('all passed');
