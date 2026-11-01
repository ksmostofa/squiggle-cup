import { type Anatomy, type Stroke, analyze, inkUsed } from './analyze';
import { sfx, unlock } from './audio';
import { type Pt, dist } from './geom';
import { fillWash, googlyEye, paintInk, strokePath } from './ink';
import type { Venue } from './venues/venue';

// PRD §6.1–6.2. The pad is 600×600 logical pixels whatever its size on screen.
export const PAD = 600;
export const INK_BUDGET = 3000;
const THIN = 7, THICK = 14;

export interface PadResult { strokes: Stroke[]; anatomy: Anatomy; name: string }

export class Pad {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private strokes: Stroke[] = [];
  private ended = new WeakMap<Stroke, number>(); // when each stroke was finished, for the wet sheen
  private current: Stroke | null = null;
  private anatomy: Anatomy | null = null;
  private color: string;
  private thick = false;
  private raf = 0;
  private chip: HTMLElement;
  private meter: HTMLElement;
  private nameInput: HTMLInputElement;
  private blinkAt = 0;

  constructor(private venue: Venue, private onDone: (r: PadResult) => void, initial: Stroke[] = [], name = '') {
    this.color = venue.inks[0];
    this.el = document.createElement('div');
    this.el.className = 'pad-screen';
    this.el.innerHTML = `
      <div class="pad-wrap">
        <canvas class="pad" aria-label="Drawing pad"></canvas>
        <div class="chip" role="status"></div>
      </div>
      <div class="meter" aria-label="Ink left"><div class="meter-fill"></div></div>
      <div class="tools">
        <div class="pens">${venue.inks.map((c, i) => `<button class="pen${i === 0 ? ' on' : ''}" data-ink="${c}" style="--c:${c}" aria-label="Ink ${i + 1}"></button>`).join('')}
          <button class="width" aria-label="Pen width"><span></span></button>
        </div>
        <div class="edit">
          <button class="pebble small undo">Undo</button>
          <button class="pebble small clear">Clear</button>
        </div>
      </div>
      <div class="done-row">
        <input class="name" maxlength="24" placeholder="Name (optional)" autocomplete="off" spellcheck="false">
        <button class="pebble primary done">Done</button>
      </div>`;
    this.canvas = this.el.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.chip = this.el.querySelector('.chip')!;
    this.meter = this.el.querySelector('.meter-fill')!;
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

  private get used() { return inkUsed(this.current ? [...this.strokes, this.current] : this.strokes); }

  private down(e: PointerEvent) {
    unlock();
    if (this.used >= INK_BUDGET) { this.flashChip('Out of ink'); return; }
    this.canvas.setPointerCapture(e.pointerId);
    this.current = { pts: [this.toPad(e)], color: this.color, w: this.thick ? THICK : THIN };
  }

  private move(e: PointerEvent) {
    if (!this.current) return;
    const events = e.getCoalescedEvents?.() ?? [e];
    for (const ev of events.length ? events : [e]) {
      const p = this.toPad(ev);
      const pts = this.current.pts;
      if (dist(pts[pts.length - 1], p) < 2) continue;
      pts.push(p);
      if (this.used > INK_BUDGET) { pts.pop(); this.up(); this.flashChip('Out of ink'); return; }
    }
    this.updateMeter();
  }

  private up() {
    if (!this.current) return;
    this.strokes.push(this.current);
    this.ended.set(this.current, performance.now());
    this.current = null;
    navigator.vibrate?.(8);
    const before = this.anatomy;
    this.changed();
    const a = this.anatomy as Anatomy | null;
    if (a && (!before || a.eyes.length > before.eyes.length)) { this.blinkAt = performance.now(); sfx.blink(); }
    else sfx.pluck();
  }

  private changed() {
    this.anatomy = analyze(this.strokes);
    this.updateMeter();
    const a = this.anatomy;
    if (!this.strokes.length) this.chip.textContent = 'Draw something.';
    else if (!a) this.chip.textContent = 'Draw a body!';
    else {
      const n = a.limbs.length, eyes = a.eyes.length;
      this.chip.textContent = [
        a.body.closed ? 'Body ✓' : 'Body (a line)',
        `${n} leg${n === 1 ? '' : 's'}`,
        `${eyes} eye${eyes === 1 ? '' : 's'}`,
      ].join(' · ');
    }
  }

  private updateMeter() {
    const left = Math.max(0, 1 - this.used / INK_BUDGET);
    this.meter.style.transform = `scaleX(${left})`;
    this.meter.parentElement!.classList.toggle('low', left < 0.15);
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
    const a = this.anatomy;
    if (!a) { this.flashChip('Draw a body!'); return; }
    sfx.click();
    this.onDone({ strokes: this.strokes, anatomy: a, name: this.nameInput.value.trim().slice(0, 24) });
  }

  private render(now: number) {
    const c = this.canvas, ctx = this.ctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.round(c.clientWidth * dpr);
    if (c.width !== size) c.width = c.height = size;
    const k = size / PAD;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillStyle = this.venue.pad;
    ctx.fillRect(0, 0, PAD, PAD);

    // Faint venue background: a strip of show carpet and a rosette watermark.
    ctx.fillStyle = 'rgba(47,125,70,0.10)';
    ctx.fillRect(0, 520, PAD, 80);
    ctx.strokeStyle = 'rgba(29,27,46,0.08)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 12]);
    ctx.beginPath(); ctx.moveTo(0, 520); ctx.lineTo(PAD, 520); ctx.stroke();
    ctx.setLineDash([]);

    // Face this way →
    ctx.fillStyle = 'rgba(29,27,46,0.38)';
    ctx.font = '600 22px "Bricolage Grotesque", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Face this way →', PAD - 22, 40);

    if (!this.strokes.length && !this.current) {
      ctx.fillStyle = 'rgba(29,27,46,0.22)';
      ctx.font = '700 54px "Bricolage Grotesque", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Draw something.', PAD / 2, PAD / 2);
      ctx.font = '500 20px "Bricolage Grotesque", system-ui, sans-serif';
      ctx.fillText('a closed body, some legs, a dot for an eye', PAD / 2, PAD / 2 + 40);
    }

