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
  /** Lower bound for top height over the footprint (hills/terraces only add height). */
  readonly minTopY: number;
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
  /**
   * Each seeded filler island gets its own character (landmarks keep their authored form):
   * how pointed its hang is, a keel pulled off-center, twin hanging lobes, a gentle list, a
   * raised terrace on one side, and a ragged cliff foot. All of it is analytic, so collision,
   * landing and meshing still share one shape.
   */
  private coneExp = 0.6;
  private skew = 0;
  private skewDir = 0;
  private twin = 0;
  private twinDir = 0;
  private tiltX = 0;
  private tiltZ = 0;
  private terrace = 0;
  private terraceX = 1;
  private terraceZ = 0;
  private terraceOff = 0;
  private lipVar = 0;
  private lipN: (theta: number) => number;
  /** Bays and headlands on top of the smooth outline, and how toothy the hang is. */
  private rag = 0;
  private ragN: (theta: number) => number;
  private pavedN: (theta: number) => number;
  private toothScale = 1;
  private toothChance = 0.6;

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
    this.lipN = periodicNoise(def.seed + 9, 12);
    this.ragN = raggedNoise(def.seed + 11);
    this.pavedN = raggedNoise(def.seed + 13);
    if (!def.landmark && def.kind !== 'roost') {
      const h = (k: number) => cellHash(k, 17, def.seed % 4093);
      this.coneExp = 0.4 + 0.5 * h(1);
      this.skew = (h(2) - 0.5) * 1.3;
      this.skewDir = h(3) * Math.PI * 2;
      if (h(4) < 0.4) {
        this.twin = 0.25 + 0.3 * h(5);
        this.twinDir = h(6) * Math.PI;
      }
      if (h(7) < 0.35) {
        const tilt = Math.tan(((3 + 4 * h(8)) * Math.PI) / 180);
        const a = h(9) * Math.PI * 2;
        this.tiltX = Math.cos(a) * tilt;
        this.tiltZ = Math.sin(a) * tilt;
      }
      if (h(10) < 0.35 && def.radius > 40) {
        this.terrace = 3 + 4 * h(11);
        const a = h(12) * Math.PI * 2;
        this.terraceX = Math.cos(a);
        this.terraceZ = Math.sin(a);
        this.terraceOff = (h(13) - 0.3) * def.radius * 0.5;
      }
      this.lipVar = 0.25 + 0.35 * h(14);
      this.rag = 0.025 + 0.03 * h(15);
      this.toothScale = 0.7 + 1.0 * h(16);
      this.toothChance = 0.35 + 0.4 * h(18);
    }
    this.maxRadius = def.radius * (1 + def.outline + this.rag);
    const lean = Math.hypot(this.tiltX, this.tiltZ) * this.maxRadius;
    this.maxY = def.y + def.hills + this.terrace + lean + 2;
    this.minTopY = def.y - RIM_DROP - lean;
    this.minY = def.y - def.depth * 1.3 - def.lip * this.lipVar * 1.6 - lean - 6;
    this.track = def.kind === 'roost' ? this.buildTrack() : null;
  }

  /** Height of the island's list (tilt) at local offset (dx, dz) from its center. */
  private leanAt(dx: number, dz: number): number {
    return dx * this.tiltX + dz * this.tiltZ;
  }

  /**
   * Depth of the cliff band below the rim's baseline at angle theta = atan2(dz, dx): ragged on
   * filler islands, never thinner than 4.5 m.
   */
  lipAt(theta: number): number {
    const d = this.def;
    if (this.lipVar === 0) return d.lip;
    return Math.max(d.lip * 0.8, 7, d.lip * (1 + this.lipVar * this.lipN(theta) * 1.6));
  }

  /** World height of the underside where it meets the cliff foot, at angle theta. */
  rimBottomAt(theta: number): number {
    const R = this.outlineRadius(theta);
    return this.def.y - this.lipAt(theta) + this.leanAt(Math.cos(theta) * R, Math.sin(theta) * R);
  }

  /** Exponent of the underside's depth profile (how pointed the hang is). */
  get coneExponent(): number {
    return this.coneExp;
  }

  /**
   * Normalized radius where the paving of a Roost or ruin courtyard gives way to turf, at the
   * angle of (x, z): a ragged edge, so the grass creeps in organically; -1 elsewhere.
   */
  pavedEdge(x: number, z: number): number {
    const d = this.def;
    if (d.kind !== 'roost' && d.kind !== 'ruin') return -1;
    const th = Math.atan2(z - d.z, x - d.x);
    return d.flatCenter * (0.47 + 0.035 * this.pavedN(th));
  }

  private buildTrack(): [number, number][] {
    const d = this.def;
    const pts: [number, number][] = [];
    const s0 = this.pavedEdge(d.x + Math.cos(ROOST_LAUNCH_ANGLE), d.z + Math.sin(ROOST_LAUNCH_ANGLE)) - 0.02;
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
      const dd = hyp(x - ax - bx * u, z - az - bz * u);
      if (dd < best) best = dd;
    }
    return best;
  }

  /** Footprint radius along a world-space angle theta = atan2(dz, dx). */
  outlineRadius(theta: number): number {
    return this.def.radius * (1 + this.def.outline * this.outlineN(theta) + this.rag * this.ragN(theta));
  }

  /** Normalized radial coordinate: 0 at the center, 1 on the rim, >1 outside. */
  normRadius(x: number, z: number): number {
    const dx = x - this.def.x;
    const dz = z - this.def.z;
    // sqrt rather than Math.hypot (which allocates in V8): these run many times a frame.
    return Math.sqrt(dx * dx + dz * dz) / this.outlineRadius(Math.atan2(dz, dx));
  }

  /** Top surface height. Defined everywhere; only meaningful where normRadius <= 1. */
  topHeight(x: number, z: number): number {
    const d = this.def;
    const dx = x - d.x;
    const dz = z - d.z;
    const s = Math.min(1, Math.sqrt(dx * dx + dz * dz) / this.outlineRadius(Math.atan2(dz, dx)));
    let hill = 0.5 + 0.5 * fbm2(this.hillN, dx * this.hillFreq, dz * this.hillFreq, 4);
    if (this.ridgedMix > 0) {
      hill = hill * (1 - this.ridgedMix) + ridged2(this.hillN, dx * this.hillFreq * 1.3 + 17, dz * this.hillFreq * 1.3 - 9, 4) * this.ridgedMix;
    }
    const outsideFlat = smoothstep(d.flatCenter * 0.7, d.flatCenter + 0.15, s);
    const rimSoften = 1 - 0.6 * smoothstep(0.72, 1, s);
    const rim = smoothstep(0.86, 1, s);
    let y = d.y + d.hills * hill * outsideFlat * rimSoften - RIM_DROP * rim * rim;
    if (this.terrace > 0) {
      // A raised terrace on one side: a short rocky step, its line wandering a little.
      const along = dx * this.terraceX + dz * this.terraceZ - this.terraceOff + 6 * this.hillN(dx * 0.02 + 5.1, dz * 0.02 - 3.7);
      y += this.terrace * smoothstep(-3, 3, along);
    }
    return y + this.leanAt(dx, dz);
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
    const r = Math.sqrt(dx * dx + dz * dz);
    const theta = Math.atan2(dz, dx);
    const s0 = Math.min(1, r / this.outlineRadius(theta));
    // A keel pulled off-center: the radial coordinate is warped (still 0 at the center and 1 at
    // the rim), so the hang bulges deeper on one side and shallower on the other.
    const s = this.skew !== 0 ? Math.pow(s0, Math.exp(this.skew * Math.cos(theta - this.skewDir))) : s0;
    const profile = Math.pow(Math.max(0, 1 - s * s), this.coneExp);
    // Ridged noise sampled around a circle (seamless in theta), drifting slowly with the radius
    // so the creases run downhill instead of across.
    const f = this.ridgeFreq;
    // The angular sampling is singular at the center, so ridges fade out right around the tip.
    const ridge = 0.5 + (softRidged(this.underN, Math.cos(theta) * f + s * 1.7, Math.sin(theta) * f - s * 1.3) - 0.5) * smoothstep(0.03, 0.3, s);
    const lump = 0.5 + 0.5 * fbm2(this.underN, dx * this.lumpFreq + 31.7, dz * this.lumpFreq - 12.3, 2);
    const teeth = this.toothAt(dx, dz) * smoothstep(0.05, 0.35, profile) * smoothstep(0.06, 0.2, s);
    // Taper the dome-shaped profile toward a (smooth-tipped) cone so the island hangs like an
    // inverted peak.
    const cone = 0.72 + 0.46 * Math.pow(1 - smoothstep(0, 1, s), 1.5);
    // Teeth may hang as far as the envelope allows: long on the flanks, short near the tip.
    const toothLen = Math.min(0.26 * this.toothScale, 1.3 - cone);
    let stal = cone * (0.74 + 0.26 * (0.6 * ridge + 0.4 * lump)) + toothLen * teeth;
    if (this.twin > 0) {
      // Two hanging lobes on opposite sides with a saddle between them.
      const lobe = Math.exp(-(((s - 0.42) / 0.22) ** 2)) * Math.max(0, Math.cos(2 * (theta - this.twinDir)));
      const saddle = Math.exp(-((s / 0.3) ** 2));
      stal *= 1 + this.twin * (1.2 * lobe - saddle);
    }
    stal = Math.min(1.3, stal);
    const lip = this.lipAt(theta);
    return d.y - lip - (d.depth - lip) * profile * stal + this.leanAt(dx, dz);
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
        if (h < 1 - this.toothChance) continue; // most cells have no tooth
        const px = cx + 0.2 + 0.6 * cellHash(cx + 17, cz - 5, seed);
        const pz = cz + 0.2 + 0.6 * cellHash(cx - 9, cz + 23, seed);
        const radius = 0.32 + 0.22 * cellHash(cx + 3, cz + 7, seed);
        const tx = gx - px;
        const tz = gz - pz;
        const dist = Math.sqrt(tx * tx + tz * tz) / radius;
        if (dist >= 1) continue;
        // Stalactite profile: a flared root tapering to a point.
        const t = 1 - dist;
        const v = (0.55 + 0.45 * (h - (1 - this.toothChance)) / this.toothChance) * t * t;
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

  /**
   * Normalized radius beyond which the wind-scoured rim is bare dirt: around 0.95, wandering
   * between 0.925 and 0.975 so the dirt band is patchy rather than a uniform ring.
   */
  rimDirtEdge(x: number, z: number): number {
    return 0.95 + 0.025 * this.hillN(x * 0.035 + 71.3, z * 0.035 - 18.9);
  }

  surfaceAt(x: number, z: number, normalY: number): SurfaceKind {
    const s = this.normRadius(x, z);
    if (normalY < 0.72) return 'rock';
    if (s > this.rimDirtEdge(x, z)) return 'dirt';
    const kind = this.def.kind;
    if ((kind === 'roost' || kind === 'ruin') && s < this.pavedEdge(x, z)) return 'stone';
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
    // The band noise is sampled around a circle so it closes seamlessly at theta = 2π.
    const n = 1 + 0.13 * this.outlineN(theta) + 0.07 * this.bandN(y * 0.04 + Math.cos(theta) * 1.4, Math.sin(theta) * 1.4);
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
  /** Cross-section thickness along the plane normal, relative to the in-plane thickness. */
  readonly squash = 0.8;
  private lumpPhase: number[];

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
    this.boundRadius = def.radius + def.tube * 1.6 + 2;
    this.lumpPhase = [0, 1, 2, 3, 4, 5].map((k) => cellHash(k, 29, def.seed % 4093) * Math.PI * 2);
  }

  /**
   * Stone thickness at arc angle a and around-the-tube angle phi (0 = away from the arch's
   * center, pi = facing into the opening): a standing arch flares at its feet and slims at the
   * crown; every arch swells and pinches in broad lumps, mostly on its outer side so the opening
   * you fly through keeps its size.
   */
  radiusAt(a: number, phi: number): number {
    const d = this.def;
    const outer = 0.35 + 0.65 * smoothstep(-0.4, 0.7, Math.cos(phi));
    let r = d.tube;
    if (!this.full) {
      const u = Math.min(1, Math.max(0, (a - d.arcStart) / (d.arcEnd - d.arcStart)));
      const foot = Math.pow(1 - Math.sin(Math.PI * u), 2);
      r *= 0.84 + 0.5 * foot * outer;
    }
    const p = this.lumpPhase;
    const lump = 0.6 * Math.sin(2 * a + p[0]) * Math.sin(phi + p[1]) + 0.4 * Math.sin(5 * a + p[2]) * Math.sin(2 * phi + p[3]) + 0.3 * Math.sin(9 * a + p[4] + phi);
    return r * (1 + 0.11 * lump * outer);
  }

  /** World position on the arch's center curve at arc angle a. */
  pointAt(a: number, out: Vector3): Vector3 {
    return out
      .copy(this.center)
      .addScaledVector(this.right, Math.cos(a) * this.def.radius)
      .addScaledVector(this.up, Math.sin(a) * this.def.radius);
  }

  /**
   * Signed distance to the stone (negative inside): an elliptical cross-section (squashed along
   * the plane normal) whose radius follows radiusAt.
   */
  distance(p: Vector3): number {
    const qx = p.x - this.center.x;
    const qy = p.y - this.center.y;
    const qz = p.z - this.center.z;
    const lx = qx * this.right.x + qy * this.right.y + qz * this.right.z;
    const ly = qx * this.up.x + qy * this.up.y + qz * this.up.z;
    const lz = qx * this.normal.x + qy * this.normal.y + qz * this.normal.z;
    let a = Math.atan2(ly, lx);
    const { arcStart, arcEnd, radius } = this.def;
    const k = this.squash;
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
        const dr = hyp(lx, ly) - radius;
        return ellipseDistance(hyp(lx - ex, ly - ey), lz, this.radiusAt(a, Math.atan2(lz / k, dr)), k);
      }
    }
    const dr = hyp(lx, ly) - radius;
    return ellipseDistance(dr, lz, this.radiusAt(a, Math.atan2(lz / k, dr)), k);
  }
}

