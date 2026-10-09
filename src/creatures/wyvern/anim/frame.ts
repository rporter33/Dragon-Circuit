// AnimFrame: the one record the wyvern animator's layers share each frame.
//
// WyvernAnimator.update (animator.ts) fills the core signals from the WyvernPose, then runs the
// layers in a fixed order — ground gait, flight trunk, ground trunk, life (neck, head, jaw,
// tongue), tail, wings, legs — each reading what the earlier ones wrote. Every field has exactly
// one writer (named on its group below); everyone else only reads it. Cross-stream signals
// (heave, lookLead, tailSteer, hover, launchT, kneel, fold) go through here and nowhere else.
//
// Layer methods take no number arguments and return nothing: a double passed into (or returned
// from) a call the JIT doesn't inline is boxed on the heap, and the animator runs every frame for
// up to three wyverns. Doubles stored in these fields are written in place.

import { Vector3 } from 'three';
import type { WyvernPose } from '../../../core/types';
import { smoothstep } from '../../../core/math';

/** A 0 → 1 → 0 window: rises over [a, b], falls over [c, d]. */
export function bump(x: number, a: number, b: number, c: number, d: number): number {
  return smoothstep(a, b, x) * (1 - smoothstep(c, d, x));
}

export const UP = new Vector3(0, 1, 0);
export const FWD = new Vector3(0, 0, 1);
export const LEFT = new Vector3(1, 0, 0);

export class AnimFrame {
  // --- Core signals: animator.ts (WyvernAnimator.update) -------------------------------------
  /** The pose being animated this frame (read only). */
  pose!: WyvernPose;
  /** Clamped frame time (s) and the animator's own clock. */
  dt = 0;
  time = 0;
  /** Breed constants: stand height (m) and heft (0 lightest … 1 heaviest). */
  sh = 0;
  heft = 0;
  /** First frame, or a jump of more than 40 m: every spring and chain starts from rest. */
  teleport = false;
  airborne = false;
  /** This frame the wyvern came down out of the air. */
  touchdown = false;
  /** Sink rate (m/s) the frame before a touchdown. */
  sink = 0;
  /** Air ↔ ground blends (smoothed): body and wings, the legs (quicker). */
  airW = 1;
  groundW = 0;
  legAirW = 1;
  /** Smoothed wing spread, and how far the wings are opened from the folded stance (0..1). */
  spreadVis = 1;
  openAmt = 1;
  /** Flight state, clamped: tuck (wings folded back in the air), flap strength, phase, flare, stall. */
  tuck = 0;
  flap = 0;
  phase = 0;
  flare = 0;
  stall = 0;
  fatigue = 0;
  /** Airspeed (m/s). */
  speed = 0;
  /** Smoothed g-load and bank (rad, + = left wing up). */
  gLoad = 1;
  bank = 0;
  /** Stall buffet weight (stall × airW) and its noise clock. */
  buffet = 0;
  stallT = 0;
  /** 0..1 how hard it has been working lately (flapping), and max(fatigue, that). */
  exertion = 0;
  effort = 0;
  /** Seconds since touchdown and how hard it was (0..1). */
  landT = 99;
  landImpact = 0;
  /** On the ground in the takeoff gait (the crouch before the leap). */
  takeoffCrouch = false;
  /** Smoothed body angular velocity (body frame, rad/s) and linear acceleration (world, m/s²). */
  readonly om = new Vector3();
  readonly accel = new Vector3();
  /** Height above the ground (m), Infinity over open air. */
  height = Infinity;
  /** Mount kneel (pose.kneel, 0..1). Driven by the mount layer (C11); 0 until then. */
  kneel = 0;

  // --- Flight: anim/flight.ts (FlightLayer) --------------------------------------------------
  /** Body heave from the wingbeat (m, + up): the downstroke lifts the chest and saddle. */
  heave = 0;
  /** Chest pitch from the beat (rad), and the lean into a roll (rad). */
  chestLift = 0;
  lean = 0;
  /** Flight's share of the spine, chest and pelvis pitch (rad; includes chestLift and the flare). */
  spineAir = 0;
  chestAir = 0;
  pelvisAir = 0;
  /** How spread the wings are for the air load (1 glide … 0 tucked/flared). */
  spreadAir = 1;
  /** Leg pose weights: tucked at speed, reaching for the ground, pushing off. */
  legTuck = 0;
  legReach = 0;
  legPush = 0;
  /** The dangling legs' fore-aft swing (rad-ish, ±0.4). */
  legSwing = 0;
  /** Head lead into a turn (rad of extra look yaw, from the stick; B3). Read by the life layer. */
  lookLead = 0;
  /** Tail rudder (rad per segment, + = toward the body's left; B3). Read by the tail layer. */
  tailSteer = 0;
  /** 0..1 hovering (flared, flapping, slow; B7). Read by the tail layer. */
  hover = 0;

  // --- Ground: anim/ground.ts (GroundLayer) --------------------------------------------------
  /** Walking or turning on the ground (the gait cycles). */
  moving = false;
  /** 0 walk … 1 run, and the gait cycle phase (0..1). */
  runBlend = 0;
  gaitPhase = 0;
  /** Gait trunk terms: bob (m), sway (rad of spine yaw), pitch and roll (rad). */
  gaitBob = 0;
  gaitSway = 0;
  gaitPitch = 0;
  gaitRoll = 0;
  /** Landing settle: the dip (m) and the nose-down pitch it gives (rad, subtracted). */
  dipV = 0;
  dipPitch = 0;
  /** Wings held up for balance after a landing (0..1). */
  brace = 0;
  /** Spine pitch of the takeoff crouch (rad). */
  crouchPitch = 0;
  /** The chest's lean into a ground turn (rad of roll, − = left side down). */
  turnLean = 0;
  /** Seconds since the wrists left the ground at a launch (C6), 99 when not launching. Read by B6. */
  launchT = 99;
  /**
   * The kneel (C11, from pose.kneel): how far the body is lowered for its rider (m, ≤ 0), pitched
   * nose-down (rad) and rolled down toward the rider's side (rad, the root's roll).
   */
  kneelDrop = 0;
  kneelPitch = 0;
  kneelRoll = 0;

  // --- Life: anim/life.ts (LifeLayer) --------------------------------------------------------
  /** Idle on the ground (standing still in the idle gait). */
  idle = false;
  /** Stretch-and-bask weights: the stretch, the gape, the wings-spread bask; any of them on. */
  stretch = 0;
  gape = 0;
  bask = 0;
  baskOn = false;
  /** Rib breathing: sin of the breath phase and its amplitude (fraction of flank width). */
  breath = 0;
  breathAmp = 0;
  /** Resting wing shuffle and yawn weights (0..1). */
  shuffle = 0;
  yawn = 0;
  /** Smoothed look yaw and pitch (rad, body frame) the head is aimed at; the tail balances them. */
  lookYaw = 0;
  lookPitch = 0;
  /** 0..1 how folded the wings are on the ground (membranes bunch; A2's fold helpers follow it). */
  fold = 0;
  /** 0..1 the greeting (cue 'greet'): the head comes down to the rider. */
  greet = 0;
}
