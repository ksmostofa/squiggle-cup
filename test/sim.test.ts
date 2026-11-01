import { analyze } from '../src/analyze';
import { botDrawing } from '../src/bots';
import { decode, encode } from '../src/encode';
import { type Entry, Race, loadPhysics } from '../src/race';
import { mulberry32 } from '../src/rng';
import { bestInShow } from '../src/venues/bestInShow';

let failed = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

await loadPhysics();
const venue = bestInShow;

function field(seed: number, n: number): Entry[] {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, (_, i) => {
    const a = analyze(botDrawing(rng, venue.inks));
    if (!a) throw new Error('bot drawing did not analyse');
    return { anatomy: a, name: `bot${i}`, kind: 'bot' as const };
  });
}

function run(entries: Entry[], seed: number) {
  const r = new Race(venue, entries, seed);
  let nan = false;
  while (!r.over) { r.step(); if (!Number.isFinite(r.creatures[0].pos.x)) { nan = true; break; } }
  const res = { hash: r.hash(), time: r.time, creatures: r.creatures.map((c) => ({ x: c.pos.x, t: c.finishTime, legs: c.limbs.length, nudges: c.stats.nudges, flips: c.stats.flips })), nan };
  r.free();
  return res;
}

// Encoding round trip
{
  const rng = mulberry32(7);
  const strokes = botDrawing(rng, venue.inks).map((s) => ({ pts: s.pts, ink: 1, thick: s.w > 10 }));
  const inputs = [{ tick: 180, type: 'tap' as const }, { tick: 200, type: 'press' as const }, { tick: 260, type: 'release' as const }, { tick: 7000, type: 'tap' as const }];
  const s = encode({ venue: 0, seed: 0xdeadbeef, name: 'Sir Reginald Fourlegs III ✨', strokes, inputs });
  const d = decode(s)!;
  check(!!d && d.seed === 0xdeadbeef && d.name === 'Sir Reginald Fourlegs III ✨', `encode/decode header (${s.length} chars)`);
  check(JSON.stringify(d.inputs) === JSON.stringify(inputs), 'inputs round trip');
  check(d.strokes.length === strokes.length && d.strokes.every((x, i) => Math.abs(x.pts[0][0] - strokes[i].pts[0][0]) <= 1.5), 'strokes round trip within the 3 px grid');
  const again = decode(encode(d))!;
  check(JSON.stringify(again.strokes) === JSON.stringify(d.strokes), 'decoded strokes are stable under re-encoding');
  check(decode('garbage!!') === null, 'bad link decodes to null');
}

// Determinism: same drawings, seed and inputs give the same world
{
  const a = run(field(42, 4), 99), b = run(field(42, 4), 99);
  check(a.hash === b.hash && a.time === b.time, `same seed, same result (hash ${a.hash})`);
}

// Fuzz the bot field
{
  const races = Number(process.env.RACES ?? 12);
  const times: number[] = [];
  let nan = 0, dnf = 0, fast = 0, stuck = 0;
  const byLegs = new Map<number, number[]>();
  const t0 = performance.now();
  for (let i = 0; i < races; i++) {
    const r = run(field(1000 + i, 4), i);
    if (r.nan) nan++;
    for (const c of r.creatures) {
      if (c.t === null) { dnf++; if (c.x < 46) stuck++; continue; }
      times.push(c.t);
      if (92 / c.t > 9) fast++;
      const l = byLegs.get(c.legs) ?? []; l.push(c.t); byLegs.set(c.legs, l);
    }
  }
  times.sort((a, b) => a - b);
  const pct = (p: number) => times[Math.floor(p * (times.length - 1))]?.toFixed(1);
  console.log(`  ${races} races in ${((performance.now() - t0) / 1000).toFixed(1)} s; finish times p10 ${pct(0.1)} / p50 ${pct(0.5)} / p90 ${pct(0.9)} s; DNF ${dnf}/${races * 4}`);
  console.log('  median by legs: ' + [...byLegs].sort((a, b) => a[0] - b[0]).map(([l, ts]) => `${l}:${ts.sort((a, b) => a - b)[ts.length >> 1].toFixed(0)}s(n=${ts.length})`).join(' '));
  check(nan === 0, 'no NaNs');
  check(fast === 0, 'nobody averages over 9 m/s');
  check(stuck === 0, 'nobody stuck before halfway at the 120 s cap');
}

if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('all passed');
