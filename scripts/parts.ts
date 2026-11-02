import { analyze } from '../src/analyze';
import { canonical } from '../src/drawing';
import { bbox } from '../src/geom';
import { mulberry32 } from '../src/rng';
import { type Family, template } from '../src/templates';

// Which part each stroke of one template became. node scripts/run-ts.mjs scripts/parts.ts horse [i] [skill]
const fam = process.argv[3] as Family, i = Number(process.argv[4] ?? 0), skill = Number(process.argv[5] ?? 0.95);
const t = template(mulberry32(1000 + i * 7919), fam, skill);
const a = analyze(canonical(t.strokes))!;
console.log(fam, i, 'kind', a.kind, 'box', JSON.stringify(a.box));
for (const p of a.parts) { const b = bbox(p.pts); console.log(p.kind.padEnd(6), `x ${b.x0.toFixed(0)}–${b.x1.toFixed(0)} y ${b.y0.toFixed(0)}–${b.y1.toFixed(0)}`, 'n', p.pts.length); }
