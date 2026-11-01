import { type Anatomy, type Part, isClosed } from './analyze';
import { type Pt, atan2, bbox, distToPolyline, pointInPoly, polyLen, rdp } from './geom';

// How well a drawing is made, which is how fast it runs. Two halves:
//   form  – movement design: the proportions that really help its kind move
//           (even legs of a good length, big wings, a round wheel)
//   craft – craftsmanship: a coherent creature (everything joined up, not a
//           tangle), with expression (a face looking the way it runs) and
//           meaningful detail. Detail counts kinds of feature (a head, a
//           tail, ears, markings), never strokes, and each new one adds less,
//           so piling on ink earns nothing and a bare shape can't win.
// Speed rises with the total but flattens toward the top: every kind can
// approach the same best time, and the last few points are the hardest.
// Pure arithmetic (+ − × ÷ and sqrt), so every device and the leaderboard
// server compute exactly the same number.

export type Feature = 'legs' | 'wings' | 'wheels' | 'head' | 'neck' | 'tail' | 'crest' | 'feet' | 'pupils' | 'markings';
export const FEATURES: Record<Feature, string> = {
  legs: 'legs', wings: 'wings', wheels: 'wheels', head: 'a head', neck: 'a neck', tail: 'a tail', crest: 'ears, horns or hair',
  feet: 'feet at the ends of its legs', pupils: 'pupils in its eyes', markings: 'markings',
};

export interface Score {
  form: number;      // 0..1
  craft: number;     // 0..1
  total: number;     // 0..1
  features: Feature[];
  face: { eyes: boolean; forward: boolean; mouth: boolean };
  cohesion: number;  // 0..1: joined up, untangled, not overworked
  line: number;      // 0..1: steady strokes, cleanly closed loops
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
// 1 at the ideal, falling to 0 at ±width.
const near = (v: number, ideal: number, width: number) => clamp(1 - Math.abs(v - ideal) / width, 0, 1);

export const FORM_WEIGHT = 0.3;
// Speed multiplier for a total score: 0.8 at nothing, 1 at perfect, with
// returns falling off near the top ((1 − s)^1.5 left to gain).
export const speedFactor = (s: number) => { const g = 1 - clamp(s, 0, 1); return 0.8 + 0.2 * (1 - g * Math.sqrt(g)); };

// Movement design: how well the proportions suit its kind.
export function form(a: Anatomy): number {
  const legs = a.parts.filter((p) => p.kind === 'leg').map((p) => bbox(p.pts).h);
  const meanLeg = legs.length ? legs.reduce((s, h) => s + h, 0) / legs.length : 0;
  const spread = legs.length > 1 ? Math.sqrt(legs.reduce((s, h) => s + (h - meanLeg) * (h - meanLeg), 0) / legs.length) : 0;
  const evenness = clamp(1 - spread / Math.max(1, meanLeg) / 0.25, 0, 1);
  const span = a.parts.filter((p) => p.kind === 'wing').reduce((s, p) => { const b = bbox(p.pts); return s + Math.max(b.w, b.h); }, 0);
  const bodyB = bbox(a.body.pts);
  const bodyS = Math.max(bodyB.w, bodyB.h, 1);
  switch (a.kind) {
    case 'biped': return (0.6 * near(a.legLen, 0.5, 0.22) + 0.4 * evenness) * (a.legs === 2 ? 1 : 0.7);
    case 'quadruped': return (0.5 * near(a.legLen, 0.42, 0.2) + 0.5 * evenness) * (a.legs === 4 ? 1 : 0.7);
    case 'centipede': return 0.4 * clamp((a.legs - 4) / 8, 0, 1) + 0.3 * evenness + 0.3 * near(a.legLen, 0.3, 0.15);
    case 'hopper': return near(a.legLen, 0.5, 0.22);
    case 'flyer': return 0.7 * near(span / bodyS, 2.2, 1.1) + 0.3 * clamp(a.wings / 2, 0, 1);
    case 'roller': return clamp((a.roundness - 0.8) / 0.18, 0, 1);
    case 'wheeled': {
      // Round wheels of a size, set wide apart under the body.
      const ws = a.parts.filter((p) => p.kind === 'wheel');
      const rounds = ws.map((p) => roundOf(p.pts));
      const sizes = ws.map((p) => { const b = bbox(p.pts); return Math.max(b.w, b.h); });
      const ms = sizes.reduce((s, v) => s + v, 0) / sizes.length;
      const even = sizes.length > 1 ? clamp(1 - (Math.max(...sizes) - Math.min(...sizes)) / ms / 0.4, 0, 1) : 0.5;
      const base = ws.length > 1 ? (Math.max(...ws.map((p) => p.pivot[0])) - Math.min(...ws.map((p) => p.pivot[0]))) / Math.max(1, bodyB.w) : 0;
      return 0.35 * clamp((rounds.reduce((s, v) => s + v, 0) / rounds.length - 0.6) / 0.3, 0, 1) + 0.25 * clamp(ws.length / 2, 0, 1)
        + 0.2 * even + 0.2 * near(base, 0.7, 0.5);
    }
    case 'worm': return clamp((a.aspect - 1.9) / 5, 0, 1);
    case 'jelly': return clamp(1 - a.crossings / 6, 0, 1) * (0.5 + 0.5 * a.roundness);
    default: return 0.5;
  }
}

function roundOf(pts: Pt[]): number {
  const len = polyLen([...pts, pts[0]]);
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return len > 0 ? Math.min(1, (4 * Math.PI * Math.abs(s / 2)) / (len * len)) : 0;
}

// Evenly spaced points along a stroke, `step` apart.
function even(pts: Pt[], step: number): Pt[] {
  const out: Pt[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const len = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
    let d = step - carry;
    while (d <= len) { const f = d / len; out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); d += step; }
    carry = len - (d - step);
  }
  return out;
}

