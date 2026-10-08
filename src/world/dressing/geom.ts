// Geometry kit for dressing: merge many small transformed primitives into one BufferGeometry with
// per-vertex color, sway weight and night-glow mask, so a whole building (or a whole species of
// tree) draws in a single call with a single material.
//
// Build-time only: these helpers allocate freely. Nothing here runs per frame.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  Matrix3,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noise3 } from '../../core/noise';

export type ColorFn = (p: Vector3, n: Vector3, out: Color) => void;
export type ScalarFn = (p: Vector3, n: Vector3) => number;

export interface AddOptions {
  /** Flat color or a per-vertex function (p and n are in builder space, after the transform). */
  color?: Color | string | ColorFn;
  /** Wind sway weight (meters of displacement at full wind). Default 0 (rigid). */
  sway?: number | ScalarFn;
  /** Night glow mask 0..1 (emissive = vertex color × glow). Default 0. */
  glow?: number | ScalarFn;
  /** Rewrite the normal (builder space) after transforming, e.g. canopy normals from a center. */
  normal?: (p: Vector3, n: Vector3) => void;
}

const tmpP = new Vector3();
const tmpN = new Vector3();
const tmpC = new Color();
const tmpM3 = new Matrix3();

export class GeoBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly sway: number[] = [];
  readonly glow: number[] = [];
  readonly indices: number[] = [];
  private anySway = false;
  private anyGlow = false;

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get triangleCount(): number {
    return this.indices.length / 3;
  }

  /** Append `geo` transformed by `matrix` (or as-is when null). */
  add(geo: BufferGeometry, matrix: Matrix4 | null, opts: AddOptions = {}): this {
    const pos = geo.getAttribute('position');
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const nrm = geo.getAttribute('normal');
    const base = this.vertexCount;
    if (matrix) tmpM3.getNormalMatrix(matrix);
    const flatColor = opts.color === undefined ? tmpC.set(1, 1, 1).clone() : typeof opts.color === 'function' ? null : new Color(opts.color);
    const colorFn = typeof opts.color === 'function' ? opts.color : null;
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      tmpP.fromBufferAttribute(pos, i);
      tmpN.fromBufferAttribute(nrm, i);
      if (matrix) {
        tmpP.applyMatrix4(matrix);
        tmpN.applyMatrix3(tmpM3).normalize();
      }
      if (opts.normal) opts.normal(tmpP, tmpN);
      this.positions.push(tmpP.x, tmpP.y, tmpP.z);
      this.normals.push(tmpN.x, tmpN.y, tmpN.z);
      if (colorFn) colorFn(tmpP, tmpN, c);
      else c.copy(flatColor!);
      this.colors.push(c.r, c.g, c.b);
      const s = typeof opts.sway === 'function' ? opts.sway(tmpP, tmpN) : opts.sway ?? 0;
      const g = typeof opts.glow === 'function' ? opts.glow(tmpP, tmpN) : opts.glow ?? 0;
      if (s !== 0) this.anySway = true;
      if (g !== 0) this.anyGlow = true;
      this.sway.push(s);
      this.glow.push(g);
    }
    const index = geo.getIndex();
    // A mirroring transform flips winding; keep faces pointing out.
    const flip = matrix ? matrix.determinant() < 0 : false;
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i);
        const b = index.getX(i + 1);
        const cc = index.getX(i + 2);
        if (flip) this.indices.push(base + a, base + cc, base + b);
        else this.indices.push(base + a, base + b, base + cc);
      }
    } else {
      for (let i = 0; i < pos.count; i += 3) {
        if (flip) this.indices.push(base + i, base + i + 2, base + i + 1);
        else this.indices.push(base + i, base + i + 1, base + i + 2);
      }
    }
    return this;
  }

  /** Append raw triangles (positions in builder space). Normals are computed per face. */
  addTriangles(verts: number[], opts: AddOptions = {}): this {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
    g.computeVertexNormals();
    return this.add(g, null, opts);
  }

  /** Append another builder's contents. */
  append(other: GeoBuilder): this {
    const base = this.vertexCount;
    this.positions.push(...other.positions);
    this.normals.push(...other.normals);
    this.colors.push(...other.colors);
    this.sway.push(...other.sway);
    this.glow.push(...other.glow);
    for (const i of other.indices) this.indices.push(base + i);
    this.anySway ||= other.anySway;
    this.anyGlow ||= other.anyGlow;
    return this;
  }

  isEmpty(): boolean {
    return this.positions.length === 0;
  }

  /**
   * Final geometry: position, normal, color, plus aSway / aGlow when any vertex uses them
   * (or always, when `forceExtras` so a shared material sees a consistent layout).
   */
  build(forceExtras = false): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 3));
    if (this.anySway || forceExtras) g.setAttribute('aSway', new BufferAttribute(new Float32Array(this.sway), 1));
    if (this.anyGlow || forceExtras) g.setAttribute('aGlow', new BufferAttribute(new Float32Array(this.glow), 1));
    const n = this.vertexCount;
    g.setIndex(n > 65535 ? new BufferAttribute(new Uint32Array(this.indices), 1) : new BufferAttribute(new Uint16Array(this.indices), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// ---------------------------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------------------------

const _q = new Quaternion();
const _e = new Euler();

/** Matrix from translation, Euler rotation (radians, YXZ order: yaw first) and scale. */
export function xf(
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = sx,
  sz = sx,
): Matrix4 {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new Matrix4().compose(new Vector3(x, y, z), _q, new Vector3(sx, sy, sz));
}

/** Matrix that places a unit-Y primitive (height 1, centered at origin) between two points. */
export function between(a: Vector3, b: Vector3, thicknessX: number, thicknessZ = thicknessX): Matrix4 {
  const dir = new Vector3().subVectors(b, a);
  const len = dir.length();
  const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
  return new Matrix4().compose(mid, q, new Vector3(thicknessX, len, thicknessZ));
}

/** Pre-multiply: apply `parent` after `child` (child in parent's space). */
export function under(parent: Matrix4, child: Matrix4): Matrix4 {
  return new Matrix4().multiplyMatrices(parent, child);
}

// ---------------------------------------------------------------------------------------------
// Shape helpers
// ---------------------------------------------------------------------------------------------

/** Strip everything but position, then weld so smooth normals can be computed. */
export function welded(geo: BufferGeometry, tolerance = 1e-3): BufferGeometry {
  for (const name of Object.keys(geo.attributes)) if (name !== 'position') geo.deleteAttribute(name);
  const g = mergeVertices(geo, tolerance);
  g.computeVertexNormals();
  return g;
}

/**
 * Push each vertex along its (welded, smooth) normal by 3D noise: lumpy rocks, blobby canopies.
 * `freq` in 1/m of the geometry's own space.
 */
export function displace(geo: BufferGeometry, amount: number, freq: number, seed: number, octaves = 2): BufferGeometry {
  const g = welded(geo);
  const n3 = noise3(seed);
  const pos = g.getAttribute('position') as BufferAttribute;
  const nrm = g.getAttribute('normal') as BufferAttribute;
  const p = new Vector3();
  const n = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nrm, i);
    let v = 0;
    let a = 1;
    let f = freq;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      v += a * n3(p.x * f, p.y * f, p.z * f);
      norm += a;
      a *= 0.5;
      f *= 2.1;
    }
    p.addScaledVector(n, (v / norm) * amount);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Scale a color's lightness/saturation in HSL; returns a new Color. */
export function shade(c: Color | string, dl: number, ds = 0, dh = 0): Color {
  const col = new Color(c);
  const hsl = { h: 0, s: 0, l: 0 };
  col.getHSL(hsl);
  col.setHSL((hsl.h + dh + 1) % 1, Math.min(1, Math.max(0, hsl.s + ds)), Math.min(1, Math.max(0, hsl.l + dl)));
  return col;
}

/** Linear mix of two colors into a new Color. */
export function mixColor(a: Color | string, b: Color | string, t: number): Color {
  return new Color(a).lerp(new Color(b), t);
}

// ---------------------------------------------------------------------------------------------
// Tubes
// ---------------------------------------------------------------------------------------------

/**
 * A tube along a polyline with a radius per point (tapers, bulges). Uses parallel-transport
 * frames so it doesn't twist. `capEnd` closes the last ring with a point (root tips, branch ends).
 * The vertex attribute `uv.y` is not produced; callers color/sway by position.
 */
export function tube(path: Vector3[], radii: number[], radial = 6, capEnd = true): BufferGeometry {
  const n = path.length;
  const pos: number[] = [];
  const idx: number[] = [];
  const tangent = new Vector3();
  const normal = new Vector3();
  const binormal = new Vector3();
  const prevT = new Vector3();
  const tmp = new Vector3();
  for (let i = 0; i < n; i++) {
    if (i === 0) tangent.subVectors(path[1], path[0]);
    else if (i === n - 1) tangent.subVectors(path[n - 1], path[n - 2]);
    else tangent.subVectors(path[i + 1], path[i - 1]);
    tangent.normalize();
    if (i === 0) {
      // Any vector not parallel to the tangent seeds the frame.
      tmp.set(0, 1, 0);
      if (Math.abs(tangent.y) > 0.9) tmp.set(1, 0, 0);
      normal.crossVectors(tangent, tmp).normalize();
    } else {
      // Parallel transport: rotate the previous normal by the change in tangent.
      const axis = tmp.crossVectors(prevT, tangent);
      const s = axis.length();
      if (s > 1e-6) {
        axis.normalize();
        const ang = Math.acos(Math.max(-1, Math.min(1, prevT.dot(tangent))));
        normal.applyAxisAngle(axis, ang);
      }
    }
    binormal.crossVectors(tangent, normal).normalize();
    prevT.copy(tangent);
    const r = radii[i];
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      pos.push(
        path[i].x + (normal.x * c + binormal.x * s) * r,
        path[i].y + (normal.y * c + binormal.y * s) * r,
        path[i].z + (normal.z * c + binormal.z * s) * r,
      );
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * radial + k;
      const b = i * radial + ((k + 1) % radial);
      const c = (i + 1) * radial + k;
      const d = (i + 1) * radial + ((k + 1) % radial);
      idx.push(a, b, c, b, d, c);
    }
  }
  if (capEnd) {
    const tip = pos.length / 3;
    const end = path[n - 1];
    const dir = new Vector3().subVectors(path[n - 1], path[n - 2]).normalize();
    pos.push(end.x + dir.x * radii[n - 1], end.y + dir.y * radii[n - 1], end.z + dir.z * radii[n - 1]);
    const last = (n - 1) * radial;
    for (let k = 0; k < radial; k++) idx.push(last + k, last + ((k + 1) % radial), tip);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Sample a quadratic/cubic Bézier into `segments + 1` points. */
export function bezier(points: Vector3[], segments: number): Vector3[] {
  const out: Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // de Casteljau
    const pts = points.map((p) => p.clone());
    for (let k = pts.length - 1; k > 0; k--) {
      for (let j = 0; j < k; j++) pts[j].lerp(pts[j + 1], t);
    }
    out.push(pts[0]);
  }
  return out;
}
