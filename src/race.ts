import type { Anatomy } from './analyze';
import { Body } from './body';
import { type Course, flatCourse } from './course';
import { DT, PROFILES, type Stats, stats } from './creature';
import { type Rng, mulberry32, range } from './rng';

// The race. You draw; your drawing races. Nobody steers: every creature is
// moved by the physics of its own body (body.ts), in its own lane, so how it
// runs, hops, rolls, slithers or flies comes from what was drawn. Same
// drawings + same seed = the same race on every device, so a room only has
// to share those.

export const COUNTDOWN = 180;  // ticks of 3, 2, 1 (3 s)
export const MAX_TIME = 60;
export const AFTER_FIRST = 12; // seconds the race waits for stragglers once someone wins
export const SUBSTEPS = 4;

export interface Entry { anatomy: Anatomy; name: string; kind: 'player' | 'rival'; id?: string }

export type RaceEventType = 'start' | 'finish' | 'photo';
export interface RaceEvent { t: number; type: RaceEventType; who: number; value?: number }

export interface RacerStats { falls: number; airtime: number; topSpeed: number; reachedTop: number | null }

export class Racer {
  body: Body;
  s: Stats;
  finishTime: number | null = null;
  stats: RacerStats = { falls: 0, airtime: 0, topSpeed: 0, reachedTop: null };
  rng: Rng;
  start: number;   // reaction time off the line
  luck: number;    // a small seeded edge or handicap for the whole race
  knots: number[]; // seeded pace wobble, one knot per second
  wasUpside = false;

  constructor(public anatomy: Anatomy, public name: string, public idx: number, public kind: Entry['kind'], seed: number, public id?: string) {
    this.s = stats(anatomy);
    this.rng = mulberry32(seed);
    this.start = range(this.rng, 0.1, 0.35);
    this.luck = range(this.rng, -0.03, 0.03);
    this.knots = Array.from({ length: MAX_TIME + 2 }, () => this.rng());
    this.body = new Body(anatomy, this.s.size, { kind: anatomy.kind, vTarget: this.s.vTarget });
  }

  get x() { return this.body.x; }
  get done() { return this.finishTime !== null; }
  get isPlayer() { return this.kind === 'player'; }
}

// Pace multiplier t seconds after leaving the line: ease up to cruising
// speed, then a seeded wobble around it. The wobble averages out, so streaky
// kinds aren't slower, just less predictable. The draw-screen preview calls
// this with no racer (no luck, no wobble).
export function pace(r: Racer | null, kind: Anatomy['kind'], t: number): number {
  const p = PROFILES[kind];
  const f = p.ramp > 0 ? Math.min(1, t / p.ramp) : 1;
  const ramp = 0.25 + 0.75 * f * (2 - f);
  if (!r) return ramp;
  const wobble = p.streak * (2 * knot(r.knots, t * (kind === 'scribble' ? 1.8 : 1)) - 1);
  return ramp * (1 + r.luck + wobble);
}

export class Race {
  course: Course;
  racers: Racer[];
  tick = 0;
  over = false;
  events: RaceEvent[] = []; // consumers drain this
  finishOrder: number[] = [];
  player: number;

  constructor(public entries: Entry[], public seed: number) {
    this.course = flatCourse();
    this.racers = entries.map((e, i) => {
      const r = new Racer(e.anatomy, e.name, i, e.kind, (seed ^ Math.imul(i + 7, 0x85ebca6b)) >>> 0, e.id);
      r.body.place(0, this.course);
      return r;
    });
    this.player = entries.findIndex((e) => e.kind === 'player');
  }

  get time() { return (this.tick - COUNTDOWN) * DT; }
  get started() { return this.tick >= COUNTDOWN; }
  get playerRacer(): Racer | undefined { return this.racers[this.player]; }

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
      const mult = !go ? 0 : r.done ? 0.35 : pace(r, r.anatomy.kind, t - r.start);
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

function knot(k: number[], t: number): number {
  const i = Math.max(0, Math.min(k.length - 2, Math.floor(t)));
  const f = Math.max(0, Math.min(1, t - i));
  const e = f * f * (3 - 2 * f);
  return k[i] * (1 - e) + k[i + 1] * e;
}
