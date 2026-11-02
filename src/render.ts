import type { Anatomy, Part } from './analyze';
import type { Body } from './body';
import { ACCENT, FINISH } from './course';
import type { Pt } from './geom';
import { strokePath } from './ink';
import type { Race, RaceEvent } from './race';

// Canvas 2D renderer. The race is an architect's presentation board lying on
// a desk, photographed tilt-shift: a white sheet with a faint drafting grid,
// lanes ruled across it and dimension lines, seen from straight above with
// the focus band on the lanes. Creatures are exactly the drawn
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

// drop: metres the body is drawn below its true height (flight is drawn
// compressed); dangling feet are lifted by as much, so they stay above the floor.
export interface Pose { body: Body; anatomy: Anatomy; size: number; t: number; drop?: number }

const paths = new WeakMap<Part, Path2D>();
const partPath = (p: Part) => {
  let h = paths.get(p);
  if (!h) { h = strokePath(p.pts, p.w, undefined, true); paths.set(p, h); }
  return h;
};
const d2 = (a: Pt, b: Pt) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

// Painting and bounds use the same articulated parts, including moving feet,
// wings and tails. Lane fitting must include the pose, not just the raw box.
function posedParts(pose: Pose, visit: (p: Part, angle: number, stretch: number, points: Pt[], wave: boolean) => void) {
  const { body: b, anatomy: a, size, t } = pose;
  const [cx, cy] = a.center;
  const wave = (a.kind === 'worm' || a.kind === 'scribble') && !b.legs.length;
  let legIdx = 0, wheelIdx = 0;
  for (const p of a.parts) {
    let angle = 0, stretch = 1;
    if (p.kind === 'leg') {
      const leg = b.legs[legIdx++];
      if (leg) {
        const dx = leg.foot[0] - b.x, dy = leg.foot[1] - b.y + (pose.drop ?? 0) * (leg.planted ? 0 : 1);
        const c = Math.cos(-b.th), sn = Math.sin(-b.th);
        const fx = cx + (c * dx - sn * dy) / size, fy = cy - (sn * dx + c * dy) / size;
        const rest = p.pts.reduce((f, q) => (d2(q, p.pivot) > d2(f, p.pivot) ? q : f), p.pivot);
        angle = Math.atan2(fy - p.pivot[1], fx - p.pivot[0]) - Math.atan2(rest[1] - p.pivot[1], rest[0] - p.pivot[0]);
        stretch = Math.max(0.3, Math.min(1.15, leg.len / leg.L));
      }
    } else if (p.kind === 'wing') angle = -Math.sin(b.flap) * (0.14 + 0.36 * b.flapAmp) * (p.side || 1);
    else if (p.kind === 'wheel') { const wh = b.wheels[wheelIdx++]; if (wh) angle = b.roll / Math.max(0.01, wh.r); }
    else if (p.kind === 'tail') angle = Math.sin(t * 6 + p.pivot[0] * 0.05) * 0.14;
    const points = wave ? p.pts.map(([x, y]): Pt => {
      const u = (x - a.box.x0) / Math.max(1, a.box.w);
      return [x, y + (0.028 / size) * (0.3 + 0.7 * (1 - u)) * Math.sin(7 * size * x + b.gait)];
    }) : p.pts;
    visit(p, angle, stretch, points, wave);
  }
}

export interface Bounds { left: number; top: number; right: number; bottom: number }

