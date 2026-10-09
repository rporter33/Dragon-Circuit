// Flight layer of the wyvern animator: what the wings and the beat do to the body in the air.
//
//   flightTrunk       heave (the downstroke lifts the chest and saddle, the recovery lets them
//                     sink), the chest pitching with the beat, the lean into a roll, the flare's
//                     pitch, the stick's leads (the head into a turn, the tail's rudder) and the
//                     per-frame wing prelude (the roll's initiation, turn asymmetry, air load)
//   flightWingPose    one wing's flight pose as joint channels: glide, tuck and flare blended,
//                     the heavy flap cycle (the outer wing of a turn takes the bigger stroke), g-load
//                     and turn adjustments, the roll-in (the inner wing flexes, the outer reaches),
//                     stall buffet, the fingers bending under the air load
//   flightLegWeights  legs tucked at speed, dangling when slow and swinging with the body's
//                     fore-aft acceleration, reaching for the ground on approach, pushing off
//   flightUniforms    trailing-edge flutter, ripple and the membrane billow per wing
//
// Outputs for other layers through AnimFrame: heave, chestLift, lean, spineAir/chestAir/pelvisAir,
// spreadAir, legTuck/legReach/legPush/legSwing, and the cross-stream leads lookLead and tailSteer
// (B3) and hover (0 until B7). Methods take no number arguments (see frame.ts).

import { Vector3 } from 'three';
import { DEG, TAU, clamp, clamp01, smoothstep } from '../../../core/math';
import { BREEDS } from '../../../flight/breeds';
import { SIDE_SIGN } from '../rig';
import { Bouncy, Spring, noise1 } from '../ik';
import {
  FLAP_STYLES,
  FLARE,
  GLIDE,
  TUCK,
  W,
  WING_CHANNELS,
  adjustPose,
  blendPose,
  flapPoseAt,
  loadPose,
  strokeLoad,
  strokePlaneMean,
  wingAdjust,
  type FlapStyle,
  type WingPose,
} from '../wingPoses';
import type { WyvernUniforms } from '../materials';
import type { WyvernAnimator } from '../animator';
import { FWD, type AnimFrame } from './frame';

const _v = new Vector3();

/**
 * The roll stick's follower (a critically damped spring, rad/s): the stick's lead over it, the
 * roll's initiation, holds for a moment and dies away into the sustained turn over 0.4 s.
 */
const ROLL_OMEGA = 6;
/**
 * The inner wing's flex at full roll stick: elbow forward, wrist back (degrees; the recovery
 * stroke's M-fold is 34/46 at its deepest, which shortens the span by a tenth).
 */
const INNER_FORE = 42;
const INNER_HAND = 58;
/** The tail's rudder at full yaw (rad per segment), and its spring (overshoots about 0.25 s). */
const RUDDER = 0.12;
const RUDDER_OMEGA = 12;
const RUDDER_ZETA = 0.45;

export class FlightLayer {
  private readonly a: WyvernAnimator;
  private readonly f: AnimFrame;
  /** The breed's wingbeat: stroke shape, fold, tip flex and downstroke fraction. */
  private readonly style: FlapStyle;
  /** Where the stroke plane sits on average (rad of shoulder sweep, − = forward). */
  private readonly planeMean: number;
  /** wingPoses.bodyClock's constants for this style: a / 2π, D / 2 and sin(πD). */
  private readonly clockK: number;
  private readonly clockC: number;
  private readonly clockS: number;
  /** Air load on each wing (left, right), smoothed: bends the fingers, billows the membrane. */
  private readonly loadSpring: [Spring, Spring] = [new Spring(28), new Spring(28)];
  readonly wingLoad = [0, 0];
  private readonly flapSide = new Float32Array(WING_CHANNELS);
  /** adjustPose's inputs for the wing being posed (a record: no doubles through call arguments). */
  private readonly adj = wingAdjust();
  private readonly legSwing = new Bouncy(5, 0.35);
  /** The breed's top roll rate (rad/s) and yaw authority (rad/s²): a ghost's stick is estimated against them. */
  private readonly maxRollRate: number;
  private readonly yawAuthority: number;
  /**
   * The stick this frame (pose.control, or estimated from the body's motion for a ghost) and the
   * roll stick's slow follower (ROLL_OMEGA): stick − follower is the roll's initiation, which
   * dies away under a held stick and swings the other way on the roll-out.
   */
  private ctlRoll = 0;
  private ctlYaw = 0;
  private readonly rollSlow = new Spring(ROLL_OMEGA);
  /** The previous frame's smoothed body rates (for a ghost's angular acceleration). */
  private readonly prevOm = new Vector3();
  /** The tail's rudder: follows the stick and overshoots briefly on the roll-out. */
  private readonly rudder = new Bouncy(RUDDER_OMEGA, RUDDER_ZETA);
  // This frame's wing prelude (flightTrunk → flightWingPose).
  private asymBase = 0;
  private rollInit = 0;
  private glideLoad = 0;
  private beatLoad = 0;

