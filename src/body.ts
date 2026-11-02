import type { Anatomy, Kind } from './analyze';
import { dcos, dsin } from './dmath';
import { type Pt, area, atan2, polyLen, rdp } from './geom';
import type { Course } from './course';

// A drawn creature as a physical body. One rigid body with real mass and
// inertia, moved by gravity, ground contact and friction, plus the forces its
// own parts make. The aim is motion that reads as alive:
//   legs  – muscles hold the body at a steady ride height (critically damped,
//           so no pogo bounce); feet stay planted until the body passes them,
//           then lift in an arc to the next spot. Neighbouring legs never lift
//           together, so bipeds alternate, quadrupeds trot, centipedes ripple
//   one leg – kangaroo hops: a crouch, a launch, a soft landing
//   wings – lift in proportion to wing area holds a cruising height; a heavy
//           body with small wings can't stay up
//   wheels – the body rides level at axle height, driven through the tyres
//   round bodies roll; long or legless ones slither on belly scales; blobs ooze
// Uses only + - * / and sqrt (dsin, dcos, atan2 are polynomial), so a race
// replays identically on every device.

export const G = 9.81;
const MU = 0.9;

export interface Leg {
  hip: Pt;       // local, metres, y up, origin at the centre of mass
  L: number;     // leg length, hip to drawn foot
  order: number; // left-to-right position among the legs
  foot: Pt;      // world position of the foot
  planted: boolean;
  from: Pt;      // step start
  to: Pt;        // step target
  p: number;     // step progress 0..1
  len: number;   // current hip-foot distance, for drawing
}

export interface Wing { root: Pt; span: number }
export interface Wheel { hub: Pt; r: number }
export interface BodyTuning { kind: Kind; vTarget: number }

export class Body {
  x = 0; y = 0; th = 0;
  vx = 0; vy = 0; w = 0;
  m: number;
  I: number;
  hull: Pt[];        // collision points, local
  rad: number;       // contact radius of each hull point
  legs: Leg[] = [];
  wings: Wing[] = [];
  wheels: Wheel[] = [];
  roll = 0;          // wheels: distance rolled, for drawing them turn
  axle = 0;          // wheels: centre-of-mass height when they touch the floor
  lift = 0;          // wings: the most lift they can make, newtons
  flap = 0;          // wing beat phase
  flapAmp = 0;
  squash = 1;        // render: vertical squash of the body (blobs, landings)
  crawl: boolean;    // legs too short to reach past the belly: paddles along on it
  R: number;
  height: number; length: number; front: number; bottom: number;
  ride: number;      // hip height the legs hold
  touching = false;
  airTime = 0;
  upsideTime = 0;
  lastLanding = 0;
  vTarget: number;
  gait = 0;          // gait phase, for bob and render
  readonly kind: Kind;
  private hopWait = 0;
  private iv = 0;       // pace integral
  private tailDamp: number;
  private hipY: number; // mean local height of the hips

