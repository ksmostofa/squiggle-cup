import { analyze } from '../src/analyze';
import { RIVAL_KINDS, rivalDrawing } from '../src/bots';
import { INKS } from '../src/course';
import { decode, encode } from '../src/encode';
import { type Entry, Race } from '../src/race';
import { canonical } from '../src/drawing';
import { REACH_DOWN, REACH_UP, creatureBounds, shownHeight } from '../src/render';
import { mulberry32 } from '../src/rng';
import { FAMILIES, template } from '../src/templates';
import { NOT_WINGS, WINGS, strokes } from './fixtures';

let failed = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

// ---------- Dare links ----------
{
  const strokes = rivalDrawing(mulberry32(7), INKS).map((s) => ({ pts: s.pts, ink: 1, thick: s.w > 10 }));
  const s = encode({ pick: 0, seed: 0xdeadbeef, name: 'Sir Reginald Fourlegs III ✨', strokes });
  const d = decode(s)!;
  check(!!d && d.seed === 0xdeadbeef && d.name === 'Sir Reginald Fourlegs III ✨', `encode/decode header (${s.length} chars)`);
  check(d.strokes.length === strokes.length, 'strokes round trip');
  check(JSON.stringify(decode(encode(d))!.strokes) === JSON.stringify(d.strokes), 'decoded strokes are stable under re-encoding');
  check(decode('garbage!!') === null, 'bad link decodes to null');
}

// ---------- Reading the drawing ----------
{
  const wrong: string[] = [];
  for (const kind of RIVAL_KINDS) {
    for (let i = 0; i < 12; i++) {
      const a = analyze(rivalDrawing(mulberry32(i * 31 + kind.length), INKS, kind));
      if (a?.kind !== kind) wrong.push(`${kind}→${a?.kind ?? 'null'}(legs ${a?.legs} wings ${a?.wings})`);
    }
  }
  check(!wrong.length, `bot drawings read as their kind${wrong.length ? ': ' + wrong.join(', ') : ''}`);
}
{
  // Every wing style, small to large, anywhere on the pad, many hands.
  const wrong: string[] = [];
  let n = 0;
  for (const [name, draw] of Object.entries(WINGS)) {
    for (const [scale, dx, dy] of [[1, 0, 0], [0.45, -120, 80], [1.5, 0, 20], [0.7, 90, -60]]) {
      for (let seed = 1; seed <= 4; seed++) {
        n++;
        const a = analyze(strokes(draw, seed, scale, dx, dy));
        if (a?.kind !== 'flyer') wrong.push(`${name} ×${scale}#${seed}→${a?.kind}(wings ${a?.wings} legs ${a?.legs})`);
      }
    }
  }
  const styles = [...new Set(wrong.map((w) => w.split(' ×')[0]))];
  check(!wrong.length, `${Object.keys(WINGS).length} wing styles read as flying (${n - wrong.length}/${n})${wrong.length ? `: misread styles [${styles.join(' | ')}] e.g. ` + wrong.slice(0, 6).join(', ') : ''}`);
}
{
  const wrong: string[] = [];
  for (const [name, { kind, draw }] of Object.entries(NOT_WINGS)) {
    for (const scale of [0.5, 1, 1.4]) {
      for (let seed = 1; seed <= 3; seed++) {
        const a = analyze(strokes(draw, seed, scale));
        if (a?.kind !== kind) wrong.push(`${name} ×${scale}→${a?.kind}(wings ${a?.wings} legs ${a?.legs})`);
      }
    }
  }
  check(!wrong.length, `look-alikes keep their kind (tails, necks, ears, snakes, balls, blobs)${wrong.length ? ': ' + wrong.slice(0, 8).join(', ') : ''}`);
}

// A stick figure whose head is its biggest loop: the head is not the body,
// and the torso's open bottom isn't two more legs.
{
  const S = (pts: number[][]) => ({ pts: pts as [number, number][], color: INKS[0], w: 11 });
  const ring = Array.from({ length: 41 }, (_, i) => [490 + 110 * Math.cos((i / 40) * 2 * Math.PI), 380 + 105 * Math.sin((i / 40) * 2 * Math.PI)]);
  const torso = [[480, 485], [480, 540], [490, 590], [510, 625], [560, 615], [610, 600], [605, 560], [590, 520], [565, 470]];
  for (const [label, t] of [['open', torso], ['closed', [...torso, [480, 487]]]] as const) {
    const a = analyze([S(ring), S([[443, 373], [444, 374]]), S([[507, 375], [508, 376]]), S([[462, 438], [480, 444], [500, 440], [513, 428]]), S(t),
      S([[540, 620], [545, 680], [555, 740]]), S([[585, 610], [600, 660], [628, 708]])])!;
    check(a.kind === 'biped' && a.legs === 2 && a.heads === 1, `big-headed stick figure (${label} torso) reads as a biped with a head (${a.kind}, ${a.legs} legs, ${a.heads} heads)`);
  }
}

