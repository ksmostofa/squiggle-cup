import { type Pt, area, bbox, centroid, dist, distToPolyline, pointInPoly, polyLen, rdp } from './geom';

// Reads a drawing (pad pixels, 600×600, y down) into labelled parts and a
// creature type. Thresholds are fractions of the drawing's own size, so a
// small drawing reads the same as a big one. Pure arithmetic: runs in tests.

export interface Stroke { pts: Pt[]; color: string; w: number }

export type PartKind = 'body' | 'leg' | 'wing' | 'tail' | 'eye' | 'decor';
export interface Part {
  kind: PartKind;
  pts: Pt[];
  color: string;
  w: number;
  pivot: Pt;     // where it hinges: hip for legs, root for wings and tails
  side: number;  // wings and tails: -1 left of the body, 1 right
  order: number; // legs: 0 = rearmost
}

export type Kind = 'biped' | 'quadruped' | 'centipede' | 'hopper' | 'flyer' | 'roller' | 'worm' | 'jelly' | 'scribble';

export interface Anatomy {
  kind: Kind;
  parts: Part[];          // drawing order: tails and wings behind, then legs, body, decor
  body: Part;
  eyes: { c: Pt; r: number }[];
  box: ReturnType<typeof bbox>;
  center: Pt;             // body centroid
  closed: boolean;        // body is a closed outline
  legs: number;
  wings: number;
  tails: number;
  roundness: number;      // of the body, 0..1 (1 = circle)
  aspect: number;         // drawing width / height
  crossings: number;
  legLen: number;         // mean leg height as a fraction of drawing height
  ink: number;            // total stroke length, pad px
}

export function isClosed(p: Pt[], len: number) {
  return p.length >= 4 && len >= 50 && dist(p[0], p[p.length - 1]) <= Math.max(24, len * 0.16);
}

const roundOf = (pts: Pt[], len: number) => (len > 0 ? Math.min(1, (4 * Math.PI * area(pts)) / (len * len)) : 0);