  constructor(a: WyvernAnimator) {
    this.a = a;
    this.f = a.frame;
    this.style = FLAP_STYLES[a.rig.props.breed];
    this.planeMean = strokePlaneMean(this.style);
    const D = this.style.down;
    this.clockS = Math.sin(Math.PI * D);
    this.clockK = ((0.5 - D) * Math.PI) / this.clockS / TAU;
    this.clockC = 0.5 * D;
    this.maxRollRate = BREEDS[a.rig.props.breed].maxRollRate;
    this.yawAuthority = BREEDS[a.rig.props.breed].yawAuthority;
  }

  /**
   * The stick: the player's (pose.control), or for a ghost (no control recorded) an estimate from
   * the body's motion: the roll stick commands a roll rate, so the rate plus a lead of its
   * acceleration over the breed's top rate; the rudder from the yaw acceleration alone over the
   * breed's yaw authority (a coordinated turn's steady yaw rate is not rudder). Then the roll's
   * initiation and the rudder.
   */
  private controls(): void {
    const f = this.f;
    const ctl = f.pose.control;
    const om = f.om;
    const dt = f.dt;
    if (ctl) {
      this.ctlRoll = clamp(ctl.roll, -1, 1);
      this.ctlYaw = clamp(ctl.yaw, -1, 1);
    } else if (dt > 1e-5) {
      // Body frame: +z rolls right, +y yaws left.
      const az = f.teleport ? 0 : (om.z - this.prevOm.z) / dt;
      const ay = f.teleport ? 0 : (om.y - this.prevOm.y) / dt;
      this.ctlRoll = clamp((om.z + 0.25 * az) / this.maxRollRate, -1, 1);
      this.ctlYaw = clamp(-ay / this.yawAuthority, -1, 1);
    }
    this.prevOm.copy(om);
    const air = f.airW;
    if (f.teleport) {
      this.rollSlow.reset(this.ctlRoll);
      this.rudder.reset(0);
    }
    // (dt 0 is a no-op: the follower and the rudder spring only move with time.)
    const slow = dt > 0 ? this.rollSlow.step(this.ctlRoll, dt) : this.rollSlow.value;
    this.rollInit = (this.ctlRoll - slow) * air * f.spreadAir;
    // The head turns into the turn first (the rope shortened on that side), then the body banks:
    // the life layer adds lookLead to the look yaw (+ = toward the body's left, like lookYaw).
    f.lookLead = -(0.5 * this.ctlYaw + 0.35 * this.ctlRoll) * air;
    // The tail rudder (+ = toward the body's left): a right yaw swings the tail's tip right (a
    // rudder pushed right yaws the nose right), a little with the roll too, so a roll-out lets it
    // swing through center and back (the spring's overshoot, about a quarter second).
    const steer = -RUDDER * clamp(this.ctlYaw + 0.4 * this.ctlRoll, -1, 1) * air;
    f.tailSteer = dt > 0 ? this.rudder.step(steer, dt) : this.rudder.value;
  }

