import { type Anatomy, type Kind, type Stroke, analyze, kindsFor, withKind } from './analyze';
import { sfx, unlock } from './audio';
import { INKS, INK_NAMES } from './course';
import { KINDS, stats } from './creature';
import { FEATURES, type Feature, type Score } from './score';
import { canonical, THICK, THIN } from './drawing';
import { type Pt, dist, distToSeg } from './geom';
import { strokePath } from './ink';
import { RacePreview } from './preview';
import { FAINT, INK, LINE, MONO, PAPER, SANS, TEXT, drawPreview } from './render';

// The drawing sheet. You draw straight onto the same white sheet the race
// runs on; the strip below brings the drawing to life as you go, with the
// race's own physics, pace and settings, so it never shows anything the race
// won't do.
//
// The eraser takes away only the ink it passes over, cutting a stroke in two
// where it crosses the middle. Undo steps back through every change: a
// stroke, an erase, a clear.

export const PAD = 600;
export const DRAW_TIMES = [20, 30, 60]; // Quick, Normal, Careful: seconds from the first stroke
export const DRAW_TIME = 30;
const ERASER = 14; // eraser radius, pad px
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export interface PadResult { strokes: Stroke[]; anatomy: Anatomy; name: string; pick: Kind | null }
export interface PadOptions { initial?: Stroke[]; pick?: Kind | null; name?: string; title?: string; action?: string; time?: number }

export class Pad {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private stage: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private strokes: Stroke[] = [];
  private ended = new WeakMap<Stroke, number>();
  private current: Stroke | null = null;
  private past: Stroke[][] = [];      // undo history: the strokes before each change
  private erasing = false;            // the eraser is the tool
  private rubbing: Pt | null = null;  // where the eraser was last, while it's down
  private rubbed: Stroke[] | null = null; // the strokes before this erase began
  private eraserAt: Pt | null = null; // the eraser's outline on the sheet
  private anatomy: Anatomy | null = null;
  private read: Anatomy | null = null; // the drawing as it reads, before the player's pick
  private pick: Kind | null = null;    // the kind the player chose instead
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
        <button class="tool eraser" aria-label="Eraser" aria-pressed="false"><svg viewBox="0 0 24 24"><path d="M15.5 4.5 20 9l-9 9H6.5L4 15.5z M10 10l4.5 4.5 M11 18h9"/></svg></button>
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
    for (const st of this.strokes) this.ended.set(st, 0);
    this.pick = opts.pick ?? null;
    const eraserBtn = this.el.querySelector<HTMLButtonElement>('.eraser')!;
    const tool = (erase: boolean) => { this.erasing = erase; eraserBtn.classList.toggle('on', erase); eraserBtn.setAttribute('aria-pressed', String(erase)); this.canvas.classList.toggle('erasing', erase); };
    eraserBtn.addEventListener('click', () => { tool(!this.erasing); sfx.click(); });

