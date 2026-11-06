import { type Anatomy, type Kind, KIND_ORDER, type Stroke, analyze, withKind } from './analyze';
import { INKS } from './course';
import { type Dare, decode, encode } from './encode';

export const THIN = 6, THICK = 11;

const pack = (strokes: Stroke[]): Dare['strokes'] => strokes.map((s) => ({ pts: s.pts, ink: Math.max(0, INKS.indexOf(s.color)), thick: s.w > (THIN + THICK) / 2 }));
const unpack = (strokes: Dare['strokes']): Stroke[] => strokes.map((s) => ({ pts: s.pts, color: INKS[s.ink] ?? INKS[0], w: s.thick ? THICK : THIN }));

// pick: the kind the player chose, if they changed it from how it reads.
export const codeOf = (strokes: Stroke[], name: string, pick?: Kind | null) => encode({ pick: pick ? KIND_ORDER.indexOf(pick) + 1 : 0, seed: 0, name, strokes: pack(strokes) });

export function fromCode(code: string): { strokes: Stroke[]; anatomy: Anatomy; name: string; pick: Kind | null } | null {
  const d = decode(code);
  if (!d) return null;
  const strokes = unpack(d.strokes);
  const read = analyze(strokes);
  if (!read) return null;
  const anatomy = withKind(read, KIND_ORDER[d.pick - 1]);
  return { strokes, anatomy, name: d.name, pick: anatomy.kind === read.kind ? null : anatomy.kind };
}

// Preview, solo races, rooms and shared links must read the same geometry.
export const canonical = (strokes: Stroke[]) => unpack(decode(codeOf(strokes, ''))!.strokes);
