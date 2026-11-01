import type RAPIER from '@dimforge/rapier2d-deterministic-compat';
import type { Pt } from '../geom';
import type { Rng } from '../rng';

// Everything a renderer needs to draw the course. Dynamic props carry their body.
export type Prop =
  | { type: 'hurdle'; rb: RAPIER.RigidBody; h: number }
  | { type: 'pole'; rb: RAPIER.RigidBody; h: number }
  | { type: 'seesaw'; rb: RAPIER.RigidBody; len: number; pivot: Pt }
  | { type: 'tunnel'; x0: number; x1: number; y: number }
  | { type: 'finish'; x: number };

export interface Course {
  finish: number;
  leapAt: number[]; // obstacle x positions, for bot pilots
  props: Prop[];
}

export interface Venue {
  id: string;
  index: number; // byte stored in dare links
  name: string;
  tagline: string;
  inks: string[];
  pad: string;
  build(world: RAPIER.World, rng: Rng): Course;
}
