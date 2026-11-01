import type { Kind, Stroke } from './analyze';
import { dcos, dsin } from './dmath';
import type { Pt } from './geom';
import { type Rng, mulberry32, pick, range } from './rng';

// The house creatures: ten curated families, each drawn by code with a
// hand's wobble and varied by a seed (proportions, pose, ink, which details
// it bothers with). `skill` (0..1) is how careful the drawing is: a sloppy
// one wobbles more, has uneven legs and skips the face or the extras. They
// are read by analyze() and scored like any player's drawing, so their speed
// comes from the same rules. Arithmetic only (dsin/dcos, no Math.sin), so
// every device draws the same house creatures from the same seed.
// Pad pixels, 600 × 600, y down, facing right (the way the race runs).

export type Family = 'horse' | 'dog' | 'cat' | 'human' | 'robot' | 'bird' | 'bat' | 'snake' | 'blob' | 'crawler';
// Creatures only. Vehicles (cars, wheels, jets, rockets…) belong to a later mode of their own.
export const FAMILIES: Family[] = ['horse', 'dog', 'cat', 'human', 'robot', 'bird', 'bat', 'snake', 'blob', 'crawler'];
export const FAMILY_KIND: Record<Family, Kind> = {
  horse: 'quadruped', dog: 'quadruped', cat: 'quadruped', human: 'biped', robot: 'biped', bird: 'flyer', bat: 'flyer',
  snake: 'worm', blob: 'jelly', crawler: 'centipede',
};
export const FAMILY_NAMES: Record<Family, string> = {
  horse: 'Horse', dog: 'Dog', cat: 'Cat', human: 'Human', robot: 'Robot', bird: 'Bird', bat: 'Bat',
  snake: 'Snake', blob: 'Blob', crawler: 'Many-legged',
};

const INK = ['#15171c', '#2a4fd6', '#c93a2e', '#5d636c'];
const THIN = 6, THICK = 11;
const TAU = 6.283185307179586;

class Pen {
  out: Stroke[] = [];
  constructor(private rng: Rng, public ink: string, public w: number, public shake: number) {}
  private j = () => range(this.rng, -this.shake, this.shake);
  // A closed loop: an ellipse (or a squarish one), lumpy and turned by rot.
  loop(cx: number, cy: number, rx: number, ry: number, o: { lumpy?: number; rot?: number; square?: boolean; w?: number; ink?: string; n?: number } = {}) {
    const n = o.n ?? 28, lumpy = o.lumpy ?? 0.04, cr = dcos(o.rot ?? 0), sr = dsin(o.rot ?? 0);
    const raw = Array.from({ length: n }, () => range(this.rng, 1 - lumpy, 1 + lumpy));
    const k = raw.map((_, i) => (raw[(i + n - 1) % n] + 2 * raw[i] + raw[(i + 1) % n]) / 4);
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      let c = dcos((TAU * i) / n), s = dsin((TAU * i) / n);
      if (o.square) { c = Math.sign(c) * Math.sqrt(Math.abs(c)); s = Math.sign(s) * Math.sqrt(Math.abs(s)); }
      const x = c * rx * k[i % n], y = s * ry * k[i % n];
      pts.push([cx + cr * x - sr * y + this.j() * 0.5, cy + sr * x + cr * y + this.j() * 0.5]);
    }
    pts[n] = [pts[0][0], pts[0][1]];
    this.add(pts, o.w, o.ink);
    return pts;
  }
  // An open line through control points, with a little wobble along it.
  path(ctrl: Pt[], o: { n?: number; w?: number; ink?: string; close?: boolean } = {}) {
    const n = o.n ?? 5;
    const pts: Pt[] = [];
    for (let i = 1; i < ctrl.length; i++) {
      const [a, b] = [ctrl[i - 1], ctrl[i]];
      for (let k = i === 1 ? 0 : 1; k <= n; k++) {
        const f = k / n;
        pts.push([a[0] + (b[0] - a[0]) * f + this.j(), a[1] + (b[1] - a[1]) * f + this.j()]);
      }
    }
    if (o.close) pts.push([pts[0][0], pts[0][1]]);
    this.add(pts, o.w, o.ink);
    return pts;
  }
  // A smooth curve from a to b, pulled toward c.
  curve(a: Pt, c: Pt, b: Pt, o: { n?: number; w?: number; ink?: string } = {}) {
    const n = o.n ?? 10;
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0] + this.j(), u * u * a[1] + 2 * u * t * c[1] + t * t * b[1] + this.j()]);
    }
    this.add(pts, o.w, o.ink);
    return pts;
  }
  dot(x: number, y: number, ink?: string) { this.out.push({ pts: [[x, y], [x + 1, y + 1]], color: ink ?? this.ink, w: THIN }); }
  private add(pts: Pt[], w?: number, ink?: string) { this.out.push({ pts, color: ink ?? this.ink, w: w ?? this.w }); }
}