  constructor(a: Anatomy, size: number, tuning: BodyTuning) {
    this.kind = tuning.kind;
    this.vTarget = tuning.vTarget;
    const [cx, cy] = a.center;
    const local = (p: Pt): Pt => [(p[0] - cx) * size, -(p[1] - cy) * size];

    const outline = a.body.pts.map(local);
    this.hull = resample(rdp(outline, 0.02), a.closed, 22);
    this.rad = a.closed ? 0.015 : Math.max(0.025, (a.body.w * size) / 2);
    this.bottom = Math.min(...this.hull.map((p) => p[1]));
    this.front = Math.max(...this.hull.map((p) => p[0]));
    this.height = a.box.h * size;
    this.length = a.box.w * size;
    this.R = this.hull.reduce((s, p) => s + Math.sqrt(p[0] * p[0] + p[1] * p[1]), 0) / this.hull.length;

    // Mass from painted area (or line length), plus every limb's ink.
    const bodyArea = a.closed ? area(outline) : polyLen(outline) * Math.max(0.05, this.rad * 2);
    const limbInk = a.parts.filter((p) => p !== a.body).reduce((s, p) => s + polyLen(p.pts) * size, 0);
    this.m = Math.max(0.4, bodyArea * 40 + limbInk * 0.8);
    const r2 = this.hull.reduce((s, p) => s + p[0] * p[0] + p[1] * p[1], 0) / this.hull.length;
    this.I = this.m * Math.max(0.01, r2 * 0.55);
    // The rest of the drawing touches the floor too: a second loop under the
    // body stands on it, a low tail drags along it, a head on a body that
    // pitches forward meets the floor instead of going through it. (Legs hold
    // themselves up, wings are in the air, eyes are inside.) A roller turns,
    // so anything sticking out of it bumps the floor as it rolls; it still
    // rolls on its body's radius.
    for (const p of a.parts) {
      if (p === a.body || p.kind === 'leg' || p.kind === 'wing' || p.kind === 'eye' || p.kind === 'wheel' || p.pts.length < 2) continue;
      const pts = p.pts.map(local);
      if (tuning.kind === 'roller' && Math.max(...pts.map((q) => Math.sqrt(q[0] * q[0] + q[1] * q[1]))) <= this.R) continue;
      this.hull.push(...resample(rdp(pts, 0.02), false, 16));
    }
    this.bottom = Math.min(...this.hull.map((p) => p[1]));

    for (const p of a.parts) {
      if (p.kind === 'leg') {
        const hip = local(p.pivot);
        const foot = p.pts.map(local).reduce((f, q) => (dist2(q, hip) > dist2(f, hip) ? q : f), hip);
        const L = Math.sqrt(dist2(foot, hip));
        if (L < 0.04) continue;
        this.legs.push({ hip, L, order: p.order, foot: [0, 0], planted: true, from: [0, 0], to: [0, 0], p: 1, len: L });
      } else if (p.kind === 'wing') {
        const root = local(p.pivot);
        this.wings.push({ root, span: Math.sqrt(p.pts.map(local).reduce((s, q) => Math.max(s, dist2(q, root)), 0)) });
      } else if (p.kind === 'wheel') {
        const hub = local(p.pivot);
        this.wheels.push({ hub, r: Math.sqrt(p.pts.map(local).reduce((s, q) => s + dist2(q, hub), 0) / p.pts.length) });
      }
    }
    this.legs.sort((p, q) => p.order - q.order).forEach((l, i) => { l.order = i; });
    // Wing lift ∝ span². Anything that reads as a flyer can at least get
    // airborne (1.4× its weight); big wings carry it with more to spare.
    if (tuning.kind === 'flyer') this.lift = Math.max(1.4 * this.m * G, this.wings.reduce((s, w) => s + 210 * w.span * w.span, 0));

    this.hipY = this.legs.length ? this.legs.reduce((s, l) => s + l.hip[1], 0) / this.legs.length : 0;
    const meanL = this.legs.length ? this.legs.reduce((s, l) => s + l.L, 0) / this.legs.length : 0;
    // Legs hold the hips at 92% of leg length: slightly bent, like a real stance.
    this.ride = meanL * 0.92;
    // If standing on those legs wouldn't lift the belly off the floor, it crawls.
    // (Standing, the centre sits at ride − hipY, so the belly clears by ride − hipY + bottom.)
    this.crawl = this.legs.length > 0 && this.ride - this.hipY + this.bottom < 0.02;
    this.tailDamp = 1 + 0.5 * Math.min(2, a.tails);
    if (this.legs.length) this.wheels = [];
    this.axle = this.wheels.reduce((m, wh) => Math.max(m, wh.r - wh.hub[1]), 0);
  }

  toWorld(p: Pt): Pt {
    const c = dcos(this.th), s = dsin(this.th);
    return [this.x + c * p[0] - s * p[1], this.y + s * p[0] + c * p[1]];
  }

  private get walker() { return this.legs.length > 0 && !this.crawl; }

  // Stand it on the floor at x with its feet down.
  place(x: number, course: Course) {
    this.x = x;
    const g = course.ground(x);
    this.y = this.walker ? g + this.ride - this.hipY : this.wheels.length ? g + this.axle : g - this.bottom + this.rad;
    for (const l of this.legs) {
      const h = this.toWorld(l.hip);
      l.foot = [h[0], this.walker ? course.ground(h[0]) : h[1] - l.L];
      l.planted = true;
      l.p = 1;
      l.len = Math.sqrt(dist2(h, l.foot));
    }
  }

