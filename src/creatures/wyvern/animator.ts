// Procedural animation: turns a WyvernPose (plus time) into local bone rotations every frame.
//
// Layers, in the order they are solved:
//   trunk   root heave/dip, spine bend into turns, chest lift on the downstroke, rib breathing
//           (the flanks swell sideways; faster and deeper after hard work), the landing settle,
//           and a reptile's stretch-and-bask after resting
//   neck    a posture per state (S-curve standing, stretched in flight) plus most of the look,
//           trailing the body's heave on a spring so the head lags each wingbeat and landing
//   head    aimed at lookTarget in body space and held level against the bank (stabilized);
//           outer blinks, quicker sideways sweeps of the nictitating membrane (held half-drawn
//           like goggles in a fast dive), and forked-tongue flicks tasting the air when idle
//   tail    a verlet chain in world space carried by the body: it lags turns, whips on
//           landings and wingbeats, and streams in the airflow, pulled toward a rest curve; a
//           counterweight that swings opposite the head and out of turns
//   wings   flight poses as joint channels (glide, a heavy flap cycle, tuck, flare, stall
//           buffet, bank asymmetry where the outer wing works harder), the fingers bending
//           under the air load, blended with a two-bone-IK folded stance on the ground where
//           the wing knuckles are front feet and the fingers fold back along the flank
//   legs    flight poses (tucked at speed, dangling when slow, reaching on the flare, pushing off
//           at takeoff) blended with ground IK to feet planted by the gait
//
// Weight: amplitudes and spring rates scale with the breed's heft (its mass): the ironback
// heaves, lags and settles slowest, the skimmer quickest — but all of them are big animals.
// Everything is smoothed with springs. No allocations per frame (scalar math in the hot loops).

import { Euler, Quaternion, Vector3 } from 'three';
import type { WyvernPose } from '../../core/types';
import type { TerrainQuery } from '../../core/types';
import { DEG, TAU, clamp, clamp01, damp, lerp, smoothstep } from '../../core/math';
import { BREEDS } from '../../flight/breeds';
import { SIDE_SIGN, TONGUE, type RigDef } from './rig';
import { globalUniforms } from '../../render/uniforms';
import { LEG_ANGLES } from './proportions';
import { Bouncy, Spring, aimRotation, mirrorQuat, noise1, rotateAbout, solveTwoBone } from './ik';
import { Gait, type GaitContext } from './gait';
import {
  BASK,
  FLARE,
  FOLDED,
  GLIDE,
  SETTLE,
  TUCK,
  W,
  WING_CHANNELS,
  adjustPose,
  blendPose,
  flapPose,
  loadPose,
  strokeLoad,
  type WingPose,
} from './wingPoses';
import type { WyvernUniforms } from './materials';
import type { Bone } from 'three';

/**
 * Root pitch while standing at rest (radians; negative = nose up). Wyvern.seatOffset reports the
 * bind seat under this rotation, so mounting lines up with the standing animal.
 */
export const STAND_ROOT_PITCH = -4 * DEG;

/** 0 (lightest breed) … 1 (heaviest), from the breed's mass. */
export function heftOf(mass: number): number {
  return clamp01((mass - 470) / 450);
}

/** A 0 → 1 → 0 window: rises over [a, b], falls over [c, d]. */
function bump(x: number, a: number, b: number, c: number, d: number): number {
  return smoothstep(a, b, x) * (1 - smoothstep(c, d, x));
}

const UP = new Vector3(0, 1, 0);
const FWD = new Vector3(0, 0, 1);
const LEFT = new Vector3(1, 0, 0);

// Scratch (module-level: the animator never re-enters).
const _q = new Quaternion();
const _q2 = new Quaternion();
const _qi = new Quaternion();
const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _v4 = new Vector3();
const _v5 = new Vector3();
const _e = new Euler();

/** Tail neutral curves (degrees per segment, + raises). */
const TAIL_GROUND = [9, -1, -3, -4, -4, -3, -2, 0, 2, 4];
const TAIL_FLIGHT = [4, 0.5, 0.3, 0, 0, 0, 0, 0, 0, 0];
const TAIL_FLARE = [-9, -4, -3, -2, -1, 0, 0, 0, 1, 2];
/** Neck postures (degrees per bone, + pitches down). Base → top. */
const NECK_GROUND = [-7, -5, -1, 2, 5, 8];
const NECK_FLIGHT = [4, 3.5, 3, 3, 2.5, 2];
const NECK_TUCK = [5, 5, 4, 4, 3, 2];
const NECK_FLARE = [-5, -4, -3, -1, 1, 3];
/** The stretch: neck reaching out and up, the S-curve straightened. */
const NECK_STRETCH = [-16, -8, -3, 0, 1, 3];
const NECK_YAW_SHARE = [0.08, 0.12, 0.14, 0.15, 0.14, 0.12];
/** How the neck bends when the body moves faster than the head can follow (base → top). */
const NECK_LAG_SHARE = [0.34, 0.28, 0.2, 0.08, -0.06, -0.14];

export class WyvernAnimator {
  private readonly rig: RigDef;
  private readonly terrain?: Pick<TerrainQuery, 'groundAt'>;
  private readonly n: number;
  private readonly parent: number[];
  private readonly offset: Vector3[];
  /** Local rotations (output). */
  readonly local: Quaternion[];
  private readonly modelQ: Quaternion[];
  private readonly modelP: Vector3[];
  /** Root bone translation offset (body space). */
  readonly rootOffset = new Vector3();
  breathScale = 1;

  // Smoothed signals
  private time = 0;
  private initialized = false;
  private readonly lastPos = new Vector3();
  private readonly lastQ = new Quaternion();
  private readonly lastVel = new Vector3();
  private readonly omega = new Vector3();
  private airW = 1;
  private legAirW = 1;
  private spreadVis = 1;
  private gLoad = 1;
  private bank = 0;
  private prevAirborne = true;
  private prevVelY = 0;
  private breathPhase = 0;
  private blinkTimer = 2;
  private blink = 0;
  private idleTime = 0;
  private shuffleTimer = 9;
  private shuffle = 0;
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
  /** Seconds the stretch-and-bask takes (heavier breeds are slower about it). */
  readonly baskDuration: number;
  private rng = 12345;
  private jaw = new Spring(10);
  private fan = new Spring(6);
  private lookYaw = new Spring(5.5);
  private lookPitch = new Spring(5.5);
  private dip: Bouncy;
  private spineYaw = new Spring(5);
  private legSwing = new Bouncy(5, 0.35);
  private stallT = 0;

  // Weight
  /** 0 (lightest breed) … 1 (heaviest). Scales amplitudes and spring rates. */
  readonly heft: number;
  /** 0..1 how hard it has been working lately (flapping); decays while gliding or resting. */
  exertion = 0;
  /** Seconds since touchdown and how hard it was (0..1). */
  private landT = 99;
  private landImpact = 0;
  /** Where the neck "thinks" the body is (a spring on the body's heave): the head trails it. */
  private readonly neckLag: Bouncy;
  /** How far the neck's bend moves the head per radian (m), for the lag mapping. */
  private readonly neckReach: number;
  /** Air load on each wing (left, right), smoothed: bends the fingers, billows the membrane. */
  private readonly loadSpring: [Spring, Spring] = [new Spring(28), new Spring(28)];
  readonly wingLoad = [0, 0];
  /** 0..1 how folded the wings are on the ground (membranes bunch and darken). */
  fold = 0;
  /** The visual root offset (heave, dip) in world space, now and last frame: the tail lags it. */
  private readonly rootOffW = new Vector3();
  private readonly rootOffWPrev = new Vector3();
  private readonly flapSide = new Float32Array(WING_CHANNELS);

