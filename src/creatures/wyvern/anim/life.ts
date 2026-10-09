// Life layer of the wyvern animator: what makes it a living reptile rather than a vehicle.
//
//   lifeSignals  the stretch-and-bask after resting (a reptile's slow full-body stretch, a slight
//                gape, then the wings spread toward the sun), idle state, unhurried outer-lid
//                blinks, quick sideways sweeps of the nictitating membrane (held half-drawn like
//                goggles in a fast dive), rib breathing (slow at rest, quick and deep after hard
//                work), the odd wing shuffle and yawn
//   neckHead     a neck posture per state (S-curve standing, stretched in flight) plus most of the
//                look, trailing the body's heave on a spring so the head lags each wingbeat and
//                landing; the head aimed at the look target in body space and held level against
//                the bank; jaw (panting, the takeoff gasp, yawns, the bask's gape), throat fans and
//                forked-tongue flicks tasting the air
//   lifeUniforms the lids (uBlink, uBlinkLower, uNictitate) and the ground fold (uFold)
//
// Methods take no number arguments (see frame.ts).

import { Euler, Quaternion, Vector3 } from 'three';
import { DEG, TAU, clamp, damp, lerp, smoothstep } from '../../../core/math';
import { BREEDS } from '../../../flight/breeds';
import { globalUniforms } from '../../../render/uniforms';
import { TONGUE, type RigDef } from '../rig';
import { Bouncy, Spring, aimRotation, noise1 } from '../ik';
import type { WyvernUniforms } from '../materials';
import type { WyvernAnimator } from '../animator';
import { FWD, UP, bump, type AnimFrame } from './frame';

/** Neck postures (degrees per bone, + pitches down). Base → top. */
const NECK_GROUND = [-14, -9, -2, 6, 12, 14];
const NECK_FLIGHT = [4, 3.5, 3, 3, 2.5, 2];
const NECK_TUCK = [5, 5, 4, 4, 3, 2];
const NECK_FLARE = [-5, -4, -3, -1, 1, 3];
/** The stretch: neck reaching out and up, the S-curve straightened. */
const NECK_STRETCH = [-16, -8, -3, 0, 1, 3];
/** The greeting: the neck sloping down from the withers, curling up at the top to carry the head level. */
const NECK_GREET = [16, 12, 7, 1, -6, -12];
const NECK_YAW_SHARE = [0.08, 0.12, 0.14, 0.15, 0.14, 0.12];
/** How the neck bends when the body moves faster than the head can follow (base → top). */
const NECK_LAG_SHARE = [0.34, 0.28, 0.2, 0.08, -0.06, -0.14];
/** The head-height hold's bend along the neck (base → top; the head is re-aimed after it). */
const HOLD_SHARE = [0.4, 0.3, 0.2, 0.1, 0, 0];
/** How much of the head's beat-by-beat height change the hold takes out, its limit (rad), and the
 * low-pass that sets the height it holds (× the breed's beat rate). */
const HOLD_GAIN = 0.85;
const HOLD_MAX = 0.25;
const HOLD_CUTOFF = 0.6;

// Scratch (module-level: the animator never re-enters).
const _q = new Quaternion();
const _q2 = new Quaternion();
const _v = new Vector3();
const _v2 = new Vector3();
const _tgt = new Vector3();
const _mouth = new Vector3();
const _e = new Euler();

export type IdleCue = 'blink' | 'nictitate' | 'tongue';

/** Seconds the greeting takes, and when its nictitating sweep and tongue burst come. */
const GREET_TIME = 3.8;
const GREET_NICT = 0.35;
const GREET_TONGUE = 0.85;
/**
 * How close the greeting brings the snout to the rider's face (m): the neck curls round toward
 * them only until the mouth is this far off, and the head turns the rest of the way on its own.
 */
const GREET_STANDOFF = 1.0;

