// Camera collision against the analytic world: a sphere traced along the boom using the
// terrain's conservative distance field. Allocation-free (one scratch vector).

import { Vector3 } from 'three';
import type { TerrainQuery } from '../core/types';

const p = new Vector3();

/**
 * Distance along unit `dir` from `origin` at which a sphere of `radius` first touches solid
 * terrain, or Infinity if the path is clear for `maxDist`. Returns 0 if the origin itself is
 * already inside. If it runs out of steps while grazing a surface it reports where it got to
 * (conservative: better a slightly short boom than a camera in rock).
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
 * Nudge a camera position out of terrain if it sits closer than `clearance` to a surface
 * (moves straight up, which is what you want next to cliffs and over hills). In place.
 */
export function liftClear(terrain: Pick<TerrainQuery, 'distance'>, pos: Vector3, clearance: number): Vector3 {
  for (let i = 0; i < 3; i++) {
    const d = terrain.distance(pos);
    if (d >= clearance) break;
    pos.y += clearance - d + 0.05;
  }
  return pos;
}
