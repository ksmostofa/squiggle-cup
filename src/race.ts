import type { Anatomy } from './analyze';
import { Body } from './body';
import { type Course, flatCourse } from './course';
import { DT, PROFILES, type Stats, stats } from './creature';

// The race. You draw; your drawing races. Nobody steers: every creature is
// moved by the physics of its own body (body.ts), in its own lane, so how it
// runs, hops, rolls, slithers or flies comes from what was drawn. There is no
// luck: the same drawing runs the same time, every race, on every device.
// The one input is rhythm: tapping on your creature's beat builds a groove
// worth up to MAX_BOOST extra speed. Taps are logged by tick, so drawings +
// tap logs replay any race exactly.

export const COUNTDOWN = 180;  // ticks of 3, 2, 1 (3 s)
export const MAX_TIME = 60;
export const AFTER_FIRST = 12; // seconds the race waits for stragglers once someone wins
export const SUBSTEPS = 4;
export const REACTION = 0.2;   // seconds off the line, the same for everyone
export const MAX_BOOST = 0.12; // a perfect groove: +12% speed, never more
export const WINDOW = 0.12;    // seconds either side of a beat that count as on it
export const BOT_GROOVE = 0.5; // house creatures keep a steady half groove
const GAIN = 0.26, MISS = 0.15, DECAY = 0.28; // groove per hit, per miss, lost per second

// Seconds per beat, matched to how each kind moves.
export const BEAT: Record<Anatomy['kind'], number> = {
  biped: 0.42, quadruped: 0.5, centipede: 0.36, hopper: 0.6, flyer: 0.5,
  roller: 0.46, worm: 0.56, jelly: 0.6, scribble: 0.4,
};

export interface Entry { anatomy: Anatomy; name: string; kind: 'player' | 'rival'; id?: string; bot?: boolean; taps?: number[] }

export type RaceEventType = 'start' | 'finish' | 'photo' | 'hit' | 'miss';
export interface RaceEvent { t: number; type: RaceEventType; who: number; value?: number }

export interface RacerStats { falls: number; airtime: number; topSpeed: number; reachedTop: number | null }

export class Racer {
  body: Body;
  s: Stats;
  finishTime: number | null = null;
  stats: RacerStats = { falls: 0, airtime: 0, topSpeed: 0, reachedTop: null };
  start = REACTION;
  groove = 0;      // 0..1, built by tapping on the beat
  log: number[] = [];   // ticks it was tapped on, the replayable record
  queue: number[] = []; // taps not yet applied, sorted
  lastBeat = -1;
  wasUpside = false;

  constructor(public anatomy: Anatomy, public name: string, public idx: number, public kind: Entry['kind'], public id?: string, public bot = false) {
    this.s = stats(anatomy);
    if (bot) this.groove = BOT_GROOVE;
    this.body = new Body(anatomy, this.s.size, { kind: anatomy.kind, vTarget: this.s.vTarget });
  }

  get x() { return this.body.x; }
  get done() { return this.finishTime !== null; }
  get isPlayer() { return this.kind === 'player'; }
  get beat() { return BEAT[this.anatomy.kind]; }
}

// Pace multiplier t seconds after leaving the line: ease up to cruising
// speed, the same every time. The draw-screen preview calls this too.
export function pace(kind: Anatomy['kind'], t: number): number {
  const p = PROFILES[kind];
  const f = p.ramp > 0 ? Math.min(1, t / p.ramp) : 1;
  return 0.25 + 0.75 * f * (2 - f);
}

export class Race {
  course: Course;
  racers: Racer[];
  tick = 0;
  over = false;
  events: RaceEvent[] = []; // consumers drain this
  finishOrder: number[] = [];
  player: number;

  constructor(public entries: Entry[], public seed = 0) {
    this.course = flatCourse();
    this.racers = entries.map((e, i) => {
      const r = new Racer(e.anatomy, e.name, i, e.kind, e.id, e.bot);
      r.body.place(0, this.course);
      if (e.taps) r.queue = e.taps.slice().sort((a, b) => a - b);
      return r;
    });
    this.player = entries.findIndex((e) => e.kind === 'player');
  }

  get time() { return (this.tick - COUNTDOWN) * DT; }
  get started() { return this.tick >= COUNTDOWN; }
  get playerRacer(): Racer | undefined { return this.racers[this.player]; }