/** sqrt(a² + b²): Math.hypot allocates its argument list in V8, and these run per ray step. */
function hyp(a: number, b: number): number {
  return Math.sqrt(a * a + b * b);
}

/**
 * Approximate signed distance from (u, v) to an ellipse with semi-axes r (along u) and k·r (along
 * v): exact on both axes and close in between (the usual "k0·(k0−1)/k1" ellipsoid estimate).
 */
function ellipseDistance(u: number, v: number, r: number, k: number): number {
  const A = r;
  const B = r * k;
  const k0 = hyp(u / A, v / B);
  const k1 = hyp(u / (A * A), v / (B * B));
  if (k1 < 1e-9) return -B;
  return (k0 * (k0 - 1)) / k1;
}

/**
 * Two octaves of ridged noise with rounded crests (a smooth |n|), in [0, 1]: hanging ridgelines
 * that read as weathered rock rather than knife-edged crystal under toon shading.
 */
function softRidged(n: Noise2, x: number, y: number): number {
  const a = n(x, y);
  const b = n(x * 2.03 + 5.3, y * 2.03 - 2.1);
  const ra = 1 - Math.sqrt(a * a + 0.03);
  const rb = 1 - Math.sqrt(b * b + 0.03);
  const top = 1 - Math.sqrt(0.03);
  return (0.67 * ra * ra + 0.33 * rb * rb) / (top * top);
}

/**
 * Seamless angular noise in [-1, 1] made of mid and high harmonics only (bays and headlands a
 * few tens of meters across), unlike periodicNoise's broad lobes.
 */
function raggedNoise(seed: number): (theta: number) => number {
  const amps: number[] = [];
  const phases: number[] = [];
  const freqs: number[] = [];
  let norm = 0;
  for (let k = 0; k < 7; k++) {
    const a = 0.5 + 0.5 * cellHash(k, 3, seed);
    amps.push(a);
    phases.push(cellHash(k, 5, seed) * Math.PI * 2);
    freqs.push(6 + k * 3);
    norm += a;
  }
  return (theta: number) => {
    let s = 0;
    for (let k = 0; k < 7; k++) s += amps[k] * Math.sin(freqs[k] * theta + phases[k]);
    return Math.max(-1, Math.min(1, (s / norm) * 1.8));
  };
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
