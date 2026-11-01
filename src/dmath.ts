// Deterministic trig for the simulation: + - * / only, so every browser agrees
// to the last bit (PRD §7).

const PI = 3.141592653589793;
const TAU = 6.283185307179586;

export function dsin(x: number): number {
  x = x - TAU * Math.floor(x / TAU); // 0..2π
  let sign = 1;
  if (x > PI) { x -= PI; sign = -1; } // 0..π
  if (x > PI / 2) x = PI - x;         // 0..π/2
  const x2 = x * x;
  // Taylor series to x^11 is accurate to ~1e-7 on [0, π/2].
  return sign * x * (1 - (x2 / 6) * (1 - (x2 / 20) * (1 - (x2 / 42) * (1 - (x2 / 72) * (1 - x2 / 110)))));
}

export const dcos = (x: number) => dsin(x + PI / 2);
