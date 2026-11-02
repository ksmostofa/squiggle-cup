import { type Anatomy, type Kind, analyze } from '../src/analyze';
import { rivalDrawing } from '../src/bots';
import { INKS } from '../src/course';
import { PROFILES } from '../src/creature';
import { canonical } from '../src/drawing';
import { Race } from '../src/race';
import { mulberry32 } from '../src/rng';
import { score } from '../src/score';
import { FAMILIES, FAMILY_KIND, template } from '../src/templates';
import { BEGINNERS } from '../test/beginners';
import { strokes } from '../test/fixtures';

// Calibrates PROFILES[kind].top so every kind runs the same time at a perfect
// score: the shared ceiling. Then reports where beginners and house creatures
// land, for setting house skill. Prints values to paste into src/creature.ts.
// Run: node scripts/run-ts.mjs scripts/tune.ts

const TARGET = Number(process.env.TARGET ?? 14.6);
export const CEILING_KINDS: Kind[] = ['quadruped', 'biped', 'centipede', 'hopper', 'flyer', 'worm', 'roller', 'jelly'];

export function pool(kind: Kind, n = 16): Anatomy[] {
  const fams = FAMILIES.filter((f) => FAMILY_KIND[f] === kind);
  const out: Anatomy[] = [];
  for (let i = 0; i < n; i++) {
    const st = fams.length ? template(mulberry32(7000 + i * 13), fams[i % fams.length], (i % 4) / 3).strokes : rivalDrawing(mulberry32(7000 + i * 13 + kind.length * 97), INKS, kind);
    const a = analyze(canonical(st));
    if (a?.kind === kind) out.push(a);
  }
  return out;
}

const time = (a: Anatomy, s?: number) => { const r = new Race([{ anatomy: a, name: '', kind: 'player', score: s }]); while (!r.over) r.step(); return r.racers[0].finishTime ?? 60; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const pools = new Map(CEILING_KINDS.map((k) => [k, pool(k)]));
for (let it = 0; it < Number(process.env.PASSES ?? 4); it++) {
  const line: string[] = [];
  for (const kind of CEILING_KINDS) {
    const t = mean(pools.get(kind)!.map((a) => time(a, 1)));
    const lost = PROFILES[kind].ramp * 0.25 + 0.6;
    PROFILES[kind].top *= (t - lost) / (TARGET - lost);
    line.push(`${kind} ${t.toFixed(3)}`);
  }
  console.log(`pass ${it + 1}: ${line.join('  ')}`);
}
for (const kind of CEILING_KINDS) console.log(`  ${kind}: { top: ${PROFILES[kind].top.toFixed(3)}, ramp: ${PROFILES[kind].ramp} },`);

console.log('\nbeginners (score, time):');
const bs: number[] = [];
for (const [name, draw] of Object.entries(BEGINNERS)) {
  const a = analyze(canonical(strokes(draw, 3)))!;
  const sc = score(a);
  bs.push(sc.total);
  console.log(`  ${name.padEnd(18)} ${a.kind.padEnd(10)} form ${sc.form.toFixed(2)} craft ${sc.craft.toFixed(2)} total ${sc.total.toFixed(2)}  ${time(a).toFixed(2)} s  ${sc.features.join(',')} ${JSON.stringify(sc.face)}`);
}
bs.sort((a, b) => a - b);
console.log(`  median ${bs[bs.length >> 1].toFixed(2)}  p25 ${bs[bs.length >> 2].toFixed(2)}  p75 ${bs[(bs.length * 3) >> 2].toFixed(2)}`);

console.log('\nhouse by skill (mean score):');
for (const skill of [0, 0.15, 0.3, 0.5, 0.7, 0.9]) {
  const xs = FAMILIES.flatMap((f) => Array.from({ length: 6 }, (_, i) => score(analyze(canonical(template(mulberry32(i * 101 + f.length), f, skill).strokes))!).total));
  console.log(`  skill ${skill}: ${mean(xs).toFixed(2)} (min ${Math.min(...xs).toFixed(2)}, max ${Math.max(...xs).toFixed(2)})`);
}
