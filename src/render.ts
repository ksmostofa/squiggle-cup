import { type Creature, PX } from './creature';
import { fillWash, googlyEye, type InkItem, paintInk, strokePath } from './ink';
import type { Race, RaceEvent } from './race';
import type { Prop } from './venues/venue';

// Canvas 2D renderer for Best in Show (M0 allows Canvas 2D; PixiJS is M1).
// Render-only: nothing here feeds back into the simulation.

const L = 1 / PX; // local metres -> local pad pixels, the units stroke outlines are built in
const HUES = ['#d9a441', '#2a6fdb', '#c8372d', '#2f9e5a', '#7b4fd6', '#e8a317'];
export const markerColor = (i: number) => HUES[i % HUES.length];

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; color: string; kind: 'dust' | 'confetti' | 'ring' }
interface Look { squash: number; blinkAt: number; nextBlink: number }

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private camX = 0;
  private camY = 0;
  private shake = 0;
  private particles: Particle[] = [];
  private looks: Look[];
  private crowd: { x: number; y: number; c: string; s: number }[] = [];
  private paths = new WeakMap<object, InkItem[]>();
  W = 0; H = 0; scale = 1;

  constructor(private canvas: HTMLCanvasElement, private race: Race) {
    this.ctx = canvas.getContext('2d')!;
    this.looks = race.creatures.map(() => ({ squash: 0, blinkAt: -9, nextBlink: 1 + Math.random() * 3 }));
    const tones = ['#e8d5b5', '#c99e77', '#8d5a3b', '#f1c27d', '#5a3a29'];
    const shirts = ['#c8372d', '#2a6fdb', '#f4f1e6', '#2f9e5a', '#d9a441', '#7b4fd6', '#1d1b2e'];
    for (let i = 0; i < 260; i++) {
      this.crowd.push({ x: Math.random() * 40, y: Math.random(), c: Math.random() < 0.5 ? tones[i % tones.length] : shirts[i % shirts.length], s: 0.12 + Math.random() * 0.06 });
    }
    const c = race.creatures[race.player] ?? race.creatures[0];
    this.camX = c.pos.x;
  }

  tapFx(c: Creature) {
    this.looks[c.idx].squash = 0.14;
    const p = c.pos;
    this.particles.push({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0, max: 0.35, r: c.radius * 0.9, color: '#fff', kind: 'ring' });
  }

  event(e: RaceEvent) {
    const c = this.race.creatures[e.who];
    if (e.type === 'land' && c) {
      const n = Math.min(10, 3 + Math.round((e.value ?? 0) * 6));
      for (let i = 0; i < n; i++) {
        this.particles.push({ x: c.pos.x + (Math.random() - 0.5) * c.radius, y: 0.05, vx: (Math.random() - 0.5) * 2, vy: Math.random() * 0.8, life: 0, max: 0.5 + Math.random() * 0.3, r: 0.06 + Math.random() * 0.08, color: '#e9e2cf', kind: 'dust' });
      }
      this.looks[c.idx].squash = Math.min(0.25, 0.08 + (e.value ?? 0) * 0.15);
      if ((e.value ?? 0) > 0.6 && c.idx === this.race.player && !reducedMotion()) this.shake = 0.12;
    }
    if (e.type === 'finish' && c && (e.value === 1 || c.idx === this.race.player)) {
      for (let i = 0; i < 70; i++) {
        this.particles.push({ x: c.pos.x + (Math.random() - 0.5) * 3, y: 3 + Math.random() * 2, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2, life: 0, max: 2 + Math.random(), r: 0.05 + Math.random() * 0.04, color: HUES[i % HUES.length], kind: 'confetti' });
      }
    }
  }

  // Which creature the camera follows: you, until you're done, then the leader.
  private focus(): Creature {
    const me = this.race.playerCreature;
    if (me && !me.done) return me;
    return this.race.standings().find((c) => !c.done) ?? me ?? this.race.creatures[0];
  }

  draw(now: number, dt: number) {
    const cv = this.canvas, ctx = this.ctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    this.W = w; this.H = h;
    const viewW = w < h ? 9 : 16; // PRD §20.2
    const s = (this.scale = w / viewW);

    const f = this.focus();
    const ahead = f.done ? 0 : viewW * 0.18;
    this.camX += (f.pos.x + ahead - this.camX) * Math.min(1, dt * 4);
    const wantY = Math.max(0, f.pos.y - (h / s) * 0.35);
    this.camY += (wantY - this.camY) * Math.min(1, dt * 3);
    let shx = 0, shy = 0;
    if (this.shake > 0) { this.shake -= dt; shx = (Math.random() - 0.5) * 10 * dpr; shy = (Math.random() - 0.5) * 10 * dpr; }

    const groundY = h * 0.72;
    const sx = (x: number) => (x - this.camX) * s + w / 2 + shx;
    const sy = (y: number) => groundY - (y - this.camY) * s + shy;

    this.background(sx, sy, s, groundY);

    const props = this.race.course.props;
    for (const p of props) if (p.type === 'tunnel') this.tunnelBack(p, sx, sy, s);
    for (const p of props) if (p.type !== 'tunnel') this.prop(p, sx, sy, s);

    const me = this.race.playerCreature;
    for (const c of this.race.creatures) if (c !== me) this.creature(c, sx, sy, s, now, c.ghost ? 0.45 : 0.82);
    if (me) {
      this.rhythmRing(me, sx, sy, s, now);
      this.creature(me, sx, sy, s, now, 1);
    }
    for (const p of props) if (p.type === 'tunnel') this.tunnelFront(p, sx, sy, s);
    this.particlesStep(sx, sy, s, dt);
    if (me && Math.abs(me.body.rb.linvel().x) > 6) this.speedLines(me, sx, sy, s, now);

    for (const c of this.race.creatures) this.tag(c, sx, sy, s);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private background(sx: (x: number) => number, sy: (y: number) => number, s: number, groundY: number) {
    const ctx = this.ctx, W = this.W, H = this.H;
    const g = ctx.createLinearGradient(0, 0, 0, groundY);
    g.addColorStop(0, '#141a33');
    g.addColorStop(1, '#2b3766');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Grandstand with a crowd, at parallax 0.35.
    const par = 0.35;
    const standTop = groundY - 3.4 * s, standBot = groundY - 1.2 * s;
    ctx.fillStyle = '#1f2547';
    ctx.fillRect(0, standTop, W, standBot - standTop);
    const offset = this.camX * par;
    for (let rep = -1; rep <= Math.ceil(W / (40 * s)) + 1; rep++) {
      for (const p of this.crowd) {
        const wx = p.x + Math.floor(offset / 40) * 40 + rep * 40;
        const x = (wx - offset) * s;
        if (x < -20 || x > W + 20) continue;
        const y = standTop + (0.15 + p.y * 0.75) * (standBot - standTop);
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(x, y, p.s * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = '#c8372d';
    ctx.fillRect(0, standBot - 0.12 * s, W, 0.12 * s);
    ctx.fillStyle = '#d9a441';
    ctx.fillRect(0, standBot, W, 0.04 * s);

    // Spotlight pools.
    for (let k = Math.floor((this.camX - 12) / 8); k <= Math.ceil((this.camX + 12) / 8); k++) {
      const x = sx(k * 8 + 2);
      const rg = ctx.createRadialGradient(x, groundY, 0, x, groundY, 3.2 * s);
      rg.addColorStop(0, 'rgba(255,244,214,0.22)');
      rg.addColorStop(1, 'rgba(255,244,214,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(x - 3.2 * s, groundY - 3.2 * s, 6.4 * s, 6.4 * s);
    }

    // Velvet ropes along the back of the ring.
    const ropeY = sy(0.75), postBase = groundY - 0.25 * s;
    const x0 = Math.floor((this.camX - 12) / 3) * 3;
    ctx.lineWidth = 0.07 * s;
    for (let x = x0; x < this.camX + 12; x += 3) {
      ctx.strokeStyle = '#8f1d2c';
      ctx.beginPath();
      ctx.moveTo(sx(x), ropeY);
      ctx.quadraticCurveTo(sx(x + 1.5), ropeY + 0.32 * s, sx(x + 3), ropeY);
      ctx.stroke();
      ctx.fillStyle = '#d9a441';
      ctx.fillRect(sx(x) - 0.035 * s, ropeY, 0.07 * s, postBase - ropeY);
      ctx.beginPath();
      ctx.arc(sx(x), ropeY, 0.07 * s, 0, Math.PI * 2);
      ctx.fill();
    }

    // Show carpet.
    const cg = ctx.createLinearGradient(0, groundY, 0, H);
    cg.addColorStop(0, '#2f8a4c');
    cg.addColorStop(1, '#1f5c33');
    ctx.fillStyle = cg;
    ctx.fillRect(0, sy(0), W, H - sy(0));
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(0, sy(0), W, 0.03 * s);

    // Distance markers.
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `600 ${Math.round(0.32 * s)}px Fraunces, Georgia, serif`;
    ctx.textAlign = 'center';
    for (let m = Math.max(0, Math.floor((this.camX - 12) / 10) * 10); m < this.camX + 12; m += 10) {
      if (m === 0 || m >= this.race.course.finish) continue;
      ctx.fillText(`${m} m`, sx(m), sy(-0.55));
    }
  }

  private prop(p: Prop, sx: (x: number) => number, sy: (y: number) => number, s: number) {
    const ctx = this.ctx;
    if (p.type === 'hurdle' || p.type === 'pole') {
      const t = p.rb.translation(), a = p.rb.rotation();
      ctx.save();
      ctx.translate(sx(t.x), sy(t.y));
      ctx.rotate(-a);
      const hw = 0.035 * s, hh = (p.h / 2) * s;
      const bands = p.type === 'pole' ? 6 : 3;
      for (let i = 0; i < bands; i++) {
        ctx.fillStyle = i % 2 ? '#f4f1e6' : p.type === 'pole' ? '#c8372d' : '#2a6fdb';
        ctx.fillRect(-hw, -hh + (i * 2 * hh) / bands, hw * 2, (2 * hh) / bands + 1);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 0.012 * s;
      ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
      if (p.type === 'pole') {
        ctx.fillStyle = '#d9a441';
        ctx.beginPath(); ctx.arc(0, -hh, hw * 1.3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    } else if (p.type === 'seesaw') {
      const [px, py] = p.pivot;
      ctx.fillStyle = '#3a2a4a';
      ctx.beginPath();
      ctx.moveTo(sx(px - 0.35), sy(0)); ctx.lineTo(sx(px + 0.35), sy(0)); ctx.lineTo(sx(px), sy(py - 0.05)); ctx.closePath();
      ctx.fill();
      const t = p.rb.translation(), a = p.rb.rotation();
      ctx.save();
      ctx.translate(sx(t.x), sy(t.y));
      ctx.rotate(-a);
      const hl = (p.len / 2) * s, hh = 0.065 * s;
      ctx.fillStyle = '#c98b4a';
      ctx.fillRect(-hl, -hh, hl * 2, hh * 2);
      ctx.fillStyle = '#f2c230'; // contact zones
      ctx.fillRect(-hl, -hh, hl * 0.3, hh * 2);
      ctx.fillRect(hl * 0.7, -hh, hl * 0.3, hh * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 0.015 * s;
      ctx.strokeRect(-hl, -hh, hl * 2, hh * 2);
      ctx.restore();
    } else if (p.type === 'finish') {
      const x = sx(p.x);
      ctx.fillStyle = '#d9a441';
      ctx.fillRect(x - 0.05 * s, sy(3.2), 0.1 * s, 3.2 * s);
      const sq = 0.2 * s;
      for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) {
        ctx.fillStyle = (r + c) % 2 ? '#1d1b2e' : '#f4f1e6';
        ctx.fillRect(x + 0.05 * s + c * sq, sy(3.2) + r * sq, sq, sq);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x - 0.02 * s, sy(0), 0.04 * s, 0.6 * s);
      ctx.fillStyle = '#f4f1e6';
      ctx.font = `700 ${Math.round(0.36 * s)}px Fraunces, Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.fillText('FINISH', x, sy(3.4));
    }
  }

  private tunnelBack(p: Extract<Prop, { type: 'tunnel' }>, sx: (x: number) => number, sy: (y: number) => number, s: number) {
    const ctx = this.ctx;
    ctx.fillStyle = '#1e4f9e';
    ctx.fillRect(sx(p.x0), sy(p.y + 0.24), (p.x1 - p.x0) * s, (p.y + 0.24) * s);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let x = p.x0 + 0.5; x < p.x1; x += 0.6) ctx.fillRect(sx(x), sy(p.y + 0.24), 0.05 * s, (p.y + 0.24) * s);
  }

  private tunnelFront(p: Extract<Prop, { type: 'tunnel' }>, sx: (x: number) => number, sy: (y: number) => number, s: number) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(42,111,219,0.38)';
    ctx.fillRect(sx(p.x0), sy(p.y), (p.x1 - p.x0) * s, p.y * s);
    ctx.fillStyle = '#2a6fdb';
    ctx.fillRect(sx(p.x0), sy(p.y + 0.24), (p.x1 - p.x0) * s, 0.24 * s);
    ctx.fillStyle = '#f2c230';
    for (let x = p.x0; x <= p.x1 + 0.01; x += 1.2) ctx.fillRect(sx(x) - 0.05 * s, sy(p.y + 0.24), 0.1 * s, 0.24 * s);
  }

  private items(key: object, strokes: { pts: [number, number][]; color: string; w: number }[]): InkItem[] {
    let it = this.paths.get(key);
    if (!it) {
      it = strokes.map((st) => ({ path: strokePath(st.pts.map(([x, y]) => [x * L, y * L]), st.w * L), color: st.color }));
      this.paths.set(key, it);
    }
    return it;
  }

  private creature(c: Creature, sx: (x: number) => number, sy: (y: number) => number, s: number, now: number, alpha: number) {
    const ctx = this.ctx, look = this.looks[c.idx];
    const k = s * PX;
    look.squash *= 0.86;
    const t = this.race.time;
    // Wake-up during the countdown: eyes shut, then a stretch and a blink.
    const wake = t < -1.6 ? 0 : t < -1.2 ? (t + 1.6) / 0.4 : 1;
    const stretch = t > -1.6 && t < -0.8 ? Math.sin(((t + 1.6) / 0.8) * Math.PI) * 0.12 : 0;
    const fade = c.eliminatedAt !== null ? 0.3 : 1;
    ctx.globalAlpha = alpha * fade;

    const edge = 7;
    for (const part of c.limbs) {
      const p = part.rb.translation();
      ctx.setTransform(k, 0, 0, -k, sx(p.x), sy(p.y));
      ctx.rotate(part.rb.rotation());
      paintInk(ctx, this.items(part, part.strokes), edge);
    }
    const p = c.body.rb.translation();
    ctx.setTransform(k, 0, 0, -k, sx(p.x), sy(p.y));
    ctx.rotate(c.body.rb.rotation());
    const sq = look.squash + stretch;
    ctx.scale(1 + sq * 0.6, 1 - sq + stretch * 1.6);
    const body = c.body.strokes[0];
    if (c.anatomy.body.closed) fillWash(ctx, body.pts.map(([x, y]) => [x * L, y * L]), body.color, 0.2);
    paintInk(ctx, this.items(c.body, c.body.strokes), edge);

    if (now / 1000 > look.nextBlink) { look.blinkAt = now / 1000; look.nextBlink = now / 1000 + 2 + Math.random() * 4; }
    const sinceBlink = now / 1000 - look.blinkAt;
    const blink = sinceBlink < 0.14 ? Math.abs(sinceBlink - 0.07) / 0.07 : 1;
    for (const e of c.eyes) googlyEye(ctx, e.c[0] * L, e.c[1] * L, e.r * L, e.px * L, e.py * L, Math.min(blink, wake));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  // Pulses at the creature's ideal tapping speed (PRD §8).
  private rhythmRing(c: Creature, sx: (x: number) => number, sy: (y: number) => number, s: number, now: number) {
    if (c.done || this.race.time < 0) return;
    const ctx = this.ctx;
    const phase = ((now / 1000) * c.idealRate) % 1;
    const p = c.pos;
    ctx.beginPath();
    ctx.arc(sx(p.x), sy(p.y), (c.radius + 0.12 + phase * 0.12) * s, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,236,170,${0.32 * (1 - phase)})`;
    ctx.lineWidth = 0.035 * s;
    ctx.stroke();
  }

  private particlesStep(sx: (x: number) => number, sy: (y: number) => number, s: number, dt: number) {
    const ctx = this.ctx;
    this.particles = this.particles.filter((p) => (p.life += dt) < p.max);
    for (const p of this.particles) {
      const f = p.life / p.max;
      if (p.kind === 'ring') {
        ctx.beginPath();
        ctx.arc(sx(p.x), sy(p.y), (p.r + f * 0.5) * s, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,${0.6 * (1 - f)})`;
        ctx.lineWidth = 0.04 * s;
        ctx.stroke();
        continue;
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'confetti') { p.vy -= 3 * dt; p.vx *= 0.99; } else { p.vy *= 0.92; p.vx *= 0.92; }
      ctx.globalAlpha = 1 - f;
      ctx.fillStyle = p.color;
      if (p.kind === 'confetti') ctx.fillRect(sx(p.x), sy(p.y), p.r * s, p.r * s * 0.6);
      else { ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), p.r * s * (1 + f), 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
  }

  private speedLines(c: Creature, sx: (x: number) => number, sy: (y: number) => number, s: number, now: number) {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 0.02 * s;
    for (let i = 0; i < 5; i++) {
      const y = c.pos.y + ((i * 0.37 + now / 900) % 1 - 0.5) * c.radius * 2;
      const x = c.pos.x - c.radius - 0.2 - (i % 2) * 0.3;
      ctx.beginPath(); ctx.moveTo(sx(x), sy(y)); ctx.lineTo(sx(x - 0.8), sy(y)); ctx.stroke();
    }
  }

  // Name tag plus a marker colour, so you can tell creatures apart without relying on ink colour.
  private tag(c: Creature, sx: (x: number) => number, sy: (y: number) => number, s: number) {
    const ctx = this.ctx;
    const p = c.pos;
    const x = sx(p.x), y = sy(p.y + c.radius + 0.3);
    if (x < -100 || x > this.W + 100) return;
    const me = c.idx === this.race.player;
    if (!me && !c.solid && !c.ghost) return; // still stacked on the start line
    ctx.font = `${me ? 700 : 600} ${Math.round((me ? 0.26 : 0.2) * s)}px "Bricolage Grotesque", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    const label = me ? 'YOU' : c.ghost ? `👻 ${c.name}` : c.name;
    ctx.globalAlpha = me ? 1 : 0.75;
    ctx.fillStyle = markerColor(c.idx);
    ctx.beginPath();
    ctx.moveTo(x, y + 0.14 * s); ctx.lineTo(x - 0.09 * s, y); ctx.lineTo(x + 0.09 * s, y); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(label.length > 22 ? label.slice(0, 21) + '…' : label, x, y - 0.06 * s);
    ctx.globalAlpha = 1;
  }
}
