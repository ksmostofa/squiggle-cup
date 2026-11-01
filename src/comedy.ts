import type { Anatomy } from './analyze';
import { KINDS } from './creature';
import type { Race, RaceEvent, RaceEventType, Racer } from './race';
import { type Rng, pick } from './rng';

// PRD §10, in Ochre's voice: a hushed nature-documentary narrator watching
// paintings come alive. The game plays it straight; the creature is the joke.

const FIRST = ['Gerald', 'Ursula', 'Og', 'Beatrix', 'Humphrey', 'Mildred', 'Clement', 'Winifred', 'Barnaby', 'Agatha', 'Thag', 'Ida'];
const EPITHET: Record<Anatomy['kind'], string[]> = {
  biped: ['the Upright', 'Longstride', 'Two-Toes'],
  quadruped: ['Fourfoot', 'the Galloper', 'of the Herd'],
  centipede: ['Manylegs', 'the Scuttler', 'Hundredstep'],
  hopper: ['Onefoot', 'the Bouncing', 'Springheel'],
  flyer: ['Skywing', 'the Flapper', 'of the High Ledge'],
  roller: ['the Round', 'Boulderkin', 'the Tumbling'],
  worm: ['the Long', 'Slithersome', 'of the Low Crawl'],
  jelly: ['the Wobbling', 'Blobsworth', 'the Soft'],
  scribble: ['the Unexplained', 'Tangleback', 'the Mysterious'],
};

export function formalName(a: Anatomy, rng: Rng): string {
  return `${pick(rng, FIRST)} ${pick(rng, EPITHET[a.kind])}`;
}

// ---------- Commentary ----------

const PRIORITY: Partial<Record<RaceEventType, number>> = { photo: 6, finish: 5, fall: 4, air: 3, lead: 2, start: 1 };

type Line = (n: string, r: Racer, e: RaceEvent) => string;
const LINES: Partial<Record<RaceEventType, Line[]>> = {
  start: [
    () => 'Night falls. The paintings stir.',
    (n, r) => `Here we observe ${n}, a ${KINDS[r.anatomy.kind].label.toLowerCase()} specimen, taking its very first steps.`,
    () => 'Thirty thousand years on the wall. Tonight, they run.',
  ],
  fall: [
    (n) => `${n} has fallen over. We do not intervene.`,
    (n) => `${n} examines the floor closely. Then rises, with dignity.`,
  ],
  air: [
    (n) => `${n} leaves the ground entirely. Remarkable.`,
    (n) => `A moment of flight for ${n}. It was not built for this.`,
  ],
  lead: [
    (n) => `${n} takes the lead. The herd follows.`,
    (n, r) => `And ${n} ${KINDS[r.anatomy.kind].verb} to the front.`,
    (n) => `A new leader emerges: ${n}.`,
  ],
  finish: [
    (n, _r, e) => (e.value === 1 ? `${n} reaches the cave mouth. Daylight, for the first time in thirty thousand years.` : `${n} emerges, blinking, into the light.`),
    (n, _r, e) => (e.value === 1 ? `${n} is first into the dawn. Extraordinary.` : `${n} arrives. Better late than painted.`),
  ],
  photo: [() => 'It is too close to call. Nobody breathe.'],
};

export class Commentator {
  private last = -99;
  private pending: RaceEvent[] = [];
  constructor(private race: Race, private rng: Rng) {}

  feed(events: RaceEvent[]) {
    for (const e of events) {
      if (PRIORITY[e.type] === undefined) continue;
      if (e.type === 'finish' && e.value !== 1 && e.who !== this.race.player) continue;
      this.pending.push(e);
    }
  }

  // At most one line every 2.5 s; the best fresh event wins.
  next(now: number): string | null {
    this.pending = this.pending.filter((e) => now - e.t < 2);
    if (now - this.last < 2.5 || !this.pending.length) return null;
    const e = this.pending.reduce((a, b) => (PRIORITY[b.type]! > PRIORITY[a.type]! ? b : a));
    this.pending = [];
    this.last = now;
    const r = this.race.racers[e.who];
    return pick(this.rng, LINES[e.type]!)(r.name, r, e);
  }
}

// ---------- Awards ----------

export interface Award { title: string; why: string }

export function awards(race: Race): Map<number, Award> {
  const rs = race.racers;
  const order = race.standings();
  const argmax = (f: (r: Racer) => number, min: number) => {
    let best: Racer | null = null;
    for (const r of rs) if (f(r) >= min && (!best || f(r) > f(best))) best = r;
    return best;
  };
  const won: [Racer | null, Award][] = [
    [order[0], { title: 'First into the Dawn', why: 'Won the race' }],
    [argmax((r) => r.stats.topSpeed, 0), { title: 'Fastest Stride', why: 'Highest top speed' }],
    [argmax((r) => r.stats.airtime, 1), { title: 'Most Airborne', why: 'Most time off the ground' }],
    [argmax((r) => r.stats.falls, 1), { title: 'Most Determined', why: 'Fell, got up' }],
    [order[order.length - 1], { title: 'Last Light', why: 'Saw the dawn eventually' }],
  ];
  const out = new Map<number, Award>();
  for (const [r, a] of won) if (r && !out.has(r.idx)) out.set(r.idx, a);
  const spare: Award[] = [
    { title: 'Steady Gait', why: 'Never in a hurry' },
    { title: 'Fine Brushwork', why: 'Beautifully painted' },
    { title: 'Ancient Spirit', why: 'Older than writing' },
  ];
  for (const r of rs) if (!out.has(r.idx)) out.set(r.idx, spare.shift() ?? { title: 'Took Part', why: 'Was there' });
  return out;
}

export const PLACINGS = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

// ---------- One fact from the race ----------

export function fact(me: Racer, winner: Racer): string {
  if (me === winner) return `Your ${KINDS[me.anatomy.kind].label.toLowerCase()} creature hit ${me.stats.topSpeed.toFixed(1)} m/s.`;
  if (winner.anatomy.kind !== me.anatomy.kind) return `The winner was ${KINDS[winner.anatomy.kind].label.toLowerCase()}. Yours was ${KINDS[me.anatomy.kind].label.toLowerCase()}.`;
  if (winner.s.legM > me.s.legM * 1.2) return `Winner's legs: ${(winner.s.legM / Math.max(0.01, me.s.legM)).toFixed(1)}× longer.`;
  if (winner.s.height > me.s.height * 1.2) return `The winner was ${(winner.s.height / me.s.height).toFixed(1)}× your size.`;
  return `Top speed: yours ${me.stats.topSpeed.toFixed(1)} m/s, the winner's ${winner.stats.topSpeed.toFixed(1)} m/s.`;
}