  // A tap from racer i. Late taps (from the network) apply now but are logged
  // at the tick they happened, so the final replay is exact.
  tap(i: number, tick = this.tick) {
    const r = this.racers[i];
    if (!r || r.bot || r.done) return;
    r.queue.push(Math.max(tick, this.tick));
    r.log.push(tick);
  }

  private groove(r: Racer, t: number) {
    while (r.queue.length && r.queue[0] <= this.tick) {
      r.queue.shift();
      if (t < r.start) continue;
      const ph = (t - r.start) / r.beat, k = Math.round(ph);
      const err = Math.abs(ph - k) * r.beat;
      if (err <= WINDOW && k !== r.lastBeat) {
        r.lastBeat = k;
        r.groove = Math.min(1, r.groove + GAIN * (1 - 0.5 * err / WINDOW));
        this.emit('hit', r.idx, 1 - err / WINDOW);
      } else {
        r.groove = Math.max(0, r.groove - MISS);
        this.emit('miss', r.idx);
      }
    }
    if (!r.bot) r.groove = Math.max(0, r.groove - DECAY * DT);
  }

  private emit(type: RaceEventType, who: number, value?: number) {
    this.events.push({ t: this.time, type, who, value });
  }

  step() {
    if (this.over) return;
    const t = this.time;
    if (this.tick === COUNTDOWN) this.emit('start', Math.max(0, this.player));
    for (const r of this.racers) {
      // Before the gun (and its reaction time) it stands on the line.
      // Finished creatures ease off but keep moving past the line.
      const go = this.started && t >= r.start;
      if (this.started && !r.done) this.groove(r, t);
      const mult = !go ? 0 : r.done ? 0.35 : pace(r.anatomy.kind, t - r.start) * (1 + MAX_BOOST * r.groove);
      for (let i = 0; i < SUBSTEPS; i++) r.body.step(DT / SUBSTEPS, this.course, mult);
      if (this.started && !r.done) this.observe(r, t);
    }
    if (this.started) this.judge();
    this.tick++;
  }

  private observe(r: Racer, t: number) {
    const b = r.body, s = r.stats;
    if (!b.touching) s.airtime += DT;
    const upside = b.upsideTime > 0.4 && r.anatomy.kind !== 'roller'; // rolling over is how a roller moves
    if (upside && !r.wasUpside) s.falls++;
    r.wasUpside = upside;
    s.topSpeed = Math.max(s.topSpeed, b.vx);
    if (s.reachedTop === null && b.vx >= 0.9 * r.s.vTarget) s.reachedTop = t;

    if (b.x >= this.course.finish) {
      // Back off to the moment it crossed, so photo finishes split fairly.
      const past = (b.x - this.course.finish) / Math.max(0.1, b.vx);
      r.finishTime = Math.max(0, t + DT - Math.min(DT, past));
      this.finishOrder.push(r.idx);
      this.emit('finish', r.idx, this.finishOrder.length);
      if (this.finishOrder.length === 2 && r.finishTime - this.racers[this.finishOrder[0]].finishTime! < 0.2) this.emit('photo', r.idx);
    }
  }

  private judge() {
    const t = this.time;
    const first = this.finishOrder.length ? this.racers[this.finishOrder[0]].finishTime! : null;
    if (this.racers.every((r) => r.done) || t >= MAX_TIME || (first !== null && t - first >= AFTER_FIRST)) this.over = true;
  }

  // Finishers by time, then everyone else by distance.
  standings(): Racer[] {
    return this.racers.slice().sort((a, b) => {
      if (a.finishTime !== null || b.finishTime !== null) {
        if (a.finishTime === null) return 1;
        if (b.finishTime === null) return -1;
        return a.finishTime - b.finishTime || a.idx - b.idx;
      }
      return b.x - a.x || a.idx - b.idx;
    });
  }

  // Order-sensitive hash of every body's state; used to check determinism.
  hash(): string {
    const f = new Float64Array(4);
    const u = new Uint32Array(f.buffer);
    let h = 0x811c9dc5;
    for (const r of this.racers) {
      f[0] = r.body.x; f[1] = r.body.y; f[2] = r.body.th; f[3] = r.body.vx;
      for (const w of u) h = Math.imul(h ^ w, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }
}