  step(h: number, course: Course, mult: number) {
    const c = dcos(this.th), s = dsin(this.th);
    const kind = this.kind;
    const vT = this.vTarget * mult;
    let fx = 0, fy = -this.m * G, tq = 0;
    let contacts = 0, support = 0;
    const flying = this.lift > 0 && mult > 0;

    // Pace: proportional plus integral, so every kind really settles at its
    // target speed whatever drag its belly or feet put up.
    const err = vT - this.vx;
    this.iv = mult > 0 ? clamp(this.iv + err * h, -0.6, 0.6) : 0;
    const pace = this.m * (3 * err + 2.5 * this.iv);

    // ---- Body against the floor ----
    // Stiffness, damping and friction are shared across the points in
    // contact: a long belly lying flat touches with twenty points at once,
    // and per-point gains would add up past what the integrator can hold
    // (that was the snake's bounce and backward jitter).
    const hits: { rx: number; ry: number; ct: ReturnType<Course['contact']> }[] = [];
    for (const p of this.hull) {
      const rx = c * p[0] - s * p[1], ry = s * p[0] + c * p[1];
      const ct = course.contact(this.x + rx, this.y + ry - this.rad);
      if (ct.d > 0) hits.push({ rx, ry, ct });
    }
    const share = 1 / Math.max(1, hits.length);
    for (const { rx, ry, ct } of hits) {
      contacts++;
      // Gains scale with the mass this point actually moves: a contact far
      // from the centre also spins the body, so it acts on less mass. Without
      // this a long body touching only at its tips (a zigzag snake) overshoots
      // every step and is flung into the air.
      const arm = rx * ct.ny - ry * ct.nx;
      const eff = share / (1 + (this.m * arm * arm) / this.I);
      const kc = this.m * 6000 * eff, cd = this.m * 140 * eff, kf = this.m * 60 * eff;
      const pvx = this.vx - this.w * ry, pvy = this.vy + this.w * rx;
      const vn = pvx * ct.nx + pvy * ct.ny;
      const fn = Math.max(0, kc * ct.d - cd * vn);
      const tx = ct.ny, ty = -ct.nx;
      const vt = pvx * tx + pvy * ty;
      let mu = kind === 'roller' ? 1.1 : 0.5;
      if (!this.walker && kind !== 'roller') mu = vt > 0 ? 0.1 : 0.9; // belly scales: slide forwards, grip back
      const ft = clamp(-vt * kf, -mu * fn, mu * fn);
      const ex = fn * ct.nx + ft * tx, ey = fn * ct.ny + ft * ty;
      fx += ex; fy += ey;
      tq += rx * ey - ry * ex;
      support += fn * ct.ny;
    }

    const slope = course.slope(this.x);
    let ang = this.th % 6.283185307179586;
    if (ang > 3.141592653589793) ang -= 6.283185307179586;
    if (ang < -3.141592653589793) ang += 6.283185307179586;
    let upright = 0; // torque budget for staying level
    let standing = false;

    // ---- Walking and running ----
    if (this.walker) {
      // Hip height above the floor, averaged over the hips.
      const hipW = this.legs.map((l) => [this.x + c * l.hip[0] - s * l.hip[1], this.y + s * l.hip[0] + c * l.hip[1]] as Pt);
      const hipH = hipW.reduce((a, p) => a + p[1] - course.ground(p[0]), 0) / hipW.length;
      const reach = this.ride / 0.92;
      standing = hipH < reach * 1.08;
      if (standing && kind !== 'hopper') {
        // Muscles: critically damped support at ride height, with a small bob
        // each time a foot lifts, plus drive limited by grip.
        const lifting = this.legs.filter((l) => !l.planted).length / this.legs.length;
        const want = this.ride * (1 - 0.05 * lifting);
        const om = 2 * Math.sqrt(G / Math.max(0.15, this.ride)) + 6;
        const up = clamp(this.m * (G + om * om * (want - hipH) - 2 * om * this.vy), 0, 3 * this.m * G);
        const drive = clamp(pace, -MU * up, MU * up);
        fy += up;
        fx += drive;
        support += up;
        upright += 0.45 * up * this.length + this.I * 30;
      }
      if (kind === 'hopper') this.hop(h, hipH, reach, vT, (f, g2) => { fx += f; fy += g2; });
      this.steps(h, course, hipW, standing);
    } else if (this.legs.length) {
      // Crawling: legs paddle in a ripple; the belly scales do the work.
      this.gait += h * (3 + 2.5 * Math.abs(this.vx));
      for (const l of this.legs) {
        const hw = this.toWorld(l.hip);
        const a2 = 0.5 * dsin(this.gait + l.order * 1.9);
        const fx = hw[0] + l.L * dsin(a2);
        l.foot = [fx, Math.max(course.ground(fx), hw[1] - l.L * dcos(a2))]; // paddling feet stay on the floor, not in it
        l.len = Math.sqrt(dist2(hw, l.foot));
      }
    }

    // ---- Driving on wheels ----
    if (this.wheels.length) {
      // Suspension holds the axles at wheel height; drive is limited by grip.
      const hh = this.y - course.ground(this.x);
      standing = hh < this.axle * 1.08;
      if (standing) {
        const om = 2 * Math.sqrt(G / Math.max(0.15, this.axle)) + 6;
        const up = clamp(this.m * (G + om * om * (this.axle - hh) - 2 * om * this.vy), 0, 3 * this.m * G);
        fy += up;
        fx += clamp(pace, -MU * up, MU * up);
        support += up;
        upright += 0.45 * up * this.length + this.I * 30;
      }
      this.roll += this.vx * h;
      this.gait += h * (2 + 3 * Math.abs(this.vx));
    }

    // ---- Slithering, oozing, crawling ----
    if (contacts && !this.walker && !this.wheels.length && kind !== 'roller' && !flying) {
      // Waves along the body push back against the grippy scales. The wave
      // runs tail-ward a little faster than the body goes forward, so each
      // bit of body follows the one ahead of it (gait is the wave phase).
      fx += clamp(pace, -0.5 * support, 0.8 * support);
      upright += 0.4 * support * this.length + this.I * 20;
      this.gait += h * (1.5 + 7 * Math.max(0, this.vx));
    }
    if (kind === 'roller') {
      const spin = (vT + 0.8 * this.iv) / this.R;
      tq += clamp(this.I * 10 * (-spin - this.w), -this.m * G * this.R * 0.45, this.m * G * this.R * 0.45);
    }

    // ---- Flying ----
    if (!flying && this.lift > 0) {
      // Waiting on the line: wings folded, a slow idle beat.
      this.flapAmp += (0.12 - this.flapAmp) * Math.min(1, h * 6);
      this.flap += 6.283185307179586 * 1.2 * h;
    }
    if (flying) {
      const alt = this.y + this.bottom - course.ground(this.x);
      const cruise = 0.45 + this.height * 0.4;
      const om = 3.2;
      const need = this.m * (G + om * om * (cruise - alt) - 2 * om * this.vy);
      const up = clamp(need, 0, this.lift);
      this.flapAmp += (clamp(0.25 + up / Math.max(1e-6, this.lift), 0.3, 1) - this.flapAmp) * Math.min(1, h * 6);
      const span = this.wings.reduce((m, wg) => Math.max(m, wg.span), 0.1);
      this.flap += 6.283185307179586 * clamp(1.6 / Math.sqrt(span), 2, 7) * (0.6 + 0.4 * this.flapAmp) * h;
      fy += up * (1 + 0.18 * dsin(this.flap)); // a gentle bob with each beat
      fx += clamp(pace, -0.5 * up - 1, 0.6 * up + 1);
      upright += this.lift * 0.4 * this.length + this.I * 30;
    }

    // ---- Staying level (follows the slope a little) ----
    this.upsideTime = Math.abs(ang) > 1.3 && (contacts || standing) ? this.upsideTime + h : 0;
    if (kind !== 'roller') {
      const target = this.walker || flying ? atan2(slope, 1) * 0.5 : atan2(slope, 1);
      const op = 9;
      let want = this.I * (op * op * (target - ang) - 2 * op * this.w * this.tailDamp);
      let limit = upright + this.I * 6 * this.tailDamp;
      if (this.upsideTime > 0.6) {
        // Knocked over: roll back up and carry on.
        want = -Math.sign(ang) * this.I * 40 - this.I * 6 * this.w;
        limit = this.m * G * this.height * 1.5;
        if (this.upsideTime < 0.6 + h * 1.5) this.vy += 1.5;
      }
      tq += clamp(want, -limit, limit);
    }

    // ---- Integrate (semi-implicit Euler) ----
    this.vx += (fx / this.m) * h;
    this.vy += (fy / this.m) * h;
    this.w += (tq / this.I) * h;
    this.x += this.vx * h;
    this.y += this.vy * h;
    this.th += this.w * h;

    const any = contacts > 0 || standing;
    if (any) {
      if (this.airTime > 0.35) this.lastLanding = this.airTime;
      this.airTime = 0;
    } else this.airTime += h;
    this.touching = any;
    this.squash += (1 - this.squash) * Math.min(1, h * 10);
    if (!this.walker && !this.wheels.length && !flying && kind !== 'roller' && contacts) this.squash = 1 + (kind === 'jelly' ? 0.07 : 0.02) * dsin(this.gait * (kind === 'jelly' ? 0.6 : 1));
  }

