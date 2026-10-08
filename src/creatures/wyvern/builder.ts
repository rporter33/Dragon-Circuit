// A small indexed-mesh builder for skinned procedural geometry. Parts are appended one at a
// time; each part gets smooth normals from its own triangles (so separate parts keep crisp
// intersections), up to four bone influences per vertex, and the extra attributes the wyvern
// shaders read:
//   aMat  (vec4): region id, belly mask, dorsal mask, flutter amount
//   aUv2  (vec2): part-specific coordinates (arc length along a part, lateral position, …)
// Two index lists are kept: group 0 for the opaque body, group 1 for membranes.

import { BufferAttribute, BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Vector3 } from 'three';

/** Body regions (aMat.x). Keep in sync with the switch in materials.ts. */
export const REGION = {
  skin: 0,
  horn: 1,
  eye: 2,
  mouth: 3,
  leather: 4,
  metal: 5,
  cloth: 6,
  wood: 7,
  plate: 8,
  claw: 9,
  glass: 10,
  wool: 11,
} as const;

/** Membrane regions (aMat.x in group 1). */
export const MREGION = {
  wing: 0,
  feather: 1,
  fin: 2,
  canopy: 3,
} as const;

/** Bone influences: up to 4 (bone, weight) pairs, built with add() and normalized on write. */
export class Skin {
  readonly bones: number[] = [];
  readonly weights: number[] = [];

  static of(bone: number): Skin {
    return new Skin().add(bone, 1);
  }

  add(bone: number, weight: number): this {
    if (!(weight > 1e-5)) return this;
    const i = this.bones.indexOf(bone);
    if (i >= 0) this.weights[i] += weight;
    else {
      this.bones.push(bone);
      this.weights.push(weight);
    }
    return this;
  }

  /** Blend another skin in with a weight (used for interpolating across surfaces). */
  mix(other: Skin, weight: number): this {
    for (let i = 0; i < other.bones.length; i++) this.add(other.bones[i], other.weights[i] * weight);
    return this;
  }

  /** Top four influences, normalized (selection without allocating). */
  top4(outIdx: number[], outW: number[]): void {
    const n = this.bones.length;
    const w = this.weights;
    let used = 0; // bitmask of picked entries (n is small)
    const pick: number[] = _pick;
    let count = 0;
    let sum = 0;
    for (let k = 0; k < 4 && k < n; k++) {
      let best = -1;
      for (let i = 0; i < n; i++) if (!(used & (1 << i)) && (best < 0 || w[i] > w[best])) best = i;
      used |= 1 << best;
      pick[count++] = best;
      sum += w[best];
    }
    for (let k = 0; k < 4; k++) {
      if (k < count && sum > 0) {
        outIdx.push(this.bones[pick[k]]);
        outW.push(w[pick[k]] / sum);
      } else {
        outIdx.push(0);
        outW.push(0);
      }
    }
  }
}

const _pick = [0, 0, 0, 0];

export interface VertexMat {
  region: number;
  belly?: number;
  dorsal?: number;
  flutter?: number;
}