// Line steadiness: how erratically each stroke turns, in radians per step.
// A confident line turns smoothly, so its turning changes little from one
// step to the next; a shaky one flips back and forth. The sharpest 15% of
// steps are left out, so deliberate corners (a zigzag, a pointed ear) are
// not counted as shake. Measured at a step well above the stored 3 px grid.
export function wobble(a: Anatomy): number {
  const M = Math.max(a.box.w, a.box.h, 24), step = 0.04 * M;
  const js: number[] = [];
  for (const p of a.parts) {
    if (p.kind === 'eye' || polyLen(p.pts) < 4 * step) continue;
    const q = even(p.pts, step);
    let prevTurn: number | null = null, prevHead: number | null = null;
    for (let i = 1; i < q.length; i++) {
      const h = atan2(q[i][1] - q[i - 1][1], q[i][0] - q[i - 1][0]);
      if (prevHead !== null) {
        let t = h - prevHead;
        while (t > Math.PI) t -= 2 * Math.PI;
        while (t < -Math.PI) t += 2 * Math.PI;
        if (prevTurn !== null) js.push(Math.abs(t - prevTurn));
        prevTurn = t;
      }
      prevHead = h;
    }
  }
  if (!js.length) return 0;
  js.sort((x, y) => x - y);
  const keep = js.slice(0, Math.max(1, Math.floor(js.length * 0.85)));
  return keep.reduce((s, v) => s + v, 0) / keep.length;
}

const d2 = (a: Pt, b: Pt) => (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]);
const center = (p: Part): Pt => { const b = bbox(p.pts); return [b.x0 + b.w / 2, b.y0 + b.h / 2]; };
const inside = (p: Part, poly: Pt[]) => pointInPoly(center(p), poly);

