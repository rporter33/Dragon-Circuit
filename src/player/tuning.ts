// Player state machine tuning: landing, the wyvern on the ground, the rider on foot, falls and
// respawns. Flight itself is tuned in flight/FlightModel.ts and flight/breeds.ts.

import { DEG } from '../core/math';
import type { BreedId } from '../core/types';

export const PLAYER_TUNING = {
  // --- Landing -------------------------------------------------------------------------------
  /** The legs come down below this airspeed (or while flaring); faster contact is a belly scrape. */
  legsSpeed: 22,
  /** Max ground speed along the surface for a clean touchdown (m/s). */
  landSpeed: 18,
  /** Max sink rate into the surface for a clean touchdown (m/s). */
  landSink: 6.5,
  /** ...and while flaring: a heavy flared arrival is still a landing (no bounce, no crash). */
  landSinkFlared: 12,
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
  /**
   * Ground turning: the most each breed turns (rad/s; a big animal comes round at 45–90°/s, the
   * heaviest slowest), and how quickly a turn winds up and settles (rad/s²).
   */
  groundTurnRate: { skimmer: 1.6, harrier: 1.2, galewing: 1.0, ironback: 0.8 } as Readonly<Record<BreedId, number>>,
  groundYawAccel: 3,
  /**
   * Turning on the spot it pivots on its haunches: about a point this × standHeight behind the
   * body center (the hind feet, GAIT.hind), so the hind feet step in place and the wrists walk
   * round. Fully below `turnPivotSpeed` m/s, fading out by twice that.
   */
  turnPivot: 0.2,
  turnPivotSpeed: 1,
  /** Below this fraction of groundSpeed the gait is a walk. */
  walkFraction: 0.55,
  /** Keyboard keys are all or nothing: W walks at this fraction of groundSpeed, Shift gallops. */
  keyboardWalk: 0.3,

  // --- Rest ----------------------------------------------------------------------------------
  /**
   * On any island the stamina meter refills at this rate (fraction per second, after the usual
   * short pause), so a landing tops it up in about two seconds.
   */
  groundRefill: 0.7,
  /** Seconds on the ground after a flight before the wyvern is Rested (at night)... */
  restTime: 2,
  /** ...and in full sun, where it basks (Sun-warmed) a little sooner. */
  restTimeSun: 1.4,
  /** A flight counts (and earns the next rest) after this long in the air (s). */
  restFlight: 4,
  /** How long Rested lasts (s), the extra stamina capacity it gives, and its regen bonus. */
  restedDuration: 90,
  restedCapacity: 0.4,
  restedRegen: 0.5,
  /** The bonus fades out over the last this-fraction of its duration. */
  restedFade: 0.1,
  /** Seconds the wing shake-out (WyvernPose.ruffle) takes. */
  ruffleTime: 1.4,
  /** The "Rested" toast is shown only the first few times in a session. */
  restedToasts: 3,

  // --- Takeoff -------------------------------------------------------------------------------
  crouchTime: 0.25,
  leapUp: 5.5,
  leapForward: 7,
  leapPitch: 10 * DEG,
  /**
   * Launch strokes last until flying speed (≈1.25 × stall), at most this long (s): long enough
   * for the ironback, which needs about 5 s to get there.
   */
  launchGrace: 7,
  /**
   * One press of "take off" keeps beating the wings until the wyvern has flying speed (at least
   * `launchCommit` s, at most `launchCommitMax`); after that the trigger is in charge.
   */
  launchCommit: 1.2,
  launchCommitMax: 5,
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
  /** A wyvern standing still this close is near enough to mount (the rider jogs over). */
  mountReach: 6.5,
  mountTime: 0.7,
  dismountTime: 0.6,
  /** The wyvern follows a rider who wanders further than this, stopping with its chest this close. */
  followDistance: 30,
  followStop: 8,
  /**
   * A called wyvern walks up alongside its rider and stops with them beside its shoulder, on its
   * near (left) side, ready to mount — never standing over them, never with them between its
   * wrists. The rider ends `greetSide` m out from the line of its wrists (which stand
   * `greetWrist` × standHeight either side of its midline), level with a point `greetAlong` ×
   * standHeight ahead of its body center (the shoulder).
   */
  greetSide: 1.2,
  greetWrist: 0.42,
  greetAlong: 0.4,
  /** The chest point, this × standHeight ahead of the body center: stops are measured from it. */
  chestAhead: 0.6,
  /** A called wyvern's chest stops at least this far from its rider (m). */
  calledStop: 2.2,
  /** Walking, the wyvern's chest never comes nearer its rider than this (m). */
  riderKeepOut: 1.5,
  /**
   * The approach, called or following: a big animal walks (this fraction of its groundSpeed) to a
   * rider nearer than `approachRunFrom` m and only runs from further, easing down to the walk as it
   * comes in; it slows ahead of its stop at `approachDecel` m/s² and covers the last
   * `approachSlowFrom` m at `approachSlowSpeed` m/s.
   */
  approachWalk: 0.35,
  approachRunFrom: 25,
  approachDecel: 3,
  approachSlowFrom: 4,
  approachSlowSpeed: 1.5,
  /** Opening the Stable, a wyvern further than this from its rider comes to a stall beside it. */
  stableSettleRange: 15,
  /** Seconds a wave (calling the wyvern) lasts. */
  waveTime: 1.4,

  // --- The world's edge ----------------------------------------------------------------------
  /**
   * In the boundary storm the wyvern is turned back toward the islands: a phantom rudder of up
   * to this deflection and a lean of up to this bank (rad), both × how hard the storm pushes.
   */
  boundaryRudder: 0.8,
  boundaryBank: 30 * DEG,

  // --- Respawn -------------------------------------------------------------------------------
  fadeOut: 0.6,
  fadeHold: 0.15,
  fadeIn: 0.6,
  respawnHeight: 30,
} as const;
