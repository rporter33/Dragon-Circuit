// The rider's skeleton: bone list, proportions per build, and the bind pose.
//
// Bind pose: every bone has an identity rotation, so each bone's local axes ARE the rider's body
// axes (+Z forward, +Y up, +X to the rider's LEFT). Arms and legs hang straight down (−Y).
// Rotations the animator applies are therefore easy to read: pitch about X, yaw about Y, roll
// about Z. Geometry is modeled in "bind space": feet at the origin, standing.

import { Bone, Matrix4, Skeleton, Vector3 } from 'three';
import type { RiderLook } from '../../core/types';

export const BONE_NAMES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'clavL',
  'upperArmL',
  'foreArmL',
  'handL',
  'fingersL',
  'fingers2L',
  'thumbL',
  'clavR',
  'upperArmR',
  'foreArmR',
  'handR',
  'fingersR',
  'fingers2R',
  'thumbR',
  'thighL',
  'shinL',
  'footL',
  'toeL',
  'thighR',
  'shinR',
  'footR',
  'toeR',
] as const;

export type BoneName = (typeof BONE_NAMES)[number];

/** Bone index by name (the order skin indices refer to). */
export const B = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i])) as Record<BoneName, number>;

const PARENT: Record<BoneName, BoneName | null> = {
  hips: null,
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  clavL: 'chest',
  upperArmL: 'clavL',
  foreArmL: 'upperArmL',
  handL: 'foreArmL',
  fingersL: 'handL',
  fingers2L: 'fingersL',
  thumbL: 'handL',
  clavR: 'chest',
  upperArmR: 'clavR',
  foreArmR: 'upperArmR',
  handR: 'foreArmR',
  fingersR: 'handR',
  fingers2R: 'fingersR',
  thumbR: 'handR',
  thighL: 'hips',
  shinL: 'thighL',
  footL: 'shinL',
  toeL: 'footL',
  thighR: 'hips',
  shinR: 'thighR',
  footR: 'shinR',
  toeR: 'footR',
};

/**
 * Body proportions (meters). Medium is ~1.75 m tall with a slightly large, appealing head;
 * slight and broad vary height a little and width/girth a lot.
 */
export interface RigDims {
  build: RiderLook['build'];
  /** Height scale for lengths. */
  h: number;
  /** Width scale (shoulders, hips). */
  w: number;
  /** Girth scale for limb and torso thickness. */
  g: number;
  hipsY: number;
  hipHalfWidth: number;
  thigh: number;
  shin: number;
  ankleY: number;
  footLen: number;
  spineLen: number;
  chestLen: number;
  neckLen: number;
  headBase: number;
  clavOut: number;
  shoulderHalfWidth: number;
  upperArm: number;
  foreArm: number;
  palm: number;
  finger1: number;
  finger2: number;
  /** Head ellipsoid radii (x, y, z) of the cranium. */
  head: Vector3;
}

export function rigDims(build: RiderLook['build']): RigDims {
  const k = build === 'slight' ? { h: 0.965, w: 0.88, g: 0.84 } : build === 'broad' ? { h: 1.025, w: 1.14, g: 1.2 } : { h: 1, w: 1, g: 1 };
  const { h, w, g } = k;
  const headScale = (build === 'slight' ? 0.98 : build === 'broad' ? 1.02 : 1) * 1.07;
  return {
    build,
    h,
    w,
    g,
    hipsY: 0.96 * h,
    hipHalfWidth: 0.092 * w,
    thigh: 0.42 * h,
    shin: 0.41 * h,
    ankleY: 0.075 * h,
    footLen: 0.25 * h,
    spineLen: 0.1 * h,
    chestLen: 0.17 * h,
    neckLen: 0.215 * h,
    headBase: 0.085 * h,
    clavOut: 0.025 * w,
    shoulderHalfWidth: 0.174 * w,
    upperArm: 0.28 * h,
    foreArm: 0.25 * h,
    palm: 0.085 * h,
    finger1: 0.05 * h,
    finger2: 0.045 * h,
    head: new Vector3(0.097, 0.117, 0.108).multiplyScalar(headScale),
  };
}

/** Bone offsets from their parents in bind space. */
function boneOffsets(d: RigDims): Record<BoneName, Vector3> {
  const o: Partial<Record<BoneName, Vector3>> = {};
  o.hips = new Vector3(0, d.hipsY, 0);
  o.spine = new Vector3(0, d.spineLen, -0.005);
  o.chest = new Vector3(0, d.chestLen, 0);
  o.neck = new Vector3(0, d.neckLen, -0.012);
  o.head = new Vector3(0, d.headBase, 0.012);
  for (const [s, sign] of [['L', 1], ['R', -1]] as const) {
    o[`clav${s}`] = new Vector3(sign * d.clavOut, d.chestLen * 0.98, -0.012);
    o[`upperArm${s}`] = new Vector3(sign * (d.shoulderHalfWidth - d.clavOut), 0, 0);
    o[`foreArm${s}`] = new Vector3(0, -d.upperArm, 0);
    o[`hand${s}`] = new Vector3(0, -d.foreArm, 0);
    o[`fingers${s}`] = new Vector3(0, -d.palm, 0.004);
    o[`fingers2${s}`] = new Vector3(0, -d.finger1, 0);
    o[`thumb${s}`] = new Vector3(-sign * 0.022 * d.w, -0.022 * d.h, 0.022 * d.h);
    o[`thigh${s}`] = new Vector3(sign * d.hipHalfWidth, -0.065 * d.h, 0);
    o[`shin${s}`] = new Vector3(0, -d.thigh, 0.004);
    o[`foot${s}`] = new Vector3(0, -d.shin, -0.004);
    o[`toe${s}`] = new Vector3(0, -d.ankleY * 0.62, d.footLen * 0.55);
  }
  return o as Record<BoneName, Vector3>;
}

export interface Rig {
  dims: RigDims;
  bones: Bone[];
  skeleton: Skeleton;
  /** Bind-space position of each bone (feet at the origin). */
  bindPos: Vector3[];
  /** Root bone (hips). */
  root: Bone;
}

export function createRig(d: RigDims): Rig {
  const off = boneOffsets(d);
  const bones: Bone[] = [];
  const bindPos: Vector3[] = [];
  for (const name of BONE_NAMES) {
    const b = new Bone();
    b.name = name;
    b.position.copy(off[name]);
    bones.push(b);
    const parent = PARENT[name];
    const p = off[name].clone();
    if (parent) {
      bones[B[parent]].add(b);
      p.add(bindPos[B[parent]]);
    }
    bindPos.push(p);
  }
  // Bind rotations are identity, so each inverse bind matrix is a pure translation.
  const inverses = bindPos.map((p) => new Matrix4().makeTranslation(-p.x, -p.y, -p.z));
  const skeleton = new Skeleton(bones, inverses);
  return { dims: d, bones, skeleton, bindPos, root: bones[B.hips] };
}

/** Bind-space positions without building bones (for geometry construction and tests). */
export function bindPositions(d: RigDims): Record<BoneName, Vector3> {
  const off = boneOffsets(d);
  const out: Partial<Record<BoneName, Vector3>> = {};
  for (const name of BONE_NAMES) {
    const parent = PARENT[name];
    out[name] = off[name].clone().add(parent ? out[parent]! : new Vector3());
  }
  return out as Record<BoneName, Vector3>;
}
