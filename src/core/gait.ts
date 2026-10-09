// The wyverns' ground gait as data: one profile per breed, shared by the gameplay walker
// (player/ground.ts, which fires the footsteps) and the animator (creatures/wyvern/gait.ts, which
// plants the feet), so both run the same clock. Pure numbers: no three.js, no presentation.
//
// Foot order everywhere: left hind, right hind, left fore (the folded wing's wrist), right fore.

import type { BreedId } from './types';
import { DEG, clamp, lerp } from './math';

export interface GaitProfile {
  /**
   * Phase offsets per foot (LH, RH, LF, RF) of the walk: a lateral-sequence walk, touchdowns
   * LH, LF, RH, RF (each fore foot lands a quarter cycle after the hind foot on its side), like a
   * monitor lizard's or a horse's.
   */
  walkOffsets: readonly [number, number, number, number];
  /** ...and of the run: a bound, the hind pair pushing off together, then the wrists catching. */
  runOffsets: readonly [number, number, number, number];
  /** The run's duty factor (share of the cycle a foot is down): low, so the bound has a flight. */
  runDuty: number;
  /** Speed (m/s) at which the gait reads as a run (the blend runs from 0.7× to 1.25× of it). */
  runSpeed: number;
  /** How far the walk can blend into the bound (1 = all the way; heavy breeds trot-bound). */
  runBlendMax: number;
  /** Share of the body's weight each foot carries (LH, RH, LF, RF): its footstep's weight. */
  load: readonly [number, number, number, number];
  /**
   * The monitor lizard's trunk, driven by the feet: the spine's sideways undulation (rad at the
   * widest fore-aft split of the feet), how much of it the neck turns back against (the head
   * held on its line), and the pelvis's and chest's roll toward the side whose foot is down (rad).
   */
  spineYaw: number;
  headCounter: number;
  pelvisRoll: number;
  chestRoll: number;
  /** Standing root pitch (rad, − = nose up) and how much of the ground's slope the body takes (0..1). */
  standPitch: number;
  slopeTilt: number;
  /**
   * The ground it can land on and walk up: the least surface normal y (the slope limits). Absent:
   * the global limits (PLAYER_TUNING landNormalY and maxSlopeY), read through slopeLimitY in
   * player/ground.ts.
   */
  landNormalY?: number;
  walkNormalY?: number;
}

/** The standing body's pitch, nose up (rad): the default GaitProfile.standPitch. */
export const STAND_PITCH = -10 * DEG;

/** The shared defaults (every breed today; a breed differs only by its own row's fields). */
const BASE: GaitProfile = {
  walkOffsets: [0, 0.5, 0.75, 0.25],
  runOffsets: [0, 0.08, 0.5, 0.58],
  runDuty: 0.36,
  runSpeed: 5.5,
  runBlendMax: 1,
  load: [0.3, 0.3, 0.2, 0.2],
  spineYaw: 0.07,
  headCounter: 0.6,
  pelvisRoll: 0.05,
  chestRoll: 0.04,
  standPitch: STAND_PITCH,
  slopeTilt: 0.35,
};

export const GAIT_PROFILES: Record<BreedId, GaitProfile> = {
  harrier: { ...BASE },
  skimmer: { ...BASE },
  // The long-legged glider breaks into its run a little sooner.
  galewing: { ...BASE, runSpeed: 5 },
  // The heavy breed carries more of its weight on the hind legs and undulates less.
  ironback: { ...BASE, load: [0.32, 0.32, 0.18, 0.18], spineYaw: 0.06 },
};

/** The breed's gait profile. */
export function gaitProfile(breed: BreedId): GaitProfile {
  return GAIT_PROFILES[breed];
}

/** Leg length as a share of the standing height (hip to ground, the Froude number's length). */
export const LEG_SHARE = 0.85;

/**
 * Turning on the spot: the cycle length (× standHeight), short quick steps round the pivot: the
 * walk's shortest stride (froudeStride's floor, 0.8 leg lengths).
 */
export const TURN_CYCLE = 0.8 * LEG_SHARE;

/**
 * The stride by dynamic similarity (animals of one shape move alike at equal Froude numbers):
 * the distance one full gait cycle covers (m) and the walk's duty factor at `speed` (m/s), for a
 * wyvern standing `standHeight` tall (its leg length ≈ 0.85 × that). Written into `out`
 * (allocation-free): out[0] cycle length, out[1] duty.
 */
export function froudeStride(speed: number, standHeight: number, out: Float64Array): Float64Array {
  const leg = LEG_SHARE * standHeight;
  const fr = (speed * speed) / (9.81 * leg);
  out[0] = leg * clamp(2.3 * Math.pow(Math.max(fr, 1e-6), 0.3), 0.8, 2.6);
  out[1] = clamp(0.74 - 0.25 * fr, 0.55, 0.74);
  return out;
}

/** Walk → run blend (0..1) at `speed` (m/s), capped by the breed's runBlendMax. */
export function runBlendAt(p: GaitProfile, speed: number): number {
  const a = p.runSpeed * 0.7;
  const b = p.runSpeed * 1.25;
  const t = clamp((speed - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t) * p.runBlendMax;
}

/** A foot's phase offset at run blend `rb` (0 walk … 1 run). */
export function footOffset(p: GaitProfile, foot: number, rb: number): number {
  return lerp(p.walkOffsets[foot], p.runOffsets[foot], rb);
}