// ---------- Races ----------
function entry(kind: (typeof RIVAL_KINDS)[number], seed: number, player = false): Entry {
  const a = analyze(rivalDrawing(mulberry32(seed), INKS, kind))!;
  return { anatomy: a, name: kind, kind: player ? 'player' : 'rival' };
}

// Runs a race and watches how each body actually moves.
function watch(entries: Entry[], seed: number) {
  const r = new Race(entries, seed);
  const m = r.racers.map((x) => ({ back: 0, hop: 0, air: 0, ticks: 0, planted: 0, legTicks: 0, flap: 0, alt: 0, altN: 0, rest: x.body.y, bad: false }));
  while (!r.over) {
    r.step();
    if (!r.started || r.time < 1.5) continue;
    r.racers.forEach((x, i) => {
      const b = x.body, s = m[i];
      if (!Number.isFinite(b.x) || !Number.isFinite(b.th)) s.bad = true;
      if (x.done) return;
      s.ticks++;
      if (b.vx < -0.05) s.back++;
      s.hop = Math.max(s.hop, b.y - s.rest);
      if (b.y > s.rest + 0.03) s.air++;
      if (b.legs.length) { s.legTicks++; if (b.legs.some((l) => l.planted)) s.planted++; }
      if (b.lift > 0) { s.flap = Math.max(s.flap, b.flapAmp); s.alt += b.y + b.bottom; s.altN++; }
    });
  }
  return { r, m };
}

{
  const seeds = Number(process.env.SEEDS ?? 4);
  let bad = 0, dnf = 0, falls = 0;
  const unnatural: string[] = [];
  console.log('  kind        finished  times (s)                     falls  top m/s');
  for (const kind of RIVAL_KINDS) {
    const times: string[] = [];
    let kf = 0, top = 0;
    for (let i = 0; i < seeds; i++) {
      const { r, m } = watch([entry(kind, 100 + i, true)], 500 + i);
      const x = r.racers[0], s = m[0];
      if (s.bad) bad++;
      if (x.finishTime !== null) times.push(x.finishTime.toFixed(1));
      else { dnf++; times.push(`DNF@${Math.round(x.body.x)}m`); }
      kf += x.stats.falls; top = Math.max(top, x.stats.topSpeed);
      const why: string[] = [];
      if (s.back > 0.01 * s.ticks) why.push(`slides backwards ${((100 * s.back) / s.ticks).toFixed(0)}%`);
      if (kind === 'hopper') { if (s.air < 0.25 * s.ticks || s.hop < 0.06) why.push(`hardly hops (${((100 * s.air) / s.ticks).toFixed(0)}% up, ${s.hop.toFixed(2)} m)`); }
      else if (kind !== 'flyer' && s.hop > 0.12) why.push(`jumps ${s.hop.toFixed(2)} m`);
      if (s.legTicks && kind !== 'hopper' && kind !== 'flyer' && s.planted < 0.95 * s.legTicks) why.push('feet leave the ground');
      if (kind === 'flyer') {
        if (s.altN && s.alt / s.altN < 0.25) why.push(`stays low (${(s.alt / s.altN).toFixed(2)} m)`);
        if (s.flap < 0.45) why.push(`wings barely flap (${s.flap.toFixed(2)})`);
      }
      if (why.length) unnatural.push(`${kind}#${i}: ${why.join(', ')}`);
    }
    falls += kf;
    console.log(`  ${kind.padEnd(11)} ${times.filter((t) => !t.startsWith('DNF')).length}/${seeds}       ${times.join(', ').padEnd(29)} ${String(kf).padStart(5)}  ${top.toFixed(1)}`);
  }
  check(bad === 0, 'no NaNs');
  check(dnf === 0, 'every kind finishes the course');
  check(falls === 0, 'nobody falls over');
  check(!unnatural.length, `natural motion: no backward sliding or jumping, feet plant, hoppers hop, flyers fly and flap${unnatural.length ? ': ' + unnatural.join('; ') : ''}`);
}

// ---------- Determinism ----------
{
  const field = () => RIVAL_KINDS.slice(0, 5).map((k, i) => entry(k, 40 + i));
  const a = watch(field(), 99).r, b = watch(field(), 99).r;
  check(a.hash() === b.hash() && a.time === b.time, `same drawings + seed, same race (hash ${a.hash()})`);
  // Through a dare link: the drawing as decoded must race identically.
  const e = entry('quadruped', 3, true);
  const packed = e.anatomy.parts.map((p) => ({ pts: p.pts, ink: 0, thick: false }));
  const once = decode(encode({ pick: 0, seed: 5, name: 'x', strokes: packed }))!;
  const twice = decode(encode(once))!;
  const race = (d: typeof once) => {
    const an = analyze(d.strokes.map((s) => ({ pts: s.pts, color: INKS[0], w: 7 })))!;
    const r = new Race([{ anatomy: an, name: 'x', kind: 'player' }], d.seed);
    while (!r.over) r.step();
    return r.hash();
  };
  check(race(once) === race(twice), 'a dare link replays the identical race');
}