  // Wings
  private readonly wingFK: [WingPose, WingPose] = [new Float32Array(WING_CHANNELS), new Float32Array(WING_CHANNELS)];
  private readonly tmpPose = new Float32Array(WING_CHANNELS);
  private readonly flapTmp = new Float32Array(WING_CHANNELS);
  private readonly wingRestDir: Vector3[][];
  private readonly legRestDir: Vector3[][];

  // Tail
  private readonly tailX: Vector3[];
  private readonly tailXp: Vector3[];
  private readonly tailLen: number[];
  private readonly tailRestDir: Vector3[];
  private readonly tailBase = new Vector3();
  private readonly tailBasePrev = new Vector3();
  private tailInit = false;

  // Ground
  private readonly gait: Gait;
  private readonly footWorld: Vector3[] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  private gaitCtx: GaitContext;
  private groundRef = 0;
  private readonly posW = new Vector3();
  private readonly qW = new Quaternion();
  private readonly qWInv = new Quaternion();
  private readonly upM = new Vector3();
  private readonly fwdG = new Vector3();
  private readonly accel = new Vector3();
  private readonly tailPitch: Float32Array;
  private readonly tailYaw: Float32Array;

  constructor(rig: RigDef, terrain?: Pick<TerrainQuery, 'groundAt'>) {
    this.rig = rig;
    this.terrain = terrain;
    this.heft = heftOf(BREEDS[rig.props.breed].mass);
    // Heavier bodies settle slower and bounce less; their necks trail further behind.
    this.dip = new Bouncy(8.5 - 2.5 * this.heft, 0.42 + 0.1 * this.heft);
    // The neck's spring is tuned to the breed's wingbeat, so the head trails every beat by about
    // a tenth of a cycle whatever the beat rate (and follows slower motions, landings, closely).
    this.neckLag = new Bouncy(TAU * BREEDS[rig.props.breed].flapRate * 1.25, 0.5);
    this.neckReach = 0.62 * rig.props.shape.neckLength;
    this.baskDuration = 3.0 + 0.8 * this.heft;
    const B = rig.bones;
    this.n = B.length;
    this.parent = B.map((b) => b.parent);
    this.offset = B.map((b) => (b.parent >= 0 ? b.pos.clone().sub(B[b.parent].pos) : b.pos.clone()));
    this.local = B.map(() => new Quaternion());
    this.modelQ = B.map(() => new Quaternion());
    this.modelP = B.map((b) => b.pos.clone());

    const P = rig.props;
    const dirOf = (a: number, b: Vector3) => b.clone().sub(B[a].pos).normalize();
    this.wingRestDir = [0, 1].map((side) => {
      const w = rig.idx.wings[side];
      const m = (v: Vector3) => new Vector3(v.x * SIDE_SIGN[side], v.y, v.z);
      return [
        dirOf(w.humerus, m(rig.elbow)),
        dirOf(w.forearm, m(rig.wrist)),
        dirOf(w.hand, m(rig.knuckle)),
        dirOf(w.fingers[0][0], m(rig.fingerTips[0])),
        dirOf(w.fingers[1][0], m(rig.fingerTips[1])),
        dirOf(w.fingers[2][0], m(rig.fingerTips[2])),
      ];
    });
    this.legRestDir = [0, 1].map((side) => {
      const l = rig.idx.legs[side];
      const m = (v: Vector3) => new Vector3(v.x * SIDE_SIGN[side], v.y, v.z);
      return [dirOf(l.thigh, m(rig.knee)), dirOf(l.shin, m(rig.ankle)), dirOf(l.meta, m(rig.ball)), FWD.clone()];
    });

    // Tail chain.
    const T = rig.idx.tail;
    this.tailX = [];
    this.tailXp = [];
    this.tailLen = [];
    this.tailRestDir = [];
    this.tailPitch = new Float32Array(T.length);
    this.tailYaw = new Float32Array(T.length);
    for (let i = 0; i <= T.length; i++) {
      this.tailX.push(new Vector3());
      this.tailXp.push(new Vector3());
    }
    for (let i = 0; i < T.length; i++) {
      const a = B[T[i]].pos;
      const b = i + 1 < T.length ? B[T[i + 1]].pos : rig.tailTip;
      this.tailLen.push(a.distanceTo(b));
      this.tailRestDir.push(b.clone().sub(a).normalize());
    }

    // Gait rest spots (body space, on the ground plane).
    const sh = P.standHeight;
    const hipX = P.hip[0];
    const restHind = (side: number) => new Vector3(hipX * 1.08 * SIDE_SIGN[side], -sh, rig.ball.z + 0.1 * sh);
    const restFore = (side: number) =>
      new Vector3((P.shoulder[0] + 0.12 * P.arm.humerus + 0.1 * sh) * SIDE_SIGN[side], -sh, P.shoulder[2] + 0.42 * P.arm.forearm);
    this.gait = new Gait([restHind(0), restHind(1), restFore(0), restFore(1)]);
    this.gaitCtx = {
      dt: 0,
      toWorld: (m, out) => out.copy(m).applyQuaternion(this.qW).add(this.posW),
      groundAt: (x, z, y) => this.groundHeight(x, z, y),
      velocity: new Vector3(),
      yawRate: 0,
      standHeight: sh,
      runBlend: 0,
      moving: false,
    };
    for (let i = 0; i < this.n; i++) this.local[i].identity();
  }

  /** Keep phases and smoothed state across a look rebuild (same breed). */
  copyStateFrom(o: WyvernAnimator): void {
    this.time = o.time;
    this.airW = o.airW;
    this.legAirW = o.legAirW;
    this.spreadVis = o.spreadVis;
    this.breathPhase = o.breathPhase;
    this.prevAirborne = o.prevAirborne;
    this.exertion = o.exertion;
    this.baskT = o.baskT;
    this.baskU = o.baskU;
    this.baskW = o.baskW;
    this.prevRuffle = o.prevRuffle;
  }

  private groundHeight(x: number, z: number, y: number): number {
    const fallback = this.groundRef;
    if (this.terrain) {
      const g = this.terrain.groundAt(x, z, y);
      // Ignore ground far from the body's own (decks over the void, cliff bottoms).
      if (g && Math.abs(g.y - fallback) < 1.6) return g.y;
    }
    return fallback;
  }

