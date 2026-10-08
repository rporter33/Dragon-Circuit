// Analytic shapes for every solid in the world. Physics (collision, landing, walking), meshing,
// prop placement and ring validation all evaluate these same functions, so what you see is
// exactly what you hit.
//
// An island is a grassy top surface over a thin cliff rim and an inverted, craggy cone beneath:
//
//        top(x,z)   ___/\__/\___________
//                  |                    |   <- cliff rim (thickness >= 4 m)
//                   \                  /
//                    \   underside    /     <- bottom(x,z)
//                     \______  ______/
//                            \/

import { Vector3 } from 'three';
import type { SurfaceKind } from '../core/types';
import { smoothstep } from '../core/math';
import { fbm2, noise2, periodicNoise, ridged2, type Noise2 } from '../core/noise';
import type { ArchDef, IslandDef, SpireDef } from './layout';

/** Height the top surface rolls off by at the very rim (m). */
export const RIM_DROP = 3;

export class IslandShape {
  readonly def: IslandDef;
  readonly maxRadius: number;
  readonly minY: number;
  readonly maxY: number;
  private outlineN: (theta: number) => number;
  private hillN: Noise2;
  private rockN: Noise2;
  private hillFreq: number;
  private rockFreq: number;
  private ridgedMix: number;

  constructor(def: IslandDef) {
    this.def = def;
    this.outlineN = periodicNoise(def.seed, 6);
    this.hillN = noise2(def.seed + 1);
    this.rockN = noise2(def.seed + 2);
    this.hillFreq = 1 / (def.radius * 0.55);
    this.rockFreq = 1 / Math.max(8, def.radius * 0.22);
    this.ridgedMix = def.kind === 'rocky' || def.kind === 'plateau' ? 0.6 : def.kind === 'cascade' ? 0.35 : 0;
    this.maxRadius = def.radius * (1 + def.outline);
    this.maxY = def.y + def.hills + 2;
    this.minY = def.y - def.depth * 1.3 - 6;
  }

  /** Footprint radius along a world-space angle theta = atan2(dz, dx). */
  outlineRadius(theta: number): number {
    return this.def.radius * (1 + this.def.outline * this.outlineN(theta));
  }

  /** Normalized radial coordinate: 0 at the center, 1 on the rim, >1 outside. */
  normRadius(x: number, z: number): number {
    const dx = x - this.def.x;
    const dz = z - this.def.z;
    return Math.hypot(dx, dz) / this.outlineRadius(Math.atan2(dz, dx));
  }

  /** Top surface height. Defined everywhere; only meaningful where normRadius <= 1. */
  topHeight(x: number, z: number): number {
    const d = this.def;
    const dx = x - d.x;
    const dz = z - d.z;
    const s = Math.min(1, Math.hypot(dx, dz) / this.outlineRadius(Math.atan2(dz, dx)));
    let hill = 0.5 + 0.5 * fbm2(this.hillN, dx * this.hillFreq, dz * this.hillFreq, 4);
    if (this.ridgedMix > 0) {
      hill = hill * (1 - this.ridgedMix) + ridged2(this.hillN, dx * this.hillFreq * 1.3 + 17, dz * this.hillFreq * 1.3 - 9, 4) * this.ridgedMix;
    }
    const outsideFlat = smoothstep(d.flatCenter * 0.7, d.flatCenter + 0.15, s);
    const rimSoften = 1 - 0.6 * smoothstep(0.72, 1, s);
    const rim = smoothstep(0.86, 1, s);
    return d.y + d.hills * hill * outsideFlat * rimSoften - RIM_DROP * rim * rim;
  }

  /** Underside height (always below the top by at least ~4 m at the rim). */
  bottomHeight(x: number, z: number): number {
    const d = this.def;
    const dx = x - d.x;
    const dz = z - d.z;
    const s = Math.min(1, Math.hypot(dx, dz) / this.outlineRadius(Math.atan2(dz, dx)));
    const profile = Math.pow(Math.max(0, 1 - s * s), 0.6);
    const crag = ridged2(this.rockN, dx * this.rockFreq, dz * this.rockFreq, 3);
    const stal = 0.75 + 0.5 * crag;
    return d.y - d.lip - (d.depth - d.lip) * profile * stal;
  }

