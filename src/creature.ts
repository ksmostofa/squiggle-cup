import RAPIER from '@dimforge/rapier2d-deterministic-compat';
import type { Anatomy, Stroke } from './analyze';
import { type Pt, polyLen, rdp } from './geom';

export const PX = 1 / 200; // pad pixels -> metres (the 600px pad is 3m across)

export interface Part {
  rb: RAPIER.RigidBody;
  joint?: RAPIER.RevoluteImpulseJoint;
  strokes: { pts: Pt[]; color: string; w: number }[]; // local metres, y up
}

export interface Pilot {
  throttle: number;
  charge: number | null;   // seconds the leap button has been held
  leapCooldown: number;
}

export interface CreatureStats {
  taps: number;
  flips: number;
  airtime: number;
  bestAir: number;
  upsideTime: number;
  maxSpeedUpside: number;
  nudges: number;
  smashed: number;
}

// Each creature gets its own collision bit so its parts never collide with
// each other, but still hit the world and the other creatures.
const WORLD_BIT = 1;
export const worldGroups = (WORLD_BIT << 16) | 0xffff;
const creatureGroups = (idx: number) => {
  const bit = 1 << (idx + 1);
  return (bit << 16) | (0xffff & ~bit);
};

export class Creature {
  body: Part;
  limbs: Part[] = [];
  eyes: { c: Pt; r: number; px: number; py: number; vx: number; vy: number }[];
  mass = 0;
  height = 0;
  reach = 0;
  pilot: Pilot = { throttle: 0, charge: null, leapCooldown: 0 };
  stats: CreatureStats = { taps: 0, flips: 0, airtime: 0, bestAir: 0, upsideTime: 0, maxSpeedUpside: 0, nudges: 0, smashed: 0 };
  finishTime: number | null = null;
  eliminatedAt: number | null = null;
  grounded = true;
  private airRun = 0;
  private lastAngleSign = 1;
  private upsideRun = 0;
  private stuckClock = 0;
  private stuckX = 0;