  private rand(): number {
    this.rng = (this.rng * 1664525 + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  // --- Hierarchy helpers -----------------------------------------------------------------------

  /** Forward kinematics for one bone from its parent and local rotation. */
  private fk(i: number): void {
    const p = this.parent[i];
    if (p < 0) {
      this.modelQ[i].copy(this.local[i]);
      this.modelP[i].copy(this.offset[i]).add(this.rootOffset);
      return;
    }
    this.modelQ[i].multiplyQuaternions(this.modelQ[p], this.local[i]);
    this.modelP[i].copy(this.offset[i]).applyQuaternion(this.modelQ[p]).add(this.modelP[p]);
  }

  /** A bone's pivot after its parent changed (refreshes its FK). */
  private pivot(i: number): Vector3 {
    this.fk(i);
    return this.modelP[i];
  }

  /** Set a bone's model-space rotation (local derived from the parent), with FK. */
  private setModel(i: number, q: Quaternion, weight = 1): void {
    const p = this.parent[i];
    _qi.copy(this.modelQ[p]).invert().multiply(q);
    if (weight >= 1) this.local[i].copy(_qi);
    else if (weight > 0) this.local[i].slerp(_qi, weight);
    this.fk(i);
  }

  private setEuler(i: number, x: number, y: number, z: number, order: 'YXZ' | 'ZYX' | 'XYZ' = 'YXZ'): void {
    _e.set(x, y, z, order);
    this.local[i].setFromEuler(_e);
    this.fk(i);
  }

  private toModel(world: Vector3, out: Vector3): Vector3 {
    return out.copy(world).sub(this.posW).applyQuaternion(this.qWInv);
  }

  private toWorld(model: Vector3, out: Vector3): Vector3 {
    return out.copy(model).applyQuaternion(this.qW).add(this.posW);
  }

  // --- Main ------------------------------------------------------------------------------------

  update(dtIn: number, pose: WyvernPose, uniforms?: WyvernUniforms): void {
    const dt = clamp(dtIn, 0, 0.1);
    const rig = this.rig;
    const P = rig.props;
    const sh = P.standHeight;
    const I = rig.idx;
    const heft = this.heft;
    this.time += dt;
    this.posW.copy(pose.position);
    this.qW.copy(pose.orientation);
    this.qWInv.copy(pose.orientation).invert();
    this.upM.copy(UP).applyQuaternion(this.qWInv);

    const teleport = !this.initialized || this.lastPos.distanceToSquared(pose.position) > 40 * 40;
    if (teleport) {
      this.lastPos.copy(pose.position);
      this.lastQ.copy(pose.orientation);
      this.lastVel.copy(pose.velocity);
      this.airW = pose.airborne ? 1 : 0;
      this.legAirW = this.airW;
      this.spreadVis = pose.wingSpread;
      this.prevAirborne = pose.airborne;
      this.tailInit = false;
      this.dip.reset();
      this.neckLag.reset();
      this.lookYaw.reset();
      this.lookPitch.reset();
      this.landT = 99;
    }

    // Body angular velocity: the physics value when given, else derived (ghost playback).
    const av = pose.angularVelocity;
    if (av.x * av.x + av.y * av.y + av.z * av.z > 1e-8) {
      _v.copy(av);
    } else if (dt > 1e-5 && !teleport) {
      _q.copy(this.lastQ).invert().multiply(pose.orientation);
      if (_q.w < 0) _q.set(-_q.x, -_q.y, -_q.z, -_q.w);
      const s = Math.sqrt(Math.max(0, 1 - _q.w * _q.w));
      const ang = 2 * Math.acos(clamp(_q.w, -1, 1));
      if (s > 1e-6) _v.set(_q.x / s, _q.y / s, _q.z / s).multiplyScalar(ang / dt);
      else _v.set(0, 0, 0);
    } else _v.set(0, 0, 0);
    const k = 1 - Math.exp(-10 * dt);
    this.omega.lerp(_v, k);
    const om = this.omega;

    // Linear acceleration (world) for inertial effects.
    const accel = this.accel.copy(pose.velocity).sub(this.lastVel).multiplyScalar(dt > 1e-5 ? 1 / dt : 0);
    const a2 = accel.x * accel.x + accel.y * accel.y + accel.z * accel.z;
    if (a2 > 2500) accel.multiplyScalar(50 / Math.sqrt(a2));

    // Air/ground blends.
    const airborne = pose.airborne;
    const touchdown = !airborne && this.prevAirborne && !teleport;
    this.airW = damp(this.airW, airborne ? 1 : 0, airborne ? 6 : 12, dt);
    this.legAirW = damp(this.legAirW, airborne ? 1 : 0, airborne ? 7 : 22, dt);
    const airW = this.airW;
    const groundW = 1 - airW;
    const spreadRate = airborne ? 12 : pose.wingSpread > this.spreadVis ? 9 : 3.2;
    this.spreadVis = damp(this.spreadVis, pose.wingSpread, spreadRate, dt);
    const openAmt = clamp01((this.spreadVis - 0.22) / 0.78);
    const tuck = airborne ? clamp01((1 - this.spreadVis) / 0.72) : 0;
    const flap = clamp01(pose.flapStrength) * (1 - tuck * 0.85);
    const phase = pose.flapPhase;
    const flare = clamp01(pose.flare);
    const stall = clamp01(pose.stall);
    const fatigue = clamp01(pose.fatigue);
    const speed = pose.airspeed;
    const gTarget = airborne ? clamp(1 + (speed * -om.x) / 9.81 + (1 - Math.cos(this.bank)) * 0.3, -1, 6) : 1;
    this.gLoad = damp(this.gLoad, gTarget, 5, dt);
    _v.copy(LEFT).applyQuaternion(this.qW);
    this.bank = damp(this.bank, Math.asin(clamp(_v.y, -1, 1)), 8, dt);
    this.stallT += dt * (1 + stall * 2);
    if (pose.groundY !== null) this.groundRef = pose.groundY;
    else this.groundRef = pose.position.y - sh;

    // Exertion: builds while beating hard (a long climb), drains slowly while gliding and faster
    // at rest on the ground. Drives the labored breathing afterwards.
    if (flap > 0.05 && airborne) this.exertion += dt * flap * (0.07 + 0.03 * heft) * (1 - this.exertion);
    else this.exertion = Math.max(0, this.exertion - dt * (airborne ? 0.035 : 0.06));
    const effort = Math.max(fatigue, this.exertion * 0.85);

    // Touchdown: plant the feet where they are and absorb the impact — the body sinks into the
    // legs (knees flex through the leg IK), pitches forward a touch and springs back.
    if (touchdown) {
      const sink = Math.max(0, -this.prevVelY);
      this.dip.velocity -= clamp(sink, 1.5, 10) * (0.24 + 0.08 * heft) * (sh / 2.6);
      this.landT = 0;
      this.landImpact = Math.max(0.35, clamp01(sink / 8));
      this.gaitCtx.standHeight = sh;
      this.gait.plantAt(this.footWorld, this.gaitCtx);
    }
    this.landT += dt;
    // Wings held up and half open for balance while the weight comes down, then folded.
    const brace = airborne ? 0 : this.landImpact * bump(this.landT, 0, 0.06, 0.3 + 0.25 * heft, 1.0 + 0.3 * heft);

    // Stretch-and-bask after resting (WyvernPose.ruffle rising from 0 starts it): a reptile's
    // slow full-body stretch — neck out and up, chest raised, tail straight — with a slight gape
    // to shed heat, then the wings spread wide toward the sun for a moment of basking before they
    // fold. It runs on its own clock (baskDuration, longer than the ruffle) and fades out if the
    // wyvern walks off or takes off.
    const rufIn = pose.ruffle ?? 0;
    const baskOk = !airborne && pose.groundSpeed < 0.6 && pose.gait !== 'takeoff' && !teleport;
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

    // Idle life: blinks, breathing, the odd wing shuffle and yawn.
    const idle = !airborne && pose.gait === 'idle' && pose.groundSpeed < 0.3;
    this.idleTime = idle ? this.idleTime + dt : 0;
    // Outer lids: an unhurried reptile blink now and then.
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blink = 0.22;
      this.blinkTimer = 4 + this.rand() * 6;
    }
    this.blink = Math.max(0, this.blink - dt);
    const blinkAmt = this.blink > 0 ? Math.sin((this.blink / 0.22) * Math.PI) : 0;
    // Nictitating membrane: the inner lid flicks across sideways far more often (more so in the
    // air and after a landing's dust), and is held half-drawn like goggles at dive speeds.
    this.nictTimer -= dt;
    if (touchdown) this.nictTimer = Math.min(this.nictTimer, 0.12);
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
    nict = Math.max(nict, 0.5 * smoothstep(36, 60, pose.airspeed) * airW);
    // Rib breathing: slow at rest, quick and deep after hard work, slow and full while basking.
    const breathRate = lerp(0.22 - 0.04 * heft, 1.0 - 0.15 * heft, effort) * (1 - 0.35 * bask) + (airborne ? 0.15 : 0);
    this.breathPhase = (this.breathPhase + breathRate * dt) % 1;
    const breath = Math.sin(this.breathPhase * TAU);
    const breathAmp = 0.03 + 0.065 * effort + 0.03 * bask;
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
    this.shuffle = sh1 * sh1;
    const yawn = this.yawnT >= 0 ? smoothstep(0, 0.6, this.yawnT) * (1 - smoothstep(1.6, 2.4, this.yawnT)) : 0;

    // Gait (ground): plant feet in world space.
    const takeoffCrouch = !airborne && pose.gait === 'takeoff';
    if (!airborne || this.legAirW < 0.99) {
      const c = this.gaitCtx;
      c.dt = dt;
      c.velocity.copy(pose.velocity);
      c.velocity.y = 0;
      c.yawRate = om.y;
      c.standHeight = sh;
      const gs = Math.sqrt(c.velocity.x * c.velocity.x + c.velocity.z * c.velocity.z);
      const runSpeed = rig.props.breed === 'galewing' ? 5 : 5.5;
      c.runBlend = smoothstep(runSpeed * 0.7, runSpeed * 1.25, gs);
      c.moving = !takeoffCrouch && (gs > 0.35 || Math.abs(om.y) > 0.35);
      if (teleport) this.gait.reset(c);
      this.gait.update(c);
    }
    const runBlend = this.gaitCtx.runBlend;
    const gaitPhase = this.gait.phase;
    const moving = this.gaitCtx.moving && !airborne;

    // --- Trunk -------------------------------------------------------------------------------------
    // Heave: the downstroke lifts the chest and saddle, the recovery lets them sink. The body is
    // highest just after the bottom of the stroke (the lift lags the force).
    const heaveAmp = (0.05 + 0.035 * heft) * sh;
    const heave = flap * airW * heaveAmp * -Math.cos((phase - 0.08) * TAU);
    const gaitBob = moving ? -(0.025 + 0.01 * heft) * sh * (1 + 2 * runBlend) * (0.5 - 0.5 * Math.cos(gaitPhase * Math.PI * 4)) : 0;
    const buffet = stall * airW;
    const dipV = this.dip.step(0, dt);
    // The stretch rises onto straightened legs; breathing barely lifts the body (the ribs swing
    // out sideways instead).
    this.rootOffset.set(
      buffet * 0.03 * sh * noise1(this.stallT * 9, 1),
      heave + gaitBob + dipV + breath * breathAmp * 0.025 * sh + buffet * 0.04 * sh * noise1(this.stallT * 8, 2) + stretch * 0.04 * sh,
      0,
    );
    const turnBend = clamp(om.y * (airborne ? 0.16 : 0.3), -0.22, 0.22);
    const gaitSway = moving ? 0.05 * (1 - runBlend * 0.5) * Math.sin(gaitPhase * TAU) : 0;
    const spineYaw = this.spineYaw.step(turnBend + gaitSway, dt);
    // Settle: the landing dip pitches the nose down a little and the body rocks back up.
    // Stretching and basking, the chest lifts (nose up).
    const rootPitch =
      groundW * STAND_ROOT_PITCH +
      (moving ? -0.03 * runBlend * Math.sin(gaitPhase * Math.PI * 4) : 0) -
      (dipV / sh) * (0.5 + 0.2 * heft) -
      stretch * 0.08 -
      bask * 0.035;
    const rootRoll = buffet * 0.05 * noise1(this.stallT * 7, 3) + (moving ? 0.03 * Math.sin(gaitPhase * TAU) * (1 - runBlend) : 0);
    this.setEuler(I.root, rootPitch, 0, rootRoll);
    // The wings drive the chest: it pitches up on the downstroke and leads the roll into a turn.
    const chestLift = -flap * airW * (0.05 + 0.03 * heft) * Math.sin((phase - 0.02) * TAU);
    const lean = clamp(this.bank * 0.1 + om.z * 0.06, -0.14, 0.14) * airW;
    this.setEuler(I.spine, chestLift - flare * 0.06 * airW + (takeoffCrouch ? -0.08 * openAmt : 0) - stretch * 0.03, spineYaw * 0.6, lean);
    this.setEuler(I.chest, chestLift * 0.6 - flare * 0.04, spineYaw * 0.5, lean * 0.5);
    this.breathScale = 1 + breath * breathAmp;
    this.local[I.breath].identity();
    this.fk(I.breath);
    // The stretch lifts the tail root level with the back.
    this.setEuler(I.pelvis, flare * 0.05 * airW - tuck * 0.02 + stretch * 0.05, -spineYaw * 0.55, -lean * 0.6);

    // --- Neck & head -------------------------------------------------------------------------------
    // The neck follows the trunk through a spring: when the body heaves up the head is left
    // behind for a moment (the neck bows), then catches up.
    const bodyY = heave + gaitBob + dipV;
    const lagY = this.neckLag.step(bodyY, dt);
    // Bend the neck so the head sits part of the way back toward where the spring says it should
    // be (more on heavier breeds).
    const neckSag = clamp(((0.55 + 0.15 * heft) * (bodyY - lagY)) / this.neckReach, -0.12, 0.12);
    const neckN = I.neck.length;
    this.toModel(pose.lookTarget, _v);
    _v.sub(this.modelP[I.head]);
    let lookYaw = Math.atan2(_v.x, _v.z);
    let lookPitch = Math.atan2(_v.y, Math.sqrt(_v.x * _v.x + _v.z * _v.z));
    if (_v.x * _v.x + _v.y * _v.y + _v.z * _v.z < 1) {
      lookYaw = 0;
      lookPitch = 0;
    }
    const maxYaw = airborne ? 1.0 : 1.35;
    lookYaw = clamp(lookYaw, -maxYaw, maxYaw);
    lookPitch = clamp(lookPitch, -0.85, 0.7);
    // Basking: the head turns up toward the sun (when it is up).
    if (bask > 0.001) {
      const sd = globalUniforms.uSunDir.value;
      if (sd.y > 0.02) {
        _v2.copy(sd).applyQuaternion(this.qWInv);
        lookYaw = lerp(lookYaw, clamp(Math.atan2(_v2.x, _v2.z), -1.1, 1.1), bask);
        lookPitch = lerp(lookPitch, clamp(Math.atan2(_v2.y, Math.hypot(_v2.x, _v2.z)), 0, 0.6), bask * 0.7);
      }
    }
    // Yawn: head up and back; stall: looking down at what went wrong; tired: head hangs; the
    // stretch reaches up; tasting the air lifts the nose a touch.
    lookPitch += yawn * 0.5 - buffet * 0.25 - fatigue * 0.12 * airW - effort * 0.08 * groundW + stretch * 0.22 + (this.tongueT >= 0 ? 0.06 : 0);
    const ly = this.lookYaw.step(lookYaw, dt);
    const lp = this.lookPitch.step(lookPitch, dt);
    const bankComp = -this.bank * airW;
    for (let i = 0; i < neckN; i++) {
      let pitch = lerp(NECK_FLIGHT[i], NECK_GROUND[i], groundW);
      pitch = lerp(pitch, NECK_TUCK[i], tuck);
      pitch = lerp(pitch, NECK_FLARE[i], flare * airW);
      pitch = lerp(pitch, NECK_STRETCH[i], stretch);
      pitch += fatigue * (2 + i * 0.4) * (1 - 0.4 * groundW) + effort * 1.5 * groundW;
      pitch *= DEG;
      pitch += neckSag * NECK_LAG_SHARE[i];
      // The neck base takes out most of the chest's beat pitch (the head is held, not flung).
      if (i === 0) pitch -= 1.6 * chestLift * 0.85;
      pitch += -lp * 0.35 * NECK_YAW_SHARE[i];
      pitch += breath * breathAmp * 0.2;
      const yaw = ly * NECK_YAW_SHARE[i] + (moving ? -gaitSway * 0.4 : 0);
      this.setEuler(I.neck[i], pitch, yaw, bankComp * 0.06);
    }
    // Head: aim at the (clamped, smoothed) look direction, level with the horizon.
    _v.set(Math.sin(ly) * Math.cos(lp), Math.sin(lp), Math.cos(ly) * Math.cos(lp));
    _v2.copy(UP).lerp(this.upM, 0.7 * airW + 0.35 * groundW).normalize();
    aimRotation(FWD, UP, _v, _v2, _q);
    // Small idle tilt and the buffet shake.
    _e.set(buffet * 0.08 * noise1(this.stallT * 10, 4), 0, idle ? 0.06 * noise1(this.time * 0.3, 5) : 0, 'YXZ');
    _q2.setFromEuler(_e);
    _q.multiply(_q2);
    this.setModel(I.head, _q);
    // Jaw: panting when tired or blown after a climb, a gasp on takeoff, yawns.
    const takeoffAir = airborne && pose.gait === 'takeoff' ? 1 - smoothstep(0.2, 0.6, pose.gaitTime) : 0;
    const roar = Math.max(takeoffCrouch ? 0.35 * openAmt : 0, takeoffAir * 0.35);
    const pant = Math.max(fatigue, smoothstep(0.35, 0.9, this.exertion)) * (0.28 + 0.14 * breath);
    // The bask's gape is slight and held: shedding heat through the mouth, not a yawn.
    const jawT = Math.max(pant, roar, yawn * 0.95, buffet * 0.2, gape * 0.3);
    this.setEuler(I.jaw, this.jaw.step(jawT, dt) * 0.62, 0, 0);
    const fanT = Math.max(roar * 2, yawn, flare * 0.5, buffet * 0.6, fatigue * 0.3, bask * 0.9, stretch * 0.5) * (1 - 0.6 * smoothstep(20, 40, speed));
    const fanA = this.fan.step(fanT, dt);
    this.setEuler(I.fans[0], 0, -fanA * 1.1, -fanA * 0.15);
    this.setEuler(I.fans[1], 0, fanA * 1.1, fanA * 0.15);
    this.updateTongue(dt, airborne, moving, touchdown, baskOn || yawn > 0.01 || pant > 0.12 || pose.gait === 'takeoff');

    // --- Tail --------------------------------------------------------------------------------------
    this.updateTail(dt, pose, airborne, groundW, flare, tuck, buffet, idle, moving, gaitPhase, accel, teleport, stretch, ly, lp);

    // --- Wings -------------------------------------------------------------------------------------
    // Turning: the outer (rising) wing reaches and works harder, the inner one unloads.
    const asymBase = clamp(om.z * 0.55 - om.y * 0.35 + this.bank * 0.35, -1, 1) * airW;
    const spreadAir = (1 - tuck) * (1 - flare * 0.5);
    // Air load: lift at 1 g holds a gentle camber; g-load and the power stroke bow the membrane up
    // and bend the fingers, the recovery stroke lets them go slack.
    const glideLoad = 0.3 * clamp(this.gLoad, 0, 3) * spreadAir;
    const beatLoad = flap * strokeLoad(phase) * (1 + 0.25 * heft);
    this.fold = groundW * (1 - openAmt) * (1 - bask);
    for (let side = 0; side < 2; side++) {
      const wp = this.wingFK[side];
      const sgn = SIDE_SIGN[side];
      const asym = asymBase * sgn;
      // Flight pose.
      blendPose(GLIDE, TUCK, tuck, wp);
      blendPose(wp, FLARE, flare * (1 - tuck), wp);
      if (flap > 0.001) {
        const fp = flapPose(phase, fatigue, this.flapSide, heft);
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
        blendPose(wp, fp, flap, wp);
      }
      const bf = buffet * noise1(this.stallT * 9 + side * 7.3, 10 + side);
      const bt = buffet * noise1(this.stallT * 11 + side * 3.1, 20 + side);
      adjustPose(wp, this.gLoad, asym, bf + buffet * 0.4 * sgn * Math.sin(this.stallT * 1.7), bt, spreadAir);
      const loadT = airW * (glideLoad + beatLoad) * (1 + 0.35 * clamp(asym, -1, 1));
      const load = this.loadSpring[side].step(loadT, dt);
      this.wingLoad[side] = load;
      loadPose(wp, load * spreadAir);
      // Ground pose (FK part): settle/shuffle/brace, raised for the takeoff, or spread to bask.
      const groundFK = this.tmpPose;
      if (takeoffCrouch) blendPose(SETTLE, flapPose(0, 0, this.flapTmp, heft), openAmt, groundFK);
      else blendPose(FOLDED, SETTLE, clamp01(openAmt * 1.4 + this.shuffle * 0.8 + brace), groundFK);
      if (bask > 0.001) blendPose(groundFK, BASK, bask, groundFK);
      blendPose(wp, groundFK, groundW, wp);
      this.applyWingFK(side, wp);
      // Ground IK: knuckles on the ground as front feet (lifted off them to bask).
      const ikW = groundW * (1 - openAmt) * (1 - this.shuffle * 0.65) * (1 - 0.85 * brace) * (1 - bask);
      if (ikW > 0.001) this.applyWingIK(side, ikW, sh);
    }

    // --- Legs --------------------------------------------------------------------------------------
    const height = pose.groundY !== null ? pose.position.y - pose.groundY : Infinity;
    const approach = airborne && pose.velocity.y < 0.5 ? 1 - smoothstep(sh * 1.4, sh * 3.2, height) : 0;
    const reach = clamp01(Math.max(flare, approach * smoothstep(26, 14, speed)));
    const push = airborne && pose.gait === 'takeoff' ? 1 - smoothstep(0.15, 0.55, pose.gaitTime) : 0;
    const tuckLegs = clamp01(smoothstep(15, 24, speed) + tuck) * (1 - reach) * (1 - push);
    // Dangling legs swing with the body's fore-aft acceleration and trail the wingbeat's heave.
    _v.copy(FWD).applyQuaternion(this.qW);
    const fwdAcc = accel.x * _v.x + accel.y * _v.y + accel.z * _v.z;
    this.legSwing.step(clamp(-fwdAcc * 0.012 + (heave / sh) * 0.9, -0.4, 0.4), dt);
    for (let side = 0; side < 2; side++) {
      this.applyLegFK(side, tuckLegs, reach, push, fatigue);
      if (this.legAirW < 0.999) this.applyLegIK(side, 1 - this.legAirW);
    }

    // Contact points for the next touchdown (hind: under the ball of the foot, fore: knuckle).
    for (let side = 0; side < 2; side++) {
      this.toWorld(this.modelP[I.legs[side].toes], this.footWorld[side]);
      this.toWorld(this.modelP[I.wings[side].claw], this.footWorld[2 + side]);
    }

    if (uniforms) {
      // Eyes half-lidded in the sun while basking.
      uniforms.uBlink.value = Math.max(blinkAmt, yawn * 0.6, bask * 0.4);
      uniforms.uNictitate.value = nict;
      // Trailing-edge flutter: airspeed, the power stroke's ripple, stall buffet, a breeze on
      // the spread membranes while basking.
      uniforms.uFlutter.value =
        0.012 * sh * smoothstep(8, 40, speed) * airW * (1 - tuck * 0.5) + 0.008 * sh * flap * airW + buffet * 0.03 + bask * 0.004 * sh;
      uniforms.uFlutterRate.value = 14 + speed * 0.9 - bask * 8;
      uniforms.uRipple.value = 0.4 + 0.6 * smoothstep(5, 35, speed);
      // Membrane billow per wing (m at full load) and how folded the wings are.
      const billow = 0.022 * P.wingspan;
      uniforms.uWingLoad.value.set(this.wingLoad[0] * billow * spreadAir, this.wingLoad[1] * billow * spreadAir);
      uniforms.uFold.value = this.fold;
    }

    this.prevAirborne = airborne;
    this.prevVelY = pose.velocity.y;
    this.lastPos.copy(pose.position);
    this.lastQ.copy(pose.orientation);
    this.lastVel.copy(pose.velocity);
    this.initialized = true;
  }

  /** Write the pose into the bones. */
  apply(bones: Bone[]): void {
    for (let i = 0; i < this.n; i++) bones[i].quaternion.copy(this.local[i]);
    const r = this.rig.idx.root;
    bones[r].position.copy(this.offset[r]).add(this.rootOffset);
    const br = bones[this.rig.idx.breath];
    // Rib breathing: the flanks swell sideways, the belly a little, hardly any lift.
    const b = this.breathScale - 1;
    br.scale.set(1 + b * 1.2, 1 + b * 0.3, 1 + b * 0.08);
    // The tongue slides out along the jaw (its bones are at rest otherwise).
    const t0 = this.rig.idx.tongue[0];
    bones[t0].position.copy(this.offset[t0]);
    bones[t0].position.z += this.tongueExt;
  }

  /** Model-space bone positions/rotations (after update), for tests and debugging. */
  boneModel(i: number, outP: Vector3, outQ?: Quaternion): Vector3 {
    if (outQ) outQ.copy(this.modelQ[i]);
    return outP.copy(this.modelP[i]);
  }

  // --- Tongue ------------------------------------------------------------------------------------

  /**
   * Forked-tongue flicks: a short burst of two or three quick in-and-out flicks with the prongs
   * waving, tasting the air every few seconds when idle (less often walking) and once soon after
   * landing somewhere new. Never in the air or with the mouth busy.
   */
  private updateTongue(dt: number, airborne: boolean, moving: boolean, touchdown: boolean, busy: boolean): void {
    const I = this.rig.idx;
    const canTaste = !airborne && !busy;
    if (touchdown) this.tongueTimer = Math.min(this.tongueTimer, 0.9 + this.rand() * 0.7);
    if (canTaste) this.tongueTimer -= dt * (moving ? 0.5 : 1);
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
      const f = this.tongueT - k * per;
      out = smoothstep(0, 0.08, f) * (1 - smoothstep(0.2, 0.32, f));
      wave = Math.sin(f * TAU * 10) * out;
      if (k >= this.tongueFlicks || !canTaste) {
        this.tongueT = -1;
        out = 0;
        wave = 0;
      }
    }
    this.tongueExt = out * TONGUE.reach * this.rig.props.shape.headLength;
    // Out and a little down (tasting toward the ground), the prongs flicking up and down.
    this.setEuler(I.tongue[0], 0.1 * out, 0, 0);
    this.setEuler(I.tongue[1], 0.4 * wave, 0, 0);
  }

