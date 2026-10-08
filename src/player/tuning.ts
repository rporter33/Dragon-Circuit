// Player state machine tuning: landing, the wyvern on the ground, the rider on foot, falls and
// respawns. Flight itself is tuned in flight/FlightModel.ts and flight/breeds.ts.

import { DEG } from '../core/math';

export const PLAYER_TUNING = {
  // --- Landing -------------------------------------------------------------------------------
  /** The legs come down below this airspeed (or while flaring); faster contact is a belly scrape. */
  legsSpeed: 22,
  /** Max ground speed along the surface for a clean touchdown (m/s). */
  landSpeed: 18,
  /** Max sink rate into the surface for a clean touchdown (m/s). */
  landSink: 6.5,
  /** Ground flatter than this (normal.y) can be landed on. */
  landNormalY: 0.65,
  /** Deceleration while skidding on the legs (m/s²). */
  skidDecel: 10,
  /** Bounce on a too-hard touchdown. */
  bounce: 0.3,
  /** Seconds the touchdown attitude blends into the standing pose. */
  landBlendTime: 0.35,
  /** Seconds the 'landing' gait (absorbing the impact, running out) is held at least. */
  landGaitTime: 0.55,

  // --- Wyvern on the ground ------------------------------------------------------------------
  /** Ground falling away by more than this ahead is a cliff edge (m). */
  edgeDrop: 2.5,
  /** Can't walk up slopes steeper than this. */
  maxSlopeY: Math.cos(40 * DEG),
  /** Ground acceleration / braking (m/s²). */
  wyvernAccel: 6,
  wyvernBrake: 8,
  /** Below this fraction of groundSpeed the gait is a walk. */
  walkFraction: 0.55,
  /** Stamina regenerates this many times faster on the ground. */
  groundRegen: 2.5,

  // --- Takeoff -------------------------------------------------------------------------------
  crouchTime: 0.25,
  leapUp: 5.5,
  leapForward: 7,
  leapPitch: 10 * DEG,
  /** Launch strokes last until flying speed (≈1.25 × stall), at most this long (s). */
  launchGrace: 4,
  /** Walking off a cliff while mounted. */
  walkOffGrace: 2.5,
  walkOffHop: 2.2,
  /** Seconds the wyvern drops off a cliff with its wings half folded before spreading them. */
  walkOffTuckTime: 0.6,
  /** Seconds after leaving the ground the gait still reads 'takeoff'. */
  takeoffGaitTime: 0.6,

  // --- Rider on foot -------------------------------------------------------------------------
  walkSpeed: 4.2,
  runSpeed: 7.5,
  footAccel: 26,
  airAccel: 5,
  jumpSpeed: 5.6,
  footGravity: 18,
  stepUp: 0.55,
  stepDown: 0.75,
  riderRadius: 0.35,
  riderHip: 0.95,
  /** Falling with no ground within this depth below is a fall off the island. */
  fallDepth: 14,
  /** Seconds before the wyvern catches a falling rider. */
  catchDelay: 0.8,
  catchGrace: 1.8,
  mountRange: 5,
  mountTime: 0.7,
  dismountTime: 0.6,
  /** The wyvern follows a rider who wanders further than this, stopping this close. */
  followDistance: 30,
  followStop: 8,
  /** Seconds a wave (calling the wyvern) lasts. */
  waveTime: 1.4,

  // --- Respawn -------------------------------------------------------------------------------
  fadeOut: 0.6,
  fadeHold: 0.15,
  fadeIn: 0.6,
  respawnHeight: 30,
} as const;