export function score(a: Anatomy): Score {
  const M = Math.max(a.box.w, a.box.h, 24);
  const body = a.body;
  const bodyPoly = rdp(body.pts, 1.5);
  const bb = bbox(body.pts);
  const heads = a.parts.filter((p) => p.kind === 'head');
  const others = a.parts.filter((p) => p !== body);

  // Cohesion: how much of the ink is joined to the body, directly or through
  // another joined part (ears on a head on a neck).
  const simple = new Map(others.map((p) => [p, rdp(p.pts, 2)]));
  const inBody = (q: Pt) => a.closed && pointInPoly(q, bodyPoly);
  const gap = (p: Part, poly: Pt[], closed: boolean) => Math.min(...simple.get(p)!.map((q) => (closed && pointInPoly(q, poly) ? 0 : distToPolyline(q, poly, closed))));
  const joined = new Set<Part>(others.filter((p) => simple.get(p)!.some(inBody) || gap(p, bodyPoly, a.closed) <= 0.07 * M));
  for (let grew = true; grew;) {
    grew = false;
    for (const p of others) {
      if (joined.has(p)) continue;
      if ([...joined].some((q) => (q.kind === 'head' && inside(p, q.pts)) || gap(p, simple.get(q)!, q.kind === 'head') <= 0.05 * M)) { joined.add(p); grew = true; }
    }
  }
  const weight = (p: Part) => Math.max(polyLen(p.pts), p.w);
  const total = others.reduce((s, p) => s + weight(p), 0);
  const ratio = total > 0 ? others.filter((p) => joined.has(p)).reduce((s, p) => s + weight(p), 0) / total : 1;
  const clean = clamp(1 - Math.max(0, a.crossings - 6) / 24, 0, 1);
  const density = a.ink / Math.sqrt(Math.max(24, a.box.w) * Math.max(24, a.box.h));
  const restraint = clamp(1 - Math.max(0, density - 11) / 12, 0, 1);
  const cohesion = ratio * ratio * clean * restraint;

  // Expression: eyes in the face (a head, else the front and top of the
  // body), looking the way it runs, and a mouth.
  const faceOf = (p: Part) => heads.find((h) => inside(p, h.pts)) ?? (inside(p, bodyPoly) || !a.closed ? body : null);
  const inFace = (p: Part) => {
    const f = faceOf(p);
    if (!f) return false;
    if (f !== body) return true;
    const c = center(p);
    return c[0] >= bb.x0 + 0.45 * bb.w && c[1] <= bb.y0 + 0.7 * bb.h;
  };
  const dots = a.parts.filter((p) => p.kind === 'eye' && joined.has(p));
  // With a head, the eyes are the ones in it; spots on the body are markings.
  const inHeads = dots.filter((p) => heads.some((h) => inside(p, h.pts)));
  const eyes = inHeads.length ? inHeads : dots.filter(inFace);
  const marks = a.parts.filter((p) => p.kind === 'decor' && joined.has(p) && (faceOf(p) || polyLen(p.pts) < 0.07 * M));
  const ec: Pt = eyes.length ? [eyes.reduce((s, p) => s + center(p)[0], 0) / eyes.length, eyes.reduce((s, p) => s + center(p)[1], 0) / eyes.length] : [0, 0];
  const mouth = eyes.length > 0 && marks.some((p) => {
    const c = center(p);
    // In the same face, or just in front of the eyes (a beak, a snout).
    return (faceOf(p) === faceOf(eyes[0]) || c[0] > ec[0]) && c[1] >= ec[1] - 0.02 * M && Math.abs(c[0] - ec[0]) + Math.abs(c[1] - ec[1]) <= 0.4 * M;
  });
  const fc = eyes.length ? (() => { const f = faceOf(eyes[0])!; const b = bbox(f.pts); return b.x0 + b.w / 2; })() : 0;
  const face = { eyes: eyes.length > 0, forward: eyes.length > 0 && ec[0] >= fc, mouth };
  const expression = (face.eyes ? 0.4 : 0) + (face.forward ? 0.2 : 0) + (face.mouth ? 0.4 : 0);

  // Detail: which kinds of feature it has, each counted once.
  const top = Math.min(bb.y0, ...heads.map((h) => bbox(h.pts).y0));
  const crest = others.some((p) => joined.has(p) && (p.kind === 'tail' || p.kind === 'decor') && !inside(p, bodyPoly)
    && !heads.some((h) => inside(p, h.pts)) && bbox(p.pts).y1 <= top + 0.12 * M && polyLen(p.pts) <= 0.45 * M);
  // Pupils: an eye drawn as a ring with a dot in it.
  const pupils = eyes.some((e) => isClosed(e.pts, polyLen(e.pts)) || e.pts.length > 6 ? dots.some((d) => d !== e && inside(d, e.pts)) : false);
  const ringed = new Set(eyes.filter((e) => dots.some((d) => d !== e && inside(d, e.pts))));
  // Feet: legs that turn out at the bottom (a hoof, a paw, a shoe).
  const legParts = a.parts.filter((p) => p.kind === 'leg');
  const footed = legParts.filter((p) => {
    const foot = d2(p.pts[0], p.pivot) > d2(p.pts[p.pts.length - 1], p.pivot) ? p.pts.slice(0, Math.ceil(p.pts.length * 0.35)) : p.pts.slice(Math.floor(p.pts.length * 0.65));
    const fb = bbox(foot);
    return fb.w >= 0.035 * M && fb.w >= 0.5 * fb.h;
  });
  // A neck: a line from the body that holds up a head.
  const neck = heads.length > 0 && a.parts.some((p) => p.kind === 'decor' && joined.has(p) && polyLen(p.pts) >= 0.07 * M
    && heads.some((h) => gap(p, simple.get(h)!, true) <= 0.05 * M) && gap(p, bodyPoly, a.closed) <= 0.07 * M);
  const markings = marks.length > (mouth ? 1 : 0) + (neck ? 2 : 0) || dots.length > eyes.length + [...ringed].length;
  const has: [Feature, boolean][] = [
    ['legs', a.legs > 0], ['wings', a.wings > 0], ['wheels', a.wheels > 0], ['head', heads.some((h) => joined.has(h))], ['neck', neck],
    ['tail', a.parts.some((p) => p.kind === 'tail' && joined.has(p) && center(p)[0] < a.center[0])], ['crest', crest],
    ['feet', legParts.length > 0 && footed.length * 2 >= legParts.length], ['pupils', pupils], ['markings', markings],
  ];
  const features = has.filter(([, on]) => on).map(([f]) => f);
  // Eight kinds of feature for full marks, each worth less than the last.
  let missing = 1, full = 1;
  for (let i = 0; i < 8; i++) { if (i < features.length) missing *= 0.82; full *= 0.82; }
  const detail = Math.min(1, (1 - missing) / (1 - full));

  // Line quality: steady strokes (a pen held with confidence), and loops
  // that close where they started.
  const steady = clamp(1 - (wobble(a) - 0.12) / 0.3, 0, 1);
  const loops = a.parts.filter((p) => p.kind !== 'eye' && isClosed(p.pts, polyLen(p.pts)));
  const closure = loops.length ? loops.reduce((s, p) => s + clamp(1 - Math.sqrt(d2(p.pts[0], p.pts[p.pts.length - 1])) / polyLen(p.pts) / 0.08, 0, 1), 0) / loops.length : 1;
  const line = 0.8 * steady + 0.2 * closure;

  // Steady lines make the most of what's drawn; they don't stand in for it.
  const craft = cohesion * (0.6 + 0.4 * line) * (0.3 * expression + 0.7 * detail);
  const f = form(a);
  return { form: f, craft, total: FORM_WEIGHT * f + (1 - FORM_WEIGHT) * craft, features, face, cohesion, line };
}
