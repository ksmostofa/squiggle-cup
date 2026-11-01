import RAPIER from '@dimforge/rapier2d-deterministic-compat';
import { worldGroups } from '../creature';
import { type Rng, range } from '../rng';
import type { Course, Prop, Venue } from './venue';

// PRD §5.1. All numbers are starting values for tuning.
const HURDLES = [11, 18, 70, 77, 84];
const SEESAW_X = 27, SEESAW_LEN = 5.5, PIVOT_H = 0.45;
const SEESAW_TILT = 0.16437558403065097; // asin(PIVOT_H / (SEESAW_LEN / 2)), so the left end rests on the carpet
const TUNNEL = { x0: 39, x1: 45, y: 1.55 };
const POLES_X = 54, POLE_COUNT = 6, POLE_GAP = 1.3, POLE_H = 1.2;
const FINISH = 92;

// A thin board hinged at its foot that springs back upright. Heavy creatures
// can flatten it; light ones have to leap.
function springBoard(world: RAPIER.World, ground: RAPIER.RigidBody, x: number, h: number, stiffness: number): RAPIER.RigidBody {
  const rb = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(x, h / 2 + 0.01).setCanSleep(false).setAngularDamping(1.5),
  );
  world.createCollider(
    RAPIER.ColliderDesc.roundCuboid(0.015, h / 2 - 0.015, 0.015).setDensity(0.6).setFriction(0.4).setCollisionGroups(worldGroups),
    rb,
  );
  const j = world.createImpulseJoint(
    RAPIER.JointData.revolute({ x, y: 0.01 }, { x: 0, y: -h / 2 }), ground, rb, true,
  ) as RAPIER.RevoluteImpulseJoint;
  j.setContactsEnabled(false);
  j.setLimits(-1.45, 1.45);
  j.configureMotorPosition(0, stiffness, stiffness * 0.08);
  return rb;
}

function build(world: RAPIER.World, rng: Rng): Course {
  const props: Prop[] = [];
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(90, 1).setTranslation(45, -1).setFriction(0.9).setCollisionGroups(worldGroups), ground,
  );
  // Back wall behind the start so nobody wanders off the wrong way.
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.5, 6).setTranslation(-6.5, 6).setCollisionGroups(worldGroups), ground,
  );

  for (const x of HURDLES) {
    const h = range(rng, 0.38, 0.6);
    props.push({ type: 'hurdle', rb: springBoard(world, ground, x, h, 18), h });
  }

  const pivotX = SEESAW_X + SEESAW_LEN / 2;
  world.createCollider(
    RAPIER.ColliderDesc.convexHull(new Float32Array([pivotX - 0.35, 0, pivotX + 0.35, 0, pivotX, PIVOT_H - 0.07]))!
      .setCollisionGroups(worldGroups),
    ground,
  );
  const plank = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(pivotX, PIVOT_H).setRotation(SEESAW_TILT).setCanSleep(false).setAngularDamping(0.4),
  );
  world.createCollider(
    RAPIER.ColliderDesc.roundCuboid(SEESAW_LEN / 2 - 0.03, 0.035, 0.03).setDensity(0.5).setFriction(1.1).setCollisionGroups(worldGroups),
    plank,
  );
  const pj = world.createImpulseJoint(RAPIER.JointData.revolute({ x: pivotX, y: PIVOT_H }, { x: 0, y: 0 }), ground, plank, true);
  pj.setContactsEnabled(false);
  props.push({ type: 'seesaw', rb: plank, len: SEESAW_LEN, pivot: [pivotX, PIVOT_H] });

  world.createCollider(
    RAPIER.ColliderDesc.cuboid((TUNNEL.x1 - TUNNEL.x0) / 2, 0.12)
      .setTranslation((TUNNEL.x0 + TUNNEL.x1) / 2, TUNNEL.y + 0.12).setCollisionGroups(worldGroups),
    ground,
  );
  props.push({ type: 'tunnel', ...TUNNEL });

  for (let i = 0; i < POLE_COUNT; i++) {
    props.push({ type: 'pole', rb: springBoard(world, ground, POLES_X + i * POLE_GAP, POLE_H, 9), h: POLE_H });
  }
  props.push({ type: 'finish', x: FINISH });

  // Where a sensible pilot would think about leaping.
  const leapAt = [...HURDLES, ...Array.from({ length: POLE_COUNT }, (_, i) => POLES_X + i * POLE_GAP)];
  return { finish: FINISH, leapAt, props };
}

export const bestInShow: Venue = {
  id: 'best-in-show',
  index: 0,
  name: 'Best in Show',
  tagline: "The world's most prestigious agility championship.",
  inks: ['#1d1b2e', '#c8372d', '#2a6fdb', '#2f9e5a'],
  pad: '#f4f1e6',
  build,
};
