import { type Anatomy, type Stroke, analyze } from './analyze';
import { sfx, unlock } from './audio';
import { Body } from './body';
import { KINDS, stats } from './creature';
import { type Pt, dist } from './geom';
import { strokePath } from './ink';
import { flatCourse, paintCreature, wall } from './render';
import type { Venue } from './venues/ochre';

// PRD §6.1–6.2, Ochre edition. You paint straight onto the cave wall; the
// strip below brings your painting to life as you go, using the same physics
// it will race with.

export const PAD = 600;
export const DRAW_TIME = 20; // seconds, from the first stroke; then the drawing submits itself
const THIN = 9, THICK = 16;

export interface PadResult { strokes: Stroke[]; anatomy: Anatomy; name: string }

export class Pad {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private stage: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private strokes: Stroke[] = [];
  private ended = new WeakMap<Stroke, number>();
  private current: Stroke | null = null;
  private anatomy: Anatomy | null = null;
  private color: string;
  private thick = false;
  private raf = 0;
  private chip: HTMLElement;
  private meter: HTMLElement;
  private clock: HTMLElement;
  private nameInput: HTMLInputElement;
  private startedAt: number | null = null;
  private submitted = false;
  private nagged = false;
  private live: { body: Body; anatomy: Anatomy; size: number } | null = null;
  private course = flatCourse();
  private last = 0;

  constructor(venue: Venue, private onDone: (r: PadResult) => void, initial: Stroke[] = [], name = '') {
    this.color = venue.inks[0];
    this.el = document.createElement('div');
    this.el.className = 'pad-screen';
    this.el.innerHTML = `
      <div class="wall-wrap">
        <canvas class="pad" aria-label="Cave wall: draw your creature here"></canvas>
        <div class="timer"><div class="meter" aria-label="Time left"><div class="meter-fill"></div></div><span class="secs">${DRAW_TIME}</span></div>
      </div>
      <div class="alive">
        <canvas class="stage" aria-hidden="true"></canvas>
        <div class="chip" role="status"></div>
      </div>
      <div class="tools">
        <div class="pens">${venue.inks.map((c, i) => `<button class="pen${i === 0 ? ' on' : ''}" data-ink="${c}" style="--c:${c}" aria-label="Pigment ${i + 1}"></button>`).join('')}
          <button class="width" aria-label="Brush width"><span></span></button>
        </div>
        <div class="edit">
          <button class="icon undo" aria-label="Undo">↶</button>
          <button class="icon clear" aria-label="Clear">✕</button>
        </div>
      </div>
      <div class="done-row">
        <input class="name" maxlength="24" placeholder="Name it (optional)" autocomplete="off" spellcheck="false">
        <button class="pebble primary done">Wake it</button>
      </div>`;
    this.canvas = this.el.querySelector('.pad')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.stage = this.el.querySelector('.stage')!;
    this.sctx = this.stage.getContext('2d')!;
    this.chip = this.el.querySelector('.chip')!;
    this.meter = this.el.querySelector('.meter-fill')!;
    this.clock = this.el.querySelector('.secs')!;
    this.nameInput = this.el.querySelector('.name')!;
    this.nameInput.value = name;
    this.strokes = initial.map((s) => ({ ...s, pts: s.pts.map((p): Pt => [p[0], p[1]]) }));

    this.el.querySelectorAll<HTMLButtonElement>('.pen').forEach((b) => b.addEventListener('click', () => {
      this.color = b.dataset.ink!;
      this.el.querySelectorAll('.pen').forEach((x) => x.classList.toggle('on', x === b));
      sfx.click();
    }));
    const widthBtn = this.el.querySelector<HTMLButtonElement>('.width')!;
    widthBtn.addEventListener('click', () => { this.thick = !this.thick; widthBtn.classList.toggle('thick', this.thick); sfx.click(); });
    this.el.querySelector('.undo')!.addEventListener('click', () => { this.strokes.pop(); this.changed(); sfx.click(); });
    this.el.querySelector('.clear')!.addEventListener('click', () => { this.strokes = []; this.changed(); sfx.click(); });
    this.el.querySelector('.done')!.addEventListener('click', () => this.done());

    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', () => this.up());
    this.canvas.addEventListener('pointercancel', () => this.up());
    this.changed();
  }