export class GeoBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private skinIdx: number[] = [];
  private skinW: number[] = [];
  private mat: number[] = [];
  private uv: number[] = [];
  private index: [number[], number[]] = [[], []];
  private partStart = 0;
  private partIndexStart = 0;
  /** 0 = body, 1 = membrane. */
  group: 0 | 1 = 0;

  /** Copy of the builder's state (to cache the parts that don't change with the look). */
  snapshot(): GeoBuilder {
    const c = new GeoBuilder();
    c.pos = this.pos.slice();
    c.nrm = this.nrm.slice();
    c.skinIdx = this.skinIdx.slice();
    c.skinW = this.skinW.slice();
    c.mat = this.mat.slice();
    c.uv = this.uv.slice();
    c.index = [this.index[0].slice(), this.index[1].slice()];
    return c;
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangleCount(): number {
    return (this.index[0].length + this.index[1].length) / 3;
  }

  /** Start a new part: normals are smoothed only within a part. */
  begin(group: 0 | 1 = 0): void {
    this.group = group;
    this.partStart = this.vertexCount;
    this.partIndexStart = this.index[group].length;
  }

  vertex(p: Vector3, skin: Skin, m: VertexMat, u = 0, w = 0): number {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(0, 0, 0);
    skin.top4(this.skinIdx, this.skinW);
    this.mat.push(m.region, m.belly ?? 0, m.dorsal ?? 0, m.flutter ?? 0);
    this.uv.push(u, w);
    return this.vertexCount - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.index[this.group].push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    // a-b-c-d counter-clockwise seen from the front.
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /** Close the current part: accumulate area-weighted face normals into its vertices. */
  end(): void {
    const idx = this.index[this.group];
    const P = this.pos;
    const N = this.nrm;
    const ax = new Vector3();
    const bx = new Vector3();
    const cx = new Vector3();
    for (let i = this.partIndexStart; i < idx.length; i += 3) {
      const a = idx[i];
      const b = idx[i + 1];
      const c = idx[i + 2];
      ax.set(P[a * 3], P[a * 3 + 1], P[a * 3 + 2]);
      bx.set(P[b * 3] - ax.x, P[b * 3 + 1] - ax.y, P[b * 3 + 2] - ax.z);
      cx.set(P[c * 3] - ax.x, P[c * 3 + 1] - ax.y, P[c * 3 + 2] - ax.z);
      bx.cross(cx);
      for (const k of [a, b, c]) {
        N[k * 3] += bx.x;
        N[k * 3 + 1] += bx.y;
        N[k * 3 + 2] += bx.z;
      }
    }
    for (let k = this.partStart; k < this.vertexCount; k++) {
      const x = N[k * 3];
      const y = N[k * 3 + 1];
      const z = N[k * 3 + 2];
      const l = Math.hypot(x, y, z) || 1;
      N[k * 3] = x / l;
      N[k * 3 + 1] = y / l;
      N[k * 3 + 2] = z / l;
    }
  }

  /** Override a vertex normal (after end()). */
  setNormal(i: number, n: Vector3): void {
    this.nrm[i * 3] = n.x;
    this.nrm[i * 3 + 1] = n.y;
    this.nrm[i * 3 + 2] = n.z;
  }

  setPosition(i: number, p: Vector3): void {
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
  }

  getPosition(i: number, out: Vector3): Vector3 {
    return out.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('skinIndex', new Uint16BufferAttribute(this.skinIdx, 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(this.skinW, 4));
    g.setAttribute('aMat', new Float32BufferAttribute(this.mat, 4));
    g.setAttribute('aUv2', new Float32BufferAttribute(this.uv, 2));
    const all = [...this.index[0], ...this.index[1]];
    const IndexArray = this.vertexCount > 65535 ? Uint32Array : Uint16Array;
    g.setIndex(new BufferAttribute(new IndexArray(all), 1));
    g.addGroup(0, this.index[0].length, 0);
    g.addGroup(this.index[0].length, this.index[1].length, 1);
    return g;
  }
}

// ---------------------------------------------------------------------------------------------
// Shared shape helpers
// ---------------------------------------------------------------------------------------------

/**
 * Connect rings of equal size into a closed tube (ring vertices go around counter-clockwise when
 * looking down the tube's direction of travel, i.e. from the first ring toward the last).
 * Optionally caps either end with a fan to a center vertex.
 */
export function stitchRings(b: GeoBuilder, rings: number[][], flip = false): void {
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r];
    const B = rings[r + 1];
    const n = A.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (flip) b.quad(A[i], A[j], B[j], B[i]);
      else b.quad(A[i], B[i], B[j], A[j]);
    }
  }
}

export function capRing(b: GeoBuilder, ring: number[], center: number, flip = false): void {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (flip) b.tri(center, ring[j], ring[i]);
    else b.tri(center, ring[i], ring[j]);
  }
}

/** Two unit vectors perpendicular to `dir` (and each other), seeded by `hint`. */
export function basisFor(dir: Vector3, hint: Vector3, outU: Vector3, outV: Vector3): void {
  outU.copy(hint).addScaledVector(dir, -hint.dot(dir));
  if (outU.lengthSq() < 1e-8) outU.set(dir.y, dir.z, dir.x).addScaledVector(dir, -dir.dot(outU.set(dir.y, dir.z, dir.x)));
  outU.normalize();
  outV.crossVectors(dir, outU).normalize();
}

export interface TubeOptions {
  /** Centerline points. */
  points: Vector3[];
  /** Radius at each point (or [rx, ry] for an elliptical section in the (u, v) frame). */
  radii: (number | [number, number])[];
  /** Ring resolution. */
  segments: number;
  /** Hint for the section's "u" axis (e.g. up). */
  hint: Vector3;
  skin: (i: number, ringU: number) => Skin;
  mat: (i: number, around: number) => VertexMat;
  /** Arc-length coordinate written to aUv2.x (defaults to cumulative distance). */
  capStart?: boolean;
  capEnd?: boolean;
  /** Pointed end: collapse the last ring to a single vertex. */
  pointEnd?: boolean;
}