  topNormal(x: number, z: number, out: Vector3): Vector3 {
    const e = 1.0;
    const hx = this.topHeight(x + e, z) - this.topHeight(x - e, z);
    const hz = this.topHeight(x, z + e) - this.topHeight(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  /** Outward (downward-facing) normal of the underside. */
  bottomNormal(x: number, z: number, out: Vector3): Vector3 {
    const e = 1.5;
    const hx = this.bottomHeight(x + e, z) - this.bottomHeight(x - e, z);
    const hz = this.bottomHeight(x, z + e) - this.bottomHeight(x, z - e);
    return out.set(hx, -2 * e, hz).normalize();
  }

  surfaceAt(x: number, z: number, normalY: number): SurfaceKind {
    const s = this.normRadius(x, z);
    if (normalY < 0.72) return 'rock';
    if (s > 0.95) return 'dirt';
    const kind = this.def.kind;
    if ((kind === 'roost' || kind === 'ruin') && s < this.def.flatCenter * 0.55) return 'stone';
    if (kind === 'rocky' || kind === 'islet') {
      const r = this.rockN(x * 0.05, z * 0.05);
      if (r > 0.35) return 'rock';
    }
    return 'grass';
  }
}

export class SpireShape {
  readonly def: SpireDef;
  readonly maxRadius: number;
  private outlineN: (theta: number) => number;
  private bandN: Noise2;

  constructor(def: SpireDef) {
    this.def = def;
    this.outlineN = periodicNoise(def.seed, 5);
    this.bandN = noise2(def.seed + 3);
    this.maxRadius = def.bellyRadius * 1.2;
  }

  /** Smooth radius profile at height y (no angular noise) — used for collision. */
  baseRadiusAt(y: number): number {
    const d = this.def;
    if (y <= d.tipY || y > d.topY) return 0;
    if (y < d.bellyY) {
      const t = (y - d.tipY) / (d.bellyY - d.tipY);
      return d.bellyRadius * Math.pow(t, 0.75);
    }
    const t = (y - d.bellyY) / (d.topY - d.bellyY);
    // Slight concave waist so the needle reads as carved, not a cone.
    return d.bellyRadius + (d.topRadius - d.bellyRadius) * Math.pow(t, 0.7);
  }

  /** Radius including angular and vertical noise — used for the visible mesh. */
  radiusAt(y: number, theta: number): number {
    const base = this.baseRadiusAt(y);
    if (base === 0) return 0;
    const n = 1 + 0.13 * this.outlineN(theta) + 0.07 * this.bandN(y * 0.04, theta * 1.5);
    return base * n;
  }
}

export class ArchShape {
  readonly def: ArchDef;
  readonly center: Vector3;
  /** In-plane horizontal axis (arc angle 0 points here). */
  readonly right: Vector3;
  /** In-plane up axis (arc angle π/2 points here). */
  readonly up: Vector3;
  /** Plane normal: the direction you fly through the arch. */
  readonly normal: Vector3;
  readonly full: boolean;
  readonly boundRadius: number;

  constructor(def: ArchDef) {
    this.def = def;
    this.center = new Vector3(def.x, def.y, def.z);
    const n = new Vector3(Math.sin(def.yaw), 0, Math.cos(def.yaw));
    const r = new Vector3(Math.cos(def.yaw), 0, -Math.sin(def.yaw));
    const u = new Vector3(0, 1, 0);
    // Tilt the plane about its right axis.
    u.applyAxisAngle(r, def.tilt);
    n.applyAxisAngle(r, def.tilt);
    this.right = r;
    this.up = u;
    this.normal = n;
    this.full = def.arcEnd - def.arcStart >= Math.PI * 2 - 1e-6;
    this.boundRadius = def.radius + def.tube + 2;
  }

  /** World position on the arch's center curve at arc angle a. */
  pointAt(a: number, out: Vector3): Vector3 {
    return out
      .copy(this.center)
      .addScaledVector(this.right, Math.cos(a) * this.def.radius)
      .addScaledVector(this.up, Math.sin(a) * this.def.radius);
  }

  /** Signed distance to the tube surface (negative inside the stone). */
  distance(p: Vector3): number {
    const qx = p.x - this.center.x;
    const qy = p.y - this.center.y;
    const qz = p.z - this.center.z;
    const lx = qx * this.right.x + qy * this.right.y + qz * this.right.z;
    const ly = qx * this.up.x + qy * this.up.y + qz * this.up.z;
    const lz = qx * this.normal.x + qy * this.normal.y + qz * this.normal.z;
    let a = Math.atan2(ly, lx);
    const { arcStart, arcEnd, radius, tube } = this.def;
    if (!this.full) {
      // Bring a into [arcStart, arcStart + 2π).
      while (a < arcStart) a += Math.PI * 2;
      while (a >= arcStart + Math.PI * 2) a -= Math.PI * 2;
      if (a > arcEnd) {
        // Past the end of the arc: clamp to the nearer end cap.
        const toEnd = a - arcEnd;
        const toStart = arcStart + Math.PI * 2 - a;
        a = toEnd < toStart ? arcEnd : arcStart;
        const ex = Math.cos(a) * radius;
        const ey = Math.sin(a) * radius;
        return Math.hypot(lx - ex, ly - ey, lz) - tube;
      }
    }
    const rho = Math.hypot(lx, ly);
    return Math.hypot(rho - radius, lz) - tube;
  }
}

/** Clamp helper for meshers: is (x, z) inside an island's footprint? */
export function insideFootprint(shape: IslandShape, x: number, z: number, margin = 0): boolean {
  return shape.normRadius(x, z) <= 1 - margin;
}