  mount(parent: HTMLElement) {
    parent.appendChild(this.el);
    const loop = (t: number) => { this.render(t); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.el.remove();
  }

  private toPad(e: PointerEvent): Pt {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * PAD, ((e.clientY - r.top) / r.height) * PAD];
  }

  private down(e: PointerEvent) {
    unlock();
    this.startedAt ??= performance.now();
    this.canvas.setPointerCapture(e.pointerId);
    this.current = { pts: [this.toPad(e)], color: this.color, w: this.thick ? THICK : THIN };
  }

  private move(e: PointerEvent) {
    if (!this.current) return;
    for (const ev of e.getCoalescedEvents?.() ?? [e]) {
      const p = this.toPad(ev);
      const pts = this.current.pts;
      if (dist(pts[pts.length - 1], p) >= 2) pts.push(p);
    }
  }

  private up() {
    if (!this.current) return;
    this.strokes.push(this.current);
    this.ended.set(this.current, performance.now());
    this.current = null;
    navigator.vibrate?.(8);
    const before = this.anatomy?.kind;
    this.changed();
    if (this.anatomy && this.anatomy.kind !== before) sfx.blink();
    else sfx.pluck();
  }

  // Re-read the drawing and bring the new version to life in the strip below.
  private changed() {
    const a = (this.anatomy = analyze(this.strokes));
    if (!this.strokes.length) this.chip.textContent = 'Paint a creature on the wall';
    else if (!a) this.chip.textContent = 'Paint a body!';
    else {
      const k = KINDS[a.kind];
      this.chip.innerHTML = `<b>${k.icon} ${k.label}</b> — ${k.verb} · <span>${k.blurb}</span>`;
    }
    if (a) {
      const s = stats(a);
      const body = new Body(a, s.size, { kind: a.kind, vTarget: s.vTarget });
      body.place(this.live?.body.x ?? 0, this.course);
      this.live = { body, anatomy: a, size: s.size };
    } else this.live = null;
  }

  private tickTimer(now: number) {
    const left = this.startedAt === null ? DRAW_TIME : Math.max(0, DRAW_TIME - (now - this.startedAt) / 1000);
    this.meter.style.transform = `scaleX(${left / DRAW_TIME})`;
    this.meter.parentElement!.classList.toggle('low', left <= 5);
    this.clock.textContent = String(Math.ceil(left));
    if (left > 0 || this.current || this.submitted) return;
    if (this.anatomy) this.done();
    else if (!this.nagged) { this.nagged = true; this.flashChip('Time! Paint a body!'); }
  }

  private flashChip(text: string) {
    this.chip.textContent = text;
    this.chip.classList.remove('shake');
    void this.chip.offsetWidth;
    this.chip.classList.add('shake');
    setTimeout(() => this.changed(), 1200);
  }

  private done() {
    unlock();
    if (!this.anatomy) { this.flashChip('Paint a body!'); return; }
    if (this.submitted) return;
    this.submitted = true;
    sfx.click();
    this.onDone({ strokes: this.strokes, anatomy: this.anatomy, name: this.nameInput.value.trim().slice(0, 24) });
  }

  private render(now: number) {
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    this.tickTimer(now);
    this.renderWall(now);
    this.renderStage(now, dt);
  }

