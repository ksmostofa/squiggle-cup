import RAPIER from '@dimforge/rapier2d-deterministic-compat';
import type { Anatomy } from './analyze';
import { BotPilot } from './bots';
import { Creature, DT } from './creature';
import { mulberry32 } from './rng';
import type { Course, Venue } from './venues/venue';

// The race simulation. Never touches the DOM, so it runs the same in the page,
// in tests and (later) in a Worker re-checking submitted runs.

export const COUNTDOWN = 180;      // ticks of "Ready… Set… Squiggle!" (3 s); inputs are ignored
export const MAX_TIME = 120;
export const AFTER_PLAYER = 6;     // seconds the race keeps going once the player is done

export type InputType = 'tap' | 'press' | 'release';
export const INPUT_TYPES: readonly InputType[] = ['tap', 'press', 'release'];
export interface InputEvent { tick: number; type: InputType }

export interface Entry {
  anatomy: Anatomy;
  name: string;
  kind: 'player' | 'bot' | 'ghost';
  inputs?: InputEvent[]; // ghosts replay these
}

export type RaceEventType = 'start' | 'flip' | 'air' | 'nudge' | 'lead' | 'finish' | 'photo' | 'leap' | 'land';
export interface RaceEvent { t: number; type: RaceEventType; who: number; x: number; value?: number }

let physics: Promise<void> | null = null;
export const loadPhysics = () => (physics ??= RAPIER.init());

export class Race {
  world: RAPIER.World;
  course: Course;
  creatures: Creature[];
  tick = 0;
  over = false;
  events: RaceEvent[] = [];   // consumers drain this
  playerInputs: InputEvent[] = [];
  finishOrder: number[] = [];
  player: number;
  private pilots: (BotPilot | null)[];
  private ghostCursor: number[];
  private queue: { slot: number; type: InputType }[] = [];
  private leader = -1;
  private lastLead = 0;
  private playerDoneAt: number | null = null;

  constructor(public venue: Venue, public entries: Entry[], public seed: number) {
    this.world = new RAPIER.World({ x: 0, y: -9.81 });
    this.world.timestep = DT;
    this.course = venue.build(this.world, mulberry32(seed));
    this.creatures = entries.map((e, i) => {
      const c = new Creature(this.world, e.anatomy, e.name, i, 1, 0, 0, e.kind === 'player', e.kind === 'ghost');
      c.onNudge = (cr, now) => this.emit(now, 'nudge', cr.idx);
      return c;
    });
    this.pilots = entries.map((e, i) => (e.kind === 'bot' ? new BotPilot(mulberry32((seed ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0)) : null));
    this.ghostCursor = entries.map(() => 0);
    this.player = entries.findIndex((e) => e.kind === 'player');
  }

  get time() { return (this.tick - COUNTDOWN) * DT; }
  get started() { return this.tick >= COUNTDOWN; }
  get playerCreature(): Creature | undefined { return this.creatures[this.player]; }

  // Queued and applied at the start of the next tick, which is the tick recorded.
  input(slot: number, type: InputType) {
    if (this.started && !this.over) this.queue.push({ slot, type });
  }

  private apply(slot: number, type: InputType) {
    const c = this.creatures[slot];
    if (c.done) return;
    if (type === 'tap') c.tap();
    else if (type === 'press') c.press();
    else if (c.release()) this.emit(this.time, 'leap', slot);
    if (slot === this.player) this.playerInputs.push({ tick: this.tick, type });
  }

  private emit(t: number, type: RaceEventType, who: number, value?: number) {
    this.events.push({ t, type, who, x: this.creatures[who]?.pos.x ?? 0, value });
  }

  step() {
    if (this.over) return;
    const t = this.time;
    if (this.started) {
      if (this.tick === COUNTDOWN) this.emit(0, 'start', Math.max(0, this.player));
      for (const q of this.queue.splice(0)) this.apply(q.slot, q.type);
      this.entries.forEach((e, i) => {
        if (e.kind === 'ghost' && e.inputs) {
          while (this.ghostCursor[i] < e.inputs.length && e.inputs[this.ghostCursor[i]].tick <= this.tick) {
            this.apply(i, e.inputs[this.ghostCursor[i]++].type);
          }
        }
        const pilot = this.pilots[i];
        if (pilot) {
          const type = pilot.think(t, this.creatures[i], this.course.leapAt);
          if (type) this.apply(i, type);
        }
      });
      for (const c of this.creatures) {
        const flips = c.stats.flips, air = c.airRun;
        c.step(DT, t);
        if (c.stats.flips > flips) this.emit(t, 'flip', c.idx, c.stats.flips);
        if (air < 1 && c.airRun >= 1) this.emit(t, 'air', c.idx);
        if (c.landed) this.emit(t, 'land', c.idx, c.landed);
      }
    }
    this.unphase();
    this.world.step();
    this.tick++;
    if (this.started) this.judge();
  }

  // Everyone starts stacked on the line, passing through each other. A creature
  // turns solid once it has pulled clear of every other entrant.
  private unphase() {
    const cs = this.creatures;
    for (const a of cs) {
      if (a.solid || a.ghost) continue;
      const clear = cs.every((b) => b === a || b.ghost || Math.abs(a.pos.x - b.pos.x) > a.radius + b.radius);
      if (clear) a.setSolid(true);
    }
  }

  private judge() {
    const t = this.time;
    for (const c of this.creatures) {
      if (c.done) continue;
      if (c.pos.x >= this.course.finish) {
        c.finishTime = t;
        this.finishOrder.push(c.idx);
        this.emit(t, 'finish', c.idx, this.finishOrder.length);
        if (this.finishOrder.length === 2) {
          const first = this.creatures[this.finishOrder[0]].finishTime!;
          if (t - first < 0.3) this.emit(t, 'photo', c.idx);
        }
        if (c.idx === this.player) this.playerDoneAt = t;
      }
    }

    const lead = this.standings()[0].idx;
    if (this.leader < 0) this.leader = lead;
    else if (lead !== this.leader && t > 3 && t - this.lastLead >= 4) {
      this.leader = lead;
      this.lastLead = t;
      this.emit(t, 'lead', lead);
    }

    const allDone = this.creatures.every((c) => c.done);
    if (allDone || t >= MAX_TIME || (this.playerDoneAt !== null && t - this.playerDoneAt >= AFTER_PLAYER)) this.over = true;
  }

  // Finishers by time, then everyone else by distance (PRD §9.1).
  standings(): Creature[] {
    return this.creatures.slice().sort((a, b) => {
      if (a.finishTime !== null || b.finishTime !== null) {
        if (a.finishTime === null) return 1;
        if (b.finishTime === null) return -1;
        return a.finishTime - b.finishTime || a.idx - b.idx;
      }
      return b.pos.x - a.pos.x || a.idx - b.idx;
    });
  }

  // Order-sensitive hash of every body's position; used to check determinism.
  hash(): string {
    const f = new Float64Array(2);
    const u = new Uint32Array(f.buffer);
    let h = 0x811c9dc5;
    this.world.forEachRigidBody((rb) => {
      const p = rb.translation();
      f[0] = p.x; f[1] = p.y;
      for (const w of u) h = Math.imul(h ^ w, 0x01000193) >>> 0;
    });
    return h.toString(16).padStart(8, '0');
  }

  free() { this.world.free(); }
}
