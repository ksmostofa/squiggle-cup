import { analyze } from '../src/analyze';
import { rivalDrawing } from '../src/bots';
import { INKS } from '../src/course';
import { Race } from '../src/race';
import { mulberry32 } from '../src/rng';
import type { Pt } from '../src/geom';
import { NOT_WINGS, strokes } from '../test/fixtures';

// Diagnostics for slithering creatures: per-second spread of height, tilt and
// forward speed, plus any backward steps. Run: node scripts/run-ts.mjs scripts/worm-probe.ts
// A hand-drawn S-curve: a big sine wave, the way people actually draw snakes.
const sCurve = (amp: number) => [{ pts: Array.from({ length: 40 }, (_, j): Pt => [100 + j * 10, 300 + amp * Math.sin(j / 4)]), color: INKS[0], w: 6 }];
const drawings = [
  rivalDrawing(mulberry32(0x5c0 + 2 * 977), INKS, 'worm'),
  strokes(NOT_WINGS['snake, long wavy line'].draw, 1),
  strokes(NOT_WINGS['snake, long outline'].draw, 1),
  sCurve(25), sCurve(45), sCurve(70),
];
for (let i = 0; i < drawings.length; i++) {
  const a = analyze(drawings[i])!;
  { const bb = new Race([{ anatomy: a, name: "w", kind: "player" }]).racers[0].body; console.log(`  parts ${a.parts.map((p) => p.kind).join(",")} legs ${a.legs} closed ${a.closed} m ${bb.m.toFixed(2)} I ${bb.I.toFixed(4)} rad ${bb.rad.toFixed(3)} hull ${bb.hull.length} walkerLegs ${bb.legs.length} crawl ${bb.crawl} bottom ${bb.bottom.toFixed(3)}`); }
  const r = new Race([{ anatomy: a, name: 'w', kind: 'player' }]);
  const b = r.racers[0].body;
  let sec = -1, ys: number[] = [], ths: number[] = [], vxs: number[] = [], back = 0, lastX = 0;
  const out: string[] = [];
  while (!r.over) {
    r.step();
    if (r.time < 0) continue;
    ys.push(b.y); ths.push(b.th); vxs.push(b.vx);
    if (b.x < lastX - 1e-4) back++;
    lastX = b.x;
    const s = Math.floor(r.time);
    if (s !== sec && ys.length > 30) {
      const span = (v: number[]) => (Math.max(...v) - Math.min(...v)).toFixed(3);
      out.push(`t${s} y±${span(ys)} th±${span(ths)} vx ${Math.min(...vxs).toFixed(2)}..${Math.max(...vxs).toFixed(2)}`);
      ys = []; ths = []; vxs = [];
      sec = s;
    }
  }
  console.log(`worm ${i} (${a.kind}) finish ${r.racers[0].finishTime?.toFixed(2)} backward steps ${back}`);
  console.log('  ' + out.slice(0, 8).join('\n  '));
}
