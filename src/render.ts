import type { Anatomy, Part } from './analyze';
import type { Body } from './body';
import { ACCENT, FINISH } from './course';
import type { Pt } from './geom';
import { strokePath } from './ink';
import type { Race, RaceEvent } from './race';

// Canvas 2D renderer. The race is an architect's presentation board lying on
// a desk, photographed tilt-shift: a white sheet with a faint drafting grid,
// lanes ruled across it, dimension lines and grid bubbles, seen at a slight
// angle with the focus band on the lanes. Creatures are exactly the drawn
// strokes in pen ink, posed by the physics: legs reach where the simulated
// feet are, wings beat with the flap, snakes carry a travelling wave.
// Render-only: nothing here feeds back into the simulation.

export const PAPER = '#fcfcfa';
export const DESK = '#e6e5e1';
export const LINE = '#b9bec6';
export const FAINT = '#e9ebee';
export const TEXT = '#6a707a';
export const INK = '#15171c';
export const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
export const SANS = '"Archivo", "Helvetica Neue", system-ui, sans-serif';

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const lowEnd = () => reducedMotion() || (navigator.hardwareConcurrency ?? 8) <= 4 || ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) <= 3;

// ---------- Creatures ----------

export interface Pose { body: Body; anatomy: Anatomy; size: number; t: number }

const paths = new WeakMap<Part, Path2D>();
const partPath = (p: Part) => {
  let h = paths.get(p);
  if (!h) { h = strokePath(p.pts, p.w, undefined, true); paths.set(p, h); }
  return h;
};
const d2 = (a: Pt, b: Pt) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

// Draws a creature with its centre of mass at screen (sx, sy). k: screen px per metre.
export function paintCreature(ctx: CanvasRenderingContext2D, pose: Pose, sx: number, sy: number, k: number) {
  const { body: b, anatomy: a, size, t } = pose;
  const [cx, cy] = a.center;
  const s = size * k; // screen px per pad px
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(-b.th);
  ctx.scale(s, s);
  ctx.translate(-cx, -cy);

  // Squash and stretch about the feet; jellies also lean as they ooze.
  if (Math.abs(b.squash - 1) > 0.003 || a.kind === 'jelly') {
    ctx.translate(cx, a.box.y1);
    if (a.kind === 'jelly') ctx.transform(1, 0, -0.07 * Math.sin(b.gait * 0.6 + 0.8), 1, 0, 0);
    ctx.scale(1 / Math.sqrt(b.squash), b.squash);
    ctx.translate(-cx, -a.box.y1);
  }

  // Snakes: a wave running tail-ward at the speed the body moves forward, so
  // each stretch of body follows the path of the one ahead. Calmer at the head.
  const wave = (a.kind === 'worm' || a.kind === 'scribble') && !b.legs.length;
  const kx = 7 * size, amp = 0.028 / size;
  const ripple = (pts: Pt[]): Pt[] => pts.map(([x, y]) => {
    const u = (x - a.box.x0) / Math.max(1, a.box.w);
    return [x, y + amp * (0.3 + 0.7 * (1 - u)) * Math.sin(kx * x + b.gait)];
  });

  let legIdx = 0;
  for (const p of a.parts) {
    ctx.save();
    if (p.kind === 'leg') {
      const leg = b.legs[legIdx++];
      if (leg) {
        // Where the physics foot is, in this pad-pixel body frame.
        const dx = leg.foot[0] - b.x, dy = leg.foot[1] - b.y;
        const c = Math.cos(-b.th), sn = Math.sin(-b.th);
        const lx = c * dx - sn * dy, ly = sn * dx + c * dy;
        const fx = cx + lx / size, fy = cy - ly / size;
        const rest = p.pts.reduce((f, q) => (d2(q, p.pivot) > d2(f, p.pivot) ? q : f), p.pivot);
        const want = Math.atan2(fy - p.pivot[1], fx - p.pivot[0]);
        const was = Math.atan2(rest[1] - p.pivot[1], rest[0] - p.pivot[0]);
        const q = Math.max(0.7, Math.min(1.15, leg.len / leg.L));
        ctx.translate(p.pivot[0], p.pivot[1]);
        ctx.rotate(want - was);
        ctx.scale(1, q);
        ctx.translate(-p.pivot[0], -p.pivot[1]);
      }
    } else if (p.kind === 'wing') {
      // A full beat when it's working hard, a slow flex on the line.
      const beat = Math.sin(b.flap) * (0.18 + 0.62 * b.flapAmp);
      ctx.translate(p.pivot[0], p.pivot[1]);
      ctx.rotate(-beat * (p.side || 1));
      ctx.translate(-p.pivot[0], -p.pivot[1]);
    } else if (p.kind === 'tail') {
      ctx.translate(p.pivot[0], p.pivot[1]);
      ctx.rotate(Math.sin(t * 6 + p.pivot[0] * 0.05) * 0.14);
      ctx.translate(-p.pivot[0], -p.pivot[1]);
    }
    ctx.fillStyle = p.color;
    ctx.fill(wave ? strokePath(ripple(p.pts), p.w) : partPath(p));
    ctx.restore();
  }
  ctx.restore();
}