  /** Heave, chest lift and lean, the flare's trunk pitch, and this frame's wing prelude. */
  flightTrunk(): void {
    const f = this.f;
    const { flap, airW, phase, heft, sh, flare, tuck, om } = f;
    // The beat's shared clock for the body (wingPoses.bodyClock, inlined): 0 at the top of the
    // stroke, 0.25 at the power peak (D/2), 0.5 at the bottom (phase D, the 'flap' event), 0.75
    // mid-recovery. The flight model's power stroke peaks at 0.25 on it, and so do the membrane
    // load and the chest's pitch, whatever the breed's downstroke fraction: the surge is felt while
    // the wing is visibly half way down. Unlike strokePhase its rate has no corners, so the body
    // never changes speed in an instant at the top or the bottom (which kicked the tail into a
    // flick and jolted the neck's spring every beat).
    const p = phase - Math.floor(phase);
    const sp = p + this.clockK * (Math.sin(TAU * (p - this.clockC)) + this.clockS);
    // Heave: the downstroke lifts the chest and saddle, the recovery lets them sink. The body
    // rises fastest just after the power peak and is highest just after the bottom of the stroke
    // (the lift lags the force).
    const heaveAmp = (0.05 + 0.035 * heft) * sh;
    f.heave = flap * airW * heaveAmp * -Math.cos((sp - 0.08) * TAU);
    // The wings drive the chest: it pitches up on the downstroke and leads the roll into a turn.
    const chestLift = -flap * airW * (0.05 + 0.03 * heft) * Math.sin((sp - 0.02) * TAU);
    f.chestLift = chestLift;
    f.lean = clamp(f.bank * 0.1 + om.z * 0.1, -0.22, 0.22) * airW;
    f.spineAir = chestLift - flare * 0.06 * airW;
    f.chestAir = chestLift * 0.6 - flare * 0.04;
    f.pelvisAir = flare * 0.05 * airW - tuck * 0.02;
    // Wing prelude. Turning: the outer (rising) wing reaches and works harder, the inner one
    // unloads.
    this.asymBase = clamp(om.z * 0.55 - om.y * 0.35 + f.bank * 0.35, -1, 1) * airW;
    const spreadAir = (1 - tuck) * (1 - flare * 0.5);
    f.spreadAir = spreadAir;
    // Air load: lift at 1 g holds a gentle camber; g-load and the power stroke bow the membrane up
    // and bend the fingers, the recovery stroke lets them go slack.
    this.glideLoad = 0.3 * clamp(f.gLoad, 0, 3) * spreadAir;
    this.beatLoad = flap * strokeLoad(phase, this.style) * (1 + 0.25 * heft);
    // The stick: the roll's initiation, the head's lead and the tail's rudder (B3).
    this.controls();
    // Hover (B7): none yet.
    f.hover = 0;
  }

