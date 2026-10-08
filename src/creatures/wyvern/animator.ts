// Procedural animation: turns a WyvernPose (plus time) into local bone rotations every frame.
//
// Layers, in the order they are solved:
//   trunk   root heave/dip, spine bend into turns, chest lift on the downstroke, breathing
//   neck    a posture per state (S-curve standing, stretched in flight) plus most of the look
//   head    aimed at lookTarget in body space and held level against the bank (stabilized)
//   tail    a verlet chain in world space carried by the body: it lags turns, whips on
//           landings and streams in the airflow, pulled toward a rest curve per state
//   wings   flight poses as joint channels (glide, flap cycle, tuck, flare, stall buffet, bank
//           asymmetry), blended with a two-bone-IK folded stance on the ground where the wing
//           knuckles are front feet
//   legs    flight poses (tucked at speed, dangling when slow, reaching on the flare, pushing off
//           at takeoff) blended with ground IK to feet planted by the gait
// Everything is smoothed with springs so it moves with weight. No allocations per frame.

import { Euler, Quaternion, Vector3 } from 'three';
import type { WyvernPose } from '../../core/types';
import type { TerrainQuery } from '../../core/types';
import { DEG, clamp, clamp01, damp, lerp, smoothstep } from '../../core/math';
import { SIDE_SIGN, type RigDef } from './rig';
import { LEG_ANGLES } from './proportions';
import { Bouncy, Spring, aimRotation, mirrorQuat, noise1, rotateAbout, solveTwoBone } from './ik';
import { FOOT_COUNT, Gait, type GaitContext } from './gait';
import { FLARE, FOLDED, GLIDE, SETTLE, TUCK, W, WING_CHANNELS, adjustPose, blendPose, flapPose, stroke, type WingPose } from './wingPoses';
import type { WyvernUniforms } from './materials';
import type { Bone } from 'three';

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
const NECK_YAW_SHARE = [0.08, 0.12, 0.14, 0.15, 0.14, 0.12];

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
  private rng = 12345;
  private jaw = new Spring(10);
  private fan = new Spring(6);
  private lookYaw = new Spring(5.5);
  private lookPitch = new Spring(5.5);
  private dip = new Bouncy(9, 0.45);
  private spineYaw = new Spring(5);
  private legSwing = new Bouncy(5, 0.35);
  private stallT = 0;

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
      this.lookYaw.reset();
      this.lookPitch.reset();
    }

    // Body angular velocity: the physics value when given, else derived (ghost playback).
    if (pose.angularVelocity.lengthSq() > 1e-8) {
      _v.copy(pose.angularVelocity);
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
    if (accel.lengthSq() > 2500) accel.setLength(50);

    // Air/ground blends.
    const airborne = pose.airborne;
    const touchdown = !airborne && this.prevAirborne && !teleport;
    this.airW = damp(this.airW, airborne ? 1 : 0, airborne ? 6 : 12, dt);
    this.legAirW = damp(this.legAirW, airborne ? 1 : 0, airborne ? 7 : 22, dt);
    const groundW = 1 - this.airW;
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

    // Touchdown: plant the feet where they are and absorb the impact.
    if (touchdown) {
      const sink = Math.max(0, -this.prevVelY);
      this.dip.velocity -= clamp(sink, 0, 9) * 0.22 * (sh / 2.6);
      this.gaitCtx.standHeight = sh;
      this.gait.plantAt(this.footWorld, this.gaitCtx);
    }

    // Idle life: blinks, breathing, the odd wing shuffle and yawn.
    const idle = !airborne && pose.gait === 'idle' && pose.groundSpeed < 0.3;
    this.idleTime = idle ? this.idleTime + dt : 0;
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blink = 0.16;
      this.blinkTimer = 2.5 + this.rand() * 4;
    }
    this.blink = Math.max(0, this.blink - dt);
    const blinkAmt = this.blink > 0 ? Math.sin((this.blink / 0.16) * Math.PI) : 0;
    const breathRate = lerp(0.24, 1.05, fatigue) + (airborne ? 0.15 : 0);
    this.breathPhase = (this.breathPhase + breathRate * dt) % 1;
    const breath = Math.sin(this.breathPhase * Math.PI * 2);
    const breathAmp = 0.022 + 0.05 * fatigue;
    if (idle && this.idleTime > 2) {
      this.shuffleTimer -= dt;
      this.yawnTimer -= dt;
      if (this.shuffleTimer <= 0 && this.shuffleT < 0) {
        this.shuffleT = 0;
        this.shuffleTimer = 8 + this.rand() * 7;
      }
      if (this.yawnTimer <= 0 && this.yawnT < 0) {
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
    this.shuffle = this.shuffleT >= 0 ? Math.sin((this.shuffleT / 1.5) * Math.PI) ** 2 : 0;
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
      const gs = Math.hypot(c.velocity.x, c.velocity.z);
      const runSpeed = rig.props.breed === 'galewing' ? 5 : 5.5;
      c.runBlend = smoothstep(runSpeed * 0.7, runSpeed * 1.25, gs);
      c.moving = !takeoffCrouch && (gs > 0.35 || Math.abs(om.y) > 0.35);
      if (teleport) this.gait.reset(c);
      this.gait.update(c);
    }
    const runBlend = this.gaitCtx.runBlend;
    const gaitPhase = this.gait.phase;
    const moving = this.gaitCtx.moving && !airborne;
    const groundSpeed = moving ? Math.hypot(pose.velocity.x, pose.velocity.z) : 0;

    // --- Trunk -------------------------------------------------------------------------------------
    const heave = flap * this.airW * 0.04 * sh * -Math.cos(phase * Math.PI * 2);
    const gaitBob = moving ? -0.025 * sh * (1 + 2 * runBlend) * (0.5 - 0.5 * Math.cos(gaitPhase * Math.PI * 4)) : 0;
    const buffet = stall * this.airW;
    const dipV = this.dip.step(0, dt);
    this.rootOffset.set(
      buffet * 0.03 * sh * noise1(this.stallT * 9, 1),
      heave + gaitBob + dipV + breath * breathAmp * 0.08 * sh + buffet * 0.04 * sh * noise1(this.stallT * 8, 2),
      0,
    );
    const turnBend = clamp(om.y * (airborne ? 0.16 : 0.3), -0.22, 0.22);
    const gaitSway = moving ? 0.05 * (1 - runBlend * 0.5) * Math.sin(gaitPhase * Math.PI * 2) : 0;
    const spineYaw = this.spineYaw.step(turnBend + gaitSway, dt);
    const rootPitch = groundW * (-4 * DEG) + (moving ? -0.03 * runBlend * Math.sin(gaitPhase * Math.PI * 4) : 0) - dipV * 0.08;
    const rootRoll = buffet * 0.05 * noise1(this.stallT * 7, 3) + (moving ? 0.03 * Math.sin(gaitPhase * Math.PI * 2) * (1 - runBlend) : 0);
    this.setEuler(I.root, rootPitch, 0, rootRoll);
    const chestLift = -flap * this.airW * 0.05 * Math.sin(phase * Math.PI * 2);
    this.setEuler(I.spine, chestLift - flare * 0.06 * this.airW + (takeoffCrouch ? -0.08 * openAmt : 0), spineYaw * 0.6, 0);
    this.setEuler(I.chest, chestLift * 0.6 - flare * 0.04, spineYaw * 0.5, 0);
    this.breathScale = 1 + breath * breathAmp;
    this.local[I.breath].identity();
    this.fk(I.breath);
    this.setEuler(I.pelvis, flare * 0.05 * this.airW - tuck * 0.02, -spineYaw * 0.55, 0);

    // --- Neck & head -------------------------------------------------------------------------------
    const neckN = I.neck.length;
    this.toModel(pose.lookTarget, _v);
    _v.sub(this.modelP[I.head]);
    let lookYaw = Math.atan2(_v.x, _v.z);
    let lookPitch = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
    if (_v.lengthSq() < 1) {
      lookYaw = 0;
      lookPitch = 0;
    }
    const maxYaw = airborne ? 1.0 : 1.35;
    lookYaw = clamp(lookYaw, -maxYaw, maxYaw);
    lookPitch = clamp(lookPitch, -0.85, 0.7);
    // Yawn: head up and back; stall: looking down at what went wrong.
    lookPitch += yawn * 0.5 - buffet * 0.25 - fatigue * 0.12 * this.airW;
    const ly = this.lookYaw.step(lookYaw, dt);
    const lp = this.lookPitch.step(lookPitch, dt);
    const bankComp = -this.bank * this.airW;
    for (let i = 0; i < neckN; i++) {
      let pitch = lerp(NECK_FLIGHT[i], NECK_GROUND[i], groundW);
      pitch = lerp(pitch, NECK_TUCK[i], tuck);
      pitch = lerp(pitch, NECK_FLARE[i], flare * this.airW);
      pitch += fatigue * (2 + i * 0.4) * (1 - 0.4 * groundW);
      pitch *= DEG;
      // Hold the head steady against the heave and the gait bob.
      pitch += (heave + gaitBob) * 0.06 * (i < 3 ? 1 : -1);
      pitch += -lp * 0.35 * NECK_YAW_SHARE[i];
      pitch += breath * breathAmp * 0.2;
      const yaw = ly * NECK_YAW_SHARE[i] + (moving ? -gaitSway * 0.4 : 0);
      this.setEuler(I.neck[i], pitch, yaw, bankComp * 0.06);
    }
    // Head: aim at the (clamped, smoothed) look direction, level with the horizon.
    _v.set(Math.sin(ly) * Math.cos(lp), Math.sin(lp), Math.cos(ly) * Math.cos(lp));
    _v2.copy(UP).lerp(this.upM, 0.7 * this.airW + 0.35 * groundW).normalize();
    aimRotation(FWD, UP, _v, _v2, _q);
    // Small idle tilt and buffet shake.
    _e.set(buffet * 0.08 * noise1(this.stallT * 10, 4), 0, (idle ? 0.06 * noise1(this.time * 0.3, 5) : 0), 'YXZ');
    _q2.setFromEuler(_e);
    _q.multiply(_q2);
    this.setModel(I.head, _q);
    // Jaw: panting when tired, a gasp on takeoff, yawns.
    const takeoffAir = airborne && pose.gait === 'takeoff' ? 1 - smoothstep(0.2, 0.6, pose.gaitTime) : 0;
    const roar = Math.max(takeoffCrouch ? 0.35 * openAmt : 0, takeoffAir * 0.35);
    const jawT = Math.max(fatigue * (0.28 + 0.14 * breath), roar, yawn * 0.95, buffet * 0.2);
    this.setEuler(I.jaw, this.jaw.step(jawT, dt) * 0.62, 0, 0);
    const fanT = Math.max(roar * 2, yawn, flare * 0.5, buffet * 0.6, fatigue * 0.3) * (1 - 0.6 * smoothstep(20, 40, speed));
    const fanA = this.fan.step(fanT, dt);
    this.setEuler(I.fans[0], 0, -fanA * 1.1, -fanA * 0.15);
    this.setEuler(I.fans[1], 0, fanA * 1.1, fanA * 0.15);

    // --- Tail --------------------------------------------------------------------------------------
    this.updateTail(dt, pose, airborne, groundW, flare, tuck, buffet, idle, moving, gaitPhase, accel, teleport);

    // --- Wings -------------------------------------------------------------------------------------
    const asymBase = clamp(om.z * 0.55 - om.y * 0.35, -1, 1) * this.airW;
    for (let side = 0; side < 2; side++) {
      const wp = this.wingFK[side];
      // Flight pose.
      blendPose(GLIDE, TUCK, tuck, wp);
      blendPose(wp, FLARE, flare * (1 - tuck), wp);
      if (flap > 0.001) {
        flapPose(phase, fatigue, this.flapTmp);
        // Flaring beats reach forward.
        if (flare > 0) {
          this.flapTmp[W.humSw] += -16 * DEG * flare;
          this.flapTmp[W.humTw] += -14 * DEG * flare;
        }
        blendPose(wp, this.flapTmp, flap, wp);
      }
      const sgn = SIDE_SIGN[side];
      const bf = buffet * noise1(this.stallT * 9 + side * 7.3, 10 + side);
      const bt = buffet * noise1(this.stallT * 11 + side * 3.1, 20 + side);
      adjustPose(wp, this.gLoad, asymBase * sgn, bf + buffet * 0.4 * sgn * Math.sin(this.stallT * 1.7), bt, (1 - tuck) * (1 - flare * 0.5));
      // Ground pose (FK part): settle/shuffle, or raised for the takeoff.
      const groundFK = this.tmpPose;
      if (takeoffCrouch) blendPose(SETTLE, flapPose(0, 0, this.flapTmp), openAmt, groundFK);
      else blendPose(FOLDED, SETTLE, clamp01(openAmt * 1.4 + this.shuffle * 0.8), groundFK);
      blendPose(wp, groundFK, groundW, wp);
      this.applyWingFK(side, wp);
      // Ground IK: knuckles on the ground as front feet.
      const ikW = groundW * (1 - openAmt) * (1 - this.shuffle * 0.65);
      if (ikW > 0.001) this.applyWingIK(side, ikW, sh);
    }

    // --- Legs --------------------------------------------------------------------------------------
    const height = pose.groundY !== null ? pose.position.y - pose.groundY : Infinity;
    const approach = airborne && pose.velocity.y < 0.5 ? 1 - smoothstep(sh * 1.4, sh * 3.2, height) : 0;
    const reach = clamp01(Math.max(flare, approach * smoothstep(26, 14, speed)));
    const push = airborne && pose.gait === 'takeoff' ? 1 - smoothstep(0.15, 0.55, pose.gaitTime) : 0;
    const tuckLegs = clamp01(smoothstep(15, 24, speed) + tuck) * (1 - reach) * (1 - push);
    this.legSwing.step(clamp(-accel.dot(_v.copy(FWD).applyQuaternion(this.qW)) * 0.012, -0.4, 0.4), dt);
    for (let side = 0; side < 2; side++) {
      this.applyLegFK(side, tuckLegs, reach, push, fatigue);
      if (this.legAirW < 0.999) this.applyLegIK(side, 1 - this.legAirW, sh);
    }

    // Contact points for the next touchdown (hind: under the ball of the foot, fore: knuckle).
    for (let side = 0; side < 2; side++) {
      this.toWorld(this.modelP[I.legs[side].toes], this.footWorld[side]);
      this.toWorld(this.modelP[I.wings[side].claw], this.footWorld[2 + side]);
    }

    if (uniforms) {
      uniforms.uBlink.value = Math.max(blinkAmt, yawn * 0.6);
      uniforms.uFlutter.value = 0.012 * sh * smoothstep(8, 40, speed) * this.airW * (1 - tuck * 0.5) + buffet * 0.03;
      uniforms.uFlutterRate.value = 14 + speed * 0.9;
      uniforms.uRipple.value = 0.4 + 0.6 * smoothstep(5, 35, speed);
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
    br.scale.set(this.breathScale, this.breathScale, 1 + (this.breathScale - 1) * 0.3);
  }

  /** Model-space bone positions/rotations (after update), for tests and debugging. */
  boneModel(i: number, outP: Vector3, outQ?: Quaternion): Vector3 {
    if (outQ) outQ.copy(this.modelQ[i]);
    return outP.copy(this.modelP[i]);
  }

  // --- Wings -------------------------------------------------------------------------------------

  private applyWingFK(side: number, p: WingPose): void {
    const w = this.rig.idx.wings[side];
    const set = (bone: number, el: number, sw: number, tw: number) => {
      _e.set(tw, sw, el, 'ZYX');
      _q.setFromEuler(_e);
      if (side === 1) mirrorQuat(_q, _q);
      this.local[bone].copy(_q);
      this.fk(bone);
    };
    set(w.humerus, p[W.humEl], p[W.humSw], p[W.humTw]);
    set(w.forearm, p[W.foreEl], p[W.foreSw], p[W.foreTw]);
    set(w.hand, p[W.handEl], p[W.handSw], p[W.handTw]);
    set(w.claw, p[W.clawEl], p[W.clawSw], 0);
    for (let f = 0; f < 3; f++) {
      set(w.fingers[f][0], p[W.f0El + f * 3], p[W.f0Sw + f * 3], p[W.f0Tw + f * 3]);
      set(w.fingers[f][1], p[W.f0bEl + f * 2], p[W.f0bSw + f * 2], 0);
    }
  }

  /**
   * Folded stance: the wrist (with its thumb claws) is a front foot planted by the gait; humerus
   * + forearm reach it by two-bone IK with the elbow high and back, and the hand and fingers fold
   * back up along the forearm and past the elbow, so the wingtips rise behind the shoulders.
   * Blended over the FK pose by `weight`.
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
    // Pole: back and up, a little out, so the folded wing lies along the flank.
    _v4.set(0.3 * sx, 0.6, -0.75);
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
    // Hand folds back up along the forearm, a little outside it.
    const back = _handD.subVectors(E, Wt).normalize();
    _fd.copy(back).addScaledVector(LEFT, 0.22 * sx).addScaledVector(fwdG, -0.12).normalize();
    aimRotation(rest[2], UP, _fd, ref, _q);
    this.setModel(w.hand, _q, weight);
    // Fingers continue past the elbow, fanned back toward the tail; the wingtip finger rises most.
    for (let f = 0; f < 3; f++) {
      _fd.copy(back).addScaledVector(LEFT, (0.16 + 0.03 * f) * sx).addScaledVector(fwdG, -0.25 - 0.32 * f).addScaledVector(up, 0.1 - 0.06 * f).normalize();
      aimRotation(rest[3 + f], UP, _fd, ref, _q);
      this.setModel(w.fingers[f][0], _q, weight);
      this.local[w.fingers[f][1]].slerp(_qIdentity, weight);
      this.fk(w.fingers[f][1]);
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

  private applyLegIK(side: number, weight: number, sh: number): void {
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
    void sh;
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

    // Target curve per segment (radians): pitch (+ raises) and yaw (+ swings to the body's left).
    const t = this.time;
    const steer = clamp(om.y * (airborne ? -0.05 : -0.03), -0.06, 0.06);
    for (let i = 0; i < n; i++) {
      let p = lerp(TAIL_FLIGHT[i], TAIL_GROUND[i], groundW);
      p = lerp(p, TAIL_FLARE[i], flare * (1 - groundW));
      p *= 1 - tuck * 0.7;
      this.tailPitch[i] = p * DEG + (idle ? 0.02 * Math.sin(t * 0.9 - i * 0.4) : 0);
      const sway = (idle ? 0.045 : 0.015) * Math.sin(t * (idle ? 0.75 : 1.4) - i * 0.45) + (moving ? 0.05 * Math.sin(gaitPhase * Math.PI * 2 - i * 0.5) : 0);
      // Counter-steer: in a turn the tail swings to the outside; a stall makes it lash.
      const lash = buffet * 0.09 * Math.sin(this.stallT * 5 - i * 0.6);
      this.tailYaw[i] = sway + steer + lash;
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
      this.tailInit = true;
    } else {
      // Carry the chain with the body's translation; rotations and accelerations make it lag.
      const shift = _v4.subVectors(this.tailBase, this.tailBasePrev);
      for (let i = 0; i <= n; i++) {
        X[i].add(shift);
        Xp[i].add(shift);
      }
      this.tailBasePrev.copy(this.tailBase);
      const steps = Math.max(1, Math.min(10, Math.ceil(dt * 120)));
      const h = dt / steps;
      const grav = (airborne ? 1.2 : 6) * h * h;
      const inertia = 0.35 * h * h;
      const groundY = this.groundRef;
      const vel = pose.velocity;
      const speed = vel.length();
      const stream = airborne ? smoothstep(4, 20, speed) * 0.04 : 0;
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
          const gx = X[i - 1].x + d.x * this.tailLen[i - 1];
          const gy = X[i - 1].y + d.y * this.tailLen[i - 1];
          const gz = X[i - 1].z + d.z * this.tailLen[i - 1];
          X[i].x += (gx - X[i].x) * kStiff;
          X[i].y += (gy - X[i].y) * kStiff;
          X[i].z += (gz - X[i].z) * kStiff;
          if (stream > 0 && speed > 1) X[i].addScaledVector(vel, (-stream * this.tailLen[i - 1]) / speed);
          // Keep the segment length.
          _v5.subVectors(X[i], X[i - 1]);
          const len = _v5.length();
          if (len > 1e-6) X[i].copy(X[i - 1]).addScaledVector(_v5, this.tailLen[i - 1] / len);
          // Stay above the ground.
          const minY = groundY + 0.05 + 0.4 * rig.props.shape.tailBaseRadius * (1 - (i - 1) / n);
          if (!airborne && X[i].y < minY) X[i].y = minY;
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
    // Pitch axis = d × up (points to the left of a backward-pointing tail).
    _axis.crossVectors(d, up);
    if (_axis.lengthSq() < 1e-8) _axis.set(1, 0, 0);
    _axis.normalize();
    rotateAbout(d, _axis, pitch);
    _axis2.copy(up).addScaledVector(d, -up.dot(d)).normalize();
    rotateAbout(d, _axis2, -yaw);
    d.normalize();
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
void stroke;
void FOOT_COUNT;
