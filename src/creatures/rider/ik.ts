// Two-bone IK and bone-basis helpers. Bones in the rider's rig extend along their local −Y and
// hinge (knee/elbow) about their local ±X, with identity bind rotations, so a bone's world
// orientation is fully described by "which way it points" plus "which way its hinge axis faces".

import { Matrix4, Quaternion, Vector3 } from 'three';

export interface TwoBoneResult {
  /** Direction of the first bone (root → middle joint). */
  dir1: Vector3;
  /** Direction of the second bone (middle joint → end). */
  dir2: Vector3;
  /** Hinge axis (perpendicular to both bones). */
  hinge: Vector3;
  /** Middle joint position. */
  mid: Vector3;
  /** 0..1: how stretched the limb is (1 = fully straight, target at or beyond reach). */
  reach: number;
}

const _d = new Vector3();
const _perp = new Vector3();
const _t = new Vector3();
const _m = new Matrix4();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();

/**
 * Solve a two-bone chain from `root` toward `target`, bending the middle joint toward `pole`
 * (a direction). Results are written into `out` (vectors are reused). The hinge follows the
 * right-hand rule: hinge = perp × dir1, where perp is the pole direction made perpendicular to
 * the root→target line. For a leg with the knee pole forward and the bone pointing down, the
 * hinge is +X.
 */
export function solveTwoBone(root: Vector3, target: Vector3, pole: Vector3, l1: number, l2: number, out: TwoBoneResult): TwoBoneResult {
  _d.subVectors(target, root);
  let dist = _d.length();
  if (dist < 1e-6) {
    _d.set(0, -1, 0);
    dist = 1e-6;
  } else _d.divideScalar(dist);
  const maxR = (l1 + l2) * 0.9995;
  const minR = Math.abs(l1 - l2) + 1e-4;
  out.reach = Math.min(1, dist / (l1 + l2));
  const D = Math.min(maxR, Math.max(minR, dist));
  const cosA = (l1 * l1 + D * D - l2 * l2) / (2 * l1 * D);
  const a = Math.acos(Math.max(-1, Math.min(1, cosA)));
  _perp.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_perp.lengthSq() < 1e-10) {
    // Pole along the limb: pick any perpendicular.
    _perp.set(0, 0, 1).addScaledVector(_d, -_d.z);
    if (_perp.lengthSq() < 1e-10) _perp.set(1, 0, 0).addScaledVector(_d, -_d.x);
  }
  _perp.normalize();
  out.dir1.copy(_d).multiplyScalar(Math.cos(a)).addScaledVector(_perp, Math.sin(a)).normalize();
  out.mid.copy(root).addScaledVector(out.dir1, l1);
  _t.copy(root).addScaledVector(_d, D);
  out.dir2.subVectors(_t, out.mid).normalize();
  out.hinge.crossVectors(_perp, out.dir1).normalize();
  return out;
}

export function createTwoBoneResult(): TwoBoneResult {
  return { dir1: new Vector3(), dir2: new Vector3(), hinge: new Vector3(), mid: new Vector3(), reach: 0 };
}

/**
 * World (or parent-space) orientation of a bone that extends along `dir` (its local −Y) with its
 * local +X along `xAxis` (made perpendicular to dir).
 */
export function boneBasis(dir: Vector3, xAxis: Vector3, out: Quaternion): Quaternion {
  _y.copy(dir).negate().normalize();
  _x.copy(xAxis).addScaledVector(_y, -xAxis.dot(_y));
  if (_x.lengthSq() < 1e-10) {
    _x.set(1, 0, 0).addScaledVector(_y, -_y.x);
    if (_x.lengthSq() < 1e-10) _x.set(0, 0, 1);
  }
  _x.normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/** Orientation whose local +Z points along `fwd` and local +Y is as close as possible to `up`. */
export function lookBasis(fwd: Vector3, up: Vector3, out: Quaternion): Quaternion {
  _z.copy(fwd).normalize();
  _x.crossVectors(up, _z);
  if (_x.lengthSq() < 1e-10) _x.set(1, 0, 0);
  _x.normalize();
  _y.crossVectors(_z, _x);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}
