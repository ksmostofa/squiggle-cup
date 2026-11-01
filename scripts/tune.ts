import { type Kind, analyze } from '../src/analyze';
import { RIVAL_KINDS, rivalDrawing } from '../src/bots';
import { INKS } from '../src/course';
import { PROFILES, stats } from '../src/creature';
import { Race } from '../src/race';
import { mulberry32 } from '../src/rng';

// Calibrates PROFILES[kind].top so every kind's mean finish time over a pool
// of varied bot drawings lands on the same target. Prints values to paste
// into src/creature.ts. Run: node scripts/run-ts.mjs scripts/tune.ts

const N = Number(process.env.PER_KIND ?? 24);
const TARGET = Number(process.env.TARGET ?? 15.3);

const pools = new Map<Kind, ReturnType<typeof analyze>[]>();
for (const kind of RIVAL_KINDS) {
  pools.set(kind, Array.from({ length: N }, (_, i) => analyze(rivalDrawing(mulberry32(7000 + i * 13 + kind.length * 97), INKS, kind))).filter((a) => a?.kind === kind));
}

function times(kind: Kind): number[] {
  return pools.get(kind)!.map((a, i) => {
    const r = new Race([{ anatomy: a!, name: kind, kind: 'player' }], (i * 2654435761 + 11) >>> 0);
    while (!r.over) r.step();
    return (r.racers[0].finishTime ?? 60) * (0.95 + 0.1 * stats(a!).quality);
  });
}
// Fair means equal quality runs an equal time whatever the kind, so take the
// drawing-quality bonus back out (time scales as 1 / speed) before comparing.
const mean = (kind: Kind) => { const t = times(kind); return t.reduce((a, b) => a + b, 0) / t.length; };

for (let it = 0; it < Number(process.env.PASSES ?? 6); it++) {
  const line: string[] = [];
  for (const kind of RIVAL_KINDS) {
    const t = mean(kind);
    // Time lost to the start is about the same whatever the top speed, so scale the cruise part.
    const lost = PROFILES[kind].ramp * 0.25 + 0.6;
    PROFILES[kind].top *= (t - lost) / (TARGET - lost);
    line.push(`${kind} ${t.toFixed(2)}`);
  }
  console.log(`pass ${it + 1}: ${line.join('  ')}`);
}
// Equal means aren't enough: a kind with a wider spread takes more of the
// fastest times. Nudge each kind until its win rate in mixed fields of five is fair.
for (let it = 0; it < Number(process.env.WIN_PASSES ?? 0); it++) {
  const pool = new Map(RIVAL_KINDS.map((k) => [k, times(k)]));
  const rng = mulberry32(it + 1);
  const wins = new Map<Kind, number>(), seen = new Map<Kind, number>();
  for (let n = 0; n < 30000; n++) {
    let best = Infinity, who: Kind = RIVAL_KINDS[0];
    for (let l = 0; l < 5; l++) {
      const k = RIVAL_KINDS[Math.floor(rng() * RIVAL_KINDS.length)];
      const ts = pool.get(k)!, t = ts[Math.floor(rng() * ts.length)];
      seen.set(k, (seen.get(k) ?? 0) + 1);
      if (t < best) { best = t; who = k; }
    }
    wins.set(who, (wins.get(who) ?? 0) + 1);
  }
  const line: string[] = [];
  for (const k of RIVAL_KINDS) {
    const ratio = Math.max(0.05, (wins.get(k) ?? 0) / (seen.get(k) ?? 1) / 0.2);
    PROFILES[k].top *= ratio ** (-1 / 160);
    line.push(`${k} ${ratio.toFixed(2)}×`);
  }
  console.log(`win pass ${it + 1}: ${line.join('  ')}`);
}
for (const kind of RIVAL_KINDS) console.log(`  ${kind}: top ${PROFILES[kind].top.toFixed(3)}`);
