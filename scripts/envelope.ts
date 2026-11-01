import { analyze } from '../src/analyze';
import { canonical } from '../src/drawing';
import { Race } from '../src/race';
import { creatureBounds } from '../src/render';
import { mulberry32 } from '../src/rng';
import { FAMILIES, template } from '../src/templates';

// Per house family: metres above the ground line the drawn pose reaches over
// a whole race, if altitude above standing height is drawn at ALT scale.
// node scripts/run-ts.mjs scripts/envelope.ts [alt]
const ALT = Number(process.argv[3] ?? 0.3);
let worstUp = 0, worstDown = 0;
for (const fam of FAMILIES) {
  let up = 0, down = 0, stand = 0;
  for (let s = 0; s < 8; s++) {
    const a = analyze(canonical(template(mulberry32(500 + s * 31), fam, s / 7).strokes))!;
    const r = new Race([{ anatomy: a, name: '', kind: 'player' }]);
    while (!r.over) {
      r.step();
      const p = r.racers[0], b = creatureBounds({ body: p.body, anatomy: p.anatomy, size: p.s.size, t: r.time });
      const y = p.body.y <= p.restY ? p.body.y : p.restY + (p.body.y - p.restY) * ALT;
      up = Math.max(up, y - b.top); down = Math.max(down, b.bottom - y);
      if (r.tick === 1) stand = Math.max(stand, p.body.y - b.top);
    }
  }
  worstUp = Math.max(worstUp, up); worstDown = Math.max(worstDown, down);
  console.log(fam.padEnd(8), 'up', up.toFixed(2), 'standing', stand.toFixed(2), 'down', down.toFixed(2));
}
console.log('worst up', worstUp.toFixed(2), 'down', worstDown.toFixed(2));
