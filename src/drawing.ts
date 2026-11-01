import { type Anatomy, type Stroke, analyze } from './analyze';
import { INKS } from './course';
import { type Dare, decode, encode } from './encode';

export const THIN = 6, THICK = 11;

const pack = (strokes: Stroke[]): Dare['strokes'] => strokes.map((s) => ({ pts: s.pts, ink: Math.max(0, INKS.indexOf(s.color)), thick: s.w > (THIN + THICK) / 2 }));
const unpack = (strokes: Dare['strokes']): Stroke[] => strokes.map((s) => ({ pts: s.pts, color: INKS[s.ink] ?? INKS[0], w: s.thick ? THICK : THIN }));

export const codeOf = (strokes: Stroke[], name: string) => encode({ venue: 0, seed: 0, name, strokes: pack(strokes) });

export function fromCode(code: string): { strokes: Stroke[]; anatomy: Anatomy; name: string } | null {
  const d = decode(code);
  if (!d) return null;
  const strokes = unpack(d.strokes);
  const anatomy = analyze(strokes);
  return anatomy ? { strokes, anatomy, name: d.name } : null;
}

// Preview, solo races, rooms and shared links must read the same geometry.
export const canonical = (strokes: Stroke[]) => unpack(decode(codeOf(strokes, ''))!.strokes);
