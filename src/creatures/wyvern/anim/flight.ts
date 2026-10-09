// Flight layer of the wyvern animator: what the wings and the beat do to the body in the air.
//
//   flightTrunk       heave (the downstroke lifts the chest and saddle, the recovery lets them
//                     sink), the chest pitching with the beat, the lean into a roll, the flare's
//                     pitch, and the per-frame wing prelude (turn asymmetry, air load)
//   flightWingPose    one wing's flight pose as joint channels: glide, tuck and flare blended,
//                     the heavy flap cycle (the outer wing of a turn takes the bigger stroke), g-load
//                     and turn adjustments, stall buffet, the fingers bending under the air load
//   flightLegWeights  legs tucked at speed, dangling when slow and swinging with the body's
//                     fore-aft acceleration, reaching for the ground on approach, pushing off
//   flightUniforms    trailing-edge flutter, ripple and the membrane billow per wing
//
// Outputs for other layers through AnimFrame: heave, chestLift, lean, spineAir/chestAir/pelvisAir,
// spreadAir, legTuck/legReach/legPush/legSwing, and the cross-stream leads lookLead, tailSteer and
// hover (0 until the turn and hover work lands). Methods take no number arguments (see frame.ts).

import { Vector3 } from 'three';
import { DEG, TAU, clamp, clamp01, smoothstep } from '../../../core/math';
import { SIDE_SIGN } from '../rig';
import { Bouncy, Spring, noise1 } from '../ik';
import { FLARE, GLIDE, TUCK, W, WING_CHANNELS, adjustPose, blendPose, flapPose, loadPose, strokeLoad, type WingPose } from '../wingPoses';
import type { WyvernUniforms } from '../materials';
import type { WyvernAnimator } from '../animator';
import { FWD, type AnimFrame } from './frame';

const _v = new Vector3();

export class FlightLayer {
  private readonly a: WyvernAnimator;
  private readonly f: AnimFrame;
  /** Air load on each wing (left, right), smoothed: bends the fingers, billows the membrane. */
  private readonly loadSpring: [Spring, Spring] = [new Spring(28), new Spring(28)];
  readonly wingLoad = [0, 0];
  private readonly flapSide = new Float32Array(WING_CHANNELS);
  private readonly legSwing = new Bouncy(5, 0.35);
  // This frame's wing prelude (flightTrunk → flightWingPose).
  private asymBase = 0;
  private glideLoad = 0;
  private beatLoad = 0;

  constructor(a: WyvernAnimator) {
    this.a = a;
    this.f = a.frame;
  }

  /** Heave, chest lift and lean, the flare's trunk pitch, and this frame's wing prelude. */
  flightTrunk(): void {
    const f = this.f;
    const { flap, airW, phase, heft, sh, flare, tuck, om } = f;
    // Heave: the downstroke lifts the chest and saddle, the recovery lets them sink. The body is
    // highest just after the bottom of the stroke (the lift lags the force).
    const heaveAmp = (0.05 + 0.035 * heft) * sh;
    f.heave = flap * airW * heaveAmp * -Math.cos((phase - 0.08) * TAU);
    // The wings drive the chest: it pitches up on the downstroke and leads the roll into a turn.
    const chestLift = -flap * airW * (0.05 + 0.03 * heft) * Math.sin((phase - 0.02) * TAU);
    f.chestLift = chestLift;
    f.lean = clamp(f.bank * 0.1 + om.z * 0.06, -0.14, 0.14) * airW;
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
    this.beatLoad = flap * strokeLoad(phase) * (1 + 0.25 * heft);
    // Cross-stream leads (B3, B7): none yet.
    f.lookLead = 0;
    f.tailSteer = 0;
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
      const fp = flapPose(f.phase, f.fatigue, this.flapSide, f.heft);
      // The outer wing of a turn takes the bigger stroke.
      const amp = clamp(1 + 0.3 * asym, 0.72, 1.32);
      fp[W.humEl] *= amp;
      fp[W.foreEl] *= amp;
      fp[W.handEl] *= amp;
      // Flaring beats reach forward.
      if (flare > 0) {
        fp[W.humSw] += -16 * DEG * flare;
        fp[W.humTw] += -14 * DEG * flare;
      }
      blendPose(out, fp, flap, out);
    }
    // (Noise only while there is a buffet: a double passed to a call the JIT doesn't inline is
    // boxed on the heap.)
    const shake = buffet > 0;
    const bf = shake ? buffet * noise1(f.stallT * 9 + side * 7.3, 10 + side) : 0;
    const bt = shake ? buffet * noise1(f.stallT * 11 + side * 3.1, 20 + side) : 0;
    adjustPose(out, f.gLoad, asym, bf + buffet * 0.4 * sgn * Math.sin(f.stallT * 1.7), bt, f.spreadAir);
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