// Metres relative to the centre of mass, with screen y pointing down.
export function creatureBounds(pose: Pose): Bounds {
  const { anatomy: a, body: b, size } = pose;
  const [cx, cy] = a.center;
  const squash = Math.abs(b.squash - 1) > 0.003 || a.kind === 'jelly' ? b.squash : 1;
  const lean = a.kind === 'jelly' ? -0.07 * Math.sin(b.gait * 0.6 + 0.8) : 0;
  const c = Math.cos(-b.th), sn = Math.sin(-b.th);
  const bounds: Bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  posedParts(pose, (p, angle, stretch, points) => {
    const pc = Math.cos(angle), ps = Math.sin(angle);
    // Include the pen outline and a little room for its smoothed caps.
    const pen = p.w * size * Math.max(1, stretch) * Math.max(squash, 1 / Math.sqrt(squash)) * 1.2;
    for (const [px, py] of points) {
      const dx = px - p.pivot[0], dy = (py - p.pivot[1]) * stretch;
      const x = p.pivot[0] + pc * dx - ps * dy;
      const y = p.pivot[1] + ps * dx + pc * dy;
      const sx = ((x - cx) / Math.sqrt(squash) + lean * squash * (y - a.box.y1)) * size;
      const sy = (a.box.y1 + (y - a.box.y1) * squash - cy) * size;
      const bx = c * sx - sn * sy, by = sn * sx + c * sy;
      bounds.left = Math.min(bounds.left, bx - pen); bounds.right = Math.max(bounds.right, bx + pen);
      bounds.top = Math.min(bounds.top, by - pen); bounds.bottom = Math.max(bounds.bottom, by + pen);
    }
  });
  return bounds;
}