export function analyze(strokes: Stroke[]): Anatomy | null {
  const items = strokes.filter((s) => s.pts.length).map((s) => {
    const len = polyLen(s.pts);
    return { s, len, closed: isClosed(s.pts, len), bb: bbox(s.pts) };
  });
  if (!items.length) return null;
  const box = bbox(items.flatMap((i) => i.s.pts));
  const W = Math.max(24, box.w), H = Math.max(24, box.h), M = Math.max(W, H);

  // Body: the biggest, roundest closed outline; else the longest line.
  let bi = -1, best = 0;
  items.forEach((it, i) => {
    if (!it.closed || it.len < 0.25 * M) return;
    const score = area(it.s.pts) * (0.4 + roundOf(it.s.pts, it.len));
    if (score > best) { best = score; bi = i; }
  });
  if (bi < 0) items.forEach((it, i) => { if (it.len > best) { best = it.len; bi = i; } });
  if (bi < 0 || items[bi].len < 20) return null;

  const bodyIt = items[bi];
  const closed = bodyIt.closed;
  const bodyPoly = rdp(bodyIt.s.pts, 1.5);
  const bb = bodyIt.bb;
  const center: Pt = closed ? centroid(bodyPoly) : [bb.x0 + bb.w / 2, bb.y0 + bb.h / 2];
  const nearBody = (p: Pt) => (closed && pointInPoly(p, bodyPoly) ? 0 : distToPolyline(p, bodyPoly, closed));
  const nearestTo = (pts: Pt[], q: (p: Pt) => number) => pts.reduce((a, p) => (q(p) < q(a) ? p : a), pts[0]);

  const body: Part = { kind: 'body', pts: bodyIt.s.pts, color: bodyIt.s.color, w: bodyIt.s.w, pivot: center, side: 0, order: 0 };
  const legs: Part[] = [], wings: Part[] = [], tails: Part[] = [], decor: Part[] = [], dots: Part[] = [];
  const endWings: Part[] = [];
  const eyes: Anatomy['eyes'] = [];
  // Small round loops: heads, which tell a neck from a raised wing.
  const heads = items.filter((it, i) => i !== bi && it.closed && roundOf(it.s.pts, it.len) >= 0.6 && Math.max(it.bb.w, it.bb.h) < 0.6 * Math.max(bb.w, bb.h))
    .map((it) => ({ ...it, c: [it.bb.x0 + it.bb.w / 2, it.bb.y0 + it.bb.h / 2] as Pt }));

  items.forEach((it, i) => {
    if (i === bi) return;
    const { s, len, bb: b } = it;
    const c: Pt = [b.x0 + b.w / 2, b.y0 + b.h / 2];
    const part = (kind: PartKind, pts = s.pts, pivot: Pt = pts[0], side = 0): Part => ({ kind, pts, color: s.color, w: s.w, pivot, side, order: 0 });

    // Dots and little loops inside the body are eyes. They stay exactly as drawn.
    const small = Math.max(b.w, b.h) < Math.max(18, 0.12 * M);
    if (small && (len < 0.07 * M || it.closed) && (!closed || pointInPoly(c, bodyPoly))) {
      eyes.push({ c, r: Math.max(b.w, b.h) / 2 });
      dots.push(part('eye'));
      return;
    }
    if (len < 0.07 * M) { decor.push(part('decor')); return; }

    // A long flat open line beside an open body is more body (a snake's other side).
    const bodyLine = !it.closed && b.w > 0.5 * W && b.w > 2.5 * Math.max(1, b.h);

    // Legs: open strokes with "feet", low points near the bottom of the drawing.
    // A zigzag is several legs.
    if (!it.closed && !bodyLine) {
      const feet = footPeaks(s.pts, box, closed ? bb.y1 - 0.1 * bb.h : -Infinity, Math.max(14, 0.1 * H));
      if (feet.length) {
        for (const seg of splitAtValleys(s.pts, feet)) {
          const top = seg.reduce((a, p) => (p[1] < a[1] ? p : a), seg[0]);
          const hip = nearBody(seg[0]) <= nearBody(seg[seg.length - 1]) ? seg[0] : seg[seg.length - 1];
          legs.push(part('leg', seg, nearBody(hip) < 0.15 * M ? hip : top));
        }
        return;
      }
    }

    const sticksOut = b.x0 < bb.x0 - 0.12 * bb.w || b.x1 > bb.x1 + 0.12 * bb.w;
    const side = c[0] < center[0] ? -1 : 1;
    const round = it.closed ? roundOf(s.pts, len) : 0;
    const root = nearestTo(s.pts, nearBody);

    // Wings, however they're drawn: raised up off the back, flung out
    // sideways, as a loop, or as a feathery zigzag. All of them sit on the
    // upper half of the body and are big next to it.
    const S = Math.max(bb.w, bb.h);
    const attached = nearBody(root) < 0.15 * M;
    const high = c[1] < center[1] - 0.02 * H;
    const rise = root[1] - b.y0;
    const rootMid = root[0] > bb.x0 + 0.12 * bb.w && root[0] < bb.x1 - 0.12 * bb.w;
    const rootEnd = !rootMid;
    const neck = heads.some((h) => h !== it && dist(h.c, [b.x0 + b.w / 2, b.y0]) < 0.14 * M);
    const big = Math.max(b.w, b.h) >= 0.28 * S && len >= 0.12 * M;
    // A round loop is a head; a wing loop is drawn long (or lopsided).
    const longLoop = it.closed && (round < 0.8 || Math.max(b.w, b.h) >= 1.45 * Math.min(b.w, b.h));
    if (attached && high && big && !neck && (!it.closed || longLoop)) {
      const raised = rise >= 0.2 * S && b.y0 < bb.y0 + 0.15 * bb.h && rootMid;
      const flung = sticksOut && b.w >= 0.5 * b.h && c[1] < center[1] - 0.05 * H;
      const loop = longLoop && b.y0 < bb.y0 + 0.25 * bb.h;
      const zig = !it.closed && reversals(s.pts) >= 3 && rootMid;
      if (raised || loop || zig || (flung && rootMid)) { wings.push(part('wing', s.pts, root, side)); return; }
      // Out from one end of the body: a wing if there's one on the other end
      // too (front view), else an upturned tail. Settled after the loop.
      if (flung && rootEnd) { endWings.push(part('wing', s.pts, root, side)); return; }
    }
    // A big loop drawn inside the upper body: a folded wing.
    if (it.closed && closed && round < 0.7 && Math.max(b.w, b.h) >= 0.4 * S && pointInPoly(c, bodyPoly) && c[1] < center[1] + 0.1 * bb.h) {
      wings.push(part('wing', s.pts, root, side));
      return;
    }
    // Tails and fins: sideways at body height.
    if (sticksOut && c[1] > bb.y0 - 0.1 * bb.h && c[1] < bb.y1 + 0.1 * bb.h && len >= 0.12 * M
      && (it.closed ? round < 0.8 : b.h >= 0.3 * b.w)) {
      tails.push(part('tail', s.pts, root, side));
      return;
    }
    // Anything else touching the body flaps along as a loose appendage.
    if (nearBody(root) < 0.06 * M && !bodyLine) { tails.push(part('tail', s.pts, root, side)); return; }
    decor.push(part(bodyLine ? 'body' : 'decor'));
  });

  if (endWings.some((w) => w.side < 0) && endWings.some((w) => w.side > 0)) wings.push(...endWings);
  else for (const w of endWings) tails.push({ ...w, kind: 'tail' });
  legs.sort((a, b) => a.pivot[0] - b.pivot[0]).forEach((l, i) => { l.order = i; });

  const crossings = countCrossings(items.map((i) => i.s.pts));
  const ink = items.reduce((a, i) => a + i.len, 0);
  const density = ink / Math.sqrt(W * H);
  const aspect = W / H;
  const roundness = closed ? roundOf(bodyPoly, polyLen([...bodyPoly, bodyPoly[0]])) : 0;
  const legLen = legs.length ? legs.reduce((a, l) => a + bbox(l.pts).h, 0) / legs.length / H : 0;

  const L = legs.length, Wn = wings.length;
  let kind: Kind;
  if (crossings >= 18 && density >= 7) kind = 'scribble';
  else if (Wn >= 1 && L <= 4) kind = 'flyer'; // a bird seen side-on shows one wing and two legs
  else if (L >= 5) kind = 'centipede';
  else if (L >= 3) kind = 'quadruped';
  else if (L === 2) kind = 'biped';
  else if (L === 1) kind = 'hopper';
  else if (closed && roundness >= 0.72 && bb.w >= 0.6 * W && bb.h >= 0.6 * H && bb.w < 1.22 * bb.h && bb.h < 1.22 * bb.w) kind = 'roller';
  else if (aspect >= 1.9) kind = 'worm';
  else kind = 'jelly';

  return {
    kind,
    parts: [...tails, ...wings, ...legs, body, ...decor, ...dots],
    body,
    eyes,
    box,
    center,
    closed,
    legs: L,
    wings: Wn,
    tails: tails.length,
    roundness,
    aspect,
    crossings,
    legLen,
    ink,
  };
}

