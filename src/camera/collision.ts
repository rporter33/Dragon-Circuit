// Camera collision against the world: a sphere traced along the boom using the terrain's
// conservative distance field. The distance field covers rock AND the localized collider index
// (buildings, trunks, decks, canopies), so the camera stays out of all of them. Foliage is soft:
// the rigs ease in front of a canopy instead of snapping through it, and never lift over one.
// Telling the two apart costs one collideSphere (≈ 9 µs), and only when the boom is blocked.
// Allocation-free (module scratch).

import { Vector3 } from 'three';
import type { ContactInfo, TerrainQuery } from '../core/types';

/**
 * What the camera needs from the world. `collideSphere` is optional (simple fakes in tests have
 * only a distance field); without it every obstacle counts as solid.
 */
export type CameraTerrain = Pick<TerrainQuery, 'distance'> & Partial<Pick<TerrainQuery, 'collideSphere'>>;

const p = new Vector3();
const push = new Vector3();
const nrm = new Vector3();
const info: ContactInfo = { soft: false };

/**
 * Distance along unit `dir` from `origin` at which a sphere of `radius` first touches anything
 * (rock, structure or foliage), or Infinity if the path is clear for `maxDist`. Returns 0 if the
 * origin itself is already inside. If it runs out of steps while grazing a surface it reports
 * where it got to (conservative: better a slightly short boom than a camera in rock).
 */
export function sphereCast(
  terrain: Pick<TerrainQuery, 'distance'>,
  origin: Vector3,
  dir: Vector3,
  maxDist: number,
  radius: number,
  maxSteps = 48,
): number {
  let t = 0;
  for (let i = 0; i < maxSteps; i++) {
    p.copy(origin).addScaledVector(dir, t);
    const d = terrain.distance(p) - radius;
    if (d < 0.02) return t;
    t += Math.max(d, 0.15);
    if (t >= maxDist) return Infinity;
  }
  return t;
}

/**
 * True if a sphere at `pos` overlaps rock or a solid structure (foliage doesn't count). Uses the
 * conservative distance field first (cheap; it may read a little short near sloping rock, which
 * errs on the safe side) and only asks collideSphere when that reports contact.
 */
export function solidContact(terrain: CameraTerrain, pos: Vector3, radius: number): boolean {
  if (terrain.distance(pos) >= radius) return false;
  return !softContact(terrain, pos, radius);
}

/** True if a sphere at `pos` touches foliage and nothing solid. */
export function softContact(terrain: CameraTerrain, pos: Vector3, radius: number): boolean {
  if (!terrain.collideSphere) return false;
  return terrain.collideSphere(pos, radius, push, nrm, info) && info.soft;
}

/** Result of a boom cast: where it is first blocked, and whether that blocker is only foliage. */
export interface BoomHit {
  /** Distance to the first contact; Infinity when clear. */
  t: number;
  /** The first contact is foliage (soft): ease in front of it rather than snapping. */
  soft: boolean;
}

/** sphereCast, plus whether the obstacle it found is soft (one collideSphere, only on a hit). */
export function castBoom(
  terrain: CameraTerrain,
  origin: Vector3,
  dir: Vector3,
  maxDist: number,
  radius: number,
  out: BoomHit,
): BoomHit {
  out.t = sphereCast(terrain, origin, dir, maxDist, radius);
  out.soft = false;
  if (out.t < maxDist) {
    const at = Math.max(out.t, 0);
    out.soft = softContact(terrain, p.copy(origin).addScaledVector(dir, at), radius + 0.25);
  }
  return out;
}

/**
 * Nudge a camera position out of rock and solid structures if it sits closer than `clearance`
 * (moves straight up, which is what you want next to cliffs, walls and over hills). Foliage is
 * left alone: lifting out of a canopy would pop the camera metres up. In place.
 */
export function liftClear(terrain: CameraTerrain, pos: Vector3, clearance: number): Vector3 {
  for (let i = 0; i < 3; i++) {
    if (!solidContact(terrain, pos, clearance)) break;
    // Inside a canopy as well, the field reads very negative; never lift more than a step at once.
    const d = Math.max(-clearance, terrain.distance(pos));
    pos.y += clearance - d + 0.05;
  }
  return pos;
}