  // Feet: planted feet stay put; a foot left behind (or too far ahead) steps
  // to a spot ahead in a smooth arc, but only while its neighbours are down.
  private steps(h: number, course: Course, hipW: Pt[], standing: boolean) {
    const v = Math.max(0, this.vx);
    const meanL = this.ride / 0.92;
    const stride = meanL * (0.7 + 0.25 * Math.min(2.5, v / Math.sqrt(G * meanL)));
    const dur = clamp((0.55 * stride) / Math.max(0.6, v), 0.12, 0.4);
    const legs = this.legs;
    for (let i = 0; i < legs.length; i++) {
      const l = legs[i], hp = hipW[i];
      if (!standing) {
        // In the air: legs reach down and a little forward, ready to land.
        const tx = hp[0] + 0.15 * meanL, ty = hp[1] - l.L * 0.95;
        l.foot = [l.foot[0] + (tx - l.foot[0]) * Math.min(1, h * 12), l.foot[1] + (ty - l.foot[1]) * Math.min(1, h * 12)];
        l.planted = false;
        l.p = 1;
      } else if (l.planted || l.p >= 1) {
        if (!l.planted) {
          // Touch down where it is.
          l.foot = [l.foot[0], course.ground(l.foot[0])];
          l.planted = true;
        }
        const behind = hp[0] - l.foot[0], ahead = l.foot[0] - hp[0];
        const neighboursDown = (i === 0 || legs[i - 1].planted) && (i === legs.length - 1 || legs[i + 1].planted);
        if ((behind > stride * 0.5 || ahead > stride * 0.75 || this.walkerStuck(l, hp)) && (neighboursDown || legs.length === 1)) {
          l.planted = false;
          l.p = 0;
          l.from = [l.foot[0], l.foot[1]];
          const tx = hp[0] + stride * 0.5 + v * dur * 0.5;
          l.to = [tx, course.ground(tx)];
        }
      } else {
        // Mid-step: an eased arc, retargeted as the body moves.
        l.p = Math.min(1, l.p + h / dur);
        const tx = hp[0] + stride * 0.5 + v * dur * 0.5 * (1 - l.p);
        l.to = [tx, course.ground(tx)];
        const e = l.p * l.p * (3 - 2 * l.p);
        const arc = (0.18 * meanL + 0.04 * v) * 4 * l.p * (1 - l.p);
        l.foot = [l.from[0] + (l.to[0] - l.from[0]) * e, l.from[1] + (l.to[1] - l.from[1]) * e + arc];
        if (l.p >= 1) { l.foot = [l.to[0], l.to[1]]; l.planted = true; }
      }
      l.len = Math.sqrt(dist2(hp, l.foot));
    }
    this.gait += (v * h) / Math.max(0.1, stride);
  }