// A soft contact shadow under a creature, fading as it leaves the ground.
function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, alt: number) {
  const a = 0.2 / (1 + 5 * Math.max(0, alt));
  const r = rx * (1 + 0.6 * Math.max(0, alt));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / r);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, `rgba(30,32,38,${a})`);
  g.addColorStop(0.55, `rgba(30,32,38,${a * 0.45})`);
  g.addColorStop(1, 'rgba(30,32,38,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ---------- The race board ----------

const LANE_Z = 1.25; // metres between lane lines
const TILT = 0.85;   // how much the far lanes shrink: 1 / (1 + TILT)
const OAK = '#d9c4a0';
// Cheap seeded hash for desk grain: the same desk every frame.
const hash = (n: number) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
const ease = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;

interface Finish { who: number; place: number; time: number; at: number }

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private sharp = document.createElement('canvas');
  private sctx = this.sharp.getContext('2d')!;
  private small = document.createElement('canvas');
  private smctx = this.small.getContext('2d')!;
  private small2 = document.createElement('canvas');
  private sm2ctx = this.small2.getContext('2d')!;
  private mid = document.createElement('canvas');
  private midctx = this.mid.getContext('2d')!;
  private mid2 = document.createElement('canvas');
  private mid2ctx = this.mid2.getContext('2d')!;
  private camX = 3;
  private viewW = 0;
  private born = 0;
  private finishes: Finish[] = [];
  private photo: { at: number; gap: number } | null = null;
  private filterOk = 'filter' in CanvasRenderingContext2D.prototype;
  W = 0; H = 0;

  constructor(private canvas: HTMLCanvasElement, private race: Race) {
    this.ctx = canvas.getContext('2d')!;
  }

  event(e: RaceEvent, now: number) {
    const r = this.race.racers[e.who];
    if (e.type === 'finish' && r?.finishTime != null) this.finishes.push({ who: e.who, place: e.value ?? 0, time: r.finishTime, at: now });
    if (e.type === 'photo') {
      const [a, b] = this.race.finishOrder.map((i) => this.race.racers[i].finishTime!);
      this.photo = { at: now, gap: b - a };
    }
  }

  draw(now: number, dt: number) {
    const cv = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
    if (cv.width !== W || cv.height !== H) {
      cv.width = this.sharp.width = W; cv.height = this.sharp.height = H;
      this.small.width = this.small2.width = Math.max(1, Math.round(W / 8));
      this.small.height = this.small2.height = Math.max(1, Math.round(H / 8));
      this.mid.width = this.mid2.width = Math.max(1, Math.round(W / 3));
      this.mid.height = this.mid2.height = Math.max(1, Math.round(H / 3));
    }
    this.W = W; this.H = H;
    this.born ||= now;
    const intro = reducedMotion() ? 1 : (now - this.born) / 1400;

    const race = this.race, racers = race.racers, N = racers.length;
    const portrait = W < H * 0.9;
    const base = portrait ? 7.5 : 14;
    const me = race.playerRacer;

    // Camera: follow the pack, widening to keep it in view, never losing you.
    const live = racers.filter((r) => !r.done);
    const pack = live.length ? live : racers;
    let lo = Math.min(...pack.map((r) => r.x)), hi = Math.max(...pack.map((r) => r.x));
    if (!race.started) { lo = -2.2; hi = base * 0.55; }
    const wantW = Math.min(base * 1.6, Math.max(base, hi - lo + base * 0.5));
    this.viewW ||= wantW;
    this.viewW += (wantW - this.viewW) * Math.min(1, dt * 2);
    let wantX = (lo + hi) / 2 + this.viewW * 0.08;
    if (me) wantX = Math.max(me.x - this.viewW * 0.36, Math.min(me.x + this.viewW * 0.36, wantX));
    if (!live.length) wantX = FINISH + 1;
    this.camX += (wantX - this.camX) * Math.min(1, dt * 2.6);

    // Projection of the sheet: X along the course, Z across it (0 = front edge).
    const Zmax = N * LANE_Z;
    const yFront = H * (portrait ? 0.7 : 0.78), yBack = H * (portrait ? 0.44 : 0.38);
    const yH = (yBack * (1 + TILT) - yFront) / TILT;
    const s0 = W / this.viewW;
    const f = (Z: number) => 1 / (1 + (TILT * Z) / Zmax);
    const P = (X: number, Z: number): Pt => [W / 2 + (X - this.camX) * s0 * f(Z), yH + (yFront - yH) * f(Z)];
    const laneZ = (i: number) => (N - 1 - i + 0.5) * LANE_Z; // lane 0 at the back
    const X0 = -4.5, X1 = FINISH + 6, Zf = -1.1, Zb = Zmax + 1.3;

    const c = this.sctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    const quad = (xa: number, xb: number, za: number, zb: number) => {
      const p = [P(xa, za), P(xb, za), P(xb, zb), P(xa, zb)];
      c.beginPath(); c.moveTo(...p[0]); for (const q of p.slice(1)) c.lineTo(...q); c.closePath();
    };
    const poly = (pts: Pt[]) => { c.beginPath(); c.moveTo(...pts[0]); for (const q of pts.slice(1)) c.lineTo(...q); c.closePath(); };
    // Lift a point off the desk by h metres (screen up, scaled by depth).
    const up = (X: number, Z: number, h: number): Pt => { const p = P(X, Z); return [p[0], p[1] - h * s0 * f(Z)]; };

    // ---- The desk: pale oak, grain running along the course ----
    c.fillStyle = OAK;
    c.fillRect(0, 0, W, H);
    for (let Z = -4, n = 0; Z < Zmax + 40; n++) {
      const y = P(0, Z)[1];
      const g = hash(n);
      const zz = Z;
      Z += 0.05 + 0.12 * hash(n + 0.5);
      if (y < -4 || y > H + 4) continue;
      c.fillStyle = g > 0.82 ? 'rgba(150,115,75,0.22)' : g > 0.5 ? 'rgba(185,154,112,0.18)' : 'rgba(255,245,225,0.10)';
      c.fillRect(0, y, W, Math.max(1, (0.03 + 0.05 * g) * s0 * f(zz) * 0.5));
    }

    // A second sheet underneath, slightly askew, so the board reads as paper.
    const rot = (X: number, Z: number, a: number, cx: number, cz: number): Pt => {
      const ca = Math.cos(a), sa = Math.sin(a), dx = X - cx, dz = Z - cz;
      return P(cx + dx * ca - dz * sa, cz + dx * sa + dz * ca);
    };
    const cx0 = (X0 + X1) / 2, cz0 = (Zf + Zb) / 2;
    c.save();
    c.shadowColor = 'rgba(60,40,20,0.22)'; c.shadowBlur = 22 * dpr; c.shadowOffsetY = 8 * dpr;
    c.fillStyle = '#efede7';
    poly([rot(X0 - 0.3, Zf - 0.2, 0.012, cx0, cz0), rot(X1 + 0.3, Zf - 0.2, 0.012, cx0, cz0), rot(X1 + 0.3, Zb + 0.35, 0.012, cx0, cz0), rot(X0 - 0.3, Zb + 0.35, 0.012, cx0, cz0)]);
    c.fill();
    c.restore();

    // The sheet itself.
    c.save();
    c.shadowColor = 'rgba(60,40,20,0.18)'; c.shadowBlur = 10 * dpr; c.shadowOffsetY = 3 * dpr;
    c.fillStyle = PAPER;
    quad(X0, X1, Zf, Zb);
    c.fill();
    c.restore();

    // ---- Props at miniature scale (a creature is a doodle a few cm long) ----
    const propShadow = (pts: Pt[], blur = 14) => {
      c.save(); c.shadowColor = 'rgba(50,30,10,0.35)'; c.shadowBlur = blur * dpr; c.shadowOffsetY = 6 * dpr;
      c.fillStyle = 'rgba(0,0,0,0.12)'; poly(pts); c.fill(); c.restore();
    };
    // A pencil lying beyond the far edge, repeating along the desk.
    for (const PX of [4, 31]) {
      const z = Zb + 1.1, len = 7.5, r = 0.16;
      const a0 = PX, a1 = PX + len;
      propShadow([P(a0, z - r), P(a1, z - r), P(a1 + 1.1, z), P(a1, z + r), P(a0, z + r)]);
      c.fillStyle = '#e9a92a'; poly([up(a0, z - r, r * 1.2), up(a1, z - r, r * 1.2), up(a1, z, r * 2), up(a0, z, r * 2)]); c.fill();
      c.fillStyle = '#f6c443'; poly([up(a0, z, r * 2), up(a1, z, r * 2), up(a1, z + r, r * 1.2), up(a0, z + r, r * 1.2)]); c.fill();
      c.fillStyle = '#fbd76a'; poly([up(a0, z - r * 0.15, r * 2.02), up(a1, z - r * 0.15, r * 2.02), up(a1, z + r * 0.15, r * 2.02), up(a0, z + r * 0.15, r * 2.02)]); c.fill();
      c.fillStyle = '#ecd2a8'; poly([up(a1, z - r, r * 1.2), up(a1 + 0.9, z, r * 1.2), up(a1, z + r, r * 1.2), up(a1, z, r * 2)]); c.fill();
      c.fillStyle = '#3a3a3e'; poly([up(a1 + 0.62, z - r * 0.3, r * 1.2), up(a1 + 1.1, z, r * 1.2), up(a1 + 0.62, z + r * 0.3, r * 1.2)]); c.fill();
      c.fillStyle = '#b8bcc2'; poly([up(a0 - 0.45, z - r, r * 1.2), up(a0, z - r, r * 1.2), up(a0, z + r, r * 1.2), up(a0 - 0.45, z + r, r * 1.2), up(a0 - 0.45, z, r * 2.05)]); c.fill();
      c.fillStyle = '#e88a8a'; poly([up(a0 - 1.0, z - r, r * 1.2), up(a0 - 0.45, z - r, r * 1.2), up(a0 - 0.45, z + r, r * 1.2), up(a0 - 1.0, z + r, r * 1.2), up(a0 - 1.0, z, r * 2)]); c.fill();
    }
    // A white eraser in a blue sleeve.
    for (const EX of [17, 44]) {
      const z0 = Zb + 0.5, z1 = z0 + 0.9, x1 = EX + 1.9, h = 0.45;
      propShadow([P(EX, z0), P(x1, z0), P(x1, z1), P(EX, z1)], 10);
      c.fillStyle = '#e7e7e2'; poly([P(EX, z0), P(x1, z0), up(x1, z0, h), up(EX, z0, h)]); c.fill();
      c.fillStyle = '#fbfbf8'; poly([up(EX, z0, h), up(x1, z0, h), up(x1, z1, h), up(EX, z1, h)]); c.fill();
      c.fillStyle = '#2e5fd8'; poly([P(EX + 0.6, z0), P(x1, z0), up(x1, z0, h + 0.01), up(EX + 0.6, z0, h + 0.01)]); c.fill();
      c.fillStyle = '#3b6ee6'; poly([up(EX + 0.6, z0, h + 0.01), up(x1, z0, h + 0.01), up(x1, z1, h + 0.01), up(EX + 0.6, z1, h + 0.01)]); c.fill();
    }
    // A coffee ring stained into the far margin.
    {
      const o = P(26, Zb - 0.55), ax = P(27, Zb - 0.55), bz = P(26, Zb + 0.45);
      c.save();
      c.setTransform(ax[0] - o[0], 0, o[0] - bz[0], o[1] - bz[1], o[0], o[1]);
      c.lineWidth = 0.07; c.strokeStyle = 'rgba(150,95,45,0.22)';
      c.beginPath(); c.arc(0, 0, 0.5, 0.3, Math.PI * 2 - 0.2); c.stroke();
      c.lineWidth = 0.025; c.strokeStyle = 'rgba(150,95,45,0.15)';
      c.beginPath(); c.arc(0.04, 0.02, 0.43, 0, Math.PI * 2); c.stroke();
      c.restore();
    }

    const xa = this.camX - this.viewW * 1.2, xb = this.camX + this.viewW * 1.2; // what's in view
    const vx0 = Math.max(X0, xa), vx1 = Math.min(X1, xb);
    const line = (a: Pt, b: Pt, color: string, w: number) => { c.strokeStyle = color; c.lineWidth = w; c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.stroke(); };
    const lw = dpr;

    // Faint drafting grid: 0.5 m squares, drawing themselves in.
    const gi = ease(intro);
    for (let X = Math.ceil(vx0 * 2) / 2; X <= vx1; X += 0.5) {
      const major = Math.abs(X % 5) < 1e-6;
      line(P(X, Zf + 0.25), P(X, Zf + 0.25 + (Zb - Zf - 0.5) * gi), major ? '#dde0e4' : FAINT, lw * (major ? 1 : 0.8));
    }
    for (let Z = 0; Z <= Zmax + 1e-6; Z += LANE_Z / 2) {
      const lane = Math.abs((Z / LANE_Z) % 1) < 1e-6;
      line(P(vx0, Z), P(vx0 + (vx1 - vx0) * gi, Z), lane ? LINE : FAINT, lw * (lane ? 1 : 0.8));
    }

    // Your lane: one accent, quietly.
    if (me) {
      const z = laneZ(race.player);
      c.fillStyle = 'rgba(255,90,31,0.055)';
      quad(vx0, vx1, z - LANE_Z / 2, z + LANE_Z / 2);
      c.fill();
      line(P(vx0, z - LANE_Z / 2), P(vx1, z - LANE_Z / 2), 'rgba(255,90,31,0.55)', lw);
      line(P(vx0, z + LANE_Z / 2), P(vx1, z + LANE_Z / 2), 'rgba(255,90,31,0.55)', lw);
    }

    // Sheet border: a fine double rule.
    c.strokeStyle = '#8d939c'; c.lineWidth = lw; quad(X0 + 0.35, X1 - 0.35, Zf + 0.25, Zb - 0.25); c.stroke();
    c.strokeStyle = LINE; c.lineWidth = lw * 0.8; quad(X0 + 0.5, X1 - 0.5, Zf + 0.4, Zb - 0.4); c.stroke();

    // Lettering and bubbles lie flat on the sheet: a local affine fit of the
    // perspective (x along the course, y toward the viewer), units in metres.
    const label = (X: number, Z: number, text: string, sizeM: number, weight: number, family: string, color: string, align: CanvasTextAlign = 'center') => {
      const o = P(X, Z), ax = P(X + 1, Z), bz = P(X, Z + 1);
      const px = 64;
      const k = sizeM / px;
      c.save();
      c.setTransform((ax[0] - o[0]) * k, 0, (o[0] - bz[0]) * k, (o[1] - bz[1]) * k, o[0], o[1]);
      c.font = `${weight} ${px}px ${family}`;
      c.fillStyle = color;
      c.textAlign = align;
      c.textBaseline = 'middle';
      c.fillText(text, 0, 0);
      c.restore();
    };
    const ring = (X: number, Z: number, r: number, fill: string | null, stroke: string) => {
      const o = P(X, Z), ax = P(X + 1, Z), bz = P(X, Z + 1);
      c.save();
      c.setTransform(ax[0] - o[0], 0, o[0] - bz[0], o[1] - bz[1], o[0], o[1]);
      c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2);
      if (fill) { c.fillStyle = fill; c.fill(); }
      c.lineWidth = 0.02; c.strokeStyle = stroke; c.stroke();
      c.restore();
    };

    // Metre marks along the front margin, in millimetres like a real drawing.
    for (let X = Math.ceil(vx0 / 5) * 5; X <= Math.min(vx1, FINISH); X += 5) {
      if (X < 0) continue;
      line(P(X, Zf + 0.25), P(X, Zf + 0.5), '#8d939c', lw);
      label(X + 0.12, Zf + 0.62, String(X * 1000).replace(/\B(?=(\d{3})+$)/g, ' '), 0.2, 500, MONO, TEXT, 'left');
    }
    // Overall dimension along the back margin, with architectural ticks.
    const zd = Zmax + 0.5;
    line(P(Math.max(0, vx0), zd), P(Math.min(FINISH, vx1), zd), '#8d939c', lw);
    for (let X = 0; X <= FINISH; X += 10) {
      if (X < vx0 - 1 || X > vx1 + 1) continue;
      const a = P(X - 0.12, zd - 0.12), b = P(X + 0.12, zd + 0.12);
      line(a, b, INK, lw * 1.4);
      line(P(X, zd - 0.25), P(X, zd + 0.25), '#8d939c', lw);
      if (X > 0) label(X - 5, zd + 0.22, `${(X * 1000).toLocaleString('en').replace(/,/g, ' ')}`, 0.2, 500, MONO, TEXT);
    }
    label(Math.min(Math.max(this.camX, 3), FINISH - 3), Zb - 0.62, 'SQUIGGLE CUP  ·  STRAIGHT  ·  40 000', 0.2, 600, MONO, '#9aa0a8');

    // Start line and lettering.
    line(P(0, 0), P(0, Zmax), INK, lw * 1.6);
    label(-0.25, Zf + 0.62, 'START', 0.26, 600, MONO, INK, 'right');
    // Finish: a hatched band between two rules.
    line(P(FINISH, 0), P(FINISH, Zmax), INK, lw * 1.6);
    line(P(FINISH + 0.32, 0), P(FINISH + 0.32, Zmax), INK, lw);
    c.save();
    quad(FINISH, FINISH + 0.32, 0, Zmax); c.clip();
    for (let z = -0.4; z < Zmax + 0.4; z += 0.16) line(P(FINISH, z), P(FINISH + 0.32, z + 0.32), '#8d939c', lw * 0.8);
    c.restore();
    label(FINISH + 0.5, Zf + 0.62, 'FINISH', 0.26, 600, MONO, INK, 'left');

    // Grid bubbles: lane numbers, yours in the accent.
    for (let i = 0; i < N; i++) {
      const z = laneZ(i), mine = i === race.player;
      ring(-1.5, z, 0.3, mine ? ACCENT : PAPER, mine ? ACCENT : '#8d939c');
      label(-1.5, z, String(i + 1).padStart(2, '0'), 0.24, 600, MONO, mine ? '#fff' : INK);
      line(P(-1.2, z), P(-0.15, z), mine ? 'rgba(255,90,31,0.6)' : LINE, lw);
    }

    // Creatures, back lanes first, standing on their lane lines.
    const tags: { x: number; y: number; name: string; mine: boolean; done: string | null }[] = [];
    let myTop = Infinity;
    for (let i = 0; i < N; i++) {
      const r = racers[i], b = r.body, z = laneZ(i);
      const k = s0 * f(z);
      const [gx, gy] = P(b.x, z);
      if (gx < -3 * k || gx > W + 3 * k) continue;
      const alt = b.y + b.bottom;
      shadow(c, gx, gy, b.length * 0.42 * k, b.length * 0.42 * k * 0.22, alt);
      c.save();
      c.shadowColor = 'rgba(30,25,20,0.22)'; c.shadowBlur = 3 * dpr; c.shadowOffsetY = 1.5 * dpr;
      paintCreature(c, { body: b, anatomy: r.anatomy, size: r.s.size, t: now / 1000 }, gx, gy - b.y * k, k);
      c.restore();
      const top = gy - (b.y + b.height * 0.55 + 0.18) * k;
      if (r === me) myTop = top;
      tags.push({ x: gx, y: top, name: r.name, mine: r === me, done: r.finishTime != null ? r.finishTime.toFixed(2) : null });
    }

    // Finish moments: a leader line and the time, drawn in at the line.
    for (const fin of this.finishes) {
      const p = ease((now - fin.at) / 500);
      const z = laneZ(fin.who);
      const a = P(FINISH + 0.32, z), b = P(FINISH + 0.32 + 1.6 * p, z);
      line(a, b, fin.who === race.player ? ACCENT : INK, lw);
      c.globalAlpha = p;
      label(FINISH + 2.05, z, `${PLACE[fin.place - 1] ?? fin.place}  ${fin.time.toFixed(2)}`, 0.24, 600, MONO, fin.who === race.player ? ACCENT : INK, 'left');
      c.globalAlpha = 1;
    }
    if (this.photo) {
      const p = ease((now - this.photo.at) / 600);
      const a = P(FINISH, -0.2), b = P(FINISH, -0.2 + (Zmax + 0.4) * p);
      line(a, b, ACCENT, lw * 1.5);
      c.globalAlpha = p;
      label(FINISH + 0.5, Zmax + 0.95, `PHOTO  Δ ${this.photo.gap.toFixed(2)} s`, 0.26, 600, MONO, ACCENT, 'left');
      c.globalAlpha = 1;
    }

    // A clear ruler along the front edge, nearest the camera (so the softest).
    {
      const z0 = Zf - 1.35, z1 = Zf - 0.35, h = 0.08;
      const xa = Math.max(X0, vx0 - 2), xb = Math.min(X1, vx1 + 2);
      c.fillStyle = 'rgba(40,40,40,0.10)'; poly([P(xa, z0 - 0.08), P(xb, z0 - 0.08), P(xb, z1), P(xa, z1)]); c.fill();
      c.fillStyle = 'rgba(235,240,238,0.55)'; poly([up(xa, z0, h), up(xb, z0, h), up(xb, z1, h), up(xa, z1, h)]); c.fill();
      c.fillStyle = 'rgba(200,210,206,0.7)'; poly([P(xa, z0), P(xb, z0), up(xb, z0, h), up(xa, z0, h)]); c.fill();
      c.strokeStyle = 'rgba(30,30,30,0.55)';
      for (let X = Math.ceil(xa * 4) / 4; X <= xb; X += 0.25) {
        const major = Math.abs(X - Math.round(X)) < 1e-6;
        c.lineWidth = dpr * (major ? 1.4 : 0.9);
        c.beginPath(); c.moveTo(...up(X, z1, h)); c.lineTo(...up(X, z1 - (major ? 0.32 : 0.16), h)); c.stroke();
      }
    }

    // ---- Tilt-shift: soft above and below the lanes, sharp along them ----
    // Three depths: heavy blur everywhere, a medium blur nearer the lanes,
    // and the sharp image only in the focus band, so softness grows with
    // distance from the lanes like a real tilt lens.
    const out = this.ctx;
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.imageSmoothingEnabled = true;
    out.imageSmoothingQuality = 'high';
    const bandTop = Math.min(P(0, Zmax)[1] - H * 0.04, myTop - H * 0.02);
    const bandBot = P(0, 0)[1] + H * 0.03;
    const mask = (ctx: CanvasRenderingContext2D, w: number, h: number, sc: number, feather: number) => {
      const t = bandTop * sc, bt = bandBot * sc, fe = feather * sc;
      const g = ctx.createLinearGradient(0, t - fe, 0, bt + fe);
      const span = bt - t + 2 * fe;
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(fe / span, 'rgba(0,0,0,1)');
      g.addColorStop(1 - fe / span, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    };
    const blurInto = (src: HTMLCanvasElement, dst: CanvasRenderingContext2D, w: number, h: number, px: number) => {
      dst.setTransform(1, 0, 0, 1, 0, 0);
      dst.clearRect(0, 0, w, h);
      dst.filter = `blur(${px}px)`;
      dst.drawImage(src, 0, 0, w, h);
      dst.filter = 'none';
    };
    const sw = this.small.width, sh = this.small.height, mw = this.mid.width, mh = this.mid.height;
    this.smctx.setTransform(1, 0, 0, 1, 0, 0);
    this.smctx.drawImage(this.sharp, 0, 0, sw, sh);
    if (this.filterOk && !lowEnd()) {
      blurInto(this.small, this.sm2ctx, sw, sh, 1.8);
      out.drawImage(this.small2, 0, 0, W, H);
      this.midctx.setTransform(1, 0, 0, 1, 0, 0);
      this.midctx.drawImage(this.sharp, 0, 0, mw, mh);
      blurInto(this.mid, this.mid2ctx, mw, mh, 1.3);
      mask(this.mid2ctx, mw, mh, mw / W, H * 0.22);
      out.drawImage(this.mid2, 0, 0, W, H);
    } else {
      out.drawImage(this.small, 0, 0, W, H);
    }
    mask(c, W, H, 1, H * 0.09);
    out.drawImage(this.sharp, 0, 0);

    // Name tags stay crisp wherever they sit, nudged up so none overlap.
    const placed: { x: number; y: number }[] = [];
    for (const t of tags.slice().sort((a, b) => b.y - a.y)) {
      for (let i = 0; i < 6 && placed.some((p) => Math.abs(p.x - t.x) < 110 * dpr && Math.abs(p.y - t.y) < 15 * dpr); i++) t.y -= 15 * dpr;
      placed.push(t);
    }
    out.textAlign = 'center';
    out.textBaseline = 'alphabetic';
    for (const t of tags) {
      out.font = `${t.mine ? 700 : 600} ${Math.round(11.5 * dpr)}px ${SANS}`;
      out.fillStyle = t.mine ? ACCENT : 'rgba(21,23,28,0.62)';
      out.fillText(t.name, t.x, t.y);
      if (t.done) {
        out.font = `500 ${Math.round(10 * dpr)}px ${MONO}`;
        out.fillText(`${t.done} s`, t.x, t.y - 13 * dpr);
      }
    }

    // A miniature's vignette, and the shutter flash of a photo finish.
    const v = out.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.8);
    v.addColorStop(0, 'rgba(20,20,30,0)');
    v.addColorStop(1, 'rgba(40,25,10,0.22)');
    out.fillStyle = v;
    out.fillRect(0, 0, W, H);
    if (this.photo && !reducedMotion()) {
      const a = 0.7 * (1 - Math.min(1, (now - this.photo.at) / 380));
      if (a > 0) { out.fillStyle = `rgba(255,255,255,${a})`; out.fillRect(0, 0, W, H); }
    }
  }
}