export class LifeLayer {
  private readonly a: WyvernAnimator;
  private readonly f: AnimFrame;
  private readonly rig: RigDef;
  private rng = 12345;
  private breathPhase = 0;
  private blinkTimer = 2;
  private blink = 0;
  private blinkAmt = 0;
  private nict = 0;
  private idleTime = 0;
  private shuffleTimer = 9;
  private shuffleT = -1;
  private yawnTimer = 24;
  private yawnT = -1;
  /** Nictitating membrane: countdown to the next sweep and time into the current one. */
  private nictTimer = 1.5;
  private nictT = -1;
  /** Tongue: countdown to the next tasting, time into a burst of flicks and how many. */
  private tongueTimer = 3;
  private tongueT = -1;
  private tongueFlicks = 0;
  /** How far the tongue is slid out (m, along the head), for apply(). */
  tongueExt = 0;
  /** Stretch-and-bask: time into it (< 0 when not playing), its progress, blend weight. */
  private baskT = -1;
  private baskU = 1;
  private baskW = 0;
  private prevRuffle = 0;
  /** The greeting (cue 'greet'): time into it, < 0 when not playing. */
  private greetT = -1;
  /** Seconds the stretch-and-bask takes (heavier breeds are slower about it). */
  readonly baskDuration: number;
  private readonly jaw = new Spring(10);
  private readonly fan = new Spring(6);
  private readonly lookYaw = new Spring(5.5);
  private readonly lookPitch = new Spring(5.5);
  /** Where the neck "thinks" the body is (a spring on the body's heave): the head trails it. */
  private readonly neckLag: Bouncy;
  /** How far the neck's bend moves the head per radian (m), for the lag mapping. */
  private readonly neckReach: number;
  /** This frame's panting (0..1), for the tongue's "mouth busy". */
  private pant = 0;
  /** This frame's neck bend against the heave lag (rad, shared out along the neck). */
  private neckSag = 0;
  /** This frame's head-height hold (rad, shared out along the neck), and the height it holds to. */
  private neckHold = 0;
  private readonly headLP: Spring;
  private holdInit = false;
  /**
   * How far this frame's greeting curls the neck round (0..1, see GREET_STANDOFF), and the mouth's
   * distance to the look target after a neck pass.
   */
  private greetReach = 1;
  private mouthDist = 0;
  /** The snout tip in the head bone's bind frame (rig.mouth − the head pivot). */
  private readonly mouthOffset: Vector3;
  /** Euler angles for setEulerAt: one neck bone; jaw, fans and tongue (x, y, z each). */
  private readonly neckAng = new Float64Array(3);
  private readonly headAng = new Float64Array(15);

  constructor(a: WyvernAnimator) {
    this.a = a;
    this.f = a.frame;
    this.rig = a.rig;
    const heft = a.heft;
    // The neck's spring is tuned to the breed's wingbeat, so the head trails every beat by about
    // a tenth of a cycle whatever the beat rate (and follows slower motions, landings, closely).
    this.neckLag = new Bouncy(TAU * BREEDS[a.rig.props.breed].flapRate * 1.25, 0.5);
    this.neckReach = 0.62 * a.rig.props.shape.neckLength;
    this.headLP = new Spring(TAU * BREEDS[a.rig.props.breed].flapRate * HOLD_CUTOFF);
    this.mouthOffset = a.rig.mouth.clone().sub(a.rig.bones[a.rig.idx.head].pos);
    this.baskDuration = 3.0 + 0.8 * heft;
  }

  /** Keep phases across a look rebuild (same breed). */
  copyStateFrom(o: LifeLayer): void {
    this.breathPhase = o.breathPhase;
    this.baskT = o.baskT;
    this.baskU = o.baskU;
    this.baskW = o.baskW;
    this.prevRuffle = o.prevRuffle;
  }

  /** After a teleport: the neck and look springs start from rest. */
  reset(): void {
    this.holdInit = false;
    this.neckLag.reset();
    this.lookYaw.reset();
    this.lookPitch.reset();
  }

  /** See WyvernAnimator.cueIdle. */
  cueIdle(event: IdleCue | null, hold: number): void {
    if (event === 'blink') this.blinkTimer = 0;
    else if (event === 'nictitate') this.nictTimer = 0;
    else if (event === 'tongue') this.tongueTimer = 0;
    else {
      this.blinkTimer = Math.max(this.blinkTimer, hold);
      this.nictTimer = Math.max(this.nictTimer, hold);
      this.tongueTimer = Math.max(this.tongueTimer, hold);
    }
  }

