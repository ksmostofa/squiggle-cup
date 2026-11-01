import type { Anatomy } from './analyze';
import { KINDS } from './creature';
import type { Race, Racer } from './race';
import { type Rng, pick } from './rng';

// Names for bots, and the one honest fact on the results sheet.

const FIRST = ['Gerald', 'Ursula', 'Beatrix', 'Humphrey', 'Mildred', 'Clement', 'Winifred', 'Barnaby', 'Agatha', 'Ida', 'Otto', 'Margit'];
const EPITHET: Record<Anatomy['kind'], string[]> = {
  biped: ['Longstride', 'Two-Toes', 'the Upright'],
  quadruped: ['Fourfoot', 'the Trotter', 'Steadyhoof'],
  centipede: ['Manylegs', 'Hundredstep', 'the Ripple'],
  hopper: ['Onefoot', 'Springheel', 'the Bounding'],
  flyer: ['Skywing', 'the Flapper', 'Updraught'],
  roller: ['the Round', 'Wheelwright', 'the Tumbling'],
  worm: ['the Long', 'Slithersome', 'Lowline'],
  jelly: ['the Wobbling', 'Blobsworth', 'the Soft'],
  scribble: ['the Unexplained', 'Tangleback', 'Mystery'],
};

export function formalName(a: Anatomy, rng: Rng): string {
  return `${pick(rng, FIRST)} ${pick(rng, EPITHET[a.kind])}`;
}

export const PLACINGS = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

const label = (r: Racer) => KINDS[r.anatomy.kind].label.toLowerCase();

// One true thing about the race, measured, never invented.
export function fact(race: Race, me: Racer): string {
  const order = race.standings();
  const winner = order[0], second = order[1];
  if (me === winner && second?.finishTime != null && me.finishTime != null) {
    const gap = second.finishTime - me.finishTime;
    if (gap < 0.25) return `Won by ${gap.toFixed(2)} s, about ${(gap * me.body.vx * 100).toFixed(0)} cm.`;
  }
  const mt = me.stats.reachedTop, wt = winner.stats.reachedTop;
  if (me !== winner && mt !== null && wt !== null && mt > wt + 1.5)
    return `Yours took ${mt.toFixed(1)} s to reach full speed; ${winner.name} took ${wt.toFixed(1)} s.`;
  if (me !== winner && winner.anatomy.kind === me.anatomy.kind && winner.s.quality > me.s.quality + 0.1)
    return `Same kind as the winner, but its proportions scored ${Math.round(winner.s.quality * 100)} to your ${Math.round(me.s.quality * 100)}.`;
  if (me === winner) return `Your ${label(me)} creature topped out at ${me.stats.topSpeed.toFixed(2)} m/s.`;
  return `Top speed: yours ${me.stats.topSpeed.toFixed(2)} m/s, the winner's ${winner.stats.topSpeed.toFixed(2)} m/s.`;
}