const PLACE = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

// ---------- Draw-screen preview: one lane of the same sheet ----------

export function drawPreview(ctx: CanvasRenderingContext2D, W: number, H: number, pose: Pose | null, camX: number, dpr: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  const k = H / 1.75;                 // px per metre
  const ground = H * 0.8;
  const sx = (x: number) => W * 0.42 + (x - camX) * k;
  for (let X = Math.floor((camX - W / k) * 4) / 4; X < camX + W / k; X += 0.25) {
    const major = Math.abs(X - Math.round(X)) < 1e-6;
    ctx.fillStyle = major ? '#dde0e4' : FAINT;
    ctx.fillRect(Math.round(sx(X)), 0, Math.max(1, dpr * (major ? 1 : 0.7)), ground);
    if (major && X >= 0) {
      ctx.fillStyle = TEXT;
      ctx.font = `500 ${Math.round(9.5 * dpr)}px ${MONO}`;
      ctx.textAlign = 'left';
      ctx.fillText(`${(X * 1000).toLocaleString('en').replace(/,/g, ' ')}`, sx(X) + 4 * dpr, ground + 14 * dpr);
    }
  }
  for (let y = ground - 0.25 * k; y > 0; y -= 0.25 * k) { ctx.fillStyle = FAINT; ctx.fillRect(0, Math.round(y), W, Math.max(1, 0.7 * dpr)); }
  ctx.fillStyle = LINE;
  ctx.fillRect(0, Math.round(ground), W, Math.max(1, dpr));
  if (pose) {
    const b = pose.body;
    shadow(ctx, sx(b.x), ground, b.length * 0.42 * k, b.length * 0.42 * k * 0.2, b.y + b.bottom);
    paintCreature(ctx, pose, sx(b.x), ground - b.y * k, k);
  }
}