  // A foot that ended up out of reach (after a landing or a stumble) re-steps.
  private walkerStuck(l: Leg, hp: Pt) { return dist2(hp, l.foot) > l.L * l.L * 1.3; }

  // One leg: kangaroo hops. Crouch on landing, launch when the crouch is done.
  private hop(h: number, hipH: number, reach: number, vT: number, push: (fx: number, fy: number) => void) {
    if (hipH < reach * 1.02) {
      // Landing and crouch: soft, critically damped.
      const om = 14;
      const want = this.ride * 0.8;
      push(clamp(this.m * (4 * (vT - this.vx) + 2.5 * this.iv), -this.m * G, this.m * G), clamp(this.m * (G + om * om * (want - hipH) - 2 * om * this.vy), 0, 4 * this.m * G));
      this.hopWait += h;
      this.squash = 0.9 + 0.1 * (hipH / reach);
      if (this.hopWait > 0.12 && this.vy > -0.2) {
        // Launch: a hop about a third of its leg length high, carrying its speed.
        this.vy = Math.sqrt(2 * G * Math.max(0.12, this.ride * 0.35));
        this.vx = Math.max(this.vx, vT * 0.95);
        this.hopWait = 0;
        this.squash = 1.08;
      }
    }
  }
}

const dist2 = (a: Pt, b: Pt) => (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

// Evenly spaced points along an outline, so contact is smooth whatever was drawn.
function resample(pts: Pt[], closed: boolean, n: number): Pt[] {
  const path = closed ? [...pts, pts[0]] : pts;
  if (path.length < 2) return pts.slice();
  const total = polyLen(path);
  const out: Pt[] = [];
  let seg = 0, acc = 0;
  for (let i = 0; i < (closed ? n : n + 1); i++) {
    const want = (total * i) / n;
    while (seg < path.length - 2 && acc + segLen(path, seg) < want) { acc += segLen(path, seg); seg++; }
    const f = clamp((want - acc) / (segLen(path, seg) || 1e-9), 0, 1);
    out.push([path[seg][0] + (path[seg + 1][0] - path[seg][0]) * f, path[seg][1] + (path[seg + 1][1] - path[seg][1]) * f]);
  }
  return out;
}
const segLen = (p: Pt[], i: number) => Math.sqrt(dist2(p[i], p[i + 1]));
