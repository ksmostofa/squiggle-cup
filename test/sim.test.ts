import { analyze } from '../src/analyze';
import { RIVAL_KINDS, rivalDrawing } from '../src/bots';
import { decode, encode } from '../src/encode';
import { type Entry, Race } from '../src/race';
import { mulberry32 } from '../src/rng';
import { ochre } from '../src/venues/ochre';

let failed = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const venue = ochre;

// Encoding round trip
{
  const strokes = rivalDrawing(mulberry32(7), venue.inks).map((s) => ({ pts: s.pts, ink: 1, thick: s.w > 10 }));
  const s = encode({ venue: venue.index, seed: 0xdeadbeef, name: 'Sir Reginald Fourlegs III ✨', strokes });
  const d = decode(s)!;
  check(!!d && d.seed === 0xdeadbeef && d.name === 'Sir Reginald Fourlegs III ✨', `encode/decode header (${s.length} chars)`);
  check(d.strokes.length === strokes.length, 'strokes round trip');
  check(JSON.stringify(decode(encode(d))!.strokes) === JSON.stringify(d.strokes), 'decoded strokes are stable under re-encoding');
  check(decode('garbage!!') === null, 'bad link decodes to null');
}

// The drawing reader recognises every kind of rival.
{
  const wrong: string[] = [];
  for (const kind of RIVAL_KINDS) {
    for (let i = 0; i < 6; i++) {
      const a = analyze(rivalDrawing(mulberry32(i * 31 + kind.length), venue.inks, kind));
      if (a?.kind !== kind) wrong.push(`${kind}→${a?.kind ?? 'null'}(legs ${a?.legs} wings ${a?.wings})`);
    }
  }
  check(!wrong.length, `rival drawings read as their kind${wrong.length ? ': ' + wrong.join(', ') : ''}`);
}

function entry(kind: (typeof RIVAL_KINDS)[number], seed: number, player = false): Entry {
  const a = analyze(rivalDrawing(mulberry32(seed), venue.inks, kind))!;
  return { anatomy: a, name: kind, kind: player ? 'player' : 'rival' };
}

function run(entries: Entry[], seed: number) {
  const r = new Race(venue, entries, seed);
  let bad = false;
  while (!r.over) {
    r.step();
    if (r.racers.some((x) => !Number.isFinite(x.body.x) || !Number.isFinite(x.body.th))) { bad = true; break; }
  }
  return { r, bad, hash: r.hash() };
}

// Determinism: same drawings and seed give the same race.
{
  const field = () => RIVAL_KINDS.slice(0, 5).map((k, i) => entry(k, 40 + i));
  const a = run(field(), 99), b = run(field(), 99);
  check(a.hash === b.hash && a.r.time === b.r.time, `same seed, same race (hash ${a.hash})`);
}

// Every kind on its own, several seeds: does it run, how fast, does it fall.
{
  const seeds = Number(process.env.SEEDS ?? 4);
  let bad = 0, tooFast = 0, dnf = 0;
  console.log('  kind        finished  times (s)                 falls  top m/s');
  for (const kind of RIVAL_KINDS) {
    const times: string[] = [];
    let falls = 0, top = 0;
    for (let i = 0; i < seeds; i++) {
      const { r, bad: b } = run([entry(kind, 100 + i, true)], 500 + i);
      if (b) bad++;
      const x = r.racers[0];
      if (x.finishTime !== null) { times.push(x.finishTime.toFixed(0)); if (100 / x.finishTime > 9) tooFast++; }
      else { dnf++; times.push(`DNF@${Math.round(x.body.x)}m`); }
      falls += x.stats.falls; top = Math.max(top, x.stats.topSpeed);
    }
    const n = times.filter((t) => !t.startsWith('DNF')).length;
    console.log(`  ${kind.padEnd(11)} ${n}/${seeds}       ${times.join(', ').padEnd(25)} ${String(falls).padStart(5)}  ${top.toFixed(1)}`);
  }
  check(bad === 0, 'no NaNs');
  check(tooFast === 0, 'nobody averages over 9 m/s');
  check(dnf === 0, 'every kind finishes the course');
}

if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('all passed');
