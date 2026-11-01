import { analyze } from '../src/analyze';
import { canonical } from '../src/drawing';
import { FAMILY_KIND, lineup } from '../src/templates';

// Every house creature in 400 lineups reads as its family's kind.
let bad = 0;
for (let seed = 0; seed < 400; seed++) {
  for (const t of lineup(seed)) {
    const a = analyze(canonical(t.strokes));
    if (a?.kind !== FAMILY_KIND[t.family]) { bad++; if (bad < 8) console.log('misread', seed, t.family, t.skill, a?.kind); }
  }
}
console.log(`${bad} of 1600 house creatures misread`);