  // --- Wings -------------------------------------------------------------------------------------

  private applyWingFK(side: number, p: WingPose): void {
    const w = this.rig.idx.wings[side];
    this.wingJoint(side, w.humerus, p[W.humEl], p[W.humSw], p[W.humTw]);
    this.wingJoint(side, w.forearm, p[W.foreEl], p[W.foreSw], p[W.foreTw]);
    this.wingJoint(side, w.hand, p[W.handEl], p[W.handSw], p[W.handTw]);
    this.wingJoint(side, w.claw, p[W.clawEl], p[W.clawSw], 0);
    for (let f = 0; f < 3; f++) {
      this.wingJoint(side, w.fingers[f][0], p[W.f0El + f * 3], p[W.f0Sw + f * 3], p[W.f0Tw + f * 3]);
      this.wingJoint(side, w.fingers[f][1], p[W.f0bEl + f * 2], p[W.f0bSw + f * 2], 0);
    }
  }

  /** One wing joint from channels (left convention, mirrored for the right wing). */
  private wingJoint(side: number, bone: number, el: number, sw: number, tw: number): void {
    _e.set(tw, sw, el, 'ZYX');
    _q.setFromEuler(_e);
    if (side === 1) mirrorQuat(_q, _q);
    this.local[bone].copy(_q);
    this.fk(bone);
  }

