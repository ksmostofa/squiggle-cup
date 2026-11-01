// The course: a straight, flat run across a drawing sheet, one lane per
// creature. No hazards: the drawing alone decides the race. Lanes never
// interact, so each creature races on its own copy of the same floor.

export interface Contact { d: number; nx: number; ny: number } // d > 0: penetration depth along the normal
export interface Course {
  finish: number;            // metres from the start line
  ground(x: number): number; // floor height at x, metres
  slope(x: number): number;  // d(ground)/dx
  contact(x: number, y: number): Contact;
}

export const FINISH = 40;
export const LANES = 5;

export function flatCourse(finish = FINISH): Course {
  return {
    finish,
    ground: () => 0,
    slope: () => 0,
    contact: (_x, y) => ({ d: -y, nx: 0, ny: 1 }),
  };
}

// Pen inks a creature can be drawn in. Index order is stored in dare links.
export const INKS = ['#15171c', '#2a4fd6', '#c93a2e', '#5d636c'];
export const INK_NAMES = ['Ink', 'Blue', 'Red', 'Graphite'];
export const ACCENT = '#ff5a1f';