    this.el.querySelectorAll<HTMLButtonElement>('.ink').forEach((b) => b.addEventListener('click', () => {
      this.color = b.dataset.ink!;
      tool(false);
      this.el.querySelectorAll('.ink').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
      sfx.click();
    }));
    const widthBtn = this.el.querySelector<HTMLButtonElement>('.width')!;
    widthBtn.addEventListener('click', () => { tool(false); this.thick = !this.thick; widthBtn.classList.toggle('thick', this.thick); widthBtn.setAttribute('aria-pressed', String(this.thick)); sfx.click(); });
    this.el.querySelector('.undo')!.addEventListener('click', () => { if (this.past.length) { this.strokes = this.past.pop()!; this.changed(); } sfx.click(); });
    this.el.querySelector('.clear')!.addEventListener('click', () => { if (this.strokes.length) { this.past.push(this.strokes); this.strokes = []; this.changed(); } sfx.click(); });
    // The kind chip: tap to try the other kinds this drawing can move as.
    this.readout.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('.pick') || !this.read || !this.anatomy) return;
      const kinds = kindsFor(this.read);
      const next = kinds[(kinds.indexOf(this.anatomy.kind) + 1) % kinds.length];
      this.pick = next === this.read.kind ? null : next;
      this.changed();
      sfx.blink();
    });
    this.el.querySelector('.done')!.addEventListener('click', () => this.done());

    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', () => this.up());
    this.canvas.addEventListener('pointercancel', () => this.up());
    this.canvas.addEventListener('pointerleave', () => { if (!this.rubbing) this.eraserAt = null; });
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
    if (this.erasing) {
      this.rubbed = this.strokes;
      this.rubbing = this.eraserAt = this.toPad(e);
      this.erase(this.rubbing, this.rubbing);
      return;
    }
    this.current = { pts: [this.toPad(e)], color: this.color, w: this.thick ? THICK : THIN };
  }

  private move(e: PointerEvent) {
    if (this.erasing) {
      this.eraserAt = this.toPad(e);
      if (!this.rubbing) return;
      for (const ev of e.getCoalescedEvents?.() ?? [e]) { const p = this.toPad(ev); this.erase(this.rubbing, p); this.rubbing = p; }
      return;
    }
    if (!this.current) return;
    for (const ev of e.getCoalescedEvents?.() ?? [e]) {
      const p = this.toPad(ev);
      const pts = this.current.pts;
      if (dist(pts[pts.length - 1], p) >= 2) pts.push(p);
    }
  }

  // Rubs out the ink within reach of the eraser's path from a to b. A stroke
  // it crosses is cut into the pieces either side; a piece too short to be a
  // line goes too (it would read as a dot, an eye).
  private erase(a: Pt, b: Pt) {
    let hit = false;
    const out: Stroke[] = [];
    for (const st of this.strokes) {
      const reach = ERASER + st.w / 2;
      const gone = st.pts.map((p) => distToSeg(p, a, b) <= reach);
      if (!gone.includes(true)) { out.push(st); continue; }
      hit = true;
      if (st.pts.length === 1) continue;
      let run: Pt[] = [];
      const flush = () => { if (run.length >= 2) { const piece = { ...st, pts: run }; this.ended.set(piece, 0); out.push(piece); } run = []; };
      st.pts.forEach((p, i) => { if (gone[i]) flush(); else run.push(p); });
      flush();
    }
    if (hit) this.strokes = out;
  }

  private up() {
    if (this.rubbing) {
      this.rubbing = null;
      if (this.rubbed && this.rubbed !== this.strokes) { this.past.push(this.rubbed); this.changed(); sfx.pluck(); }
      this.rubbed = null;
      return;
    }
    if (!this.current) return;
    this.past.push(this.strokes);
    this.strokes = [...this.strokes, this.current];
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
    const read = (this.read = analyze(canonical(this.strokes)));
    if (read && this.pick && !kindsFor(read).includes(this.pick)) this.pick = null;
    const a = (this.anatomy = read && withKind(read, this.pick));
    if (!this.strokes.length) this.readout.innerHTML = '<span class="kind muted">Waiting for ink</span>';
    else if (!a) this.readout.innerHTML = '<span class="kind muted">Draw a body</span>';
    else {
      const k = KINDS[a.kind], s = stats(a);
      const sc = s.score, pc = (v: number) => String(Math.round(v * 100)).padStart(2, '0');
      const choice = kindsFor(read!).length > 1;
      const label = `${k.label} — ${k.verb}`;
      this.readout.innerHTML = `${choice ? `<button type="button" class="kind pick" title="Not right? Tap to change what it is">${label}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h13l-3-3M20 15H7l3 3"/></svg></button>` : `<span class="kind">${label}</span>`}<span class="form mono" title="Score: movement design and craftsmanship. A higher score runs faster.">SCORE ${pc(sc.total)}</span><p class="blurb">${k.blurb}</p><p class="split mono"><span title="Proportions that help it move">MOVE ${pc(sc.form)}</span><span title="A joined-up creature with a face and details">CRAFT ${pc(sc.craft)}</span><span class="tip">${hint(sc)}</span></p>`;
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
    this.onDone({ strokes: this.strokes, anatomy: this.anatomy, name: this.nameInput.value.trim().slice(0, 22), pick: this.pick });
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
    if (this.erasing && this.eraserAt) {
      ctx.beginPath();
      ctx.arc(this.eraserAt[0], this.eraserAt[1], ERASER, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fill();
      ctx.strokeStyle = TEXT; ctx.lineWidth = 1.2 * px;
      ctx.stroke();
    }
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
  if (sc.line < 0.6) return 'Steadier lines score higher. Take your time.';
  const next = (['head', 'tail', 'crest', 'pupils', 'feet', 'neck', 'markings'] as Feature[]).find((f) => !sc.features.includes(f));
  if (next) return `Try adding ${FEATURES[next]}.`;
  return sc.form < 0.9 ? 'Tune its proportions for its kind.' : 'Beautifully made.';
}