  /** One wing's flight pose (`side` 0 left, 1 right) into `out`. */
  flightWingPose(side: number, out: WingPose): void {
    const f = this.f;
    const { tuck, flare, flap, buffet, airW } = f;
    const sgn = SIDE_SIGN[side];
    const asym = this.asymBase * sgn;
    blendPose(GLIDE, TUCK, tuck, out);
    blendPose(out, FLARE, flare * (1 - tuck), out);
    if (flap > 0.001) {
      const fp = flapPoseAt(f, this.flapSide, this.style);
      // The outer wing of a turn takes the bigger stroke.
      const amp = clamp(1 + 0.3 * asym, 0.72, 1.32);
      fp[W.humEl] *= amp;
      fp[W.foreEl] *= amp;
      fp[W.handEl] *= amp;
      // Flaring beats reach 16° forward of the shoulder's neutral (the stroke plane already sits
      // part of the way there: the flare adds the rest rather than stacking on it).
      if (flare > 0) {
        fp[W.humSw] += (-16 * DEG - this.planeMean) * flare;
        fp[W.humTw] += -14 * DEG * flare;
      }
      blendPose(out, fp, flap, out);
    }
    // (Noise only while there is a buffet: a double passed to a call the JIT doesn't inline is
    // boxed on the heap.)
    const shake = buffet > 0;
    const bf = shake ? buffet * noise1(f.stallT * 9 + side * 7.3, 10 + side) : 0;
    const bt = shake ? buffet * noise1(f.stallT * 11 + side * 3.1, 20 + side) : 0;
    const adj = this.adj;
    adj.gLoad = f.gLoad;
    adj.asym = asym;
    adj.buffet = bf + buffet * 0.4 * sgn * Math.sin(f.stallT * 1.7);
    adj.buffetTw = bt;
    adj.spread = f.spreadAir;
    adjustPose(out, adj);
    // Rolling in (B3): the stick asks first and the wings answer before the body has banked.
    // The inner wing half-folds (elbow forward, wrist back, hand and tips down), shortening its
    // span; the outer one reaches forward and up with its leading edge raised. It dies away into
    // the sustained turn's asymmetry (adjustPose) over 0.4 s, and swings the other way on the
    // roll-out.
    const init = this.rollInit * sgn;
    if (init > 0) {
      out[W.humTw] -= 10 * init * DEG;
      out[W.humEl] += 6 * init * DEG;
      out[W.humSw] -= 6 * init * DEG;
    } else if (init < 0) {
      // The inner wing flexes at the elbow and wrist (deeper than the recovery's M-fold, for a
      // moment): its span shortens by a sixth while the outer one stays fully spread.
      const m = -init;
      out[W.foreSw] -= INNER_FORE * m * DEG;
      out[W.handSw] += INNER_HAND * m * DEG;
      out[W.handEl] -= 8 * m * DEG;
      out[W.f0bEl] -= 6 * m * DEG;
      out[W.f1bEl] -= 6 * m * DEG;
      out[W.f2bEl] -= 6 * m * DEG;
    }
    const loadT = airW * (this.glideLoad + this.beatLoad) * (1 + 0.35 * clamp(asym, -1, 1));
    const load = this.loadSpring[side].step(loadT, f.dt);
    this.wingLoad[side] = load;
    loadPose(out, load * f.spreadAir);
  }

  /** Leg weights in the air: tucked, reaching, pushing off; the dangling legs' swing. */
  flightLegWeights(): void {
    const f = this.f;
    const pose = f.pose;
    const { airborne, sh, speed, accel } = f;
    const approach = airborne && pose.velocity.y < 0.5 ? 1 - smoothstep(sh * 1.4, sh * 3.2, f.height) : 0;
    const reach = clamp01(Math.max(f.flare, approach * smoothstep(26, 14, speed)));
    const push = airborne && pose.gait === 'takeoff' ? 1 - smoothstep(0.15, 0.55, pose.gaitTime) : 0;
    f.legReach = reach;
    f.legPush = push;
    f.legTuck = clamp01(smoothstep(15, 24, speed) + f.tuck) * (1 - reach) * (1 - push);
    // Dangling legs swing with the body's fore-aft acceleration and trail the wingbeat's heave.
    _v.copy(FWD).applyQuaternion(this.a.qW);
    const fwdAcc = accel.x * _v.x + accel.y * _v.y + accel.z * _v.z;
    f.legSwing = this.legSwing.step(clamp(-fwdAcc * 0.012 + (f.heave / sh) * 0.9, -0.4, 0.4), f.dt);
  }

  /** Trailing-edge flutter and ripple, and the membrane billow per wing. */
  flightUniforms(u: WyvernUniforms): void {
    const f = this.f;
    const { sh, speed, airW, tuck, flap, buffet, bask, spreadAir } = f;
    // Trailing-edge flutter: airspeed, the power stroke's ripple, stall buffet, a breeze on the
    // spread membranes while basking.
    u.uFlutter.value = 0.012 * sh * smoothstep(8, 40, speed) * airW * (1 - tuck * 0.5) + 0.008 * sh * flap * airW + buffet * 0.03 + bask * 0.004 * sh;
    u.uFlutterRate.value = 14 + speed * 0.9 - bask * 8;
    u.uRipple.value = 0.4 + 0.6 * smoothstep(5, 35, speed);
    // Membrane billow per wing (m at full load).
    const billow = 0.022 * this.a.rig.props.wingspan;
    const wl = u.uWingLoad.value;
    wl.x = this.wingLoad[0] * billow * spreadAir;
    wl.y = this.wingLoad[1] * billow * spreadAir;
  }
}
