// Collision shapes for built things, authored next to the geometry they stand for. Every helper
// takes a site frame (translation + yaw, like the kit's `xf(x, y, z, 0, yaw, 0)` frames) and local
// dimensions, and appends world-space colliders (world/colliders.ts indexes them):
//
//   colBox       an upright box turned about Y: wall panels, slabs, crates, beams lying flat
//   colCyl       a vertical cylinder: towers, posts, columns, barrels
//   colSphere    a sphere: boulders, hay piles (soft), lantern globes
//   colChain     spheres strung along a curve: dome ribs, telescope barrels, hoops
//   colGable     a gable roof as stacked boxes whose tops follow the slopes within ±(step/2)
//   colCone      a conical roof as stacked cylinders
//
// Shapes are coarse on purpose (a building is a dozen boxes, not hundreds of planks): the goal is
// "what you see is what you hit, within about half a meter", and nothing invisible in the way.

import { Matrix4, Vector3 } from 'three';
import type { BoxCollider, Collider, CylinderCollider, SphereCollider, SurfaceKind } from '../../core/types';

export interface ColTraits {
  soft?: boolean;
  surface?: SurfaceKind;
}

const _p = new Vector3();

/** The yaw (radians) of a frame built by xf(x, y, z, 0, yaw, 0) (local +Z → (sin yaw, cos yaw)). */
export function frameYaw(F: Matrix4): number {
  const e = F.elements;
  return Math.atan2(e[8], e[10]);
}

/** Frame-local point → world. */
export function toWorld(F: Matrix4, x: number, y: number, z: number, out = new Vector3()): Vector3 {
  return out.set(x, y, z).applyMatrix4(F);
}

/**
 * An upright box centered at (x, y, z) in frame space with full sizes (w, h, d) along the frame's
 * local x / y / z, turned by `ry` about Y on top of the frame's own yaw.
 */
export function colBox(out: Collider[], F: Matrix4, x: number, y: number, z: number, w: number, h: number, d: number, ry = 0, t: ColTraits = {}): BoxCollider {
  const p = toWorld(F, x, y, z, _p);
  const c: BoxCollider = { kind: 'box', x: p.x, y: p.y, z: p.z, hx: w / 2, hy: h / 2, hz: d / 2, yaw: frameYaw(F) + ry, ...traits(t) };
  out.push(c);
  return c;
}

/** A box spanning two frame-space points in plan (a thick wall or a beam lying level), y0..y1. */
export function colSpan(out: Collider[], F: Matrix4, ax: number, az: number, bx: number, bz: number, y0: number, y1: number, thickness: number, t: ColTraits = {}): BoxCollider {
  const len = Math.hypot(bx - ax, bz - az);
  const ry = Math.atan2(bx - ax, bz - az);
  return colBox(out, F, (ax + bx) / 2, (y0 + y1) / 2, (az + bz) / 2, thickness, y1 - y0, len, ry, t);
}

/** A vertical cylinder with its base center at frame (x, y0, z), height h. */
export function colCyl(out: Collider[], F: Matrix4, x: number, y0: number, z: number, r: number, h: number, t: ColTraits = {}): CylinderCollider {
  const p = toWorld(F, x, y0, z, _p);
  const c: CylinderCollider = { x: p.x, z: p.z, radius: r, y0: p.y, y1: p.y + h, ...traits(t) };
  out.push(c);
  return c;
}

export function colSphere(out: Collider[], F: Matrix4 | null, x: number, y: number, z: number, r: number, t: ColTraits = {}): SphereCollider {
  const p = F ? toWorld(F, x, y, z, _p) : _p.set(x, y, z);
  const c: SphereCollider = { kind: 'sphere', x: p.x, y: p.y, z: p.z, radius: r, ...traits(t) };
  out.push(c);
  return c;
}

/**
 * Spheres of radius r strung along a world-space polyline, at most `spacing` apart (default
 * 1.2 r, so the chain's waist never dips more than ~0.2 r below the tube it stands for).
 */
export function colChain(out: Collider[], pts: Vector3[], r: number, t: ColTraits = {}, spacing = r * 1.2): void {
  if (pts.length === 0) return;
  colSphere(out, null, pts[0].x, pts[0].y, pts[0].z, r, t);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = a.distanceTo(b);
    const n = Math.max(1, Math.ceil(len / spacing));
    for (let k = 1; k <= n; k++) {
      const u = k / n;
      colSphere(out, null, a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u, r, t);
    }
  }
}

/**
 * A gable roof (ridge along frame z from z0 to z1, eaves at ±halfSpan / eaveY, ridge at ridgeY)
 * as `steps` stacked boxes, each as wide as the roof at its mid-height, so the stepped top stays
 * within half a step of the real slope. The lowest box reaches down to `baseY` (the wall plate),
 * so the attic is solid and the eaves overhang over open air.
 */
export function colGable(out: Collider[], F: Matrix4, z0: number, z1: number, halfSpan: number, eaveY: number, ridgeY: number, baseY: number, steps: number, t: ColTraits = {}): void {
  const rise = ridgeY - eaveY;
  const len = z1 - z0;
  const zc = (z0 + z1) / 2;
  for (let k = 0; k < steps; k++) {
    const yTop = eaveY + (rise * (k + 1)) / steps;
    const yBot = k === 0 ? Math.min(baseY, eaveY) : eaveY + (rise * k) / steps;
    const mid = (k + 0.5) / steps;
    const half = halfSpan * (1 - mid);
    colBox(out, F, 0, (yTop + yBot) / 2, zc, half * 2, yTop - yBot, len, 0, t);
  }
}

/** A conical roof (base radius r at y, apex at y + h) as `steps` stacked cylinders. */
export function colCone(out: Collider[], F: Matrix4, x: number, y: number, z: number, r: number, h: number, steps: number, t: ColTraits = {}): void {
  for (let k = 0; k < steps; k++) {
    const yBot = y + (h * k) / steps;
    const yTop = y + (h * (k + 1)) / steps;
    const mid = (k + 0.5) / steps;
    colCyl(out, F, x, yBot, z, Math.max(0.15, r * (1 - mid)), yTop - yBot, t);
  }
}

/** A frustum (radius r0 at y0 → r1 at y0 + h) as `steps` stacked cylinders. */
export function colFrustum(out: Collider[], F: Matrix4, x: number, y0: number, z: number, r0: number, r1: number, h: number, steps: number, t: ColTraits = {}): void {
  for (let k = 0; k < steps; k++) {
    const mid = (k + 0.5) / steps;
    colCyl(out, F, x, y0 + (h * k) / steps, z, r0 + (r1 - r0) * mid, h / steps, t);
  }
}

function traits(t: ColTraits): ColTraits {
  const o: ColTraits = {};
  if (t.soft) o.soft = true;
  if (t.surface) o.surface = t.surface;
  return o;
}