/** A tube along a polyline with per-point radii, smooth normals, optional caps. */
export function tube(b: GeoBuilder, o: TubeOptions): void {
  const n = o.points.length;
  const dir = new Vector3();
  const u = new Vector3();
  const w = new Vector3();
  const p = new Vector3();
  const rings: number[][] = [];
  let s = 0;
  const prevU = new Vector3().copy(o.hint);
  for (let i = 0; i < n; i++) {
    const a = o.points[Math.max(0, i - 1)];
    const c = o.points[Math.min(n - 1, i + 1)];
    dir.subVectors(c, a).normalize();
    if (i > 0) s += o.points[i].distanceTo(o.points[i - 1]);
    // Parallel-transport-ish: reuse the previous u as the hint to avoid twisting.
    basisFor(dir, i === 0 ? o.hint : prevU, u, w);
    prevU.copy(u);
    const r = o.radii[i];
    const rx = Array.isArray(r) ? r[0] : r;
    const ry = Array.isArray(r) ? r[1] : r;
    if (o.pointEnd && i === n - 1) {
      rings.push([b.vertex(o.points[i], o.skin(i, 0), o.mat(i, 0), s, 0)]);
      continue;
    }
    const ring: number[] = [];
    for (let k = 0; k < o.segments; k++) {
      const t = (k / o.segments) * Math.PI * 2;
      const cu = Math.cos(t);
      const cw = Math.sin(t);
      p.copy(o.points[i]).addScaledVector(u, cu * rx).addScaledVector(w, cw * ry);
      ring.push(b.vertex(p, o.skin(i, cu), o.mat(i, cu), s, cw));
    }
    rings.push(ring);
  }
  // Stitch; a pointed end is a fan.
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r];
    const B = rings[r + 1];
    if (B.length === 1) {
      for (let k = 0; k < A.length; k++) b.tri(A[k], A[(k + 1) % A.length], B[0]);
      continue;
    }
    for (let k = 0; k < A.length; k++) {
      const j = (k + 1) % A.length;
      b.quad(A[k], A[j], B[j], B[k]);
    }
  }
  if (o.capStart) {
    const c = b.vertex(o.points[0], o.skin(0, 0), o.mat(0, 0), 0, 0);
    const A = rings[0];
    for (let k = 0; k < A.length; k++) b.tri(c, A[(k + 1) % A.length], A[k]);
  }
  if (o.capEnd && !o.pointEnd) {
    const c = b.vertex(o.points[n - 1], o.skin(n - 1, 0), o.mat(n - 1, 0), s, 0);
    const A = rings[n - 1];
    for (let k = 0; k < A.length; k++) b.tri(c, A[k], A[(k + 1) % A.length]);
  }
}

/** An ellipsoid in a given frame (x/y/z axes scaled by radii), single-bone or custom skin. */
export function ellipsoid(
  b: GeoBuilder,
  center: Vector3,
  ax: Vector3,
  ay: Vector3,
  az: Vector3,
  radii: [number, number, number],
  skin: (p: Vector3) => Skin,
  mat: (p: Vector3, nLocal: Vector3) => VertexMat,
  rings = 8,
  segs = 12,
): void {
  const p = new Vector3();
  const nl = new Vector3();
  const grid: number[][] = [];
  for (let i = 0; i <= rings; i++) {
    const phi = (i / rings) * Math.PI; // 0 at +y pole
    const row: number[] = [];
    const count = i === 0 || i === rings ? 1 : segs;
    for (let k = 0; k < count; k++) {
      const th = (k / segs) * Math.PI * 2;
      nl.set(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th));
      p.copy(center)
        .addScaledVector(ax, nl.x * radii[0])
        .addScaledVector(ay, nl.y * radii[1])
        .addScaledVector(az, nl.z * radii[2]);
      row.push(b.vertex(p, skin(p), mat(p, nl), nl.z, nl.y));
    }
    grid.push(row);
  }
  for (let i = 0; i < rings; i++) {
    const A = grid[i];
    const B = grid[i + 1];
    if (A.length === 1) {
      for (let k = 0; k < segs; k++) b.tri(A[0], B[(k + 1) % segs], B[k]);
    } else if (B.length === 1) {
      for (let k = 0; k < segs; k++) b.tri(A[k], A[(k + 1) % segs], B[0]);
    } else {
      for (let k = 0; k < segs; k++) {
        const j = (k + 1) % segs;
        b.quad(A[k], A[j], B[j], B[k]);
      }
    }
  }
}