  private renderWall(now: number) {
    const c = this.canvas, ctx = this.ctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.round(c.clientWidth * dpr);
    if (c.width !== size) c.width = c.height = size;
    const k = size / PAD;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.drawImage(wall(), 120, 40, 600, 600, 0, 0, PAD, PAD);
    // Firelight on the wall, breathing.
    const f = 1 + 0.03 * Math.sin(now / 170) + 0.02 * Math.sin(now / 53);
    const g = ctx.createRadialGradient(PAD * 0.5, PAD * 0.55, 30, PAD * 0.5, PAD * 0.5, PAD * 0.75 * f);
    g.addColorStop(0, 'rgba(255,179,71,0.16)');
    g.addColorStop(0.6, 'rgba(40,22,12,0.15)');
    g.addColorStop(1, 'rgba(18,10,6,0.75)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, PAD, PAD);

    ctx.fillStyle = 'rgba(239,230,216,0.55)';
    ctx.font = '600 20px Fraunces, Georgia, serif';
    ctx.textAlign = 'right';
    ctx.fillText('it runs this way →', PAD - 24, 42);
    if (!this.strokes.length && !this.current) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(239,230,216,0.5)';
      ctx.font = 'italic 600 44px Fraunces, Georgia, serif';
      ctx.fillText('Paint a creature.', PAD / 2, PAD / 2 - 6);
      ctx.font = '500 19px "Instrument Sans", system-ui, sans-serif';
      ctx.fillText('a body, some legs, wings if it flies', PAD / 2, PAD / 2 + 32);
    }

    // Pigment: a soft bleed into the stone, then the paint.
    const all = this.current ? [...this.strokes, this.current] : this.strokes;
    for (const s of all) {
      const path = strokePath(s.pts, s.w, s === this.current ? undefined : s, s !== this.current);
      const age = now - (this.ended.get(s) ?? now);
      const wet = s === this.current ? 1 : Math.max(0, 1 - age / 400);
      ctx.globalAlpha = 0.2 + 0.1 * wet;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 8;
      ctx.lineJoin = 'round';
      ctx.stroke(path);
      ctx.globalAlpha = 0.86 + 0.1 * wet;
      ctx.fillStyle = s.color;
      ctx.fill(path);
    }
    ctx.globalAlpha = 1;
    for (const e of this.anatomy?.eyes ?? []) {
      ctx.fillStyle = '#1d1a19';
      ctx.beginPath(); ctx.arc(e.c[0], e.c[1], Math.max(5, e.r * 0.55), 0, Math.PI * 2); ctx.fill();
    }
  }

  // The living preview: the creature on a loop of cave floor.
  private renderStage(now: number, dt: number) {
    const c = this.stage, ctx = this.sctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const tex = wall();
    const s = h / 1.9; // px per metre: about 1.9 m of height in view
    const live = this.live;
    const camX = live ? live.body.x : 0;
    const tw = tex.width * (s / 160);
    const off = ((camX * s * 0.6) % tw + tw) % tw;
    for (let x = -off; x < w; x += tw) ctx.drawImage(tex, x, 0, tw, tex.height * (s / 160));
    const floor = h * 0.82;
    ctx.fillStyle = '#4a3527';
    ctx.fillRect(0, floor, w, h - floor);
    ctx.fillStyle = 'rgba(240,220,190,0.35)';
    ctx.fillRect(0, floor, w, 2 * dpr);
    // Floor marks scroll by so you can see it move.
    ctx.fillStyle = 'rgba(20,12,8,0.35)';
    const step = 0.5 * s;
    for (let x = -((camX * s) % step); x < w; x += step) ctx.fillRect(x, floor + 6 * dpr, 3 * dpr, 6 * dpr);
    if (live) {
      const b = live.body;
      for (let t = 0; t < dt; t += 1 / 240) b.step(1 / 240, this.course, 0.8);
      if (b.x > 1e4) b.place(0, this.course);
      paintCreature(ctx, { body: b, anatomy: live.anatomy, size: live.size, t: now / 1000 }, w * 0.45 + (b.x - camX) * s, floor - b.y * s, s);
    }
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(18,10,6,0.85)');
    g.addColorStop(0.2, 'rgba(18,10,6,0)');
    g.addColorStop(0.8, 'rgba(18,10,6,0)');
    g.addColorStop(1, 'rgba(18,10,6,0.85)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}