  /**
   * Folded stance: the wrist (with its thumb claws) is a front foot planted by the gait; humerus
   * + forearm reach it by two-bone IK with the elbow high and back. The hand folds back up along
   * the forearm and the fingers run on up beside it in a tight bundle, then their outer segments
   * fold back along the flank toward the tail, so the folded wing reads as one strong limb with
   * the wingtips lying along the upper flank and the membrane bunched into a narrow wedge (not a
   * second pair of stilts with a sheet hung between them). Blended over the FK pose by `weight`.
   */
  private applyWingIK(side: number, weight: number, sh: number): void {
    const rig = this.rig;
    const w = rig.idx.wings[side];
    const A = rig.props.arm;
    const sx = SIDE_SIGN[side];
    const rest = this.wingRestDir[side];
    const up = this.upM;
    const fwdG = this.fwdG.copy(FWD).addScaledVector(up, -up.z).normalize();
    // Wrist target (model space) from the planted foot, the claws resting on the ground.
    const foot = this.gait.feet[2 + side];
    const Wt = this.toModel(foot.pos, _v3).addScaledVector(up, 0.07 * sh);
    const S = _v2.copy(this.modelP[w.humerus]);
    // Pole: back and up, a little out, so the elbow juts up behind the shoulder.
    _v4.set(0.25 * sx, 0.75, -0.62);
    const E = _v5;
    solveTwoBone(S, A.humerus, A.forearm, Wt, _v4, E);
    const hum = _hum.subVectors(E, S);
    const fore = _fore.subVectors(Wt, E);
    // Wing surface "up" in the bind is −(humerus × forearm) for the left wing.
    const ref = _ref.crossVectors(hum, fore).multiplyScalar(-sx);
    if (ref.lengthSq() < 1e-8) ref.copy(UP);
    ref.normalize();
    aimRotation(rest[0], UP, hum, ref, _q);
    this.setModel(w.humerus, _q, weight);
    aimRotation(rest[1], UP, fore, ref, _q);
    this.setModel(w.forearm, _q, weight);
    // Hand folds back up along the forearm, just outside it.
    const back = _handD.subVectors(E, Wt).normalize();
    _fd.copy(back).addScaledVector(LEFT, 0.12 * sx).addScaledVector(fwdG, -0.06).normalize();
    aimRotation(rest[2], UP, _fd, ref, _q);
    this.setModel(w.hand, _q, weight);
    for (let f = 0; f < 3; f++) {
      // Inner segment: up beside the forearm, bundled (outside and a little behind it).
      _fd.copy(back)
        .addScaledVector(LEFT, (0.07 + 0.02 * f) * sx)
        .addScaledVector(fwdG, -0.1 - 0.06 * f)
        .normalize();
      aimRotation(rest[3 + f], UP, _fd, ref, _q);
      this.setModel(w.fingers[f][0], _q, weight);
      // Outer segment: folded back along the flank, tips toward the tail; the wingtip finger
      // rides highest, the inner ones fan a little lower. Membrane side faces outward.
      _fd.copy(fwdG)
        .multiplyScalar(-0.92)
        .addScaledVector(up, 0.3 - 0.13 * f)
        .addScaledVector(LEFT, (0.07 - 0.02 * f) * sx)
        .normalize();
      aimRotation(rest[3 + f], UP, _fd, _refN.copy(LEFT).multiplyScalar(sx), _q);
      this.setModel(w.fingers[f][1], _q, weight);
    }
    // Claws point forward along the ground.
    _fd.copy(fwdG).addScaledVector(up, -0.25).addScaledVector(LEFT, 0.2 * sx).normalize();
    aimRotation(FWD, UP, _fd, up, _q);
    this.setModel(w.claw, _q, weight);
  }