  /** Start the stretch-and-bask now (as a rising ruffle would), if the wyvern can. */
  startBask(): void {
    this.baskT = 0;
    this.baskU = 0;
  }

  /**
   * Greet the rider (a called arrival): the head comes down to them (the look target), with a
   * nictitating sweep and then a burst of tongue flicks toward them. Ground only.
   */
  startGreet(): void {
    this.greetT = 0;
  }

  private rand(): number {
    this.rng = (this.rng * 1664525 + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  /** Stretch-and-bask, idle, lids, breathing, shuffle and yawn. */
  lifeSignals(): void {
    const f = this.f;
    const pose = f.pose;
    const { dt, airborne, heft, effort } = f;
    // Stretch-and-bask after resting (WyvernPose.ruffle rising from 0 starts it): a reptile's
    // slow full-body stretch — neck out and up, chest raised, tail straight — with a slight gape
    // to shed heat, then the wings spread wide toward the sun for a moment of basking before they
    // fold. It runs on its own clock (baskDuration, longer than the ruffle) and fades out if the
    // wyvern walks off or takes off.
    const rufIn = pose.ruffle ?? 0;
    const baskOk = !airborne && pose.groundSpeed < 0.6 && pose.gait !== 'takeoff' && !f.teleport;
    if (rufIn > 0 && this.prevRuffle <= 0 && baskOk) {
      this.baskT = 0;
      this.baskU = 0;
    }
    this.prevRuffle = rufIn;
    if (this.baskT >= 0) {
      if (!baskOk) this.baskT = -1;
      else {
        this.baskT += dt;
        this.baskU = Math.min(1, this.baskT / this.baskDuration);
        if (this.baskU >= 1) this.baskT = -1;
      }
    }
    this.baskW = damp(this.baskW, this.baskT >= 0 ? 1 : 0, this.baskT >= 0 ? 10 : 3, dt);
    const bu = this.baskU;
    const stretch = this.baskW * bump(bu, 0, 0.2, 0.36, 0.55);
    const gape = this.baskW * bump(bu, 0.12, 0.3, 0.7, 0.88);
    const bask = this.baskW * bump(bu, 0.3, 0.5, 0.8, 0.98);
    const baskOn = stretch + gape + bask > 0.002;
    f.stretch = stretch;
    f.gape = gape;
    f.bask = bask;
    f.baskOn = baskOn;
    f.fold = f.groundW * (1 - f.openAmt) * (1 - bask);

    // The greeting: the head comes down to the rider, a nictitating sweep, a tongue burst.
    if (this.greetT >= 0) {
      const t0 = this.greetT;
      this.greetT += dt;
      if (airborne || f.teleport || this.greetT > GREET_TIME) this.greetT = -1;
      else {
        if (t0 < GREET_NICT && this.greetT >= GREET_NICT) this.nictTimer = 0;
        if (t0 < GREET_TONGUE && this.greetT >= GREET_TONGUE) this.tongueTimer = 0;
      }
    }
    f.greet = this.greetT >= 0 ? bump(this.greetT, 0, 1.0, 2.8, GREET_TIME) : 0;

    // Idle life: blinks, breathing, the odd wing shuffle and yawn.
    const idle = !airborne && pose.gait === 'idle' && pose.groundSpeed < 0.3;
    f.idle = idle;
    this.idleTime = idle ? this.idleTime + dt : 0;
    // Outer lids: an unhurried reptile blink now and then.
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blink = 0.22;
      this.blinkTimer = 4 + this.rand() * 6;
    }
    this.blink = Math.max(0, this.blink - dt);
    this.blinkAmt = this.blink > 0 ? Math.sin((this.blink / 0.22) * Math.PI) : 0;
    // Nictitating membrane: the inner lid flicks across sideways far more often (more so in the
    // air and after a landing's dust), and is held half-drawn like goggles at dive speeds.
    this.nictTimer -= dt;
    if (f.touchdown) this.nictTimer = Math.min(this.nictTimer, 0.12);
    if (this.nictTimer <= 0 && this.nictT < 0) {
      this.nictT = 0;
      this.nictTimer = (airborne ? 1.4 : 2.4) + this.rand() * 3.5;
    }
    let nict = 0;
    if (this.nictT >= 0) {
      this.nictT += dt;
      nict = bump(this.nictT, 0, 0.08, 0.13, 0.3);
      if (this.nictT > 0.3) this.nictT = -1;
    }
    this.nict = Math.max(nict, 0.5 * smoothstep(36, 60, pose.airspeed) * f.airW);
    // Rib breathing: slow at rest, quick and deep after hard work, slow and full while basking.
    const breathRate = lerp(0.22 - 0.04 * heft, 1.0 - 0.15 * heft, effort) * (1 - 0.35 * bask) + (airborne ? 0.15 : 0);
    this.breathPhase = (this.breathPhase + breathRate * dt) % 1;
    f.breath = Math.sin(this.breathPhase * TAU);
    f.breathAmp = 0.03 + 0.065 * effort + 0.03 * bask;
    if (idle && this.idleTime > 2 && !baskOn) {
      this.shuffleTimer -= dt;
      this.yawnTimer -= dt;
      if (this.shuffleTimer <= 0 && this.shuffleT < 0) {
        this.shuffleT = 0;
        this.shuffleTimer = 8 + this.rand() * 7;
      }
      if (this.yawnTimer <= 0 && this.yawnT < 0 && effort < 0.3) {
        this.yawnT = 0;
        this.yawnTimer = 22 + this.rand() * 16;
      }
    } else {
      this.shuffleT = -1;
      this.yawnT = -1;
    }
    if (this.shuffleT >= 0) {
      this.shuffleT += dt;
      if (this.shuffleT > 1.5) this.shuffleT = -1;
    }
    if (this.yawnT >= 0) {
      this.yawnT += dt;
      if (this.yawnT > 2.4) this.yawnT = -1;
    }
    const sh1 = this.shuffleT >= 0 ? Math.sin((this.shuffleT / 1.5) * Math.PI) : 0;
    f.shuffle = sh1 * sh1;
    f.yawn = this.yawnT >= 0 ? smoothstep(0, 0.6, this.yawnT) * (1 - smoothstep(1.6, 2.4, this.yawnT)) : 0;
  }

  /** The neck and head loop, jaw, fans and tongue. */
  neckHead(): void {
    this.look();
    this.neckBones();
    this.mouth();
  }

  /**
   * Where the head wants to look (smoothed yaw and pitch, body frame) and how far the neck lags
   * the body's heave.
   */
  private look(): void {
    const a = this.a;
    const f = this.f;
    const I = this.rig.idx;
    const { dt, airborne, heft, airW, groundW, stretch, fatigue, effort, bask, yawn, buffet } = f;
    // The neck follows the trunk through a spring: when the body heaves up the head is left
    // behind for a moment (the neck bows), then catches up.
    const bodyY = f.heave + f.gaitBob + f.dipV;
    const lagY = this.neckLag.step(bodyY, dt);
    // Bend the neck so the head sits most of the way back toward where the spring says it should
    // be (more on heavier breeds): the landing's dip and the gait's bob. In the air the head-height
    // hold (neckBones) takes over: it sees everything that lifts the head, the chest's pitch swing
    // about the hips as well as the heave, on every beat rate.
    this.neckSag = clamp(((0.75 + 0.15 * heft) * (bodyY - lagY)) / this.neckReach, -0.16, 0.16) * (1 - airW);
    a.toModel(f.pose.lookTarget, _v);
    _v.sub(a.modelP[I.head]);
    let lookYaw = Math.atan2(_v.x, _v.z);
    let lookPitch = Math.atan2(_v.y, Math.sqrt(_v.x * _v.x + _v.z * _v.z));
    if (_v.x * _v.x + _v.y * _v.y + _v.z * _v.z < 1) {
      lookYaw = 0;
      lookPitch = 0;
    }
    // Greeting, the head comes round to a rider standing at the shoulder.
    const greet = f.greet;
    const maxYaw = airborne ? 1.0 : 1.35 + 1.1 * greet;
    lookYaw = clamp(lookYaw, -maxYaw, maxYaw);
    lookPitch = clamp(lookPitch, -0.85, 0.7);
    // Basking: the head turns up toward the sun (when it is up).
    if (bask > 0.001) {
      const sd = globalUniforms.uSunDir.value;
      if (sd.y > 0.02) {
        _v2.copy(sd).applyQuaternion(a.qWInv);
        lookYaw = lerp(lookYaw, clamp(Math.atan2(_v2.x, _v2.z), -1.1, 1.1), bask);
        lookPitch = lerp(lookPitch, clamp(Math.atan2(_v2.y, Math.sqrt(_v2.x * _v2.x + _v2.z * _v2.z)), 0, 0.6), bask * 0.7);
      }
    }
    // Yawn: head up and back; stall: looking down at what went wrong; tired: head hangs; the
    // stretch reaches up; tasting the air lifts the nose a touch.
    lookPitch += yawn * 0.5 - buffet * 0.25 - fatigue * 0.12 * airW - effort * 0.08 * groundW + stretch * 0.22 + (this.tongueT >= 0 ? 0.06 * (1 - greet) : 0);
    f.lookYaw = this.lookYaw.step(lookYaw, dt);
    f.lookPitch = this.lookPitch.step(lookPitch, dt);
  }

  /**
   * The neck's posture and bend, and the head aimed and held level. In the air the head's height
   * is then held too: the neck is posed once, the head's height (above the body origin, world up)
   * compared with a low-passed copy of itself that follows the flight path but not the wingbeat,
   * and the neck posed again bent to take out most of the difference. The heave and the chest's
   * pitch swing about the hips both lift the head on a long lever; this cancels whatever moves it,
   * on every breed and beat rate, as birds and big predators hold the head steady.
   */
  private neckBones(): void {
    const a = this.a;
    const f = this.f;
    const I = this.rig.idx;
    this.neckHold = 0;
    this.greetReach = 1;
    this.poseNeck();
    if (f.greet > 0.001) this.greetStandoff();
    const hp = a.modelP[I.head];
    _v.copy(hp).applyQuaternion(a.qW);
    const y = _v.y;
    if (f.teleport || !this.holdInit) {
      this.headLP.reset(y);
      this.holdInit = true;
    }
    const target = this.headLP.step(y, f.dt);
    if (f.airW > 0.01) {
      // How far the head moves per radian of the hold's bend (its share at each neck joint times
      // the head's reach ahead of that joint).
      let lever = 0;
      for (let i = 0; i < I.neck.length; i++) lever += HOLD_SHARE[i] * (hp.z - a.modelP[I.neck[i]].z);
      if (lever > 0.2) {
        const hold = clamp((HOLD_GAIN * (y - target)) / lever, -HOLD_MAX, HOLD_MAX) * f.airW;
        if (hold > 1e-5 || hold < -1e-5) {
          this.neckHold = hold;
          this.poseNeck();
        }
      }
    }
  }

  /**
   * The greeting stops the snout GREET_STANDOFF from the rider's face (the look target), whatever
   * the neck's length and the rider's distance: if the full curl round brings the mouth closer,
   * the neck is posed again without it, and then with the share of it that leaves the mouth about
   * that far off (linear between the two). The head still turns to face them, and the neck still
   * comes down (only the curl round is held back). Two extra neck passes, only while greeting close.
   */
  private greetStandoff(): void {
    this.a.toModel(this.f.pose.lookTarget, _tgt);
    this.measureMouth();
    const d1 = this.mouthDist;
    if (d1 >= GREET_STANDOFF) return;
    this.greetReach = 0;
    this.poseNeck();
    this.measureMouth();
    const d0 = this.mouthDist;
    this.greetReach = d0 > GREET_STANDOFF && d0 > d1 + 1e-4 ? clamp((d0 - GREET_STANDOFF) / (d0 - d1), 0, 1) : 0;
    if (this.greetReach > 0) this.poseNeck();
  }

  /** The mouth's distance (model space) to _tgt after the last neck pass, into mouthDist. */
  private measureMouth(): void {
    const a = this.a;
    const head = this.rig.idx.head;
    _mouth.copy(this.mouthOffset).applyQuaternion(a.modelQ[head]).add(a.modelP[head]);
    this.mouthDist = _mouth.distanceTo(_tgt);
  }

  /** One pass of the neck (posture, bends, look, plus this frame's height hold) and the head. */
  private poseNeck(): void {
    const a = this.a;
    const f = this.f;
    const I = this.rig.idx;
    const { airW, groundW, tuck, flare, stretch, fatigue, effort, buffet, breath, breathAmp } = f;
    const neckHold = this.neckHold;
    const ly = f.lookYaw;
    const lp = f.lookPitch;
    const neckSag = this.neckSag;
    const neckN = I.neck.length;
    const bankComp = -f.bank * airW;
    const chestLift = f.chestLift;
    const gaitNeckYaw = f.gaitNeckYaw;
    // Greeting a rider at its shoulder, the neck curls round toward them (but stops short: the
    // head turns the rest of the way on its own, so the snout ends a little way off their face).
    const greet = f.greet;
    const curl = greet * this.greetReach;
    const neckYawMax = 1.35 + 0.35 * curl;
    const neckYaw = clamp(ly, -neckYawMax, neckYawMax) * (1 + 0.35 * curl);
    for (let i = 0; i < neckN; i++) {
      let pitch = lerp(NECK_FLIGHT[i], NECK_GROUND[i], groundW);
      pitch = lerp(pitch, NECK_TUCK[i], tuck);
      pitch = lerp(pitch, NECK_FLARE[i], flare * airW);
      pitch = lerp(pitch, NECK_STRETCH[i], stretch);
      pitch = lerp(pitch, NECK_GREET[i], greet);
      pitch += fatigue * (2 + i * 0.4) * (1 - 0.4 * groundW) + effort * 1.5 * groundW;
      pitch *= DEG;
      pitch += neckSag * NECK_LAG_SHARE[i] + neckHold * HOLD_SHARE[i];
      // The neck base takes out most of the chest's beat pitch (the head is held, not flung).
      if (i === 0) pitch -= 1.6 * chestLift * 0.85;
      pitch += -lp * 0.35 * NECK_YAW_SHARE[i];
      // Breathing nods the neck on the ground; in the air the head is held (the ribs still
      // breathe). The height hold can't take it out there: its low-pass follows anything slower
      // than 0.6 of the beat, and laboured breathing (0.8-1.2 Hz) is slower than a quick beat
      // (the skimmer's 1.6 Hz), so each breath bobbed the head more than the held wingbeat did.
      pitch += breath * breathAmp * 0.2 * (1 - airW);
      const e = this.neckAng;
      e[0] = pitch;
      e[1] = neckYaw * NECK_YAW_SHARE[i] + gaitNeckYaw;
      e[2] = bankComp * 0.06;
      a.setEulerAt(I.neck[i], e, 0);
    }
    // Head: aim at the (clamped, smoothed) look direction, level with the horizon.
    // (Vector fields written directly: no doubles through calls the JIT might not inline.)
    _v.x = Math.sin(ly) * Math.cos(lp);
    _v.y = Math.sin(lp);
    _v.z = Math.cos(ly) * Math.cos(lp);
    const lk = 0.7 * airW + 0.35 * groundW;
    const up = a.upM;
    _v2.x = UP.x + (up.x - UP.x) * lk;
    _v2.y = UP.y + (up.y - UP.y) * lk;
    _v2.z = UP.z + (up.z - UP.z) * lk;
    _v2.normalize();
    aimRotation(FWD, UP, _v, _v2, _q);
    // Small idle tilt and the buffet shake.
    _e.set(buffet > 0 ? buffet * 0.08 * noise1(f.stallT * 10, 4) : 0, 0, f.idle ? 0.06 * noise1(f.time * 0.3, 5) : 0, 'YXZ');
    _q2.setFromEuler(_e);
    _q.multiply(_q2);
    a.setModel(I.head, _q);
  }

  /** Jaw, throat fans and tongue. */
  private mouth(): void {
    const a = this.a;
    const f = this.f;
    const pose = f.pose;
    const I = this.rig.idx;
    const { dt, airborne, flare, stretch, fatigue, bask, yawn, buffet, breath } = f;
    // Jaw: panting when tired or blown after a climb, a gasp on takeoff, yawns.
    const takeoffAir = airborne && pose.gait === 'takeoff' ? 1 - smoothstep(0.2, 0.6, pose.gaitTime) : 0;
    const roar = Math.max(f.takeoffCrouch ? 0.35 * f.openAmt : 0, takeoffAir * 0.35);
    const pant = Math.max(fatigue, smoothstep(0.35, 0.9, f.exertion)) * (0.28 + 0.14 * breath);
    this.pant = pant;
    // The bask's gape is slight and held: shedding heat through the mouth, not a yawn.
    const jawT = Math.max(pant, roar, yawn * 0.95, buffet * 0.2, f.gape * 0.3);
    const fanT = Math.max(roar * 2, yawn, flare * 0.5, buffet * 0.6, fatigue * 0.3, bask * 0.9, stretch * 0.5) * (1 - 0.6 * smoothstep(20, 40, f.speed));
    const fanA = this.fan.step(fanT, dt);
    const e = this.headAng;
    e[0] = this.jaw.step(jawT, dt) * 0.62;
    e[1] = 0;
    e[2] = 0;
    e[3] = 0;
    e[4] = -fanA * 1.1;
    e[5] = -fanA * 0.15;
    e[6] = 0;
    e[7] = fanA * 1.1;
    e[8] = fanA * 0.15;
    a.setEulerAt(I.jaw, e, 0);
    a.setEulerAt(I.fans[0], e, 3);
    a.setEulerAt(I.fans[1], e, 6);
    this.updateTongue();
  }

  /**
   * Forked-tongue flicks: a short burst of two or three quick in-and-out flicks with the prongs
   * waving, tasting the air every few seconds when idle (less often walking) and once soon after
   * landing somewhere new. Never in the air or with the mouth busy.
   */
  private updateTongue(): void {
    const a = this.a;
    const f = this.f;
    const I = this.rig.idx;
    const dt = f.dt;
    const busy = f.baskOn || f.yawn > 0.01 || this.pant > 0.12 || f.pose.gait === 'takeoff';
    const canTaste = !f.airborne && !busy;
    if (f.touchdown) this.tongueTimer = Math.min(this.tongueTimer, 0.9 + this.rand() * 0.7);
    if (canTaste) this.tongueTimer -= dt * (f.moving ? 0.5 : 1);
    if (canTaste && this.tongueTimer <= 0 && this.tongueT < 0) {
      this.tongueT = 0;
      this.tongueFlicks = this.rand() < 0.5 ? 2 : 3;
      this.tongueTimer = 4.5 + this.rand() * 6;
    }
    let out = 0;
    let wave = 0;
    if (this.tongueT >= 0) {
      this.tongueT += dt;
      const per = 0.36;
      const k = Math.floor(this.tongueT / per);
      const ft = this.tongueT - k * per;
      out = smoothstep(0, 0.08, ft) * (1 - smoothstep(0.2, 0.32, ft));
      wave = Math.sin(ft * TAU * 10) * out;
      if (k >= this.tongueFlicks || !canTaste) {
        this.tongueT = -1;
        out = 0;
        wave = 0;
      }
    }
    this.tongueExt = out * TONGUE.reach * this.rig.props.shape.headLength;
    // Out and a little down (tasting toward the ground), the prongs flicking up and down.
    const e = this.headAng;
    e[9] = 0.1 * out;
    e[10] = 0;
    e[11] = 0;
    e[12] = 0.4 * wave;
    e[13] = 0;
    e[14] = 0;
    a.setEulerAt(I.tongue[0], e, 9);
    a.setEulerAt(I.tongue[1], e, 12);
  }

  /** The lids and the ground fold. */
  lifeUniforms(u: WyvernUniforms): void {
    const f = this.f;
    // Eyes half-lidded in the sun while basking.
    u.uBlink.value = Math.max(this.blinkAmt, f.yawn * 0.6, f.bask * 0.4);
    u.uBlinkLower.value = 0;
    u.uNictitate.value = this.nict;
    u.uFold.value = f.fold;
  }
}
