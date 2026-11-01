import { type Anatomy, type Stroke, analyze } from './analyze';
import { sfx, unlock } from './audio';
import { INKS, INK_NAMES } from './course';
import { KINDS, stats } from './creature';
import { FEATURES, type Feature, type Score } from './score';
import { canonical, THICK, THIN } from './drawing';
import { type Pt, dist } from './geom';
import { strokePath } from './ink';
import { RacePreview } from './preview';
import { FAINT, INK, LINE, MONO, PAPER, SANS, TEXT, drawPreview } from './render';

// The drawing sheet. You draw straight onto the same white sheet the race
// runs on; the strip below brings the drawing to life as you go, with the
// race's own physics, pace and settings, so it never shows anything the race
// won't do.

export const PAD = 600;
export const DRAW_TIMES = [20, 30, 60]; // Quick, Normal, Careful: seconds from the first stroke
export const DRAW_TIME = 30;
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export interface PadResult { strokes: Stroke[]; anatomy: Anatomy; name: string }
export interface PadOptions { initial?: Stroke[]; name?: string; title?: string; action?: string; time?: number }

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
  private color = INKS[0];
  private thick = false;
  private raf = 0;
  private readout: HTMLElement;
  private bar: HTMLElement;
  private clock: HTMLElement;
  private nameInput: HTMLInputElement;
  private startedAt: number | null = null;
  private time: number;
  private submitted = false;
  private live: RacePreview | null = null;
  private camX = 0;
  private last = 0;

  constructor(private onDone: (r: PadResult) => void, opts: PadOptions = {}) {
    this.time = opts.time ?? DRAW_TIME;
    this.el = document.createElement('div');
    this.el.className = 'pad-screen';
    this.el.innerHTML = `
      <div class="sheet-head">
        <span class="mono label">${opts.title ?? 'DWG 01 — CREATURE'}</span>
        <span class="mono clock" aria-label="Seconds left">${mmss(this.time)}</span>
      </div>
      <div class="timebar" aria-hidden="true"><i></i></div>
      <div class="sheet-wrap"><canvas class="pad" aria-label="Drawing sheet: draw your creature here"></canvas></div>
      <section class="preview" aria-label="Live preview">
        <canvas class="stage" aria-hidden="true"></canvas>
        <div class="readout" role="status"></div>
      </section>
      <div class="tools">
        <div class="inks" role="radiogroup" aria-label="Ink">${INKS.map((c, i) => `<button class="ink${i === 0 ? ' on' : ''}" data-ink="${c}" style="--c:${c}" role="radio" aria-checked="${i === 0}" aria-label="${INK_NAMES[i]}"></button>`).join('')}</div>
        <button class="tool width" aria-label="Pen width" aria-pressed="false"><span class="nib"></span></button>
        <span class="sep"></span>
        <button class="tool undo" aria-label="Undo"><svg viewBox="0 0 24 24"><path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 0 12h-2" transform="translate(0 -3)"/></svg></button>
        <button class="tool clear" aria-label="Clear"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </div>
      <div class="done-row">
        <input class="name" maxlength="22" placeholder="Name it" autocomplete="off" spellcheck="false" aria-label="Creature name">
        <button class="btn primary done">${opts.action ?? 'Race'} <span aria-hidden="true">→</span></button>
      </div>`;
    this.canvas = this.el.querySelector('.pad')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.stage = this.el.querySelector('.stage')!;
    this.sctx = this.stage.getContext('2d')!;
    this.readout = this.el.querySelector('.readout')!;
    this.bar = this.el.querySelector('.timebar i')!;
    this.clock = this.el.querySelector('.clock')!;
    this.nameInput = this.el.querySelector('.name')!;
    this.nameInput.value = opts.name ?? '';
    this.strokes = (opts.initial ?? []).map((s) => ({ ...s, pts: s.pts.map((p): Pt => [p[0], p[1]]) }));

    this.el.querySelectorAll<HTMLButtonElement>('.ink').forEach((b) => b.addEventListener('click', () => {
      this.color = b.dataset.ink!;
      this.el.querySelectorAll('.ink').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
      sfx.click();
    }));
    const widthBtn = this.el.querySelector<HTMLButtonElement>('.width')!;
    widthBtn.addEventListener('click', () => { this.thick = !this.thick; widthBtn.classList.toggle('thick', this.thick); widthBtn.setAttribute('aria-pressed', String(this.thick)); sfx.click(); });
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


  // Lets a room end the drawing phase for everyone.
  forceDone() { if (this.anatomy) this.done(); }

  private toPad(e: PointerEvent): Pt {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * PAD, ((e.clientY - r.top) / r.height) * PAD];
  }

  private down(e: PointerEvent) {
    if (this.submitted) return;
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
    navigator.vibrate?.(6);
    const before = this.anatomy?.kind;
    this.changed();
    if (this.anatomy && this.anatomy.kind !== before) sfx.blink();
    else sfx.pluck();
  }

  // Re-read the drawing and bring the new version to life in the strip below.
  private changed() {
    const a = (this.anatomy = analyze(canonical(this.strokes)));
    if (!this.strokes.length) this.readout.innerHTML = '<span class="kind muted">Waiting for ink</span>';
    else if (!a) this.readout.innerHTML = '<span class="kind muted">Draw a body</span>';
    else {
      const k = KINDS[a.kind], s = stats(a);
      const sc = s.score, pc = (v: number) => String(Math.round(v * 100)).padStart(2, '0');
      this.readout.innerHTML = `<span class="kind">${k.label} — ${k.verb}</span><span class="form mono" title="Score: movement design and craftsmanship. A higher score runs faster.">SCORE ${pc(sc.total)}</span><p class="blurb">${k.blurb}</p><p class="split mono"><span title="Proportions that help it move">MOVE ${pc(sc.form)}</span><span title="A joined-up creature with a face and details">CRAFT ${pc(sc.craft)}</span><span class="tip">${hint(sc)}</span></p>`;
    }
    if (a) {
      this.live = new RacePreview(a);
      this.camX = 0;
    } else this.live = null;
  }

  private tickTimer(now: number) {
    const left = this.startedAt === null ? this.time : Math.max(0, this.time - (now - this.startedAt) / 1000);
    this.bar.style.transform = `scaleX(${left / this.time})`;
    this.el.classList.toggle('low', left <= 5 && this.startedAt !== null);
    this.clock.textContent = mmss(Math.ceil(left));
    if (left > 0 || this.current || this.submitted) return;
    if (this.anatomy) this.done();
  }

  private done() {
    unlock();
    if (!this.anatomy) { this.readout.classList.remove('nudge'); void this.readout.offsetWidth; this.readout.classList.add('nudge'); return; }
    if (this.submitted) return;
    this.submitted = true;
    this.el.classList.add('submitted');
    sfx.click();
    this.onDone({ strokes: this.strokes, anatomy: this.anatomy, name: this.nameInput.value.trim().slice(0, 22) });
  }

  private render(now: number) {
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    this.tickTimer(now);
    this.renderSheet(now);
    this.renderStage(dt);
  }

  private renderSheet(now: number) {
    const c = this.canvas, ctx = this.ctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.round(c.clientWidth * dpr);
    if (!size) return;
    if (c.width !== size) c.width = c.height = size;
    const k = size / PAD;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, PAD, PAD);
    const px = 1 / k;
    for (let i = 20; i < PAD; i += 20) {
      ctx.fillStyle = i % 100 ? FAINT : '#e0e3e7';
      ctx.fillRect(i, 0, px, PAD);
      ctx.fillRect(0, i, PAD, px);
    }
    ctx.strokeStyle = '#8d939c'; ctx.lineWidth = px; ctx.strokeRect(12, 12, PAD - 24, PAD - 24);
    ctx.strokeStyle = LINE; ctx.lineWidth = 0.8 * px; ctx.strokeRect(17, 17, PAD - 34, PAD - 34);
    ctx.fillStyle = TEXT;
    ctx.font = `500 11px ${MONO}`;
    ctx.textAlign = 'right';
    ctx.fillText('RACES THIS WAY  →', PAD - 30, 38);
    // A small title block, as on any sheet.
    ctx.strokeStyle = LINE; ctx.lineWidth = px;
    ctx.strokeRect(PAD - 186, PAD - 58, 169, 41);
    ctx.fillRect(PAD - 186, PAD - 38, 169, px);
    ctx.textAlign = 'left';
    ctx.fillStyle = INK; ctx.font = `600 10px ${MONO}`;
    ctx.fillText('SQUIGGLE CUP', PAD - 178, PAD - 44);
    ctx.fillStyle = TEXT; ctx.font = `500 9px ${MONO}`;
    ctx.fillText('SCALE  NTS      SHEET  A1', PAD - 178, PAD - 24);

    if (!this.strokes.length && !this.current) {
      ctx.textAlign = 'center';
      ctx.fillStyle = INK;
      ctx.font = `600 34px ${SANS}`;
      ctx.fillText('Draw a creature', PAD / 2, PAD / 2 - 8);
      ctx.fillStyle = TEXT;
      ctx.font = `500 15px ${SANS}`;
      ctx.fillText('Body first. Then legs, wings, whatever.', PAD / 2, PAD / 2 + 24);
    }

    // Pen ink, settling as it dries.
    const all = this.current ? [...this.strokes, this.current] : this.strokes;
    for (const s of all) {
      const age = now - (this.ended.get(s) ?? now);
      const wet = s === this.current ? 1 : Math.max(0, 1 - age / 650);
      const path = strokePath(s.pts, s.w * (1 + 0.12 * wet), wet > 0 ? undefined : s, s !== this.current);
      ctx.globalAlpha = 1 - 0.22 * wet;
      ctx.fillStyle = s.color;
      ctx.fill(path);
    }
    ctx.globalAlpha = 1;
  }

  // The living preview: the race's physics and pace on one lane of the sheet.
  private renderStage(dt: number) {
    const c = this.stage, ctx = this.sctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const live = this.live;
    if (live) {
      if (live.advance(dt)) this.camX = 0;
      this.camX += (live.race.playerRacer!.x - this.camX) * Math.min(1, dt * 4);
    }
    const racer = live?.race.playerRacer;
    drawPreview(ctx, w, h, racer ? { body: racer.body, anatomy: racer.anatomy, size: racer.s.size, t: live!.race.time } : null, racer?.restY ?? 0, this.camX, dpr);
  }
}

// The single most useful next step for a better (faster) drawing.
function hint(sc: Score): string {
  if (sc.cohesion < 0.7) return 'Join the loose bits to the body.';
  if (!sc.face.eyes) return 'Give it eyes.';
  if (!sc.face.forward) return 'Face it the way it runs →';
  if (!sc.face.mouth) return 'Add a mouth.';
  const next = (['head', 'tail', 'crest', 'markings'] as Feature[]).find((f) => !sc.features.includes(f));
  if (next) return `Try adding ${FEATURES[next]}.`;
  return sc.form < 0.8 ? 'Tune its proportions for its kind.' : 'Beautifully made.';
}
