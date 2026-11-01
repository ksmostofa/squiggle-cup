import type { Anatomy, Part } from './analyze';
import type { Body } from './body';
import { type Pt } from './geom';
import { strokePath } from './ink';
import type { Race, RaceEvent, Racer } from './race';
import type { Course } from './venues/ochre';

// Canvas 2D renderer for Ochre. The look is real rock art: torch-lit limestone,
// creatures painted in ochre and charcoal with a soft bleed and dry grain.
// Every drawn limb is posed from the physics: legs point where their spring
// legs actually are, wings beat with the flap. Render-only: nothing here
// feeds back into the simulation.

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Baked textures ----------

let wallTex: HTMLCanvasElement | null = null;
let grainTex: HTMLCanvasElement | null = null;

function rnd(seed: number) {
  let a = seed | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Limestone: warm mottling, mineral speckle, fine cracks, a few old hand-stencil ghosts.
export function wall(): HTMLCanvasElement {
  if (wallTex) return wallTex;
  const W = 1024, H = 640;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const r = rnd(7);
  g.fillStyle = '#b48a62';
  g.fillRect(0, 0, W, H);
  const blot = (n: number, rMin: number, rMax: number, cols: string[], alpha: number) => {
    for (let i = 0; i < n; i++) {
      const x = r() * W, y = r() * H, rad = rMin + r() * (rMax - rMin);
      for (const dx of [-W, 0, W]) {
        const gr = g.createRadialGradient(x + dx, y, 0, x + dx, y, rad);
        gr.addColorStop(0, cols[i % cols.length]);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalAlpha = alpha;
        g.fillStyle = gr;
        g.fillRect(x + dx - rad, y - rad, rad * 2, rad * 2);
      }
    }
    g.globalAlpha = 1;
  };
  blot(40, 120, 320, ['#d4ad80', '#8f6544', '#c79b6c', '#7a5236', '#e0c49c'], 0.45);
  blot(160, 20, 70, ['#e6cfa8', '#6e4a30', '#a77a52'], 0.3);
  // Strata.
  g.globalAlpha = 0.12;
  for (let i = 0; i < 9; i++) {
    g.strokeStyle = i % 2 ? '#5b3d27' : '#f0dcb8';
    g.lineWidth = 3 + r() * 14;
    g.beginPath();
    const y0 = r() * H;
    g.moveTo(0, y0);
    for (let x = 0; x <= W; x += 64) g.lineTo(x, y0 + Math.sin(x / 140 + i) * 18 + (r() - 0.5) * 10);
    g.stroke();
  }
  // Speckle.
  g.globalAlpha = 1;
  for (let i = 0; i < 9000; i++) {
    const v = r();
    g.fillStyle = v < 0.5 ? `rgba(60,38,24,${0.08 + r() * 0.18})` : `rgba(250,236,210,${0.06 + r() * 0.16})`;
    g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
  }
  // Cracks.
  g.strokeStyle = 'rgba(48,30,20,0.35)';
  for (let i = 0; i < 14; i++) {
    let x = r() * W, y = r() * H;
    g.lineWidth = 0.8 + r() * 1.6;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 10; k++) { x += (r() - 0.3) * 40; y += (r() - 0.5) * 26; g.lineTo(x, y); }
    g.stroke();
  }
  // Ghosts of older paintings: blown hand stencils and a few ochre dots.
  for (let i = 0; i < 5; i++) {
    const x = 80 + r() * (W - 160), y = 80 + r() * (H * 0.55);
    const gr = g.createRadialGradient(x, y, 10, x, y, 60);
    gr.addColorStop(0, 'rgba(160,60,35,0)');
    gr.addColorStop(0.55, 'rgba(160,60,35,0.18)');
    gr.addColorStop(1, 'rgba(160,60,35,0)');
    g.fillStyle = gr;
    g.fillRect(x - 60, y - 60, 120, 120);
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(150,55,32,${0.12 + r() * 0.15})`;
    g.beginPath(); g.arc(r() * W, r() * H * 0.6, 3 + r() * 4, 0, Math.PI * 2); g.fill();
  }
  wallTex = c;
  return c;
}

// Speckle mask that eats pigment so strokes look daubed onto rough stone.
function grain(): HTMLCanvasElement {
  if (grainTex) return grainTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const r = rnd(11);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(0,0,0,${0.25 + r() * 0.6})`;
    const s = 0.6 + r() * 2.2;
    g.fillRect(r() * 256, r() * 256, s, s);
  }
  grainTex = c;
  return c;
}

