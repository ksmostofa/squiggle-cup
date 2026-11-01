import { type Pt, area, bbox, centroid, dist, distToPolyline, pointInPoly, polyLen, rdp } from './geom';

export interface Stroke { pts: Pt[]; color: string; w: number }
export interface Drawing { strokes: Stroke[]; name: string }

export interface Limb { pts: Pt[]; color: string; w: number }
export interface Anatomy {
  body: { pts: Pt[]; closed: boolean; color: string; w: number };
  limbs: Limb[];          // pts[0] is the joint where the limb meets the body
  eyes: { c: Pt; r: number }[];
  decor: Stroke[];
  center: Pt;             // body centroid, pad pixels
}

// Pad is 600x600 pixels. These thresholds are in pad pixels.
const ATTACH = 20;
const MIN_LIMB = 28;
const EYE_MAX = 54;

function isClosed(p: Pt[], len: number) {
  return p.length >= 4 && len > 60 && dist(p[0], p[p.length - 1]) <= Math.max(26, len * 0.18);
}

export function analyze(strokes: Stroke[]): Anatomy | null {
  const items = strokes
    .filter((s) => s.pts.length >= 2 || (s.pts.length === 1))
    .map((s) => {
      const len = polyLen(s.pts);
      return { s, len, closed: isClosed(s.pts, len), bb: bbox(s.pts) };
    });
  if (!items.length) return null;

  // Body: the biggest closed shape that isn't eye-sized, else the longest line.
  let bi = -1, best = 0;
  items.forEach((it, i) => {
    if (!it.closed || Math.max(it.bb.w, it.bb.h) < EYE_MAX) return;
    const a = area(it.s.pts);
    if (a > best) { best = a; bi = i; }
  });
  if (bi < 0) {
    items.forEach((it, i) => { if (it.len > best) { best = it.len; bi = i; } });
  }
  if (bi < 0 || items[bi].len < 20) return null;

  const bodyIt = items[bi];
  const bodyPoly = rdp(bodyIt.s.pts, 1.5);
  const closed = bodyIt.closed;
  const nearBody = (p: Pt) => (closed && pointInPoly(p, bodyPoly) ? 0 : distToPolyline(p, bodyPoly, closed));
  const inside = (p: Pt) => closed && pointInPoly(p, bodyPoly);

  const limbs: Limb[] = [];
  const eyes: Anatomy['eyes'] = [];
  const decor: Stroke[] = [];

  items.forEach((it, i) => {
    if (i === bi) return;
    const { s, len, bb } = it;
    const c: Pt = [bb.x0 + bb.w / 2, bb.y0 + bb.h / 2];
    const small = Math.max(bb.w, bb.h) < EYE_MAX;

    // Dots and little loops inside the body become googly eyes.
    if (small && (len < 16 || it.closed) && inside(c)) {
      eyes.push({ c, r: Math.max(9, Math.max(bb.w, bb.h) / 2 + 4) });
      return;
    }

    const d0 = nearBody(s.pts[0]);
    const d1 = nearBody(s.pts[s.pts.length - 1]);
    const reach = Math.max(...s.pts.map(nearBody));
    if (Math.min(d0, d1) <= ATTACH && len >= MIN_LIMB && reach >= 18) {
      const pts = d0 <= d1 ? s.pts.slice() : s.pts.slice().reverse();
      limbs.push({ pts, color: s.color, w: s.w });
      return;
    }
    decor.push(s);
  });

  return {
    body: { pts: bodyIt.s.pts, closed, color: bodyIt.s.color, w: bodyIt.s.w },
    limbs,
    eyes,
    decor,
    center: closed ? centroid(bodyPoly) : [bodyIt.bb.x0 + bodyIt.bb.w / 2, bodyIt.bb.y0 + bodyIt.bb.h / 2],
  };
}

export function inkUsed(strokes: Stroke[]) {
  return strokes.reduce((a, s) => a + polyLen(s.pts) * (s.w > 10 ? 1.4 : 1), 0);
}
