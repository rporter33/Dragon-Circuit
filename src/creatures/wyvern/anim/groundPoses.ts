// Wing poses for the ground (left wing convention; the right mirrors), in the joint channels of
// wingPoses.ts. The folded stance itself is mostly two-bone IK (ground.ts applyWingIK); these are
// the FK poses it blends over: the settle after a landing, the resting shuffle, the fold where IK
// is not driving the arm, and the bask.

import { DEG, smoothstep } from '../../../core/math';
import { wingPose } from '../wingPoses';

/**
 * Root pitch while standing at rest (radians; negative = nose up): a flier's long arms carry the
 * chest high, like a bat or a pterosaur on the ground. Wyvern.seatOffset reports the bind seat
 * under this rotation, so mounting lines up with the standing animal.
 */
export const STAND_ROOT_PITCH = -10 * DEG;
/**
 * The pelvis's pitch against the root while standing (radians, + = nose down): the hindquarters
 * and the tail root keep a near-level carriage while the long arms raise the chest.
 */
export const STAND_PELVIS_PITCH = 6 * DEG;

/**
 * The kneel for the rider (C11, WyvernPose.kneel): a belly-down couch like a camel's or a basking
 * monitor's. The chest goes down nose-first and rolls toward the rider; the forearms reach forward
 * along the ground (the near one a little wider) so the folded forearm becomes a low step; the hind
 * legs fold with the heels down.
 */
export const KNEEL = {
  /** Nose-down pitch (rad) and roll toward the rider (rad) at a full kneel. */
  pitch: 7 * DEG,
  roll: 5 * DEG,
  /** The keel's clearance above the ground at a full kneel (× standHeight), and the depth's bounds. */
  clear: 0.06,
  minDepth: 0.3,
  maxDepth: 0.7,
  /** The forefeet's rest spots: forward (× forearm), and out (m; the near side's extra). */
  fwd: 0.55,
  out: 0.1,
  nearOut: 0.3,
  /** The metatarsus's angle from vertical at a full kneel (rad): nearly flat, the heels down. */
  metaFlat: 1.25,
};

/** Raised half-fold: the settle after landing, a resting shuffle. */
export const SETTLE = wingPose({
  humEl: 38,
  humSw: 38,
  humTw: -10,
  foreEl: 10,
  foreSw: -110,
  foreTw: 0,
  handEl: -20,
  handSw: 120,
  f0El: 6,
  f0Sw: 8,
  f1El: 6,
  f1Sw: -18,
  f2El: 6,
  f2Sw: -42,
  f0bEl: -6,
  f1bEl: -6,
  f2bEl: -6,
});

/** Folded on the ground (used where IK is not driving the arm). */
export const FOLDED = wingPose({
  humEl: -55,
  humSw: 55,
  humTw: 20,
  foreEl: -40,
  foreSw: -120,
  handEl: 75,
  handSw: 150,
  f0Sw: 6,
  f1Sw: -28,
  f2Sw: -58,
});

/**
 * Basking (the end of a reptile's stretch after resting): wings spread wide and raised toward
 * the sun like a cormorant drying out — arms up and out, the leading edge turned up so the
 * membrane faces the light, fingers splayed and their tips drooping. Blend weight is the caller's.
 */
export const BASK = wingPose({
  humEl: 30,
  humSw: 4,
  humTw: -12,
  foreEl: -6,
  foreSw: -12,
  foreTw: -6,
  handEl: -10,
  handSw: 10,
  f0El: -10,
  f0Sw: 2,
  f1El: -12,
  f1Sw: 6,
  f2El: -14,
  f2Sw: 12,
  f0bEl: -12,
  f1bEl: -10,
  f2bEl: -8,
});

/** Ease for the takeoff/landing opening of the wings on the ground. */
export const openEase = (x: number) => smoothstep(0, 1, x);
