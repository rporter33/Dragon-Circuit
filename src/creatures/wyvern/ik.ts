// Pure rotation helpers for the procedural animator: aiming a bone, two-bone IK and a
// critically-damped vector spring. No allocations in the per-frame paths.

import type { Quaternion, Vector3 } from 'three';

/**
 * The rotation that takes `restDir` to `dir` while keeping `restRef` (any vector not parallel to
 * restDir) as close as possible to `ref`. All vectors in the same space; dirs need not be unit.
 */
export function aimRotation(restDir: Vector3, restRef: Vector3, dir: Vector3, ref: Vector3, out: Quaternion): Quaternion {
  basis(restDir, restRef, _b0);
  basis(dir, ref, _b1);
  // R = B1 · B0ᵀ (columns of B are the basis vectors a, b, a × b).
  const A = _b1;
  const B = _b0;
  const m11 = A[0] * B[0] + A[3] * B[3] + A[6] * B[6];
  const m12 = A[0] * B[1] + A[3] * B[4] + A[6] * B[7];
  const m13 = A[0] * B[2] + A[3] * B[5] + A[6] * B[8];
  const m21 = A[1] * B[0] + A[4] * B[3] + A[7] * B[6];
  const m22 = A[1] * B[1] + A[4] * B[4] + A[7] * B[7];
  const m23 = A[1] * B[2] + A[4] * B[5] + A[7] * B[8];
  const m31 = A[2] * B[0] + A[5] * B[3] + A[8] * B[6];
  const m32 = A[2] * B[1] + A[5] * B[4] + A[8] * B[7];
  const m33 = A[2] * B[2] + A[5] * B[5] + A[8] * B[8];
  // Quaternion from a rotation matrix (as Quaternion.setFromRotationMatrix). Written through an
  // array (fromArray), not set(x, y, z, w): doubles passed into a call the JIT doesn't inline are
  // boxed on the heap, and this runs ~60 times a frame.
  const q = _qa;
  const tr = m11 + m22 + m33;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1.0);
    q[0] = (m32 - m23) * s;
    q[1] = (m13 - m31) * s;
    q[2] = (m21 - m12) * s;
    q[3] = 0.25 / s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
    q[0] = 0.25 * s;
    q[1] = (m12 + m21) / s;
    q[2] = (m13 + m31) / s;
    q[3] = (m32 - m23) / s;
  } else if (m22 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
    q[0] = (m12 + m21) / s;
    q[1] = 0.25 * s;
    q[2] = (m23 + m32) / s;
    q[3] = (m13 - m31) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
    q[0] = (m13 + m31) / s;
    q[1] = (m23 + m32) / s;
    q[2] = 0.25 * s;
    q[3] = (m21 - m12) / s;
  }
  return out.fromArray(q);
}

const _b0 = new Float64Array(9);
const _b1 = new Float64Array(9);
const _qa = new Float64Array(4);

/** Orthonormal basis (a = dir, b = ref made perpendicular, a × b) as three columns. */
function basis(dir: Vector3, ref: Vector3, out: Float64Array): void {
  // Scalar math (no Vector3 calls that return numbers): this runs ~60 times a frame and every
  // non-inlined call returning a double boxes it on the heap.
  let ax = dir.x;
  let ay = dir.y;
  let az = dir.z;
  let l = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
  ax /= l;
  ay /= l;
  az /= l;
  const d = ref.x * ax + ref.y * ay + ref.z * az;
  let bx = ref.x - ax * d;
  let by = ref.y - ay * d;
  let bz = ref.z - az * d;
  l = bx * bx + by * by + bz * bz;
  if (l < 1e-10) {
    // ref parallel to dir: pick any perpendicular, (ay, az, -ax) × a.
    const px = ay;
    const py = az;
    const pz = -ax;
    bx = py * az - pz * ay;
    by = pz * ax - px * az;
    bz = px * ay - py * ax;
    l = bx * bx + by * by + bz * bz;
  }
  l = Math.sqrt(l) || 1;
  bx /= l;
  by /= l;
  bz /= l;
  out[0] = ax;
  out[1] = ay;
  out[2] = az;
  out[3] = bx;
  out[4] = by;
  out[5] = bz;
  out[6] = ay * bz - az * by;
  out[7] = az * bx - ax * bz;
  out[8] = ax * by - ay * bx;
}

/**
 * Two-bone IK: from `root` with segment lengths l1, l2 toward `target`, bending toward `pole`
 * (a direction). Writes the middle joint position. Returns how far the target is beyond reach
 * (0 when reachable).
 */
export function solveTwoBone(root: Vector3, l1: number, l2: number, target: Vector3, pole: Vector3, outMid: Vector3): number {
  let dx = target.x - root.x;
  let dy = target.y - root.y;
  let dz = target.z - root.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const maxReach = (l1 + l2) * 0.9995;
  const minReach = Math.abs(l1 - l2) * 1.001 + 1e-4;
  const d = dist < minReach ? minReach : dist > maxReach ? maxReach : dist;
  if (dist > 1e-6) {
    dx /= dist;
    dy /= dist;
    dz /= dist;
  } else {
    dx = 0;
    dy = -1;
    dz = 0;
  }
  // Distance from root along the root→target line to the foot of the middle joint.
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  // Pole made perpendicular to the line.
  const pd = pole.x * dx + pole.y * dy + pole.z * dz;
  let ex = pole.x - dx * pd;
  let ey = pole.y - dy * pd;
  let ez = pole.z - dz * pd;
  let el = ex * ex + ey * ey + ez * ez;
  if (el < 1e-10) {
    // (dy, dz, -dx) × d
    ex = dz * dz + dx * dy;
    ey = -dx * dx - dy * dz;
    ez = dy * dy - dz * dx;
    el = ex * ex + ey * ey + ez * ez;
  }
  el = Math.sqrt(el) || 1;
  outMid.x = root.x + dx * a + (ex / el) * h;
  outMid.y = root.y + dy * a + (ey / el) * h;
  outMid.z = root.z + dz * a + (ez / el) * h;
  return Math.max(0, dist - maxReach);
}

/** Rotate `v` about unit `axis` by `angle` (Rodrigues), in place. */
export function rotateAbout(v: Vector3, axis: Vector3, angle: number): Vector3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const ax = axis.x;
  const ay = axis.y;
  const az = axis.z;
  const vx = v.x;
  const vy = v.y;
  const vz = v.z;
  const k = (ax * vx + ay * vy + az * vz) * (1 - c);
  v.x = vx * c + (ay * vz - az * vy) * s + ax * k;
  v.y = vy * c + (az * vx - ax * vz) * s + ay * k;
  v.z = vz * c + (ax * vy - ay * vx) * s + az * k;
  return v;
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

/**
 * Smooth 1D value noise in [-1, 1] (for buffets and idle fidgets). The lattice hash is written out
 * twice rather than called: a double returned from a call the JIT doesn't inline is boxed.
 */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  // Hash of the lattice points i and i + 1 to [-1, 1].
  const s0 = Math.sin((i + seed * 17.13) * 127.1 + seed * 311.7) * 43758.5453;
  const s1 = Math.sin((i + 1 + seed * 17.13) * 127.1 + seed * 311.7) * 43758.5453;
  const h0 = (s0 - Math.floor(s0)) * 2 - 1;
  const h1 = (s1 - Math.floor(s1)) * 2 - 1;
  return h0 * (1 - u) + h1 * u;
}
