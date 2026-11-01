import type { Anatomy } from './analyze';
import { Body } from './body';
import { DT, type Stats, stats } from './creature';
import { type Rng, mulberry32, range } from './rng';
import type { Course, Venue } from './venues/ochre';

// The race. You draw; your drawing races. Nobody steers: every creature is
// moved by the physics of its own body (body.ts), so how it runs, hops,
// rolls, slithers or flies comes from what was drawn. Same drawings + same
// seed = the same race on every device.

export const COUNTDOWN = 180;  // ticks of "Ready… Set… Go!" (3 s)
export const MAX_TIME = 120;
export const AFTER_PLAYER = 4; // seconds the race keeps going once your creature is home
const SUBSTEPS = 4;

export interface Entry { anatomy: Anatomy; name: string; kind: 'player' | 'rival' }

export type RaceEventType = 'start' | 'land' | 'air' | 'fall' | 'lead' | 'finish' | 'photo';
export interface RaceEvent { t: number; type: RaceEventType; who: number; x: number; value?: number }

export interface RacerStats { falls: number; airtime: number; bestAir: number; topSpeed: number }

export class Racer {
  body: Body;
  s: Stats;
  finishTime: number | null = null;
  stats: RacerStats = { falls: 0, airtime: 0, bestAir: 0, topSpeed: 0 };
  rng: Rng;
  start: number;    // reaction time off the line
  sprintAt: number; // fraction of the course where it finds a final burst
  knots: number[];  // seeded effort wobble, one knot per second
  wasUpside = false;
  wasLong = false;

  constructor(public anatomy: Anatomy, public name: string, public idx: number, public kind: Entry['kind'], seed: number) {
    this.s = stats(anatomy);
    this.rng = mulberry32(seed);
    this.start = range(this.rng, 0.1, 0.4);
    this.sprintAt = range(this.rng, 0.7, 0.85);
    this.knots = Array.from({ length: MAX_TIME + 2 }, () => this.rng());
    this.body = new Body(anatomy, this.s.size, { kind: anatomy.kind, vTarget: this.s.vTarget });
  }

  get x() { return this.body.x; }
  get done() { return this.finishTime !== null; }
  get isPlayer() { return this.kind === 'player'; }
}

export class Race {
  course: Course;
  racers: Racer[];
  tick = 0;
  over = false;
  events: RaceEvent[] = [];   // consumers drain this
  finishOrder: number[] = [];
  player: number;
  private leader = -1;
  private lastLead = 0;
  private playerDoneAt: number | null = null;

  constructor(public venue: Venue, public entries: Entry[], public seed: number) {
    this.course = venue.build(mulberry32(seed));
    this.racers = entries.map((e, i) => {
      const r = new Racer(e.anatomy, e.name, i, e.kind, (seed ^ Math.imul(i + 7, 0x85ebca6b)) >>> 0);
      r.body.place(0, this.course);
      return r;
    });
    this.player = entries.findIndex((e) => e.kind === 'player');
  }

  get time() { return (this.tick - COUNTDOWN) * DT; }
  get started() { return this.tick >= COUNTDOWN; }
  get playerRacer(): Racer | undefined { return this.racers[this.player]; }

  private emit(type: RaceEventType, who: number, value?: number) {
    this.events.push({ t: this.time, type, who, x: this.racers[who]?.x ?? 0, value });
  }

  step() {
    if (this.over) return;
    const t = this.time;
    if (this.tick === COUNTDOWN) this.emit('start', Math.max(0, this.player));
    for (const r of this.racers) {
      // Before the gun (and its reaction time) it just stands there. Finished
      // creatures ease off but keep moving past the line.
      const go = this.started && t >= r.start;
      const mult = !go ? 0 : r.done ? 0.3 : this.effort(r, t);
      for (let i = 0; i < SUBSTEPS; i++) r.body.step(DT / SUBSTEPS, this.course, mult);
      if (this.started && !r.done) this.observe(r, t);
    }
    if (this.started) this.judge();
    this.tick++;
  }

  // How hard it's trying right now: a seeded wobble and a final sprint.
  private effort(r: Racer, t: number): number {
    let m = 0.94 + 0.12 * knot(r.knots, t);
    if (r.anatomy.kind === 'scribble') m *= 0.7 + 0.6 * knot(r.knots, t * 1.7);
    if (r.x > r.sprintAt * this.course.finish) m *= 1.06;
    return m;
  }

  // Turns what the physics did into stats and commentary events.
  private observe(r: Racer, t: number) {
    const b = r.body, s = r.stats;
    if (!b.touching) {
      s.airtime += DT;
      s.bestAir = Math.max(s.bestAir, b.airTime);
      const long = b.airTime >= 1 && b.lift === 0;
      if (long && !r.wasLong) this.emit('air', r.idx);
      r.wasLong = long;
    } else r.wasLong = false;
    if (b.lastLanding) { this.emit('land', r.idx, b.lastLanding); b.lastLanding = 0; }
    const upside = b.upsideTime > 0.4;
    if (upside && !r.wasUpside) { s.falls++; this.emit('fall', r.idx); }
    r.wasUpside = upside;
    s.topSpeed = Math.max(s.topSpeed, b.vx);

    if (b.x >= this.course.finish) {
      r.finishTime = t;
      this.finishOrder.push(r.idx);
      this.emit('finish', r.idx, this.finishOrder.length);
      if (this.finishOrder.length === 2 && t - this.racers[this.finishOrder[0]].finishTime! < 0.3) this.emit('photo', r.idx);
      if (r.idx === this.player) this.playerDoneAt = t;
    }
  }

  private judge() {
    const t = this.time;
    const lead = this.standings()[0].idx;
    if (this.leader < 0) this.leader = lead;
    else if (lead !== this.leader && t > 3 && t - this.lastLead >= 4) {
      this.leader = lead;
      this.lastLead = t;
      this.emit('lead', lead);
    }
    const allDone = this.racers.every((r) => r.done);
    if (allDone || t >= MAX_TIME || (this.playerDoneAt !== null && t - this.playerDoneAt >= AFTER_PLAYER)) this.over = true;
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

function knot(k: number[], t: number): number {
  const i = Math.max(0, Math.min(k.length - 2, Math.floor(t)));
  const f = Math.max(0, Math.min(1, t - i));
  return k[i] * (1 - f) + k[i + 1] * f;
}