// ---------- Painting a creature ----------

// Pigment: a wide faint bleed into the stone, then the body of the paint.
function pigment(ctx: CanvasRenderingContext2D, path: Path2D, color: string, alpha: number) {
  ctx.globalAlpha = alpha * 0.22;
  ctx.strokeStyle = color;
  ctx.lineWidth = 7;
  ctx.lineJoin = 'round';
  ctx.stroke(path);
  ctx.globalAlpha = alpha * 0.88;
  ctx.fillStyle = color;
  ctx.fill(path);
  ctx.globalAlpha = 1;
}

export interface Pose {
  body: Body;
  anatomy: Anatomy;
  size: number;
  t: number;      // seconds, for render-only wiggles
  alpha?: number;
}

const paths = new WeakMap<Part, Path2D>();
const partPath = (p: Part) => {
  let h = paths.get(p);
  if (!h) { h = strokePath(p.pts, p.w * 1.15, undefined, true); paths.set(p, h); }
  return h;
};

// Draws a creature in world space. `k` is screen pixels per metre.
export function paintCreature(ctx: CanvasRenderingContext2D, pose: Pose, sx: number, sy: number, k: number) {
  const { body: b, anatomy: a, size, t } = pose;
  const alpha = pose.alpha ?? 1;
  const [cx, cy] = a.center;
  const s = size * k; // screen px per pad px
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(-b.th);
  ctx.scale(s, s);
  ctx.translate(-cx, -cy);

  // Contact shadow-free: paint sits on the wall. A worm ripples as it slides.
  const ripple = a.kind === 'worm' ? b.gait * 3 : 0;
  // Squash and stretch about the feet (blobs ooze, hoppers crouch and spring).
  if (Math.abs(b.squash - 1) > 0.005) {
    ctx.translate(cx, a.box.y1);
    ctx.scale(1 / Math.sqrt(b.squash), b.squash);
    ctx.translate(-cx, -a.box.y1);
  }

  let legIdx = 0;
  const legs = b.legs;
  for (const p of a.parts) {
    ctx.save();
    if (p.kind === 'leg') {
      const leg = legs[legIdx++];
      if (leg) {
        // Where the physics foot is, in this pad-pixel body frame.
        const dx = leg.foot[0] - b.x, dy = leg.foot[1] - b.y;
        const c = Math.cos(-b.th), sn = Math.sin(-b.th);
        const lx = c * dx - sn * dy, ly = sn * dx + c * dy;
        const fx = cx + lx / size, fy = cy - ly / size;
        const rest = p.pts.reduce((f, q) => (d2(q, p.pivot) > d2(f, p.pivot) ? q : f), p.pivot);
        const want = Math.atan2(fy - p.pivot[1], fx - p.pivot[0]);
        const was = Math.atan2(rest[1] - p.pivot[1], rest[0] - p.pivot[0]);
        const q = Math.max(0.6, Math.min(1.3, leg.len / leg.L));
        ctx.translate(p.pivot[0], p.pivot[1]);
        ctx.rotate(want - was);
        ctx.scale(q, q);
        ctx.translate(-p.pivot[0], -p.pivot[1]);
      }
    } else if (p.kind === 'wing') {
      const beat = b.lift > 0 ? Math.sin(b.flap) * (0.25 + 0.5 * b.flapAmp) : Math.sin(t * 5) * 0.08;
      ctx.translate(p.pivot[0], p.pivot[1]);
      ctx.rotate(-beat * (p.side || 1));
      ctx.translate(-p.pivot[0], -p.pivot[1]);
    } else if (p.kind === 'tail') {
      ctx.translate(p.pivot[0], p.pivot[1]);
      ctx.rotate(Math.sin(t * 7 + p.pivot[0]) * 0.18);
      ctx.translate(-p.pivot[0], -p.pivot[1]);
    }
    if (ripple && (p.kind === 'body' || p.kind === 'decor')) {
      const pts: Pt[] = p.pts.map(([x, y]) => [x, y + Math.sin(x * 0.045 - ripple) * 6]);
      pigment(ctx, strokePath(pts, p.w * 1.15), p.color, alpha);
    } else {
      pigment(ctx, partPath(p), p.color, alpha);
    }
    ctx.restore();
  }
  // Eyes are just pigment dots, as on the cave walls.
  for (const e of a.eyes) {
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillStyle = '#1d1a19';
    ctx.beginPath(); ctx.arc(e.c[0], e.c[1], Math.max(5, e.r * 0.55), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

const d2 = (a: Pt, b: Pt) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

// ---------- The race scene ----------

interface Mote { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; color: string }

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private layer = document.createElement('canvas');
  private lctx = this.layer.getContext('2d')!;
  private camX = 0;
  private camY = 0;
  private shake = 0;
  private motes: Mote[] = [];
  private flicker = 0;
  W = 0; H = 0; scale = 1;
  daylight = 0; // 0..1, the flood at the cave mouth

  constructor(private canvas: HTMLCanvasElement, private race: Race) {
    this.ctx = canvas.getContext('2d')!;
    this.camX = (race.playerRacer ?? race.racers[0]).x;
  }

  event(e: RaceEvent) {
    const r = this.race.racers[e.who];
    if (!r) return;
    if (e.type === 'land') {
      const n = Math.min(9, 3 + Math.round((e.value ?? 0) * 5));
      for (let i = 0; i < n; i++) {
        this.motes.push({ x: r.x + (Math.random() - 0.3) * r.body.length * 0.5, y: this.race.course.ground(r.x) + 0.03, vx: (Math.random() - 0.5) * 1.5, vy: Math.random() * 0.7, life: 0, max: 0.6 + Math.random() * 0.4, r: 0.04 + Math.random() * 0.07, color: '#d9b98f' });
      }
      if (r.isPlayer && (e.value ?? 0) > 0.7 && !reducedMotion()) this.shake = 0.14;
    }
  }

  private focus(): Racer {
    const me = this.race.playerRacer;
    if (me && !me.done) return me;
    return this.race.standings().find((r) => !r.done) ?? me ?? this.race.racers[0];
  }

  draw(now: number, dt: number) {
    const cv = this.canvas, ctx = this.ctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; this.layer.width = w; this.layer.height = h; }
    this.W = w; this.H = h;
    const viewW = w < h ? 9 : 16; // PRD §20.2
    const s = (this.scale = w / viewW);
    const course = this.race.course;

    const f = this.focus();
    const ahead = f.done ? 0 : viewW * 0.16;
    this.camX += (f.x + ahead - this.camX) * Math.min(1, dt * 3.5);
    const wantY = course.ground(this.camX) + Math.max(0, f.body.y - course.ground(f.x) - 1.5);
    this.camY += (wantY - this.camY) * Math.min(1, dt * 2.5);
    let shx = 0, shy = 0;
    if (this.shake > 0) { this.shake -= dt; shx = (Math.random() - 0.5) * 9 * dpr; shy = (Math.random() - 0.5) * 9 * dpr; }
    const floorY = h * 0.7;
    const sx = (x: number) => (x - this.camX) * s + w / 2 + shx;
    const sy = (y: number) => floorY - (y - this.camY) * s + shy;

    // Wall, at a slower parallax than the floor so the cave has depth.
    const tex = wall();
    const tw = tex.width * (s / 110), th = tex.height * (s / 110);
    const off = ((this.camX * s * 0.6) % tw + tw) % tw;
    for (let x = -off; x < w; x += tw) for (let y = floorY - th * 0.9; y < h; y += th) ctx.drawImage(tex, x, y, tw, th);
    ctx.drawImage(tex, 0, 0, tex.width, 1, 0, 0, w, Math.max(0, floorY - th * 0.9)); // ceiling bleed

    // The floor: a darker, worn rock shelf following the course.
    ctx.beginPath();
    ctx.moveTo(-10, h + 10);
    for (let px = -10; px <= w + 10; px += 8) ctx.lineTo(px, sy(course.ground(this.camX + (px - w / 2) / s)));
    ctx.lineTo(w + 10, h + 10);
    ctx.closePath();
    const fg = ctx.createLinearGradient(0, floorY - s, 0, h);
    fg.addColorStop(0, '#7d5a3e');
    fg.addColorStop(1, '#3b2a1f');
    ctx.fillStyle = fg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(240,220,190,0.35)';
    ctx.lineWidth = 2 * dpr;
    ctx.stroke();

    // Cave mouth: daylight beyond the finish.
    const fx = sx(course.finish);
    if (fx < w + 200) {
      const sky = ctx.createLinearGradient(fx, 0, fx + 6 * s, 0);
      sky.addColorStop(0, 'rgba(191,227,255,0)');
      sky.addColorStop(0.15, 'rgba(191,227,255,0.85)');
      sky.addColorStop(1, '#eaf6ff');
      ctx.fillStyle = sky;
      ctx.fillRect(fx, 0, w - fx + 10, h);
    }

    // Creatures, painted onto a layer so the grain can eat into the pigment.
    const L = this.lctx;
    L.setTransform(1, 0, 0, 1, 0, 0);
    L.clearRect(0, 0, w, h);
    const me = this.race.playerRacer;
    const order = this.race.racers.filter((r) => r !== me).concat(me ? [me] : []);
    for (const r of order) {
      paintCreature(L, { body: r.body, anatomy: r.anatomy, size: r.s.size, t: now / 1000, alpha: r === me ? 1 : 0.9 }, sx(r.body.x), sy(r.body.y), s);
    }
    L.globalCompositeOperation = 'destination-out';
    L.fillStyle = L.createPattern(grain(), 'repeat')!;
    L.globalAlpha = 0.5;
    L.fillRect(0, 0, w, h);
    L.globalAlpha = 1;
    L.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.layer, 0, 0);

    // Dust.
    this.motes = this.motes.filter((m) => (m.life += dt) < m.max);
    for (const m of this.motes) {
      m.x += m.vx * dt; m.y += m.vy * dt; m.vy -= 0.6 * dt;
      ctx.globalAlpha = 0.5 * (1 - m.life / m.max);
      ctx.fillStyle = m.color;
      ctx.beginPath(); ctx.arc(sx(m.x), sy(m.y), m.r * s * (1 + m.life), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Torchlight: the pack is lit, everything else falls into shadow.
    const lead = this.race.standings()[0];
    this.flicker += (Math.random() - 0.5) * 0.25;
    this.flicker *= 0.9;
    const tx = sx(f.x), ty = sy(f.body.y + 0.6);
    const rad = (reducedMotion() ? 1 : 1 + this.flicker * 0.08) * Math.max(w, h) * 0.62;
    const dark = ctx.createRadialGradient(tx, ty, rad * 0.12, tx, ty, rad);
    dark.addColorStop(0, 'rgba(255,179,71,0.10)');
    dark.addColorStop(0.45, 'rgba(20,12,8,0.12)');
    dark.addColorStop(1, 'rgba(12,7,5,0.82)');
    ctx.fillStyle = dark;
    ctx.fillRect(0, 0, w, h);
    void lead;

    // The dark, creeping in behind the pack.
    const dx = sx(course.dark(this.race.time));
    if (dx > -2 * s) {
      const g = ctx.createLinearGradient(dx - 3 * s, 0, dx + 0.6 * s, 0);
      g.addColorStop(0, 'rgba(6,4,3,1)');
      g.addColorStop(0.75, 'rgba(6,4,3,0.92)');
      g.addColorStop(1, 'rgba(6,4,3,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, Math.min(w, dx + 0.6 * s), h);
      // Wisps at its edge.
      ctx.fillStyle = 'rgba(6,4,3,0.7)';
      for (let i = 0; i < 9; i++) {
        const y = (i / 8) * h, reach = (0.25 + 0.25 * Math.sin(now / 400 + i * 1.7)) * s;
        ctx.beginPath(); ctx.ellipse(dx, y, reach, h / 14, 0, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Daylight flood once you reach the mouth.
    if (this.daylight > 0) {
      ctx.globalAlpha = this.daylight;
      const g = ctx.createRadialGradient(w * 0.8, h * 0.45, 0, w * 0.8, h * 0.45, Math.max(w, h));
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.5, '#dff1ff');
      g.addColorStop(1, '#bfe3ff');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    // Name marks under each runner.
    ctx.textAlign = 'center';
    for (const r of this.race.racers) {
      const x = sx(r.x), y = sy(r.body.y + r.body.height * 0.75 + 0.35);
      if (x < -60 || x > w + 60) continue;
      const mine = r === me;
      ctx.font = `${mine ? 700 : 500} ${Math.round((mine ? 0.24 : 0.19) * s)}px Fraunces, Georgia, serif`;
      ctx.fillStyle = mine ? '#ffd9a0' : 'rgba(239,230,216,0.75)';
      ctx.fillText(mine ? `▼ ${r.name}` : r.name, x, y);
    }
  }
}

// ---------- Draw-screen preview: the creature alive on a strip of cave floor ----------

export function flatCourse(): Course {
  return {
    finish: 1e9,
    ground: () => 0,
    slope: () => 0,
    contact: (_x, y) => ({ d: -y, nx: 0, ny: 1 }),
    dark: () => -1e9,
  };
}