// ---------- Hand-drawn snakes stay on the floor ----------
{
  // Zigzags and S-curves touch the floor at only a few points far from the
  // centre; they used to be flung into the air.
  const sCurve = (amp: number) => [{ pts: Array.from({ length: 40 }, (_, j): [number, number] => [100 + j * 10, 300 + amp * Math.sin(j / 4)]), color: INKS[0], w: 6 }];
  const snakes = { zigzag: strokes(NOT_WINGS['snake, long wavy line'].draw, 1), 'gentle S': sCurve(25), 'deep S': sCurve(70) };
  const bad: string[] = [];
  for (const [name, s] of Object.entries(snakes)) {
    const a = analyze(s)!;
    // Physics only: a fixed score, so how well it's drawn doesn't move the bounds.
    const r = new Race([{ anatomy: a, name, kind: 'player', score: 0.5 }]);
    let maxY = 0;
    while (!r.over) { r.step(); maxY = Math.max(maxY, r.racers[0].body.y); }
    const t = r.racers[0].finishTime ?? Infinity;
    if (t < 13 || t > 18 || maxY > 0.3) bad.push(`${name} ${t.toFixed(2)} s, up to ${maxY.toFixed(2)} m`);
  }
  check(!bad.length, `hand-drawn snakes slither on the floor${bad.length ? ': ' + bad.join(', ') : ''}`);
}

// ---------- No part of a drawing sinks through the floor ----------
{
  // Two or three loops stacked: the body is one of them, and the others
  // used to hang through the ground because only the body touched it.
  const loop = (r: () => number, cx: number, cy: number, rx: number, ry: number): [number, number][] => {
    const ph = r() * 6;
    return Array.from({ length: 31 }, (_, i) => [cx + Math.cos((i / 30) * 6.2832) * rx * (1 + 0.1 * Math.sin(i * 3 + ph)), cy + Math.sin((i / 30) * 6.2832) * ry]);
  };
  let sunk = 0, worst = 0;
  for (let seed = 0; seed < 60; seed++) {
    const r = mulberry32(seed), top = 22 + r() * 28, bot = 25 + r() * 30;
    const pts = [loop(r, 300, 240, top, top * (0.8 + r() * 0.3)), loop(r, 300 + (r() - 0.5) * 40, 240 + top + r() * bot, bot, bot * (0.6 + r() * 0.4))];
    const a = analyze(canonical(pts.map((p) => ({ pts: p, color: INKS[0], w: 6 }))));
    if (!a) continue;
    const race = new Race([{ anatomy: a, name: '', kind: 'player' }]);
    let lowest = Infinity;
    while (!race.over) {
      race.step();
      const p = race.racers[0], b = p.body, s = p.s.size, [cx, cy] = a.center;
      for (const part of a.parts) if (part.kind !== 'leg') for (const q of part.pts) lowest = Math.min(lowest, b.toWorld([(q[0] - cx) * s, -(q[1] - cy) * s])[1]);
    }
    worst = Math.min(worst, lowest);
    if (lowest < -0.08) sunk++;
  }
  check(!sunk, `no part of a drawing sinks through the floor (deepest dip ${(-worst * 100).toFixed(0)} cm)`);
}

// ---------- Every house creature fits its lane at the one shared scale ----------
{
  const over: string[] = [];
  for (const fam of FAMILIES) for (let i = 0; i < 4; i++) {
    const a = analyze(canonical(template(mulberry32(300 + i), fam, i / 3).strokes))!;
    const r = new Race([{ anatomy: a, name: '', kind: 'player' }]);
    let up = 0, down = 0;
    while (!r.over) {
      r.step();
      const p = r.racers[0], y = shownHeight(p.body.y, p.restY);
      const b = creatureBounds({ body: p.body, anatomy: p.anatomy, size: p.s.size, t: r.time, drop: p.body.y - y });
      up = Math.max(up, y - b.top); down = Math.max(down, b.bottom - y);
    }
    if (up > REACH_UP || down > REACH_DOWN) over.push(`${fam} ${i}: ${up.toFixed(2)} up, ${down.toFixed(2)} down`);
  }
  check(!over.length, `every house creature stays within its lane (plus SPILL into the lane behind) through a whole race${over.length ? ': ' + over.join(', ') : ''}`);
}

if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('all passed');