type Draw = (p: Pen, r: Rng, s: number, has: (p: number) => boolean) => void;

// A leg from the hip down to the floor, with a knee.
const leg = (p: Pen, x: number, y: number, len: number, splay: number, knee = 0.12) =>
  p.path([[x, y], [x + splay * 0.4 + len * knee, y + len * 0.5], [x + splay, y + len]], { n: 4, w: THIN });

const DRAW: Record<Family, Draw> = {
  horse(p, r, s, has) {
    const cx = 270, cy = range(r, 250, 270), rx = range(r, 92, 108), ry = range(r, 38, 46);
    p.loop(cx, cy, rx, ry, { lumpy: 0.05 });
    const L = range(r, 112, 132), v = 0.16 * (1 - s);
    for (const f of [-0.62, -0.42, 0.42, 0.62]) leg(p, cx + rx * f, cy + ry * 0.8, L * (1 + range(r, -v, v)), range(r, -10, 10), 0.08);
    const hx = cx + rx + range(r, 18, 30), hy = cy - ry - range(r, 58, 74);
    p.path([[cx + rx * 0.55, cy - ry * 0.8], [hx - 24, hy + 6]], { n: 6 });
    p.path([[cx + rx * 0.88, cy - ry * 0.25], [hx - 4, hy + 16]], { n: 6 });
    p.loop(hx, hy, 40, 22, { rot: 0.45, lumpy: 0.03 });
    if (has(0.75)) p.dot(hx - 2, hy - 5);
    if (has(0.5)) p.path([[hx + 16, hy + 12], [hx + 24, hy + 8]], { n: 2 });
    if (has(0.7)) p.path([[hx - 16, hy - 10], [hx - 12, hy - 30], [hx - 5, hy - 13]], { n: 3 });
    if (has(0.45)) for (let i = 0; i < 3; i++) { const t = 0.2 + 0.25 * i; p.path([[cx + rx * 0.55 + (hx - 24 - cx - rx * 0.55) * t, cy - ry * 0.8 + (hy + 6 - cy + ry * 0.8) * t], [cx + rx * 0.55 + (hx - 24 - cx - rx * 0.55) * t - 12, cy - ry * 0.8 + (hy + 6 - cy + ry * 0.8) * t - 8]], { n: 2 }); }
    if (has(0.85)) p.curve([cx - rx * 0.95, cy - ry * 0.45], [cx - rx - 40, cy - ry * 0.3], [cx - rx - 34, cy + ry * 0.55]);
  },
  dog(p, r, s, has) {
    const cx = 275, cy = range(r, 270, 290), rx = range(r, 78, 92), ry = range(r, 36, 44);
    p.loop(cx, cy, rx, ry, { lumpy: 0.05 });
    const L = range(r, 70, 92), v = 0.18 * (1 - s);
    for (const f of [-0.6, -0.38, 0.4, 0.62]) leg(p, cx + rx * f, cy + ry * 0.8, L * (1 + range(r, -v, v)), range(r, -8, 8), 0.06);
    const hr = range(r, 28, 34), hx = cx + rx + hr * 0.45, hy = cy - ry - hr * 0.35;
    p.loop(hx, hy, hr, hr * 0.9, { lumpy: 0.04 });
    if (has(0.8)) { p.dot(hx + hr * 0.25, hy - hr * 0.25); if (has(0.6)) p.dot(hx - hr * 0.1, hy - hr * 0.3); }
    if (has(0.6)) p.dot(hx + hr * 0.8, hy + hr * 0.05);
    if (has(0.5)) p.curve([hx + hr * 0.15, hy + hr * 0.35], [hx + hr * 0.4, hy + hr * 0.55], [hx + hr * 0.65, hy + hr * 0.3], { n: 4 });
    if (has(0.6)) { const e = pick(r, [0, 1]); if (e) p.path([[hx - hr * 0.6, hy - hr * 0.6], [hx - hr * 0.55, hy - hr * 1.35], [hx - hr * 0.15, hy - hr * 0.85]], { n: 3 }); else p.path([[hx - hr * 0.3, hy - hr * 0.85], [hx - hr * 0.25, hy - hr * 1.5], [hx + hr * 0.05, hy - hr * 0.9]], { n: 3 }); }
    if (has(0.85)) p.curve([cx - rx * 0.92, cy - ry * 0.4], [cx - rx - 30, cy - ry * 0.6], [cx - rx - 26, cy - ry - 30]);
    if (has(0.35)) for (let i = 0; i < 2; i++) p.loop(cx + range(r, -0.4, 0.2) * rx, cy + range(r, -0.2, 0.35) * ry, range(r, 9, 14), range(r, 7, 11), { w: THIN });
  },
  cat(p, r, s, has) {
    const cx = 280, cy = range(r, 285, 300), rx = range(r, 66, 78), ry = range(r, 32, 38);
    p.loop(cx, cy, rx, ry, { lumpy: 0.04 });
    const L = range(r, 62, 80), v = 0.18 * (1 - s);
    for (const f of [-0.58, -0.36, 0.38, 0.6]) leg(p, cx + rx * f, cy + ry * 0.8, L * (1 + range(r, -v, v)), range(r, -6, 6), 0.04);
    const hr = range(r, 26, 31), hx = cx + rx + hr * 0.4, hy = cy - ry - hr * 0.4;
    p.loop(hx, hy, hr, hr * 0.92, { lumpy: 0.03 });
    if (has(0.75)) { p.path([[hx - hr * 0.7, hy - hr * 0.55], [hx - hr * 0.55, hy - hr * 1.45], [hx - hr * 0.15, hy - hr * 0.85]], { n: 3 }); p.path([[hx + hr * 0.1, hy - hr * 0.9], [hx + hr * 0.45, hy - hr * 1.5], [hx + hr * 0.65, hy - hr * 0.6]], { n: 3 }); }
    if (has(0.8)) { p.dot(hx + hr * 0.3, hy - hr * 0.2); p.dot(hx - hr * 0.1, hy - hr * 0.2); }
    if (has(0.55)) p.path([[hx + hr * 0.05, hy + hr * 0.35], [hx + hr * 0.2, hy + hr * 0.5], [hx + hr * 0.35, hy + hr * 0.35]], { n: 2 });
    if (has(0.45)) for (const dy of [0.1, 0.3]) p.path([[hx + hr * 0.75, hy + hr * dy], [hx + hr * 1.35, hy + hr * (dy - 0.1)]], { n: 2 });
    if (has(0.85)) p.curve([cx - rx * 0.92, cy - ry * 0.1], [cx - rx - 55, cy - ry * 0.2], [cx - rx - 30, cy - ry - 55], { n: 12 });
    if (has(0.3)) for (let i = 0; i < 3; i++) p.path([[cx - rx * 0.3 + i * 18, cy - ry * 0.75], [cx - rx * 0.3 + i * 18 + 4, cy - ry * 0.3]], { n: 2 });
  },
  human(p, r, s, has) {
    const cx = 300, cy = range(r, 250, 265), rx = range(r, 30, 36), ry = range(r, 50, 58);
    p.loop(cx, cy, rx, ry, { lumpy: 0.04 });
    const hr = range(r, 25, 30), hx = cx + range(r, 2, 8), hy = cy - ry - hr - range(r, 3, 8);
    p.loop(hx, hy, hr, hr, { lumpy: 0.03 });
    const L = range(r, 108, 126), v = 0.14 * (1 - s);
    leg(p, cx - rx * 0.35, cy + ry * 0.92, L * (1 + range(r, -v, v)), range(r, -22, -10), 0.05);
    leg(p, cx + rx * 0.35, cy + ry * 0.92, L * (1 + range(r, -v, v)), range(r, 10, 22), 0.05);
    if (has(0.75)) { p.path([[cx - rx * 0.9, cy - ry * 0.45], [cx - rx - 18, cy], [cx - rx - 24, cy + ry * 0.35]], { n: 3 }); p.path([[cx + rx * 0.9, cy - ry * 0.45], [cx + rx + 18, cy], [cx + rx + 26, cy + ry * 0.3]], { n: 3 }); }
    if (has(0.85)) { p.dot(hx + hr * 0.15, hy - hr * 0.2); p.dot(hx + hr * 0.55, hy - hr * 0.2); }
    if (has(0.65)) p.curve([hx, hy + hr * 0.35], [hx + hr * 0.35, hy + hr * 0.6], [hx + hr * 0.65, hy + hr * 0.3], { n: 5 });
    if (has(0.6)) for (let i = 0; i < 4; i++) p.path([[hx - hr * 0.6 + i * hr * 0.35, hy - hr * 0.92], [hx - hr * 0.7 + i * hr * 0.35, hy - hr * 1.3]], { n: 2 });
    if (has(0.4)) for (let i = 0; i < 3; i++) p.dot(cx + 2, cy - ry * 0.35 + i * ry * 0.3);
  },
  robot(p, r, s, has) {
    const cx = 300, cy = range(r, 255, 270), rx = range(r, 40, 48), ry = range(r, 46, 54);
    p.loop(cx, cy, rx, ry, { square: true, lumpy: 0.02, n: 32 });
    const hr = range(r, 25, 30), hx = cx + range(r, 0, 6), hy = cy - ry - hr - range(r, 8, 12);
    p.loop(hx, hy, hr * 1.1, hr, { square: true, lumpy: 0.02, n: 32 });
    p.path([[hx, hy + hr], [cx, cy - ry]], { n: 2 });
    const L = range(r, 100, 118), v = 0.12 * (1 - s);
    leg(p, cx - rx * 0.45, cy + ry * 0.95, L * (1 + range(r, -v, v)), -6, 0);
    leg(p, cx + rx * 0.45, cy + ry * 0.95, L * (1 + range(r, -v, v)), 6, 0);
    if (has(0.85)) { p.loop(hx + hr * 0.05, hy - hr * 0.2, 5, 5, { n: 8, square: true }); p.loop(hx + hr * 0.6, hy - hr * 0.2, 5, 5, { n: 8, square: true }); }
    if (has(0.6)) p.path([[hx - hr * 0.1, hy + hr * 0.45], [hx + hr * 0.7, hy + hr * 0.45]], { n: 3 });
    if (has(0.7)) { p.path([[hx, hy - hr], [hx + range(r, -6, 6), hy - hr - 30]], { n: 3 }); p.loop(hx, hy - hr - 36, 6, 6, { n: 10 }); }
    if (has(0.7)) { p.path([[cx - rx, cy - ry * 0.5], [cx - rx - 22, cy + ry * 0.1], [cx - rx - 14, cy + ry * 0.35]], { n: 3 }); p.path([[cx + rx, cy - ry * 0.5], [cx + rx + 22, cy + ry * 0.1], [cx + rx + 30, cy + ry * 0.3]], { n: 3 }); }
    if (has(0.45)) { p.loop(cx, cy + ry * 0.05, rx * 0.45, ry * 0.3, { square: true, n: 20, w: THIN }); p.dot(cx - rx * 0.15, cy + ry * 0.05); p.dot(cx + rx * 0.15, cy + ry * 0.05); }
  },
  bird(p, r, s, has) {
    const cx = 285, cy = range(r, 285, 300), rx = range(r, 50, 60), ry = range(r, 32, 40);
    p.loop(cx, cy, rx, ry, { lumpy: 0.04, rot: -0.12 });
    const hr = range(r, 20, 25), hx = cx + rx * 0.82, hy = cy - ry * 0.85;
    p.loop(hx, hy, hr, hr * 0.95);
    const span = range(r, 120, 160) * (0.8 + 0.2 * s);
    p.curve([cx - rx * 0.05, cy - ry * 0.75], [cx - rx * 0.1, cy - ry - span * 0.75], [cx - rx * 0.75, cy - ry - span * 0.8], { n: 12 });
    if (has(0.85)) p.curve([cx + rx * 0.2, cy - ry * 0.8], [cx + rx * 0.25, cy - ry - span * 0.6], [cx - rx * 0.3, cy - ry - span * 0.7], { n: 12 });
    if (has(0.8)) p.dot(hx + hr * 0.3, hy - hr * 0.25);
    if (has(0.7)) p.path([[hx + hr * 0.9, hy - hr * 0.2], [hx + hr * 1.6, hy + hr * 0.1], [hx + hr * 0.9, hy + hr * 0.3]], { n: 2 });
    if (has(0.75)) for (const d of [-14, 0, 14]) p.path([[cx - rx * 0.92, cy + d * 0.3], [cx - rx - 38, cy + d - 10]], { n: 3 });
    if (has(0.7)) { p.path([[cx - 10, cy + ry * 0.9], [cx - 14, cy + ry + 40]], { n: 3 }); p.path([[cx + 12, cy + ry * 0.9], [cx + 10, cy + ry + 40]], { n: 3 }); }
  },
  bat(p, r, s, has) {
    const cx = 300, cy = range(r, 290, 305), rx = range(r, 30, 36), ry = range(r, 36, 42);
    p.loop(cx, cy, rx, ry, { lumpy: 0.04 });
    const span = range(r, 62, 86) * (0.8 + 0.2 * s), lift = range(r, 45, 65);
    for (const side of [-1, 1]) {
      const x0 = cx + side * rx * 0.85, tip: Pt = [cx + side * (rx + span), cy - ry - lift];
      const pts: Pt[] = [[x0, cy - ry * 0.4], [cx + side * (rx + span * 0.5), cy - ry - lift * 0.9], tip];
      const sc = has(0.7) ? 3 : 2;
      for (let i = 1; i <= sc; i++) {
        const f = i / sc, bx = tip[0] + (x0 - tip[0]) * f, by = tip[1] + (cy - ry * 0.1 - tip[1]) * f;
        pts.push([bx - side * span * 0.06, by - 22], [bx, by]);
      }
      p.path(pts, { n: 3 });
    }
    if (has(0.75)) { p.path([[cx - rx * 0.6, cy - ry * 0.8], [cx - rx * 0.5, cy - ry - 14], [cx - rx * 0.15, cy - ry * 0.92]], { n: 3 }); p.path([[cx + rx * 0.15, cy - ry * 0.92], [cx + rx * 0.5, cy - ry - 14], [cx + rx * 0.6, cy - ry * 0.8]], { n: 3 }); }
    if (has(0.5)) for (const d of [-0.35, 0.35]) p.path([[cx + rx * d, cy + ry * 0.92], [cx + rx * d, cy + ry + 14], [cx + rx * d + 6, cy + ry + 10]], { n: 2 });
    if (has(0.85)) { p.dot(cx + rx * 0.1, cy - ry * 0.35); p.dot(cx + rx * 0.55, cy - ry * 0.35); }
    if (has(0.6)) p.path([[cx + rx * 0.1, cy], [cx + rx * 0.2, cy + 10], [cx + rx * 0.3, cy], [cx + rx * 0.4, cy + 10], [cx + rx * 0.5, cy]], { n: 1 });
  },
  snake(p, r, s, has) {
    const x0 = range(r, 105, 125), x1 = range(r, 440, 465), cy = range(r, 290, 310), amp = range(r, 10, 22), ph = range(r, 0, TAU), waves = range(r, 1.2, 2);
    const n = 24, top: Pt[] = [], bot: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t, y = cy + amp * dsin(ph + TAU * waves * t), th = 4 + 15 * t;
      top.push([x, y - th]); bot.push([x, y + th]);
    }
    p.path([...top, ...bot.reverse(), top[0]], { n: 1 });
    const hx = x1 + 6, hy = cy + amp * dsin(ph + TAU * waves) - 2;
    if (has(0.7)) {
      p.loop(hx, hy, 26, 21);
      if (has(0.85)) p.dot(hx + 8, hy - 8);
      if (has(0.6)) { p.path([[hx + 26, hy + 4], [hx + 44, hy + 4], [hx + 52, hy - 2]], { n: 2 }); p.path([[hx + 44, hy + 4], [hx + 52, hy + 10]], { n: 1 }); }
    } else if (has(0.8)) p.dot(x1 - 8, hy - 6);
    if (has(0.45)) for (let i = 2; i < n - 2; i += 3) { const [tx, ty] = top[i], [, by] = bot[n - i]; p.path([[tx - 5, (ty * 2 + by) / 3], [tx + 4, (ty + by) / 2], [tx - 5, (ty + by * 2) / 3]], { n: 1 }); }
  },
  blob(p, r, s, has) {
    const cx = 295, cy = range(r, 275, 295), rx = range(r, 88, 100), ry = range(r, 52, 62);
    p.loop(cx, cy, rx, ry, { lumpy: 0.1 + 0.06 * (1 - s), n: 24 });
    if (has(0.85)) for (const ex of [0.05, 0.45]) { p.loop(cx + rx * ex, cy - ry * 0.3, 13, 15, { n: 12, w: THIN }); p.dot(cx + rx * ex + 4, cy - ry * 0.28); }
    if (has(0.65)) p.curve([cx, cy + ry * 0.15], [cx + rx * 0.25, cy + ry * 0.45], [cx + rx * 0.55, cy + ry * 0.15], { n: 6 });
    if (has(0.65)) for (const ax of [-0.3, 0.2]) p.curve([cx + rx * ax, cy - ry * 0.95], [cx + rx * ax + 4, cy - ry - 26], [cx + rx * ax + 16, cy - ry - 30], { n: 6 });
    if (has(0.45)) for (let i = 0; i < 3; i++) p.loop(cx - rx * 0.5 + i * 18, cy + ry * 0.25 - (i % 2) * 16, 6, 5, { n: 8, w: THIN });
  },
  crawler(p, r, s, has) {
    const cx = 280, cy = range(r, 285, 300), rx = range(r, 120, 138), ry = range(r, 26, 32);
    p.loop(cx, cy, rx, ry, { lumpy: 0.04 });
    const n = pick(r, [6, 7, 8, 9, 10]), L = range(r, 34, 48), v = 0.2 * (1 - s);
    for (let i = 0; i < n; i++) leg(p, cx - rx * 0.78 + (1.56 * rx * i) / (n - 1), cy + ry * 0.85, L * (1 + range(r, -v, v)), range(r, -4, 10), 0.1);
    const hr = range(r, 22, 27), hx = cx + rx + hr * 0.55, hy = cy - ry * 0.3;
    if (has(0.75)) {
      p.loop(hx, hy, hr, hr * 0.9);
      if (has(0.8)) p.dot(hx + hr * 0.35, hy - hr * 0.3);
      if (has(0.5)) p.path([[hx + hr * 0.5, hy + hr * 0.3], [hx + hr * 0.85, hy + hr * 0.4]], { n: 2 });
      if (has(0.7)) for (const d of [-8, 8]) p.curve([hx + d * 0.4, hy - hr * 0.85], [hx + d - 4, hy - hr - 24], [hx + d * 2 + 14, hy - hr - 30], { n: 6 });
    } else if (has(0.8)) p.dot(cx + rx * 0.8, cy - ry * 0.3);
    if (has(0.5)) for (let i = 1; i < 6; i++) { const x = cx - rx + (2 * rx * i) / 6; p.path([[x, cy - ry * 0.45], [x + 2, cy + ry * 0.45]], { n: 2 }); }
  },
};