  // --- Legs --------------------------------------------------------------------------------------

  /** Blend a leg bone direction (pelvis space, left; mirrored by sx) from four poses. */
  private legDir(
    out: Vector3,
    tuckAmt: number,
    reach: number,
    push: number,
    sx: number,
    tx: number, ty: number, tz: number,
    dx: number, dy: number, dz: number,
    rx: number, ry: number, rz: number,
    px: number, py: number, pz: number,
  ): Vector3 {
    const dangle = 1 - tuckAmt;
    out.set(tx * tuckAmt + dx * dangle, ty * tuckAmt + dy * dangle, tz * tuckAmt + dz * dangle);
    out.lerp(_lv.set(rx, ry, rz), reach);
    out.lerp(_lv.set(px, py, pz), push);
    out.x *= sx;
    return out.normalize();
  }

  private applyLegFK(side: number, tuckAmt: number, reach: number, push: number, fatigue: number): void {
    const l = this.rig.idx.legs[side];
    const sx = SIDE_SIGN[side];
    const rest = this.legRestDir[side];
    const pq = this.modelQ[this.parent[l.thigh]];
    // Dangling legs swing back and forth with the body's fore-aft acceleration.
    const sw = this.legSwing.value * (1 - tuckAmt);
    //                                       tucked              dangling                          reaching           pushing off
    const thigh = this.legDir(_v, tuckAmt, reach, push, sx, 0.06, -0.5, -0.86, 0.1, -0.86 - 0.05 * fatigue, 0.48 - sw, 0.14, -0.62, 0.78, 0.05, -0.92, -0.38);
    const shin = this.legDir(_v2, tuckAmt, reach, push, sx, 0.0, 0.25, -0.97, 0.02, -0.82, -0.56 - sw, 0.03, -0.97, 0.24, 0.0, -0.94, -0.33);
    const meta = this.legDir(_v3, tuckAmt, reach, push, sx, 0.0, -0.18, -0.98, 0.0, -0.9, 0.22 - sw * 0.5, 0.0, -0.94, 0.32, 0.0, -0.8, -0.6);
    thigh.applyQuaternion(pq);
    shin.applyQuaternion(pq);
    meta.applyQuaternion(pq);
    const lat = _ref.copy(LEFT).applyQuaternion(pq);
    aimRotation(rest[0], LEFT, thigh, lat, _q);
    this.setModel(l.thigh, _q);
    aimRotation(rest[1], LEFT, shin, lat, _q);
    this.setModel(l.shin, _q);
    aimRotation(rest[2], LEFT, meta, lat, _q);
    this.setModel(l.meta, _q);
    // Toes: curled while tucked or dangling, spread forward when reaching.
    const curl = (0.9 * tuckAmt + 0.55 * (1 - tuckAmt)) * (1 - reach) * (1 - push * 0.5) - 0.15 * reach;
    this.setEuler(l.toes, curl, 0, 0);
  }

