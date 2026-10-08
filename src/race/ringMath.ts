// Ring crossing: the wyvern's physics position is swept from the previous step to this one and
// tested against the ring's disk, so a 90 m/s dive (75 cm per 120 Hz step) can never tunnel
// through a ring, and the crossing time is known to a fraction of a step. Pure and unit-tested.

import type { RingDef } from '../game/contracts';

/** A ring in a form that's cheap to test against: unit normal, plain numbers. */
export interface RingGeom {
  cx: number;
  cy: number;
  cz: number;
  nx: number;
  ny: number;
  nz: number;
  /** Inner radius you must pass within (m). */
  radius: number;
}

export function ringGeom(r: RingDef): RingGeom {
  const [nx, ny, nz] = r.normal;
  const len = Math.hypot(nx, ny, nz) || 1;
  return { cx: r.position[0], cy: r.position[1], cz: r.position[2], nx: nx / len, ny: ny / len, nz: nz / len, radius: r.radius };
}

export interface RingCrossing {
  /** Through the hole, or across the ring's plane outside it (but within the miss radius). */
  kind: 'pass' | 'miss';
  /** 0..1 along the swept segment where the plane was crossed (for sub-step timing). */
  t: number;
  /** Distance from the ring center where the plane was crossed (m). */
  dist: number;
}

/**
 * Sweep a point from a to b against a ring. Only a crossing in the flying direction (from the
 * back of the plane to the front, along the normal) counts; flying through backwards is ignored.
 * The plane interval is half-open (behind < 0 ≤ front) so a point resting exactly on the plane
 * is counted once, by the step that arrived there. Crossings farther than `missRadius` from the
 * center are not about this ring at all and return null.
 */
export function sweepRing(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  ring: RingGeom,
  missRadius = Infinity,
): RingCrossing | null {
  const da = (ax - ring.cx) * ring.nx + (ay - ring.cy) * ring.ny + (az - ring.cz) * ring.nz;
  const db = (bx - ring.cx) * ring.nx + (by - ring.cy) * ring.ny + (bz - ring.cz) * ring.nz;
  if (!(da < 0 && db >= 0)) return null;
  const t = da / (da - db);
  const px = ax + (bx - ax) * t - ring.cx;
  const py = ay + (by - ay) * t - ring.cy;
  const pz = az + (bz - az) * t - ring.cz;
  const dist = Math.hypot(px, py, pz);
  if (dist <= ring.radius) return { kind: 'pass', t, dist };
  if (dist <= missRadius) return { kind: 'miss', t, dist };
  return null;
}

/** Signed distance of a point in front of (+) or behind (−) the ring's plane. */
export function ringSide(x: number, y: number, z: number, ring: RingGeom): number {
  return (x - ring.cx) * ring.nx + (y - ring.cy) * ring.ny + (z - ring.cz) * ring.nz;
}

/** How far a crossing may be from a ring and still count as having missed it (m). */
export function missRadiusFor(radius: number): number {
  return Math.max(45, radius * 5);
}
