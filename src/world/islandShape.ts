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

/** Half-width (m) of the worn dirt track on the Roost. */
export const ROOST_TRACK_HALF_WIDTH = 1.7;
/**
 * Direction of the Roost's cliff-edge launch point from the island center, as atan2(dz, dx):
 * toward Gull's Rest, the first short glide.
 */
export const ROOST_LAUNCH_ANGLE = Math.atan2(420, 560);

export class IslandShape {
  readonly def: IslandDef;
  readonly maxRadius: number;
  readonly minY: number;
  readonly maxY: number;
  private outlineN: (theta: number) => number;
  private hillN: Noise2;
  private rockN: Noise2;
  private underN: Noise2;
  private hillFreq: number;
  /** Underside: ridgelines around the cone, broad lumps, hanging-tooth cell size (m). */
  private ridgeFreq: number;
  private lumpFreq: number;
  private toothCell: number;
  private ridgedMix: number;
  /**
   * The Roost's worn dirt track from the paved courtyard out to the cliff-edge launch point, as
   * a world-space (x, z) polyline; null on other islands. The last point is the launch point.
   */
  readonly track: [number, number][] | null;

  constructor(def: IslandDef) {
    this.def = def;
    this.outlineN = periodicNoise(def.seed, 6);
    this.hillN = noise2(def.seed + 1);
    this.rockN = noise2(def.seed + 2);
    this.hillFreq = 1 / (def.radius * 0.55);
    this.underN = noise2(def.seed + 4);
    this.ridgeFreq = Math.min(5, Math.max(1.5, def.radius / 40));
    this.lumpFreq = 1 / Math.max(12, def.radius * 0.6);
    this.toothCell = Math.min(36, Math.max(9, def.radius * 0.2));
    this.ridgedMix = def.kind === 'rocky' || def.kind === 'plateau' ? 0.6 : def.kind === 'cascade' ? 0.35 : 0;
    this.maxRadius = def.radius * (1 + def.outline);
    this.maxY = def.y + def.hills + 2;
    this.minY = def.y - def.depth * 1.3 - 6;
    this.track = def.kind === 'roost' ? this.buildTrack() : null;
  }

  private buildTrack(): [number, number][] {
    const d = this.def;
    const pts: [number, number][] = [];
    const s0 = d.flatCenter * 0.55 - 0.02;
    const n = 9;
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      // A gentle S-bend, as if worn by generations of riders walking out to launch.
      const th = ROOST_LAUNCH_ANGLE + 0.07 * Math.sin(u * Math.PI * 1.6 + 0.4) - 0.03 * u;
      const r = this.outlineRadius(th) * (s0 + (1 - s0) * u);
      pts.push([d.x + Math.cos(th) * r, d.z + Math.sin(th) * r]);
    }
    return pts;
  }

  /** Horizontal distance (m) from (x, z) to the Roost track's centerline; Infinity elsewhere. */
  trackDistance(x: number, z: number): number {
    const t = this.track;
    if (!t) return Infinity;
    let best = Infinity;
    for (let k = 0; k < t.length - 1; k++) {
      const ax = t[k][0];
      const az = t[k][1];
      const bx = t[k + 1][0] - ax;
      const bz = t[k + 1][1] - az;
      const len2 = bx * bx + bz * bz;
      const u = Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / len2));
      const dd = Math.hypot(x - ax - bx * u, z - az - bz * u);
      if (dd < best) best = dd;
    }
    return best;
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

  /**
   * Underside height (always below the top by at least ~4 m at the rim). An inverted mountain:
   * ridgelines run down the cone and converge at the tip, broad lumps keep each island's hang
   * unique, and sparse hanging teeth drop from the deeper part. stal stays within
   * [0.53, 1.30], so the underside never reaches below minY.
   */
  bottomHeight(x: number, z: number): number {
    const d = this.def;
    const dx = x - d.x;
    const dz = z - d.z;
    const r = Math.hypot(dx, dz);
    const theta = Math.atan2(dz, dx);
    const s = Math.min(1, r / this.outlineRadius(theta));
    const profile = Math.pow(Math.max(0, 1 - s * s), 0.6);
    // Ridged noise sampled around a circle (seamless in theta), drifting slowly with the radius
    // so the creases run downhill instead of across.
    const f = this.ridgeFreq;
    const ridge = ridged2(this.underN, Math.cos(theta) * f + s * 1.7, Math.sin(theta) * f - s * 1.3, 2);
    const lump = 0.5 + 0.5 * fbm2(this.underN, dx * this.lumpFreq + 31.7, dz * this.lumpFreq - 12.3, 2);
    const teeth = this.toothAt(dx, dz) * smoothstep(0.05, 0.35, profile);
    // Taper the dome-shaped profile toward a cone so the island hangs like an inverted peak.
    const cone = 0.72 + 0.46 * Math.pow(1 - s, 1.5);
    // Teeth may hang as far as the envelope allows: long on the flanks, short near the tip.
    const toothLen = Math.min(0.26, 1.3 - cone);
    const stal = cone * (0.74 + 0.26 * (0.6 * ridge + 0.4 * lump)) + toothLen * teeth;
    return d.y - d.lip - (d.depth - d.lip) * profile * stal;
  }

  /** 0..1 hanging-tooth field: sparse cones on a jittered grid (Worley), local (dx, dz). */
  private toothAt(dx: number, dz: number): number {
    const cell = this.toothCell;
    const gx = dx / cell;
    const gz = dz / cell;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const seed = this.def.seed % 4093;
    let best = 0;
    for (let oz = -1; oz <= 1; oz++) {
      for (let ox = -1; ox <= 1; ox++) {
        const cx = ix + ox;
        const cz = iz + oz;
        const h = cellHash(cx, cz, seed);
        if (h < 0.4) continue; // most cells have no tooth
        const px = cx + 0.2 + 0.6 * cellHash(cx + 17, cz - 5, seed);
        const pz = cz + 0.2 + 0.6 * cellHash(cx - 9, cz + 23, seed);
        const radius = 0.32 + 0.22 * cellHash(cx + 3, cz + 7, seed);
        const dist = Math.hypot(gx - px, gz - pz) / radius;
        if (dist >= 1) continue;
        // Stalactite profile: a flared root tapering to a point.
        const t = 1 - dist;
        const v = (0.55 + 0.45 * (h - 0.4) / 0.6) * t * t;
        if (v > best) best = v;
      }
    }
    return best;
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
    if (this.track && this.trackDistance(x, z) < ROOST_TRACK_HALF_WIDTH) return 'dirt';
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

/** Integer-lattice hash in [0, 1) for jittered-grid features. */
function cellHash(x: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Clamp helper for meshers: is (x, z) inside an island's footprint? */
export function insideFootprint(shape: IslandShape, x: number, z: number, margin = 0): boolean {
  return shape.normRadius(x, z) <= 1 - margin;
}
