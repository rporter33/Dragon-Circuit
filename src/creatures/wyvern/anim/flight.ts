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
  BACKWING_STYLES,
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
/**
 * The living glide (B4): per wing, two octaves of smooth value noise (GLIDE_HZ) on the shoulder's
 * elevation and twist, the span trim at the wrist and the tips (degrees at full weight), and every
 * RESETTLE_MIN..MAX s a resettle of both wings (the shoulders lift and settle back).
 */
const GLIDE_HZ0 = 0.35;
const GLIDE_HZ1 = 0.9;
const GLIDE_AMP = new Float64Array([1.5, 1.2, 2.5, 3]);
/** Value noise spends most of its time inside half its range: ×1.6 makes those its typical swing. */
const GLIDE_GAIN = 1.6;
const RESETTLE_FIRST = 2.5;
const RESETTLE_MIN = 5;
const RESETTLE_MAX = 9;
const RESETTLE_UP = 0.5;
const RESETTLE_DOWN = 0.8;
const RESETTLE_EL = 4;
/** Rising air at a wingtip loads that wing (load per m/s): a thermal's edge lifts one tip first. */
const GUST_LOAD = 0.12;

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
  /**
   * Air load on each wing (left, right), smoothed: bends the fingers, billows the membrane. A soft
   * spring (18 rad/s): the sail fills just after the arm starts to drive.
   */
  private readonly loadSpring: [Spring, Spring] = [new Spring(18), new Spring(18)];
  readonly wingLoad = [0, 0];
  private readonly flapSide = new Float32Array(WING_CHANNELS);
  /** The breed's backwing stroke (B5) and the scratch pose it is sampled into. */
  private readonly backStyle: FlapStyle;
  private readonly flapBack = new Float32Array(WING_CHANNELS);
  /** The landing flare this frame (0..1, the last metres of an approach) and its backwing weight. */
  private landFlare = 0;
  private backW = 0;
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
  /** The living glide this frame: [side × 4] humEl, humTw, handSw, tips (radians, weighted). */
  private readonly glideLife = new Float64Array(8);
  /**
   * The resettle: seconds of gliding so far (its own clock, which only runs in a glide), when the
   * next one starts on it, how many so far, and this frame's lift (rad).
   */
  private glideT = 0;
  private resettleAt = RESETTLE_FIRST;
  private resettleN = 0;
  private resettle = 0;
  // This frame's wing prelude (flightTrunk → flightWingPose).
  private asymBase = 0;
  private rollInit = 0;
  private glideLoad = 0;
  private beatLoad = 0;

  constructor(a: WyvernAnimator) {
    this.a = a;
    this.f = a.frame;
    this.style = FLAP_STYLES[a.rig.props.breed];
    this.backStyle = BACKWING_STYLES[a.rig.props.breed];
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

  /**
   * The living glide: a gliding wing is never still. Each wing trims on its own (two octaves of
   * smooth value noise per channel, written out here rather than calling ik.noise1 sixteen times a
   * frame: a double passed to or returned from a call the JIT doesn't inline is boxed), less on
   * the heavy breeds, the tips by the style's glideTips; and every 5–9 s both shoulders lift and
   * settle back (the resettle). Only while gliding: weight airW·(1 − flap)(1 − tuck)(1 − flare).
   */
  private glide(): void {
    const f = this.f;
    const t = f.time;
    const out = this.glideLife;
    const w = f.airW * (1 - f.flap) * (1 - f.tuck) * (1 - f.flare) * f.spreadAir;
    if (w <= 1e-4) {
      out.fill(0);
    } else {
      const amp = w * (1 - 0.5 * f.heft) * DEG;
      for (let k = 0; k < 8; k++) {
        let v = 0;
        for (let o = 0; o < 2; o++) {
          // Value noise at this octave: lattice hash at i and i + 1, smoothstep between.
          const x = t * (o === 0 ? GLIDE_HZ0 : GLIDE_HZ1) + k * 7.31 + o * 3.7;
          const i = Math.floor(x);
          const u = x - i;
          const seed = k * 2 + o + 1;
          const s0 = Math.sin((i + seed * 17.13) * 127.1 + seed * 311.7) * 43758.5453;
          const s1 = Math.sin((i + 1 + seed * 17.13) * 127.1 + seed * 311.7) * 43758.5453;
          const h0 = (s0 - Math.floor(s0)) * 2 - 1;
          const h1 = (s1 - Math.floor(s1)) * 2 - 1;
          v += (o === 0 ? 0.6 : 0.4) * (h0 + (h1 - h0) * u * u * (3 - 2 * u));
        }
        const ch = k & 3;
        out[k] = v * GLIDE_AMP[ch] * amp * (ch === 3 ? this.style.glideTips : 1) * GLIDE_GAIN;
      }
    }
    // The resettle, on the glide's own clock: the first a moment into a glide (the wings settle
    // after the last beat), then every 5–9 s (apart by a hash of the count: deterministic). A beat,
    // a tuck or the ground starts the clock again.
    if (f.teleport || w < 0.3) {
      this.glideT = 0;
      this.resettleN = 0;
      this.resettleAt = RESETTLE_FIRST;
    } else {
      this.glideT += f.dt;
    }
    const since = this.glideT - this.resettleAt;
    if (since >= RESETTLE_UP + RESETTLE_DOWN) {
      this.resettleN++;
      const h = Math.sin(this.resettleN * 12.9898) * 43758.5453;
      this.resettleAt = this.glideT + RESETTLE_MIN + (RESETTLE_MAX - RESETTLE_MIN) * (h - Math.floor(h)) - (RESETTLE_UP + RESETTLE_DOWN);
    }
    const r = since < 0 ? 0 : since < RESETTLE_UP ? smoothstep(0, RESETTLE_UP, since) : 1 - smoothstep(RESETTLE_UP, RESETTLE_UP + RESETTLE_DOWN, since);
    this.resettle = r * RESETTLE_EL * DEG * w;
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
    // Landing (B5): the last metres of an approach (feet within 1.6·sh of the ground, coming
    // down) the chest and spine pitch up a further 10° and a flaring beat becomes a backwing.
    const feet = f.height - sh;
    this.landFlare = f.airborne && f.pose.velocity.y < 0.5 ? smoothstep(1.6 * sh, 0.4 * sh, feet) : 0;
    this.backW = this.landFlare * smoothstep(0.3, 0.6, flare);
    const landPitch = this.landFlare * flare * airW;
    f.spineAir = chestLift - flare * 0.06 * airW - 0.1 * landPitch;
    f.chestAir = chestLift * 0.6 - flare * 0.04 - 0.075 * landPitch;
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
    // The living glide (B4).
    this.glide();
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
      // part of the way there: the flare adds the rest rather than stacking on it)...
      const backW = this.backW;
      if (flare > 0) {
        fp[W.humSw] += (-16 * DEG - this.planeMean) * flare * (1 - backW);
        fp[W.humTw] += -14 * DEG * flare * (1 - backW);
      }
      // ...and over the last metres to the ground they are backwing strokes, beating against the
      // sink in front of the body.
      if (backW > 0.001) blendPose(fp, flapPoseAt(f, this.flapBack, this.backStyle), backW, fp);
      blendPose(out, fp, flap, out);
    }
    // The living glide: each wing trims on its own, the tips most; the resettle lifts both.
    const gl = this.glideLife;
    const k = side * 4;
    out[W.humEl] += gl[k] + this.resettle;
    out[W.humTw] += gl[k + 1];
    out[W.handSw] += gl[k + 2];
    out[W.f0bEl] += gl[k + 3];
    out[W.f1bEl] += 0.8 * gl[k + 3];
    out[W.f2bEl] += 0.6 * gl[k + 3];
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
    // Rising air under a wingtip loads that wing before the body rolls (a thermal's edge).
    const gust = f.pose.gust;
    const tipAir = gust ? (side === 0 ? gust.l : gust.r) : 0;
    const loadT = airW * ((this.glideLoad + this.beatLoad) * (1 + 0.35 * clamp(asym, -1, 1)) + GUST_LOAD * clamp(tipAir, -4, 8) * f.spreadAir);
    const load = this.loadSpring[side].step(loadT, f.dt);
    this.wingLoad[side] = load;
    loadPose(out, load * f.spreadAir);
  }

  /** Leg weights in the air: tucked, reaching, pushing off; the dangling legs' swing. */
  flightLegWeights(): void {
    const f = this.f;
    const pose = f.pose;
    const { airborne, sh, speed, accel } = f;
    // The hind legs reach for the ground from 3.5·sh up on an approach.
    const approach = airborne && pose.velocity.y < 0.5 ? 1 - smoothstep(sh * 1.4, sh * 3.5, f.height) : 0;
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
    // At dive speeds the spread trailing edge luffs (0.1 m at 55 m/s), more with the wings
    // half-tucked; the rate stays low enough (3–8 Hz) that a 60 fps frame never aliases it.
    u.uFlutter.value = sh * (0.008 + 0.04 * smoothstep(25, 60, speed)) * (1 + 0.5 * tuck) * airW + 0.008 * sh * flap * airW + buffet * 0.03 + bask * 0.004 * sh;
    u.uFlutterRate.value = TAU * clamp(3 + 0.08 * speed, 3, 8) * (1 - bask) + 6 * bask;
    u.uRipple.value = 0.4 + 0.6 * smoothstep(5, 35, speed);
    // Membrane billow per wing (m at full load).
    const billow = 0.022 * this.a.rig.props.wingspan;
    const wl = u.uWingLoad.value;
    wl.x = this.wingLoad[0] * billow * spreadAir;
    wl.y = this.wingLoad[1] * billow * spreadAir;
  }
}