    const a = this.anatomy;
    if (a?.body.closed) fillWash(ctx, a.body.pts, a.body.color, 0.22);

    const items = this.strokes.map((s) => ({ path: strokePath(s.pts, s.w, s), color: s.color }));
    if (this.current) items.push({ path: strokePath(this.current.pts, this.current.w, undefined, false), color: this.current.color });
    paintInk(ctx, items, 7);

    // Wet strokes have a sheen that dries in 400 ms.
    for (const s of this.strokes) {
      const age = now - (this.ended.get(s) ?? -1e9);
      if (age < 400) {
        ctx.globalAlpha = 0.45 * (1 - age / 400);
        ctx.fillStyle = '#fff';
        ctx.fill(strokePath(s.pts, s.w, s));
        ctx.globalAlpha = 1;
      }
    }
    if (this.current) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#fff';
      ctx.fill(items[items.length - 1].path);
      ctx.globalAlpha = 1;
    }

    if (a) {
      // Pulsing knuckle dots where limbs join.
      const pulse = 1 + 0.25 * Math.sin(now / 160);
      for (const l of a.limbs) {
        const [x, y] = l.pts[0];
        ctx.beginPath();
        ctx.arc(x, y, 7 * pulse, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, 4.5 * pulse, 0, Math.PI * 2);
        ctx.fillStyle = '#d9a441';
        ctx.fill();
      }
      // Googly eyes blink as soon as they're recognised, then every few seconds.
      const sinceBlink = (now - this.blinkAt) % 3200;
      const open = sinceBlink < 160 ? Math.abs(sinceBlink - 80) / 80 : 1;
      for (const e of a.eyes) {
        const wob = Math.sin(now / 300 + e.c[0]) * e.r * 0.15;
        googlyEye(ctx, e.c[0], e.c[1], e.r, e.r * 0.28 + wob, e.r * 0.12, open);
      }
    }
  }
}