// Draws a creature with its centre of mass at screen (sx, sy). k: screen px per metre.
export function paintCreature(ctx: CanvasRenderingContext2D, pose: Pose, sx: number, sy: number, k: number) {
  const { body: b, anatomy: a, size } = pose;
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

  posedParts(pose, (p, angle, stretch, points, wave) => {
    ctx.save();
    ctx.translate(p.pivot[0], p.pivot[1]);
    ctx.rotate(angle);
    ctx.scale(1, stretch);
    ctx.translate(-p.pivot[0], -p.pivot[1]);
    ctx.fillStyle = p.color;
    ctx.fill(wave ? strokePath(points, p.w) : partPath(p));
    ctx.restore();
  });
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
const TILT = 0.3;    // how much the far lanes shrink: 1 / (1 + TILT), the miniature's tilt
// Height above the ground is drawn true up to standing height; anything above
// that (flight, hops) at ALT of its true size, the same for every creature:
// a flyer lifts off its shadow and beats its wings, and headroom for its
// full altitude doesn't shrink every creature in the race.
const ALT = 0.12;
export const shownHeight = (y: number, rest: number) => (y <= rest ? y : rest + (y - rest) * ALT);
// The most any creature reaches above and below its ground line, in metres,
// as drawn (checked over whole races of every template by test/sim.test.ts).
export const REACH_UP = 1.25, REACH_DOWN = 0.09;
// Creatures are drawn big: the tallest pose may reach this share of a lane
// into the lane behind it (feet always stay in their own lane).
export const SPILL = 0.4;
// Physics races every drawing at about a metre whatever its size on the pad;
// on screen, a drawing the player made small stays small. Anything spanning
// LOOK_FULL pad px or more (every house creature does) is drawn full size.
const LOOK_FULL = 150, LOOK_MIN = 0.35;
export const looks = (a: Anatomy) => Math.min(1, Math.max(LOOK_MIN, Math.max(a.box.w, a.box.h) / LOOK_FULL));
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
  scale = 0; // px per metre every creature was last drawn at (for tests)

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
    if (cv.width !== W || cv.height !== H || this.sharp.width !== W || this.sharp.height !== H) {
      cv.width = this.sharp.width = W; cv.height = this.sharp.height = H;
      this.small.width = this.small2.width = Math.max(1, Math.round(W / 6));
      this.small.height = this.small2.height = Math.max(1, Math.round(H / 6));
    }
    this.W = W; this.H = H;
    this.born ||= now;
    const intro = reducedMotion() ? 1 : (now - this.born) / 1400;

    const race = this.race, racers = race.racers, N = racers.length;
    const portrait = W < H * 0.9;
    const compact = H < 480 * dpr;
    const base = portrait ? 5.5 : 9;
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
    // Lanes fill the height, leaving just over half a lane above and below
    // for the dimension lettering in the margins.
    const laneStep = H / (N + 1.1);
    const yFront = H - 0.5 * laneStep, yBack = 0.6 * laneStep;
    const s0 = W / this.viewW;
    // Seen at a slight tilt, like a photo of a model on the desk: lines
    // converge and the far lanes shrink a little. Creatures don't: they all
    // share the back lane's scale (below).
    const yH = (yBack * (1 + TILT) - yFront) / TILT;
    const f = (Z: number) => 1 / (1 + (TILT * Z) / Zmax);
    const P = (X: number, Z: number): Pt => [W / 2 + (X - this.camX) * s0 * f(Z), yH + (yFront - yH) * f(Z)];
    // Put feet near the lower edge of each lane, leaving space above for
    // the creature and its own header. Lane 0 is at the back.
    const laneZ = (i: number) => (N - 1 - i + 0.12) * LANE_Z;
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
      const near = (N - 1 - race.player) * LANE_Z, far = near + LANE_Z;
      c.fillStyle = 'rgba(255,90,31,0.055)';
      quad(vx0, vx1, near, far);
      c.fill();
      line(P(vx0, near), P(vx1, near), 'rgba(255,90,31,0.55)', lw);
      line(P(vx0, far), P(vx1, far), 'rgba(255,90,31,0.55)', lw);
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

    // Metre marks along the front margin, in millimetres like a real drawing.
    for (let X = Math.ceil(vx0 / 5) * 5; X <= Math.min(vx1, FINISH); X += 5) {
      if (X <= 0 || X >= FINISH) continue; // START and FINISH are lettered instead
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
      if (X > 0) label(X - 5, zd - 0.2, `${(X * 1000).toLocaleString('en').replace(/,/g, ' ')}`, 0.2, 500, MONO, TEXT);
    }

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

    // Every racer, yours included, is drawn at one scale for the whole race:
    // sized so the tallest pose any creature reaches fills the back (smallest)
    // lane and SPILL of the margin above it. Names sit beside the creature,
    // not above it, so the whole lane height is the creature's. Nothing about
    // a pose, a wingbeat or the camera changes the scale; only the canvas
    // size does. A drawing made small on the pad is drawn smaller (looks).
    const laneH = P(0, (N - 1) * LANE_Z)[1] - P(0, N * LANE_Z)[1];
    const K = (this.scale = Math.max(1, (laneH * (1 + SPILL) - 4 * dpr) / (REACH_UP + REACH_DOWN)));
    const tags: { x: number; left: number; right: number; y: number; name: string; mine: boolean; idx: number; done: string | null }[] = [];
    const order = race.standings();
    let myTop = Infinity;
    for (let i = 0; i < N; i++) {
      const r = racers[i], b = r.body;
      const y = shownHeight(b.y, r.restY);
      const pose = { body: b, anatomy: r.anatomy, size: r.s.size, t: race.time, drop: b.y - y };
      const laneTop = P(0, (N - i) * LANE_Z)[1];
      const laneBottom = P(0, (N - 1 - i) * LANE_Z)[1];
      const gx = P(b.x, laneZ(i))[0];
      const k = K * looks(r.anatomy);
      const gy = laneBottom - REACH_DOWN * k - 2 * dpr;
      if (gx < -3 * k || gx > W + 3 * k) continue;
      shadow(c, gx, gy, b.length * 0.42 * k, b.length * 0.42 * k * 0.22, b.y + b.bottom);
      paintCreature(c, pose, gx, gy - y * k, k);
      myTop = Math.min(myTop, gy + (creatureBounds(pose).top - y) * k);
      // How far the drawing reaches either side of its centre, padded for wingbeats.
      const a = r.anatomy, reach = r.s.size * k * 1.1, pad = 0.08 * k;
      tags.push({ x: gx, left: gx - (a.center[0] - a.box.x0) * reach - pad, right: gx + (a.box.x1 - a.center[0]) * reach + pad,
        y: compact ? (laneTop + laneBottom) / 2 + 4 * dpr : laneTop + 16 * dpr, name: r.name, mine: r === me, idx: i,
        done: r.finishTime === null ? null : `${PLACE[order.indexOf(r)]}  ${r.finishTime.toFixed(2)} s` });
    }

    // Finish moments: a leader line and the time, drawn in at the line.
    for (const fin of this.finishes) {
      const p = ease((now - fin.at) / 500);
      const z = laneZ(fin.who);
      const a = P(FINISH + 0.32, z), b = P(FINISH + 0.32 + 1.6 * p, z);
      line(a, b, fin.who === race.player ? ACCENT : INK, lw);
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
      s2.filter = 'blur(2.4px)';
      s2.drawImage(this.small, 0, 0);
      s2.filter = 'none';
      blurred = this.small2;
    }
    out.imageSmoothingEnabled = true;
    out.imageSmoothingQuality = 'high';
    out.drawImage(blurred, 0, 0, W, H);
    // Mask the sharp copy to the focus band, then lay it on top.
    // Sharp across the lanes only: the margins, the desk and the far edge of
    // the sheet go soft, as in a tilt-shift photo of a miniature.
    const bandTop = Math.min(P(0, Zmax)[1], myTop) - H * 0.01;
    const bandBot = P(0, 0)[1] + H * 0.01;
    const feather = H * 0.07;
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

    // Screen-sized text stays readable on phones. Numbers, names and finish
    // times have separate slots; a name goes behind its creature, or ahead of
    // it when there's no room behind, never over it.
    const nameLeft = 46 * dpr, nameRight = W - Math.min(120 * dpr, W * 0.3) - 16 * dpr;
    out.textBaseline = 'alphabetic';
    for (const t of tags) {
      const color = t.mine ? ACCENT : INK;
      out.fillStyle = PAPER;
      out.fillRect(10 * dpr, t.y - 15 * dpr, 27 * dpr, 21 * dpr);
      out.strokeStyle = t.mine ? ACCENT : LINE; out.lineWidth = dpr;
      out.strokeRect(10 * dpr, t.y - 15 * dpr, 27 * dpr, 21 * dpr);
      out.font = `500 ${12 * dpr}px ${MONO}`;
      out.textAlign = 'center'; out.fillStyle = color;
      out.fillText(String(t.idx + 1).padStart(2, '0'), 23.5 * dpr, t.y);
      // Short landscape screens put full names and times in the side panel.
      if (compact) continue;
      out.font = `${t.mine ? 700 : 600} ${13 * dpr}px ${SANS}`;
      // Behind the creature if it fits, else whichever side has more room,
      // shortened to fit there. The standings always have the full name.
      const gapX = 10 * dpr;
      const behind = t.left - gapX - nameLeft, ahead = nameRight - (t.right + gapX);
      const full = out.measureText(t.name).width;
      const side = full <= behind || behind >= ahead ? 'behind' : 'ahead';
      const limit = Math.min(260 * dpr, side === 'behind' ? behind : ahead);
      if (limit >= 24 * dpr) {
        let name = t.name;
        if (full > limit) {
          const chars = Array.from(name);
          while (chars.length && out.measureText(chars.join('') + '…').width > limit) chars.pop();
          name = chars.join('') + '…';
        }
        const width = out.measureText(name).width;
        const x = side === 'behind' ? t.left - gapX - width : t.right + gapX;
        out.fillStyle = PAPER; out.fillRect(x - 3 * dpr, t.y - 15 * dpr, width + 6 * dpr, 21 * dpr);
        out.textAlign = 'left'; out.fillStyle = color;
        out.fillText(name, x, t.y);
      }
      if (t.done) {
        out.font = `500 ${11.5 * dpr}px ${MONO}`;
        const timeWidth = out.measureText(t.done).width;
        out.fillStyle = PAPER; out.fillRect(W - 19 * dpr - timeWidth, t.y - 15 * dpr, timeWidth + 6 * dpr, 21 * dpr);
        out.textAlign = 'right'; out.fillStyle = color;
        out.fillText(t.done, W - 16 * dpr, t.y);
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

export function drawPreview(ctx: CanvasRenderingContext2D, W: number, H: number, pose: Pose | null, rest: number, camX: number, dpr: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  const ground = H * 0.8;
  const k = (ground - 6 * dpr) / REACH_UP; // px per metre, the race's scale rule
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
    const kc = k * looks(pose.anatomy);
    shadow(ctx, sx(b.x), ground, b.length * 0.42 * kc, b.length * 0.42 * kc * 0.2, b.y + b.bottom);
    const y = shownHeight(b.y, rest);
    paintCreature(ctx, { ...pose, drop: b.y - y }, sx(b.x), ground - y * kc, kc);
  }
}
