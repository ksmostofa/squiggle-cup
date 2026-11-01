import type { Anatomy } from './analyze';
import type { Creature } from './creature';
import { polyLen } from './geom';
import type { Race, RaceEvent, RaceEventType } from './race';
import { type Rng, pick } from './rng';

// PRD §10. The game is the straight man; the creature is the joke.

const TITLES = ['Sir', 'Dame', 'The Honourable', 'Lord', 'Lady', 'Professor', 'Captain'];
const FIRST = ['Reginald', 'Gerald', 'Beatrice', 'Humphrey', 'Agatha', 'Clement', 'Winifred', 'Barnaby', 'Mildred', 'Percival', ''];
const SUFFIX = ['III', 'Esq.', 'of Croydon', 'the Unbothered', 'Jr.', '', '', 'of the Lower Field', 'II'];

function core(a: Anatomy, rng: Rng): string {
  const n = a.limbs.length;
  const longest = Math.max(0, ...a.limbs.map((l) => polyLen(l.pts)));
  if (!a.body.closed) return pick(rng, ['Wobblington', 'Squiggleton', 'Linesworth']);
  if (n === 0) return pick(rng, ['Blob', 'Nolegs', 'Roundsby']);
  if (longest > 170) return 'Longshanks';
  if (n === 1) return pick(rng, ['Hopsworth', 'Onelegge']);
  if (n === 3) return 'Tripod';
  if (n === 4) return 'Fourlegs';
  if (n >= 6) return pick(rng, ['Manylegs', 'Centipedington']);
  return pick(rng, ['Twoshanks', 'Strideley', 'Fourlegs']);
}

export function formalName(a: Anatomy, rng: Rng): string {
  const c = core(a, rng);
  const title = pick(rng, TITLES);
  const first = c === 'Blob' && rng() < 0.6 ? '' : pick(rng, FIRST);
  const suffix = pick(rng, SUFFIX);
  return [title, first, c, suffix].filter(Boolean).join(' ');
}

// ---------- Commentary (Best in Show voice: hushed, reverent) ----------

const PRIORITY: Partial<Record<RaceEventType, number>> = { photo: 6, finish: 5, nudge: 4, flip: 3, air: 2, lead: 1, start: 0 };

type Line = (name: string, c: Creature, e: RaceEvent) => string;
const LINES: Partial<Record<RaceEventType, Line[]>> = {
  start: [
    (n, c) => (c.limbs.length === 0 ? 'A bold strategy: zero legs.' : c.limbs.length >= 5 ? `${n} has brought ${c.limbs.length} legs. The judges are counting.` : `And they are away. Quietly, please.`),
    () => 'The entrants proceed. Most of them forwards.',
  ],
  flip: [
    (n) => `${n} has inverted. This is not in the rulebook.`,
    (n) => `${n} is now upside down. ${n} remains confident.`,
    () => 'A full rotation. The judges are writing something down.',
    (n, c) => (c.stats.flips >= 3 ? `That is ${c.stats.flips} flips for ${n}. Nobody asked.` : `${n} explores a new orientation.`),
  ],
  air: [
    (n) => `${n} has lost contact with the ground. ${n} remains confident.`,
    (n) => `${n} is airborne. We did not prepare for this.`,
    () => 'Remarkable elevation. Whether it was intended is unclear.',
  ],
  nudge: [
    (n, _c, e) => (e.x > 38 && e.x < 46 ? 'Remarkable. It has gone into the tunnel and has not come out.' : `The handler has intervened on behalf of ${n}. This is permitted.`),
    () => 'A gentle assist from the handler. Entirely within the rules.',
    (n) => `${n} has been relocated. The crowd applauds politely.`,
  ],
  lead: [
    (n) => `${n} takes the lead. Remarkable.`,
    (n) => `A change at the front. It is ${n}.`,
    (n) => `${n} moves ahead, with what can only be described as purpose.`,
  ],
  finish: [
    (n, _c, e) => (e.value === 1 ? `${n} crosses the line. Extraordinary composure.` : `${n} has finished. Technically.`),
    (n, _c, e) => (e.value === 1 ? `And ${n} wins. One must simply accept it.` : `${n} arrives. The judges nod.`),
  ],
  photo: [() => 'It is a photo finish. Nobody breathe.'],
};

export class Commentator {
  private last = -99;
  private pending: RaceEvent[] = [];
  constructor(private race: Race, private rng: Rng) {}