  private applyLegIK(side: number, weight: number): void {
    const rig = this.rig;
    const l = rig.idx.legs[side];
    const G = rig.props.leg;
    const rest = this.legRestDir[side];
    const foot = this.gait.feet[side];
    const up = this.upM;
    const fwdG = this.fwdG.copy(FWD).addScaledVector(up, -up.z).normalize();
    // Ball of the foot above the planted sole.
    const ball = this.toModel(foot.pos, _v).addScaledVector(up, G.sole);
    // Metatarsus leans forward; more when the heel lifts during a swing.
    const a = LEG_ANGLES.meta + foot.airborne * 0.5;
    const metaDir = _v3.copy(up).multiplyScalar(-Math.cos(a)).addScaledVector(fwdG, Math.sin(a));
    const ankle = _v4.copy(ball).addScaledVector(metaDir, -G.meta);
    const hip = this.modelP[l.thigh];
    const pole = _v5.copy(fwdG).addScaledVector(LEFT, 0.12 * SIDE_SIGN[side]);
    const knee = _hum;
    solveTwoBone(hip, G.thigh, G.shin, ankle, pole, knee);
    const lat = _ref.copy(LEFT).applyQuaternion(this.modelQ[this.parent[l.thigh]]);
    aimRotation(rest[0], LEFT, _fore.subVectors(knee, hip), lat, _q);
    this.setModel(l.thigh, _q, weight);
    aimRotation(rest[1], LEFT, _fore.subVectors(ankle, this.pivot(l.shin)), lat, _q);
    this.setModel(l.shin, _q, weight);
    aimRotation(rest[2], LEFT, _fore.subVectors(ball, this.pivot(l.meta)), lat, _q);
    this.setModel(l.meta, _q, weight);
    // Toes flat on the ground in stance, pointing down as the foot lifts.
    _fd.copy(fwdG).addScaledVector(up, -0.9 * foot.airborne).normalize();
    aimRotation(FWD, UP, _fd, up, _q);
    this.setModel(l.toes, _q, weight);
  }

  // --- Tail --------------------------------------------------------------------------------------