  constructor(
    public world: RAPIER.World,
    public anatomy: Anatomy,
    public name: string,
    public idx: number,
    public facing: 1 | -1,
    x: number,
    groundY: number,
    public isPlayer = false,
  ) {
    const [cx, cy] = anatomy.center;
    const toLocal = (p: Pt): Pt => [(p[0] - cx) * PX * facing, -(p[1] - cy) * PX];
    const groups = creatureGroups(idx);

    const bodyPts = anatomy.body.pts.map(toLocal);
    const limbPts = anatomy.limbs.map((l) => l.pts.map(toLocal));
    const all = [...bodyPts, ...limbPts.flat()];
    const minY = Math.min(...all.map((p) => p[1]));
    const maxY = Math.max(...all.map((p) => p[1]));
    this.height = maxY - minY;

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, groundY - minY + 0.08)
        .setLinearDamping(0.05)
        .setAngularDamping(0.6)
        .setCanSleep(false),
    );
    const simple = rdp(bodyPts, 0.015);
    let made = false;
    if (anatomy.body.closed && simple.length >= 3) {
      const hull = RAPIER.ColliderDesc.convexHull(new Float32Array(simple.flat()));
      if (hull) {
        world.createCollider(hull.setDensity(1).setFriction(0.7).setRestitution(0.05).setCollisionGroups(groups), body);
        made = true;
      }
    }
    if (!made) addCapsules(world, body, simple, Math.max(0.04, (anatomy.body.w * PX) / 2), groups, 1, 0.7);

    const strokeLocal = (s: Stroke) => ({ pts: s.pts.map(toLocal), color: s.color, w: s.w * PX });
    this.body = {
      rb: body,
      strokes: [strokeLocal(anatomy.body as Stroke), ...anatomy.decor.map(strokeLocal)],
    };
    this.eyes = anatomy.eyes.map((e) => ({ c: toLocal(e.c), r: e.r * PX, px: 0, py: 0, vx: 0, vy: 0 }));

    anatomy.limbs.forEach((limb, i) => {
      const pts = limbPts[i];
      const anchor = pts[0];
      const rel = pts.map((p): Pt => [p[0] - anchor[0], p[1] - anchor[1]]);
      const bt = body.translation();
      const rb = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(bt.x + anchor[0], bt.y + anchor[1])
          .setAngularDamping(0.3)
          .setCanSleep(false),
      );
      addCapsules(world, rb, rdp(rel, 0.02), Math.max(0.035, (limb.w * PX) / 2), groups, 1.2, 1.6);
      const joint = world.createImpulseJoint(
        RAPIER.JointData.revolute({ x: anchor[0], y: anchor[1] }, { x: 0, y: 0 }),
        body, rb, true,
      ) as RAPIER.RevoluteImpulseJoint;
      this.limbs.push({ rb, joint, strokes: [{ pts: rel, color: limb.color, w: limb.w * PX }] });
      this.reach = Math.max(this.reach, polyLen(rel));
    });

    this.mass = body.mass() + this.limbs.reduce((m, l) => m + l.rb.mass(), 0);
    const torque = 30 * this.mass;
    for (const l of this.limbs) {
      l.joint!.configureMotorModel(RAPIER.MotorModel.ForceBased);
      l.joint!.setMotorMaxForce(torque);
    }
    this.stuckX = x;
  }

  get pos() { return this.body.rb.translation(); }
  get done() { return this.finishTime !== null || this.eliminatedAt !== null; }

  tap() {
    if (this.done) return;
    this.pilot.throttle = Math.min(this.pilot.throttle + 1, 5);
    this.stats.taps++;
  }

  press() { if (!this.done) { this.tap(); this.pilot.charge = 0; } }

  // Returns true when the release turned into a leap.
  release(): boolean {
    const held = this.pilot.charge;
    this.pilot.charge = null;
    if (held === null || held < 0.2 || this.done) return false;
    if (this.pilot.leapCooldown > 0 || !this.grounded) return false;
    const c = Math.min(1, (held - 0.2) / 0.7);
    const m = this.mass;
    const rb = this.body.rb;
    rb.applyImpulse({ x: m * (1.2 + 2.2 * c) * this.facing, y: m * (3 + 4.5 * c) }, true);
    for (const l of this.limbs) l.rb.applyImpulse({ x: 0, y: l.rb.mass() * (3 + 4.5 * c) }, true);
    this.pilot.leapCooldown = 0.9;
    return true;
  }

  step(dt: number, now: number) {
    const p = this.pilot;
    p.throttle *= Math.exp(-1.7 * dt);
    if (p.charge !== null) p.charge += dt;
    p.leapCooldown = Math.max(0, p.leapCooldown - dt);

    const done = this.done;
    const spin = done ? 0 : p.throttle;
    const target = -this.facing * spin * 3.4;
    const factor = 2 + 10 * Math.min(spin, 1);
    for (const l of this.limbs) l.joint!.configureMotorVelocity(target, factor);

    // A weak urge to stay upright. Weak enough that flips still happen,
    // stronger once it has been upside down for a while so nobody stays stuck.
    const rb = this.body.rb;
    let a = rb.rotation() % (Math.PI * 2);
    if (a > Math.PI) a -= Math.PI * 2;
    if (a < -Math.PI) a += Math.PI * 2;
    const upside = Math.abs(a) > 2.2;
    this.upsideRun = upside ? this.upsideRun + dt : 0;
    const k = this.upsideRun > 1.4 ? 30 : 7;
    rb.applyTorqueImpulse((-k * a - 1.6 * rb.angvel()) * rb.mass() * dt * 0.6, true);

    const sign = Math.sign(a) || 1;
    if (Math.abs(a) > 2.6 && sign !== this.lastAngleSign) this.stats.flips++;
    if (Math.abs(a) > 2.6) this.lastAngleSign = sign;
    if (upside) {
      this.stats.upsideTime += dt;
      this.stats.maxSpeedUpside = Math.max(this.stats.maxSpeedUpside, Math.abs(rb.linvel().x));
    }

    this.grounded = this.probeGround();
    if (!this.grounded) {
      this.airRun += dt;
      this.stats.airtime += dt;
      this.stats.bestAir = Math.max(this.stats.bestAir, this.airRun);
    } else this.airRun = 0;

    // Stuck under a ceiling or wedged in a hurdle: the handler intervenes.
    if (!done) {
      this.stuckClock += dt;
      if (this.stuckClock > 5) {
        const x = this.pos.x;
        if ((x - this.stuckX) * this.facing < 0.6) this.nudge(now);
        this.stuckClock = 0;
        this.stuckX = this.pos.x;
      }
    }
    this.updateEyes(dt);
  }

  onNudge: ((c: Creature, now: number) => void) | null = null;
  nudge(now: number) {
    const shift = 2.2 * this.facing;
    for (const part of [this.body, ...this.limbs]) {
      const t = part.rb.translation();
      part.rb.setTranslation({ x: t.x + shift, y: t.y + 1.2 }, true);
      part.rb.setLinvel({ x: 0, y: 0 }, true);
    }
    this.stats.nudges++;
    this.onNudge?.(this, now);
  }

  private probeGround(): boolean {
    const t = this.pos;
    const reach = this.height + 0.35;
    const ray = new RAPIER.Ray({ x: t.x, y: t.y }, { x: 0, y: -1 });
    const own = new Set([this.body.rb.handle, ...this.limbs.map((l) => l.rb.handle)]);
    const hit = this.world.castRay(ray, reach, true, undefined, undefined, undefined, undefined,
      (col) => !own.has(col.parent()!.handle));
    return hit !== null;
  }

  // Render-only spring physics for googly pupils.
  private lastV = { x: 0, y: 0 };
  private updateEyes(dt: number) {
    const v = this.body.rb.linvel();
    const ax = (v.x - this.lastV.x) / dt, ay = (v.y - this.lastV.y) / dt;
    this.lastV = { x: v.x, y: v.y };
    const rot = this.body.rb.rotation();
    const c = Math.cos(-rot), s = Math.sin(-rot);
    // gravity and inertia, rotated into the body frame
    const gx = -ax * 0.02, gy = -9.8 * 0.05 - ay * 0.02;
    const lx = gx * c - gy * s, ly = gx * s + gy * c;
    for (const e of this.eyes) {
      e.vx += (lx - e.px * 60) * dt - e.vx * 4 * dt;
      e.vy += (ly - e.py * 60) * dt - e.vy * 4 * dt;
      e.px += e.vx * dt * 8; e.py += e.vy * dt * 8;
      const m = Math.hypot(e.px, e.py), lim = e.r * 0.45;
      if (m > lim) { e.px *= lim / m; e.py *= lim / m; e.vx *= -0.4; e.vy *= -0.4; }
    }
  }

  freeze() {
    for (const part of [this.body, ...this.limbs]) part.rb.setBodyType(RAPIER.RigidBodyType.Fixed, false);
  }
}

function addCapsules(world: RAPIER.World, rb: RAPIER.RigidBody, pts: Pt[], r: number, groups: number, density: number, friction: number) {
  if (pts.length === 1) pts = [pts[0], [pts[0][0] + 0.01, pts[0][1]]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-4) continue;
    const ang = Math.atan2(by - ay, bx - ax) - Math.PI / 2;
    world.createCollider(
      RAPIER.ColliderDesc.capsule(len / 2, r)
        .setTranslation((ax + bx) / 2, (ay + by) / 2)
        .setRotation(ang)
        .setDensity(density)
        .setFriction(friction)
        .setRestitution(0.05)
        .setCollisionGroups(groups),
      rb,
    );
  }
}