  feed(events: RaceEvent[]) {
    for (const e of events) {
      if (PRIORITY[e.type] === undefined) continue;
      // Other finishers are only worth a word if it's the winner or you.
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
    const c = this.race.creatures[e.who];
    return pick(this.rng, LINES[e.type]!)(c.name, c, e);
  }
}

// ---------- Awards (PRD §10.3) ----------

export interface Award { title: string; why: string }

export function awards(race: Race): Map<number, Award> {
  const cs = race.creatures;
  const order = race.standings().map((c) => c.idx);
  const finishers = cs.filter((c) => c.finishTime !== null).sort((a, b) => a.finishTime! - b.finishTime!);
  const argmax = (f: (c: Creature) => number, min = 1e-9) => {
    let best: Creature | null = null;
    for (const c of cs) if (f(c) >= min && (!best || f(c) > f(best))) best = c;
    return best;
  };
  const won: [Creature | null, Award][] = [
    [cs[order[order.length - 1]], { title: 'Most Confident Loser', why: 'Last place, and tapped like it mattered' }],
    [argmax((c) => c.stats.maxSpeedUpside, 0.5), { title: 'Fastest While Upside Down', why: 'Top speed while inverted' }],
    [finishers.length >= 2 ? finishers[finishers.length - 1] : null, { title: 'Technically Finished', why: 'The slowest finisher' }],
    [argmax((c) => c.stats.airtime, 1), { title: 'Frequent Flyer', why: 'Most time in the air' }],
    [argmax((c) => c.stats.flips, 1), { title: 'Gymnast', why: 'Most flips' }],
    [argmax((c) => c.stats.nudges, 1), { title: "Handler's Favourite", why: 'Most nudges from the handler' }],
    [argmax((c) => -c.stats.taps, -1e9), { title: 'Unbothered', why: 'Fewest taps in the field' }],
  ];
  const out = new Map<number, Award>();
  for (const [c, a] of won) if (c && !out.has(c.idx)) out.set(c.idx, a);
  const spare: Award[] = [
    { title: 'Good Posture', why: 'Mostly the right way up' },
    { title: 'Most Earnest', why: 'Tried very hard' },
    { title: 'Present and Correct', why: 'Was there' },
    { title: 'Commendable Effort', why: 'The judges were moved' },
  ];
  for (const c of cs) if (!out.has(c.idx)) out.set(c.idx, spare.shift() ?? { title: 'Participant', why: 'Took part' });
  return out;
}

export const PLACINGS = ['Champion', 'Reserve Champion', 'Highly Commended', 'Commended', 'Commended', 'Commended'];

// ---------- Judges' scorecards (PRD §10.5) ----------

export interface Scorecards { grace: string; legs: string; spirit: string }

export function judges(c: Creature, raceTime: number, rng: Rng): Scorecards {
  const grace = Math.max(0.5, 10 - c.stats.flips * 1.5);
  const n = c.limbs.length;
  const legs = n === 0 ? 'No' : n >= 5 ? 'Too many' : n === 2 || n === 4 ? 'Yes' : 'Unclear';
  const rate = c.stats.taps / Math.max(1, c.finishTime ?? raceTime);
  const spirit = Math.max(0.5, Math.min(10, rate * 2 + (rng() * 2 - 1)));
  return { grace: grace.toFixed(1), legs, spirit: spirit.toFixed(1) };
}

// ---------- One fact from the replay (PRD §9.2) ----------

const legLength = (c: Creature) => c.limbs.reduce((a, l) => a + polyLen(l.strokes[0].pts), 0);

export function fact(race: Race, me: Creature, winner: Creature): string {
  const time = Math.max(1, me.finishTime ?? race.time);
  const rate = me.stats.taps / time;
  const off = Math.abs(rate - me.idealRate) / me.idealRate;
  if (me !== winner) {
    const mine = legLength(me), theirs = legLength(winner);
    if (mine === 0 && theirs > 0) return `Winner had ${winner.limbs.length} leg${winner.limbs.length === 1 ? '' : 's'}. You had none.`;
    if (mine > 0 && theirs / mine > 1.3) return `Winner's legs: ${(theirs / mine).toFixed(1)}× longer.`;
  }
  if (me.stats.flips >= 2) return `You flipped ${me.stats.flips} times.`;
  if (off > 0.25 && me.stats.taps > 5) return `You tapped ${rate.toFixed(1)}/s; your ideal was ${me.idealRate.toFixed(1)}/s.`;
  if (me.stats.nudges) return `The handler helped you ${me.stats.nudges} time${me.stats.nudges === 1 ? '' : 's'}.`;
  if (me === winner) return `Your legs did ${Math.round(me.stats.taps)} strides' worth of work. Commendable.`;
  return `Winner finished ${((me.finishTime ?? race.time) - (winner.finishTime ?? race.time)).toFixed(1)} s ahead.`;
}