// Indices of a stroke's "feet": points lower than their neighbours, in the
// bottom 30% of the drawing, below the body, and standing out by `prominence`.
function footPeaks(pts: Pt[], box: ReturnType<typeof bbox>, belowY: number, prominence: number): number[] {
  const floor = box.y0 + 0.7 * box.h;
  const cand: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const y = pts[i][1];
    if (y < floor || y < belowY) continue;
    let peak = true;
    for (let j = Math.max(0, i - 3); j <= Math.min(pts.length - 1, i + 3); j++) if (pts[j][1] > y) peak = false;
    if (peak && (!cand.length || i - cand[cand.length - 1] >= 3)) cand.push(i);
  }
  // Keep peaks that rise clear of the higher of their two valleys; merge near neighbours.
  const out: number[] = [];
  cand.forEach((i, k) => {
    const a = k ? cand[k - 1] : 0, b = k < cand.length - 1 ? cand[k + 1] : pts.length - 1;
    const left = i > a ? Math.min(...pts.slice(a, i).map((p) => p[1])) : Infinity;
    const right = b > i ? Math.min(...pts.slice(i + 1, b + 1).map((p) => p[1])) : Infinity;
    const valley = Math.max(left === Infinity ? -Infinity : left, right === Infinity ? -Infinity : right);
    const rise = pts[i][1] - (valley === -Infinity ? pts[i][1] : valley);
    if (rise < prominence) return;
    if (out.length && dist(pts[out[out.length - 1]], pts[i]) < 12) return;
    out.push(i);
  });
  return out;
}

// How many times a stroke doubles back on itself, after smoothing out hand jitter.
function reversals(pts: Pt[]): number {
  const p = rdp(pts, 4);
  let n = 0;
  for (let i = 2; i < p.length; i++) {
    const ax = p[i - 1][0] - p[i - 2][0], ay = p[i - 1][1] - p[i - 2][1];
    const bx = p[i][0] - p[i - 1][0], by = p[i][1] - p[i - 1][1];
    const la = Math.sqrt(ax * ax + ay * ay), lb = Math.sqrt(bx * bx + by * by);
    if (la > 6 && lb > 6 && (ax * bx + ay * by) / (la * lb) < -0.2) n++;
  }
  return n;
}

// Cuts a multi-foot stroke at the highest point between each pair of feet.
function splitAtValleys(pts: Pt[], feet: number[]): Pt[][] {
  const cuts: number[] = [];
  for (let k = 1; k < feet.length; k++) {
    let top = feet[k - 1];
    for (let i = feet[k - 1]; i <= feet[k]; i++) if (pts[i][1] < pts[top][1]) top = i;
    cuts.push(top);
  }
  const segs: Pt[][] = [];
  let start = 0;
  for (const c of cuts) { segs.push(pts.slice(start, c + 1)); start = c; }
  segs.push(pts.slice(start));
  return segs.filter((s) => s.length >= 2);
}

function countCrossings(strokes: Pt[][]): number {
  const segs: [Pt, Pt][] = [];
  for (const s of strokes) {
    const p = rdp(s, 4);
    for (let i = 1; i < p.length && segs.length < 700; i++) segs.push([p[i - 1], p[i]]);
  }
  let n = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 2; j < segs.length; j++) {
      if (crosses(segs[i][0], segs[i][1], segs[j][0], segs[j][1]) && ++n >= 400) return n;
    }
  }
  return n;
}

function crosses(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
