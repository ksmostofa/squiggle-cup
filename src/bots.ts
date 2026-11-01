import type { Stroke } from './analyze';
import type { Creature } from './creature';
import type { Pt } from './geom';
import type { InputType } from './race';
import { type Rng, pick, range } from './rng';

// cos and sin of 15°, written out: the outline is walked by repeated rotation
// so generated creatures come out identical in every browser.
const C15 = 0.9659258262890683, S15 = 0.25881904510252074;

// PRD §11.1: a lumpy closed body, 0–6 legs, dot eyes, an optional tail.
// Built from pad-pixel strokes and read by analyze() like any player drawing.
export function botDrawing(rng: Rng, inks: string[]): Stroke[] {
  const ink = pick(rng, inks);
  const w = rng() < 0.3 ? 14 : 7;
  const cx = 300, cy = range(rng, 230, 300);
  const rx = range(rng, 60, 125), ry = range(rng, 45, 95);

  const n = 24;
  const raw = Array.from({ length: n }, () => range(rng, 0.8, 1.2));
  const lump = raw.map((_, i) => (raw[(i + n - 1) % n] + 2 * raw[i] + raw[(i + 1) % n]) / 4);
  const body: Pt[] = [];
  let c = 1, s = 0;
  for (let i = 0; i <= n; i++) {
    const k = lump[i % n];
    body.push([cx + c * rx * k, cy + s * ry * k]);
    [c, s] = [c * C15 - s * S15, s * C15 + c * S15];
  }
  const strokes: Stroke[] = [{ pts: body, color: ink, w }];

  // Legs hang off the lower arc (indices 2..10 run from just right of bottom to just left).
  const legs = pick(rng, [0, 1, 2, 2, 3, 4, 4, 4, 6]);
  const legLen = range(rng, 45, 160);
  for (let k = 0; k < legs; k++) {
    const i = Math.round(2 + ((k + 0.5) * 8) / legs);
    const [x, y] = body[i];
    const L = legLen * range(rng, 0.85, 1.15);
    const splay = range(rng, -0.35, 0.35) * L;
    const knee = range(rng, -0.2, 0.2) * L;
    const pts: Pt[] = [];
    for (let j = 0; j <= 4; j++) {
      const f = j / 4;
      const bend = knee * 4 * f * (1 - f);
      pts.push([x + splay * f + bend, y + L * f]);
    }
    strokes.push({ pts, color: ink, w: 7 });
  }

  // Eyes on the upper front (right) of the body.
  const eyes = rng() < 0.25 ? 1 : 2;
  for (let e = 0; e < eyes; e++) {
    const i = 20 + e * 2;
    const f = range(rng, 0.45, 0.65);
    const [bx, by] = body[i];
    strokes.push({ pts: [[cx + (bx - cx) * f, cy + (by - cy) * f]], color: '#1d1b2e', w: 7 });
  }

  if (rng() < 0.35) {
    const [x, y] = body[12];
    const L = range(rng, 40, 90);
    strokes.push({ pts: [[x, y], [x - L * 0.5, y - L * 0.3], [x - L, y - L * 0.1]], color: ink, w: 7 });
  }

  for (const st of strokes) for (const p of st.pts) { p[0] = clamp(p[0]); p[1] = clamp(p[1]); }
  return strokes;
}

const clamp = (v: number) => Math.max(0, Math.min(599, v));

// Taps at 2.4–4.4 per second with jitter; leaps ~1.6 m before obstacles, with a
// per-bot chance of getting it right. Also hops along open ground now and then,
// as players do: leaping is most of the speed (see test/sim.test.ts).
export class BotPilot {
  private rate: number;
  private skill: number;
  private nextTap = 0;
  private nextHop: number;
  private releaseAt: number | null = null;
  private decided = new Set<number>();

  constructor(private rng: Rng) {
    this.rate = range(rng, 2.4, 4.4);
    this.skill = range(rng, 0.45, 0.9);
    this.nextHop = this.hopGap();
  }

  think(t: number, c: Creature, leapAt: number[]): InputType | null {
    if (this.releaseAt !== null) {
      if (t < this.releaseAt) return null;
      this.releaseAt = null;
      this.nextTap = t + this.gap();
      return 'release';
    }
    const front = c.pos.x + c.radius * 0.5;
    for (const x of leapAt) {
      const ahead = x - front;
      if (ahead < 1.2 || ahead > 1.8 || this.decided.has(x)) continue;
      this.decided.add(x);
      if (this.rng() < this.skill && c.grounded) {
        this.releaseAt = t + range(this.rng, 0.35, 0.9);
        return 'press';
      }
    }
    if (t >= this.nextHop && c.grounded && c.pilot.leapCooldown === 0) {
      this.nextHop = t + this.hopGap();
      this.releaseAt = t + range(this.rng, 0.3, 0.75);
      return 'press';
    }
    if (t >= this.nextTap) {
      this.nextTap = t + this.gap();
      return 'tap';
    }
    return null;
  }

  private hopGap() { return range(this.rng, 1.1, 3.2) / this.skill; }
  private gap() { return (1 / this.rate) * range(this.rng, 0.7, 1.3); }
}
