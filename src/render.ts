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
const TILT = 0.32;   // how much the far lanes shrink: 1 / (1 + TILT)
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
      this.small.width = this.small2.width = Math.max(1, Math.round(W / 6));
      this.small.height = this.small2.height = Math.max(1, Math.round(H / 6));
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
    const yFront = H * (portrait ? 0.7 : 0.8), yBack = H * (portrait ? 0.4 : 0.36);
    const yH = (yBack * (1 + TILT) - yFront) / TILT;
    const s0 = W / this.viewW;
    const f = (Z: number) => 1 / (1 + (TILT * Z) / Zmax);
    const P = (X: number, Z: number): Pt => [W / 2 + (X - this.camX) * s0 * f(Z), yH + (yFront - yH) * f(Z)];
    const laneZ = (i: number) => (N - 1 - i + 0.5) * LANE_Z; // lane 0 at the back
    const X0 = -4.5, X1 = FINISH + 6, Zf = -1.1, Zb = Zmax + 1.3;

    const c = this.sctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = DESK;
    c.fillRect(0, 0, W, H);

    // The sheet, with a soft drop shadow on the desk.
    const quad = (xa: number, xb: number, za: number, zb: number) => {
      const p = [P(xa, za), P(xb, za), P(xb, zb), P(xa, zb)];
      c.beginPath(); c.moveTo(...p[0]); for (const q of p.slice(1)) c.lineTo(...q); c.closePath();
    };
    c.save();
    c.shadowColor = 'rgba(40,40,50,0.16)';
    c.shadowBlur = 28 * dpr;
    c.shadowOffsetY = 10 * dpr;
    c.fillStyle = PAPER;
    quad(X0, X1, Zf, Zb);
    c.fill();
    c.restore();

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
      paintCreature(c, { body: b, anatomy: r.anatomy, size: r.s.size, t: now / 1000 }, gx, gy - b.y * k, k);
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

    // ---- Tilt-shift: soft above and below the lanes, sharp along them ----
    const out = this.ctx;
    out.setTransform(1, 0, 0, 1, 0, 0);
    const sm = this.smctx, sw = this.small.width, sh = this.small.height;
    sm.setTransform(1, 0, 0, 1, 0, 0);
    sm.drawImage(this.sharp, 0, 0, sw, sh);
    let blurred: HTMLCanvasElement = this.small;
    if (this.filterOk && !lowEnd()) {
      const s2 = this.sm2ctx;
      s2.setTransform(1, 0, 0, 1, 0, 0);
      s2.clearRect(0, 0, sw, sh);
      s2.filter = 'blur(1.6px)';
      s2.drawImage(this.small, 0, 0);
      s2.filter = 'none';
      blurred = this.small2;
    }
    out.imageSmoothingEnabled = true;
    out.imageSmoothingQuality = 'high';
    out.drawImage(blurred, 0, 0, W, H);
    // Mask the sharp copy to the focus band, then lay it on top.
    const bandTop = Math.min(P(0, Zmax)[1] - H * 0.05, myTop - H * 0.02);
    const bandBot = P(0, 0)[1] + H * 0.035;
    const feather = H * 0.13;
    c.globalCompositeOperation = 'destination-in';
    const g = c.createLinearGradient(0, bandTop - feather, 0, bandBot + feather);
    const span = bandBot - bandTop + 2 * feather;
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(feather / span, 'rgba(0,0,0,1)');
    g.addColorStop(1 - feather / span, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'source-over';
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
    v.addColorStop(1, 'rgba(20,20,30,0.10)');
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
