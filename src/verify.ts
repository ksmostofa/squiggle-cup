import type { Kind } from './analyze';
import { codeOf, fromCode } from './drawing';
import { Race } from './race';

// The leaderboard's referee. Rules and seasons version the board: whenever
// the simulation or the scoring changes, RULES goes up, and old times stay on
// their own board instead of being compared with times they can't match.
export const RULES = 'r3';
export const SEASON = 's1';

export interface Verified { kind: Kind; ms: number; score: number; strokes: string }

// Runs a drawing's race exactly as every lane runs it (lanes never interact,
// so its time alone is its time in any race). Null if it can't be read or
// doesn't finish.
export function verify(code: string): Verified | null {
  const d = fromCode(code);
  if (!d) return null;
  const race = new Race([{ anatomy: d.anatomy, name: '', kind: 'player' }]);
  while (!race.over) race.step();
  const r = race.racers[0];
  if (r.finishTime === null) return null;
  // The drawing alone, without its name: one board entry per drawing.
  return { kind: d.anatomy.kind, ms: Math.round(r.finishTime * 1000), score: Math.round(r.s.quality * 1000) / 1000, strokes: codeOf(d.strokes, '') };
}
