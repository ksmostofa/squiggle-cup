import type { Pt } from '../src/geom';
import { type Draw, ell, eye, ln } from './fixtures';

// Ordinary first drawings: what people actually draw in 30 seconds the first
// time, quick and a little lopsided. The house creatures are calibrated
// against these, so a beginner isn't consistently beaten by the bots.
// Pad pixels (600 × 600, y down), facing right.

const legs4 = (r: Parameters<Draw>[0], y: number, len: number, xs = [250, 280, 325, 355]) => xs.map((x) => ln(r, [[x, y], [x + 3, y + len]]));
const smile = (r: Parameters<Draw>[0], x: number, y: number, w = 20): Pt[] => ln(r, [[x - w / 2, y], [x, y + w / 3], [x + w / 2, y]], 2);

export const BEGINNERS: Record<string, Draw> = {
  'potato dog': (r) => [ell(r, 300, 300, 75, 40), ...legs4(r, 335, 60), eye(355, 290), ln(r, [[226, 295], [200, 270]])],
  'dog with a head': (r) => [ell(r, 290, 310, 70, 40), ell(r, 370, 270, 28, 26), ...legs4(r, 345, 55, [240, 265, 315, 340]), eye(375, 265), eye(385, 265)],
  'dog, face and tail': (r) => [ell(r, 290, 310, 70, 40), ell(r, 370, 270, 28, 26), ...legs4(r, 345, 55, [240, 265, 315, 340]), eye(372, 262), eye(386, 262), smile(r, 380, 280, 14), ln(r, [[222, 300], [195, 265]])],
  'stick person': (r) => [ell(r, 300, 290, 30, 50), ell(r, 300, 212, 24, 24), ln(r, [[290, 338], [280, 420]]), ln(r, [[310, 338], [322, 420]]), ln(r, [[272, 270], [245, 310]]), ln(r, [[328, 270], [355, 310]]), eye(294, 206), eye(308, 206)],
  'smiling person': (r) => [ell(r, 300, 290, 30, 50), ell(r, 300, 212, 24, 24), ln(r, [[290, 338], [280, 420]]), ln(r, [[310, 338], [322, 420]]), eye(296, 206), eye(310, 206), smile(r, 303, 220, 14)],
  'cat with ears': (r) => [ell(r, 290, 315, 65, 35), ell(r, 365, 275, 25, 23), ln(r, [[348, 260], [350, 238], [362, 254]], 2), ln(r, [[370, 254], [382, 238], [386, 262]], 2), ...legs4(r, 345, 50, [245, 268, 312, 335]), eye(368, 272), eye(380, 272), ln(r, [[226, 310], [205, 270], [215, 245]], 3)],
  'bird, V wings': (r) => [ell(r, 300, 320, 60, 35), ln(r, [[290, 290], [250, 210]]), ln(r, [[315, 290], [350, 210]]), eye(345, 310)],
  'bird with a beak': (r) => [ell(r, 300, 320, 55, 35), ell(r, 355, 285, 20, 18), ln(r, [[373, 280], [392, 288], [373, 295]], 2), ln(r, [[295, 290], [270, 210], [240, 200]]), eye(358, 280), ln(r, [[290, 354], [288, 400]]), ln(r, [[312, 354], [314, 400]])],
  'wavy snake': (r) => [ln(r, Array.from({ length: 8 }, (_, i): Pt => [130 + i * 45, 320 + (i % 2 ? -15 : 15)]), 4), eye(450, 318)],
  'snake outline': (r) => [ell(r, 300, 320, 170, 30), eye(445, 312), ln(r, [[470, 322], [492, 322]])],
  'smiley ball': (r) => [ell(r, 300, 300, 80, 80), eye(310, 275), eye(340, 275), smile(r, 325, 315, 36)],
  'blob with eyes': (r) => [ell(r, 300, 320, 100, 65), eye(320, 300), eye(350, 300)],
  'horse-ish': (r) => [ell(r, 280, 310, 85, 40), ln(r, [[350, 285], [385, 210]]), ell(r, 400, 200, 25, 15), ...legs4(r, 345, 85, [215, 240, 315, 340]), ln(r, [[196, 300], [170, 340]]), eye(402, 195)],
  'caterpillar': (r) => [ell(r, 300, 320, 130, 30), ...[190, 220, 250, 280, 310, 340, 370, 400].map((x) => ln(r, [[x, 345], [x, 380]])), eye(415, 310)],
  'spider': (r) => [ell(r, 300, 300, 50, 40), ...[255, 270, 285, 300, 315, 330].map((x, i) => ln(r, [[x, 335], [x + (i < 3 ? -20 : 20), 390]])), eye(315, 290), eye(330, 290)],
  'bat': (r) => [ell(r, 300, 320, 35, 35), ln(r, [[330, 305], [400, 260], [440, 280], [410, 300]], 3), ln(r, [[270, 305], [200, 260], [160, 280], [190, 300]], 3), eye(292, 312), eye(310, 312)],
  'just a circle': (r) => [ell(r, 300, 300, 80, 80)],
  'squiggle': (r) => [ln(r, [[150, 300], [200, 250], [250, 330], [300, 260], [350, 320], [400, 270], [450, 310]], 4)],
};