  private updateTail(
    dt: number,
    pose: WyvernPose,
    airborne: boolean,
    groundW: number,
    flare: number,
    tuck: number,
    buffet: number,
    idle: boolean,
    moving: boolean,
    gaitPhase: number,
    accel: Vector3,
    teleport: boolean,
    stretch: number,
    lookYaw: number,
    lookPitch: number,
  ): void {
    const rig = this.rig;
    const T = rig.idx.tail;
    const n = T.length;
    const X = this.tailX;
    const Xp = this.tailXp;
    const om = this.omega;
    const pelvis = rig.idx.pelvis;
    // Base of the tail and its rest direction (world).
    const pelvisWorldQ = _q2.multiplyQuaternions(this.qW, this.modelQ[pelvis]);
    this.toWorld(_v.copy(this.offset[T[0]]).applyQuaternion(this.modelQ[pelvis]).add(this.modelP[pelvis]), this.tailBase);
    const baseDir = _v2.copy(this.tailRestDir[0]).applyQuaternion(pelvisWorldQ);
    const bodyUp = _v3.copy(UP).applyQuaternion(this.qW);
    this.rootOffW.copy(this.rootOffset).applyQuaternion(this.qW);

    // Target curve per segment (radians): pitch (+ raises) and yaw (+ swings to the body's left).
    const t = this.time;
    // Counter-steer: in a turn the tail swings out to the outside, a counterweight to the turn.
    const steer = clamp(om.y * (airborne ? -0.07 : -0.045), -0.08, 0.08);
    for (let i = 0; i < n; i++) {
      let p = lerp(TAIL_FLIGHT[i], TAIL_GROUND[i], groundW);
      p = lerp(p, TAIL_FLARE[i], flare * (1 - groundW));
      p *= (1 - tuck * 0.7) * (1 - 0.75 * stretch);
      // On the ground the tail balances the head and neck: it lifts as the head goes down and
      // swings the other way when the head turns; the stretch holds it straight out.
      const counterPitch = -lookPitch * 0.014 * groundW + stretch * 0.03 * (1 - i / n);
      this.tailPitch[i] = p * DEG + (idle ? 0.02 * Math.sin(t * 0.9 - i * 0.4) : 0) + counterPitch;
      const sway = (idle ? 0.045 : 0.015) * Math.sin(t * (idle ? 0.75 : 1.4) - i * 0.45) + (moving ? 0.05 * Math.sin(gaitPhase * TAU - i * 0.5) : 0);
      // A stall makes it lash.
      const lash = buffet * 0.09 * Math.sin(this.stallT * 5 - i * 0.6);
      const counterYaw = -lookYaw * 0.03 * groundW * (1 - 0.5 * stretch);
      this.tailYaw[i] = sway * (1 - 0.6 * stretch) + steer + lash + counterYaw;
    }
    const tp = this.tailPitch;
    const ty = this.tailYaw;

    if (teleport || !this.tailInit) {
      X[0].copy(this.tailBase);
      const d = _v4.copy(baseDir);
      for (let i = 0; i < n; i++) {
        this.bendDir(d, bodyUp, tp[i], ty[i]);
        X[i + 1].copy(X[i]).addScaledVector(d, this.tailLen[i]);
      }
      for (let i = 0; i <= n; i++) Xp[i].copy(X[i]);
      this.tailBasePrev.copy(this.tailBase);
      this.rootOffWPrev.copy(this.rootOffW);
      this.tailInit = true;
    } else {
      // Carry the chain with the body's travel, but not with the visual heave and landing dip:
      // the chain has to follow those through its springs, so each wingbeat and touchdown sends
      // a wave down the tail. Rotations and accelerations make it lag too.
      const sx = this.tailBase.x - this.tailBasePrev.x - (this.rootOffW.x - this.rootOffWPrev.x) * 0.85;
      const sy = this.tailBase.y - this.tailBasePrev.y - (this.rootOffW.y - this.rootOffWPrev.y) * 0.85;
      const sz = this.tailBase.z - this.tailBasePrev.z - (this.rootOffW.z - this.rootOffWPrev.z) * 0.85;
      for (let i = 0; i <= n; i++) {
        X[i].x += sx;
        X[i].y += sy;
        X[i].z += sz;
        Xp[i].x += sx;
        Xp[i].y += sy;
        Xp[i].z += sz;
      }
      this.tailBasePrev.copy(this.tailBase);
      this.rootOffWPrev.copy(this.rootOffW);
      const steps = Math.max(1, Math.min(10, Math.ceil(dt * 120)));
      const h = dt / steps;
      const grav = (airborne ? 1.2 : 6) * h * h;
      const inertia = 0.35 * h * h;
      const groundY = this.groundRef;
      const vel = pose.velocity;
      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
      const stream = airborne ? smoothstep(4, 20, speed) * 0.04 : 0;
      const baseR = rig.props.shape.tailBaseRadius;
      for (let s = 0; s < steps; s++) {
        X[0].copy(this.tailBase);
        for (let i = 1; i <= n; i++) {
          const x = X[i];
          const px = Xp[i];
          const vx = (x.x - px.x) * 0.94;
          const vy = (x.y - px.y) * 0.94;
          const vz = (x.z - px.z) * 0.94;
          px.copy(x);
          x.x += vx - accel.x * inertia;
          x.y += vy - grav - accel.y * inertia;
          x.z += vz - accel.z * inertia;
        }
        const d = _v4.copy(baseDir);
        for (let i = 1; i <= n; i++) {
          if (i > 1) d.subVectors(X[i - 1], X[i - 2]).normalize();
          this.bendDir(d, bodyUp, tp[i - 1], ty[i - 1]);
          const kStiff = lerp(0.42, 0.16, (i - 1) / (n - 1));
          const len = this.tailLen[i - 1];
          const xi = X[i];
          const xa = X[i - 1];
          xi.x += (xa.x + d.x * len - xi.x) * kStiff;
          xi.y += (xa.y + d.y * len - xi.y) * kStiff;
          xi.z += (xa.z + d.z * len - xi.z) * kStiff;
          if (stream > 0 && speed > 1) {
            const k = (-stream * len) / speed;
            xi.x += vel.x * k;
            xi.y += vel.y * k;
            xi.z += vel.z * k;
          }
          // Keep the segment length.
          const ex = xi.x - xa.x;
          const ey = xi.y - xa.y;
          const ez = xi.z - xa.z;
          const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
          if (el > 1e-6) {
            const f = len / el;
            xi.x = xa.x + ex * f;
            xi.y = xa.y + ey * f;
            xi.z = xa.z + ez * f;
          }
          // Stay above the ground.
          const minY = groundY + 0.05 + 0.4 * baseR * (1 - (i - 1) / n);
          if (!airborne && xi.y < minY) xi.y = minY;
        }
      }
    }

    // Bones follow the chain: aim each segment at the next point, rolling gently with the bank.
    for (let i = 0; i < n; i++) {
      const dirM = this.toModel(X[i + 1], _v4).sub(this.toModel(X[i], _v5));
      const parentQ = this.modelQ[this.parent[T[i]]];
      _ref.copy(UP).applyQuaternion(parentQ);
      rotateAbout(_ref, _refN.copy(dirM).normalize(), clamp(-om.z * 0.04, -0.08, 0.08));
      aimRotation(this.tailRestDir[i], UP, dirM, _ref, _q);
      this.setModel(T[i], _q);
    }
  }

  /** Bend a direction by pitch (raise) and yaw (to the body's left) relative to itself. */
  private bendDir(d: Vector3, up: Vector3, pitch: number, yaw: number): void {
    // Scalar Rodrigues rotations (this runs ~30 times a frame; no boxed temporaries).
    let dx = d.x;
    let dy = d.y;
    let dz = d.z;
    const ux = up.x;
    const uy = up.y;
    const uz = up.z;
    // Pitch about a = normalize(d × up) (points to the left of a backward-pointing tail).
    let ax = dy * uz - dz * uy;
    let ay = dz * ux - dx * uz;
    let az = dx * uy - dy * ux;
    let l = ax * ax + ay * ay + az * az;
    if (l < 1e-8) {
      ax = 1;
      ay = 0;
      az = 0;
    } else {
      l = Math.sqrt(l);
      ax /= l;
      ay /= l;
      az /= l;
    }
    let c = Math.cos(pitch);
    let s = Math.sin(pitch);
    let k = (ax * dx + ay * dy + az * dz) * (1 - c);
    let rx = dx * c + (ay * dz - az * dy) * s + ax * k;
    let ry = dy * c + (az * dx - ax * dz) * s + ay * k;
    let rz = dz * c + (ax * dy - ay * dx) * s + az * k;
    dx = rx;
    dy = ry;
    dz = rz;
    // Yaw about b = up made perpendicular to d.
    const ud = ux * dx + uy * dy + uz * dz;
    let bx = ux - dx * ud;
    let by = uy - dy * ud;
    let bz = uz - dz * ud;
    l = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
    bx /= l;
    by /= l;
    bz /= l;
    c = Math.cos(-yaw);
    s = Math.sin(-yaw);
    k = (bx * dx + by * dy + bz * dz) * (1 - c);
    rx = dx * c + (by * dz - bz * dy) * s + bx * k;
    ry = dy * c + (bz * dx - bx * dz) * s + by * k;
    rz = dz * c + (bx * dy - by * dx) * s + bz * k;
    l = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
    d.set(rx / l, ry / l, rz / l);
  }
}

const _hum = new Vector3();
const _fore = new Vector3();
const _ref = new Vector3();
const _refN = new Vector3();
const _handD = new Vector3();
const _fd = new Vector3();
const _axis = new Vector3();
const _axis2 = new Vector3();
const _qIdentity = new Quaternion();
const _lv = new Vector3();
