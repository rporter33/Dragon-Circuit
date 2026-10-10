import { Triangle, Vector3 } from 'three';
import type { BoxCollider } from '../core/types';

const triangle = new Triangle(), point = new Vector3(), closest = new Vector3();
/** Exact distance to a closed convex triangle surface; no invisible bounding-box contacts. */
export function convexDistance(solid: NonNullable<BoxCollider['convex']>, x: number, y: number, z: number, normal: Vector3 | null): number {
  const planes = solid.planes;
  let maxPlane = -Infinity, face = 0;
  for (let i = 0; i < planes.length; i += 4) {
    const d = x * planes[i] + y * planes[i + 1] + z * planes[i + 2] + planes[i + 3];
    if (d > maxPlane) { maxPlane = d; face = i; }
  }
  if (maxPlane <= 1e-7) {
    normal?.set(planes[face], planes[face + 1], planes[face + 2]);
    return maxPlane;
  }
  // Outside, distance to supporting planes alone is not exact near corners. Check visible
  // triangles so sphere contacts and camera ray marching agree with the actual surface.
  const vertices = solid.triangles;
  point.set(x, y, z);
  let best = Infinity;
  for (let i = 0, p = 0; i < vertices.length; i += 9, p += 4) {
    if (x * planes[p] + y * planes[p + 1] + z * planes[p + 2] + planes[p + 3] < -1e-7) continue;
    triangle.a.fromArray(vertices, i); triangle.b.fromArray(vertices, i + 3); triangle.c.fromArray(vertices, i + 6);
    triangle.closestPointToPoint(point, closest);
    const d = point.distanceToSquared(closest);
    if (d < best) { best = d; normal?.subVectors(point, closest); }
  }
  normal?.normalize();
  return Math.sqrt(best);
}