export interface Template { family: Family; skill: number; strokes: Stroke[] }

// One house creature: a family, a seed and a skill level.
export function template(rng: Rng, family: Family, skill: number): Template {
  const s = Math.max(0, Math.min(1, skill));
  const ink = pick(rng, INK);
  const pen = new Pen(rng, ink, rng() < 0.25 ? THICK : THIN, 1 + 2.4 * (1 - s));
  // Careful drawers include more of the extras; each detail has its own odds.
  const has = (p: number) => rng() < p * (0.35 + 0.65 * s) + 0.15 * s;
  DRAW[family](pen, rng, s, has);
  for (const st of pen.out) for (const q of st.pts) { q[0] = Math.max(0, Math.min(599, q[0])); q[1] = Math.max(0, Math.min(599, q[1])); }
  return { family, skill: s, strokes: pen.out };
}

// Four house creatures for a game: different families, one at each skill
// level. The levels are set against ordinary first drawings (test/beginners.ts)
// so a typical beginner finishes mid-pack and a careful drawing can win.
export const HOUSE_SKILLS = [0, 0.12, 0.25, 0.4];
export function lineup(seed: number): Template[] {
  const rng = mulberry32(seed);
  const fams = FAMILIES.slice();
  for (let i = fams.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [fams[i], fams[j]] = [fams[j], fams[i]]; }
  const skills = HOUSE_SKILLS.slice();
  for (let i = skills.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [skills[i], skills[j]] = [skills[j], skills[i]]; }
  return skills.map((s, i) => template(mulberry32((seed ^ (0x9e3779b9 * (i + 1))) >>> 0), fams[i], s));
}
