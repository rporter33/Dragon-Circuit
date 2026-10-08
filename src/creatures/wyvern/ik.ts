// Pure rotation helpers for the procedural animator: aiming a bone, two-bone IK and a
// critically-damped vector spring. No allocations in the per-frame paths.

import { Matrix4, Quaternion, Vector3 } from 'three';
import { clamp } from '../../core/math';

const _m0 = new Matrix4();
const _m1 = new Matrix4();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _d = new Vector3();
const _e = new Vector3();
const _f = new Vector3();

/**
 * The rotation that takes `restDir` to `dir` while keeping `restRef` (any vector not parallel to
 * restDir) as close as possible to `ref`. All vectors in the same space; dirs need not be unit.
 */
export function aimRotation(restDir: Vector3, restRef: Vector3, dir: Vector3, ref: Vector3, out: Quaternion): Quaternion {
  basis(restDir, restRef, _m0);
  basis(dir, ref, _m1);
  // out = B1 · B0ᵀ
  _m0.transpose();
  _m1.multiply(_m0);
  return out.setFromRotationMatrix(_m1);
}

function basis(dir: Vector3, ref: Vector3, out: Matrix4): void {
  _a.copy(dir).normalize();
  _b.copy(ref).addScaledVector(_a, -ref.dot(_a));
  if (_b.lengthSq() < 1e-10) {
    // ref parallel to dir: pick any perpendicular.
    _b.set(_a.y, _a.z, -_a.x).cross(_a);
  }
  _b.normalize();
  _c.crossVectors(_a, _b);
  out.makeBasis(_a, _b, _c);
}

/**
 * Two-bone IK: from `root` with segment lengths l1, l2 toward `target`, bending toward `pole`
 * (a direction). Writes the middle joint position. Returns how far the target is beyond reach
 * (0 when reachable).
 */
export function solveTwoBone(root: Vector3, l1: number, l2: number, target: Vector3, pole: Vector3, outMid: Vector3): number {
  _d.subVectors(target, root);
  const dist = _d.length();
  const maxReach = (l1 + l2) * 0.9995;
  const minReach = Math.abs(l1 - l2) * 1.001 + 1e-4;
  const d = clamp(dist, minReach, maxReach);
  if (dist > 1e-6) _d.multiplyScalar(1 / dist);
  else _d.set(0, -1, 0);
  // Distance from root along the root→target line to the foot of the middle joint.
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _e.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_e.lengthSq() < 1e-10) _e.set(_d.y, _d.z, -_d.x).cross(_d);
  _e.normalize();
  outMid.copy(root).addScaledVector(_d, a).addScaledVector(_e, h);
  return Math.max(0, dist - maxReach);
}

/** Rotate `v` about unit `axis` by `angle` (Rodrigues), in place. */
export function rotateAbout(v: Vector3, axis: Vector3, angle: number): Vector3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  _f.crossVectors(axis, v);
  const k = axis.dot(v) * (1 - c);
  return v.multiplyScalar(c).addScaledVector(_f, s).addScaledVector(axis, k);
}

/** Mirror a left-side rotation to the right side (reflection across the YZ plane). */
export function mirrorQuat(q: Quaternion, out: Quaternion): Quaternion {
  return out.set(q.x, -q.y, -q.z, q.w);
}

/** Critically damped spring on a scalar; state is [value, velocity]. */
export class Spring {
  value = 0;
  velocity = 0;
  constructor(public omega: number) {}

  step(target: number, dt: number): number {
    const w = this.omega;
    const f = 1 + 2 * dt * w;
    const oo = w * w;
    const hoo = dt * oo;
    const hhoo = dt * hoo;
    const det = 1 / (f + hhoo);
    const x = (f * this.value + dt * this.velocity + hhoo * target) * det;
    const v = (this.velocity + hoo * (target - this.value)) * det;
    this.value = x;
    this.velocity = v;
    return x;
  }

  reset(v = 0): void {
    this.value = v;
    this.velocity = 0;
  }
}

/** Under-damped spring (for bounces): x'' = ω²(target − x) − 2ζω x'. Semi-implicit Euler. */
export class Bouncy {
  value = 0;
  velocity = 0;
  constructor(
    public omega: number,
    public zeta: number,
  ) {}

  step(target: number, dt: number): number {
    // Substep for stability at large dt.
    const n = Math.max(1, Math.ceil(dt * this.omega * 0.5));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = this.omega * this.omega * (target - this.value) - 2 * this.zeta * this.omega * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }

  reset(v = 0): void {
    this.value = v;
    this.velocity = 0;
  }
}

/** Smooth 1D value noise in [-1, 1] (for buffets and idle fidgets). */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number) => {
    const s = Math.sin((n + seed * 17.13) * 127.1 + seed * 311.7) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}
