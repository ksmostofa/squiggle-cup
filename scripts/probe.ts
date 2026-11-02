import { analyze } from '../src/analyze';
import { canonical } from '../src/drawing';
import { score } from '../src/score';
import { FAMILIES, FAMILY_KIND, template } from '../src/templates';
import { mulberry32 } from '../src/rng';

// Do the house templates read as their kind, and how do they score?
// node scripts/run-ts.mjs scripts/probe.ts [family]
const only = process.argv[3];
for (const fam of FAMILIES) {
  if (only && fam !== only) continue;
  const wrong: string[] = [];
  const by: Record<string, number[]> = { lo: [], mid: [], hi: [] };
  const feats = new Map<string, number>();
  for (let i = 0; i < 30; i++) {
    const skill = i % 3 === 0 ? 0.15 : i % 3 === 1 ? 0.5 : 0.95;
    const t = template(mulberry32(1000 + i * 7919), fam, skill);
    const a = analyze(canonical(t.strokes));
    if (!a || a.kind !== FAMILY_KIND[fam]) { wrong.push(`${i}:${a?.kind}`); continue; }
    const sc = score(a);
    by[skill < 0.3 ? 'lo' : skill < 0.7 ? 'mid' : 'hi'].push(sc.total);
    for (const f of sc.features) feats.set(f, (feats.get(f) ?? 0) + 1);
    if (process.env.V) console.log(fam, i, skill, 'form', sc.form.toFixed(2), 'craft', sc.craft.toFixed(2), 'coh', sc.cohesion.toFixed(2), sc.features.join(','), JSON.stringify(sc.face), 'parts', a.parts.map((p) => p.kind[0]).join(''));
  }
  const m = (xs: number[]) => xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : '-';
  console.log(fam.padEnd(8), `wrong ${wrong.length}/30`, wrong.slice(0, 6).join(' '), ' score lo', m(by.lo), 'mid', m(by.mid), 'hi', m(by.hi), ' ', [...feats].map(([f, n]) => `${f}:${n}`).join(' '));
}
