// Small shape utilities shared by the part builders.

import { Vector3 } from 'three';
import { GeoBuilder, Skin, type VertexMat } from '../builder';

/** Catmull-Rom interpolation through (t, value) keys sorted by t. */
export function keyed(keys: [number, number][], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  const n = keys.length;
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0;
  while (i < n - 2 && keys[i + 1][0] <= t) i++;
  const [t1, p1] = keys[i];
  const [t2, p2] = keys[i + 1];
  const p0 = keys[Math.max(0, i - 1)][1];
  const p3 = keys[Math.min(n - 1, i + 2)][1];
  const u = (t - t1) / Math.max(1e-6, t2 - t1);
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

/** Signed power keeping the sign: superellipse helper. */
export const spow = (x: number, e: number) => Math.sign(x) * Math.pow(Math.abs(x), e);

/**
 * A tapered, optionally curved horn/claw/spike: a tube along `points` from base radius to a point.
 * Rings use `segs` sides; radii taper with `taper` power.
 */
export function spike(
  b: GeoBuilder,
  points: Vector3[],
  baseRadius: number,
  skin: Skin | ((i: number) => Skin),
  mat: VertexMat | ((i: number, t: number) => VertexMat),
  segs = 6,
  hint = new Vector3(0, 1, 0),
  flatten = 1,
  taper = 1,
): void {
  const n = points.length;
  const dir = new Vector3();
  const u = new Vector3();
  const w = new Vector3();
  const p = new Vector3();
  const prevU = hint.clone();
  const rings: number[][] = [];
  let len = 0;
  for (let i = 1; i < n; i++) len += points[i].distanceTo(points[i - 1]);
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) s += points[i].distanceTo(points[i - 1]);
    const t = len > 0 ? s / len : 0;
    const sk = typeof skin === 'function' ? skin(i) : skin;
    const mm = typeof mat === 'function' ? mat(i, t) : mat;
    if (i === n - 1) {
      rings.push([b.vertex(points[i], sk, mm, t, 0)]);
      break;
    }
    const a = points[Math.max(0, i - 1)];
    const c = points[Math.min(n - 1, i + 1)];
    dir.subVectors(c, a).normalize();
    u.copy(prevU).addScaledVector(dir, -prevU.dot(dir));
    if (u.lengthSq() < 1e-8) u.set(dir.y, dir.z, dir.x).cross(dir);
    u.normalize();
    prevU.copy(u);
    w.crossVectors(dir, u).normalize();
    const r = baseRadius * Math.pow(1 - t, taper);
    const ring: number[] = [];
    for (let k = 0; k < segs; k++) {
      const th = (k / segs) * Math.PI * 2;
      p.copy(points[i])
        .addScaledVector(u, Math.cos(th) * r * flatten)
        .addScaledVector(w, Math.sin(th) * r);
      ring.push(b.vertex(p, sk, mm, t, Math.sin(th)));
    }
    rings.push(ring);
  }
  // Base cap (usually buried) and side quads.
  const base = rings[0];
  const c0 = b.vertex(points[0], typeof skin === 'function' ? skin(0) : skin, typeof mat === 'function' ? mat(0, 0) : mat, 0, 0);
  for (let k = 0; k < base.length; k++) b.tri(c0, base[(k + 1) % base.length], base[k]);
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
}

/** Quadratic Bezier sampled into n+1 points. */
export function bezier3(a: Vector3, c: Vector3, e: Vector3, n: number): Vector3[] {
  const out: Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push(new Vector3().addScaledVector(a, u * u).addScaledVector(c, 2 * u * t).addScaledVector(e, t * t));
  }
  return out;
}

/** Cubic Bezier sampled into n+1 points. */
export function bezier4(a: Vector3, c1: Vector3, c2: Vector3, e: Vector3, n: number): Vector3[] {
  const out: Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push(
      new Vector3()
        .addScaledVector(a, u * u * u)
        .addScaledVector(c1, 3 * u * u * t)
        .addScaledVector(c2, 3 * u * t * t)
        .addScaledVector(e, t * t * t),
    );
  }
  return out;
}

/**
 * A lens-shaped solid ("leaf"): a closed outline in the plane spanned by (u, v) around `center`,
 * bulging along ±n by `thickness` at the middle and meeting at a sharp rim. Used for tail spades,
 * blades, armor plates and fin bases. `outline` is a list of [u, v] points (counter-clockwise
 * seen from +n). aUv2.x is written as the radial fraction (0 center → 1 rim).
 */
export function leaf(
  b: GeoBuilder,
  center: Vector3,
  u: Vector3,
  v: Vector3,
  n: Vector3,
  outline: [number, number][],
  thickness: number,
  skin: (p: Vector3) => Skin,
  mat: (top: boolean, f: number) => VertexMat,
  rings = 3,
  bottomScale = 1,
): void {
  const p = new Vector3();
  const N = outline.length;
  // The outline must run counter-clockwise seen from +n; reverse it if (u × v) points away.
  if (new Vector3().crossVectors(u, v).dot(n) < 0) outline = outline.slice().reverse();
  for (const side of [1, -1]) {
    const c = b.vertex(p.copy(center).addScaledVector(n, thickness * side * (side < 0 ? bottomScale : 1)), skin(p), mat(side > 0, 0), 0, 0);
    let prev: number[] = [];
    for (let r = 1; r <= rings; r++) {
      const f = r / rings;
      const h = thickness * (1 - f * f) * (side < 0 ? bottomScale : 1);
      const ring: number[] = [];
      for (let k = 0; k < N; k++) {
        p.copy(center)
          .addScaledVector(u, outline[k][0] * f)
          .addScaledVector(v, outline[k][1] * f)
          .addScaledVector(n, h * side);
        ring.push(b.vertex(p, skin(p), mat(side > 0, f), f, 0));
      }
      for (let k = 0; k < N; k++) {
        const j = (k + 1) % N;
        if (r === 1) {
          if (side > 0) b.tri(c, ring[k], ring[j]);
          else b.tri(c, ring[j], ring[k]);
        } else if (side > 0) b.quad(prev[k], ring[k], ring[j], prev[j]);
        else b.quad(prev[k], prev[j], ring[j], ring[k]);
      }
      prev = ring;
    }
  }
}

/** A flat strip (for feathers, ribbons and fin webbing) along a center curve, double-sided use. */
export function strip(
  b: GeoBuilder,
  points: Vector3[],
  side: Vector3[],
  widths: number[],
  skin: (i: number) => Skin,
  mat: (i: number, t: number, across: number) => VertexMat,
  across = 2,
): void {
  const n = points.length;
  const p = new Vector3();
  const rows: number[][] = [];
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    const row: number[] = [];
    for (let j = 0; j <= across; j++) {
      const a = j / across - 0.5;
      p.copy(points[i]).addScaledVector(side[i], a * 2 * widths[i]);
      row.push(b.vertex(p, skin(i), mat(i, t, a), t, a));
    }
    rows.push(row);
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < across; j++) b.quad(rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]);
  }
}
