// Procedural animation for the rider. Two layers are computed and blended by the mount weight:
//
//   foot layer   — standing, walking/running (planted feet from gait.ts), idle life (breathing,
//                  weight shifts, glances), jump/fall/land, flailing, the wave, and the climbing
//                  and hopping halves of mount/dismount;
//   mount layer  — sitting the saddle: legs straddling the wyvern, hands on the grip, leaning into
//                  turns, flat in a dive, braced back on a flare, absorbing the wyvern's motion.
//
// Each layer produces channel values for the spine chain plus IK targets for hands and feet; the
// blend is applied to the rig, then legs and arms are solved with two-bone IK in world space.
// Everything happens in the "anchor" frame the Rider places the group at: on foot, upright at the
// nominal hip height above pose.position, facing pose.yaw; mounted, the saddle (hips at origin).

import { Bone, Euler, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import type { RiderPose } from '../../core/types';
import { B, type Rig } from './rig';
import { boneBasis, createTwoBoneResult, solveTwoBone } from './ik';
import { Gait, runBlend, type GroundFn } from './gait';
import { PLAYER_TUNING } from '../../player/tuning';

const P = PLAYER_TUNING;
const SIDES = [1, -1] as const;
/** Bone chains for the IK pass (module tables: no per-frame arrays). */
const LEG_BONES = [
  [B.thighL, B.shinL, B.footL, B.toeL],
  [B.thighR, B.shinR, B.footR, B.toeR],
] as const;
const ARM_BONES = [
  [B.clavL, B.upperArmL, B.foreArmL, B.handL, B.fingersL, B.fingers2L, B.thumbL],
  [B.clavR, B.upperArmR, B.foreArmR, B.handR, B.fingersR, B.fingers2R, B.thumbR],
] as const;

/** Anchor-space vs chest-space targets for the hands. */
const enum Space {
  Anchor = 0,
  Chest = 1,
}

export class LayerPose {
  hip = new Vector3();
  hipRot = new Vector3();
  spine = new Vector3();
  chest = new Vector3();
  neck = new Vector3();
  head = new Vector3();
  clav = [new Vector3(), new Vector3()];
  /** Ankle targets (anchor space). */
  foot = [new Vector3(), new Vector3()];
  /** Knee pole directions (anchor space). */
  knee = [new Vector3(0, 0, 1), new Vector3(0, 0, 1)];
  /** Foot orientation (anchor space). */
  footQ = [new Quaternion(), new Quaternion()];
  toe = [0, 0];
  /** Wrist targets, in `handSpace`. */
  hand = [new Vector3(), new Vector3()];
  elbow = [new Vector3(0, 0, -1), new Vector3(0, 0, -1)];
  handSpace: Space = Space.Chest;
  /** Hand orientation: local to the forearm (Chest space layers) or anchor space (Anchor). */
  handQ = [new Quaternion(), new Quaternion()];
  curl = [0.3, 0.3];
  thumb = [0.2, 0.2];
}

/** Cross-section of the mount's body under the seat (see wyvern/parts/saddle.ts SaddleFlank). */
export interface SaddleFlank {
  /** Centre height below the seat (negative). */
  cy: number;
  /** Half-width and upper half-height (m). */
  rx: number;
  ry: number;
  /** Superellipse exponent. */
  sq: number;
}

/** Half-width of the barrel at height y (anchor space); 0 above it. */
export function flankHalfWidth(f: SaddleFlank, y: number): number {
  const t = Math.abs(y - f.cy) / f.ry;
  if (t >= 1) return y > f.cy ? 0 : f.rx;
  return f.rx * Math.pow(1 - Math.pow(t, f.sq), 1 / f.sq);
}

/**
 * The lowest angle in [a0, a0 + maxLift] (radians, in the side plane: x out, y up) at which a
 * limb of length r from (px, py) ends outside the barrel by `clear`; bisection, since the
 * barrel's width changes with height. Returns a0 when it already clears.
 */
function lowestClearing(f: SaddleFlank, px: number, py: number, r: number, a0: number, maxLift: number, clear: number): number {
  if (outside(f, px, py, r, a0) >= clear) return a0;
  let lo = a0;
  let hi = a0 + maxLift;
  if (outside(f, px, py, r, hi) < clear) return hi;
  for (let k = 0; k < 7; k++) {
    const mid = 0.5 * (lo + hi);
    if (outside(f, px, py, r, mid) >= clear) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** How far outside the barrel the end of a limb at angle a ends up (m; negative inside). */
function outside(f: SaddleFlank, px: number, py: number, r: number, a: number): number {
  return px + r * Math.cos(a) - flankHalfWidth(f, py + r * Math.sin(a));
}

export interface AnimContext {
  /** 0 = on foot, 1 = in the saddle (posture blend). */
  mountW: number;
  /** World matrix of the anchor frame (the rider group). */
  anchor: Matrix4;
  /** Saddle body half-width (m) and grip point (anchor space) when mounted. */
  halfWidth: number;
  grip: Vector3;
  /** Tack tread centres in anchor space; null/missing keeps the original flank-fit fallback. */
  stirrups?: readonly [Vector3 | null, Vector3 | null];
  /**
   * The barrel under the saddle (anchor space), when the mount describes it: the shins wrap
   * around it instead of sinking into a broad back. Null: only `halfWidth` is known.
   */
  flank: SaddleFlank | null;
  /** Smoothed ride motion (anchor space): hips offset from the wyvern's movement. */
  rideOffset: Vector3;
  ridePitch: number;
  ground: GroundFn;
  /** Was the rider teleported this frame (reset feet)? */
  snapped: boolean;
  /** Anchor height above pose.position on foot. */
  standHeight: number;
}

// Scratch.
const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _v4 = new Vector3();
const _v5 = new Vector3();
const _q4 = new Quaternion();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _q3 = new Quaternion();
const _e = new Euler(0, 0, 0, 'YXZ');
const _mInv = new Matrix4();
const _ik = createTwoBoneResult();
const _anchorQ = new Quaternion();
const UP = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const damp = (a: number, b: number, rate: number, dt: number) => a + (b - a) * (1 - Math.exp(-rate * dt));
const bump = (t: number, a: number, b: number, c: number, d: number) => smooth(a, b, t) * (1 - smooth(c, d, t));

function setEuler(q: Quaternion, v: Vector3): Quaternion {
  _e.set(v.x, v.y, v.z, 'YXZ');
  return q.setFromEuler(_e);
}

/**
 * Chest-space wrist target for a "forward kinematics" arm: swing α forward (+) / back, abduct β
 * out to the side, bend the elbow ε. Writes the wrist position and an elbow pole.
 */
function armFK(shoulder: Vector3, side: number, alpha: number, beta: number, eps: number, l1: number, l2: number, outHand: Vector3, outPole: Vector3): void {
  const u = _v.set(side * Math.sin(beta), -Math.cos(beta) * Math.cos(alpha), Math.cos(beta) * Math.sin(alpha)).normalize();
  // Forearm bends toward "forward" relative to the upper arm (or up when the arm points forward).
  const ref = _v2.set(0, 0, 1);
  if (Math.abs(u.dot(ref)) > 0.92) ref.set(0, 1, 0);
  const perp = _v3.copy(ref).addScaledVector(u, -ref.dot(u)).normalize();
  outHand.copy(shoulder).addScaledVector(u, l1).addScaledVector(u, l2 * Math.cos(eps)).addScaledVector(perp, l2 * Math.sin(eps));
  outPole.copy(perp).negate().addScaledVector(X, side * 0.35).normalize();
}

export class RiderAnimator {
  private rig: Rig;
  private bones: Bone[];
  readonly gait: Gait;
  private LF = new LayerPose();
  private LM = new LayerPose();
  private U = new LayerPose();
  time = 0;
  // Smoothed state.
  private airW = 0;
  private freefallW = 0;
  private flailW = 0;
  private waveW = 0;
  private landKick = 0;
  private wasAir = false;
  private prevAction = '';
  private yawRate = 0;
  private prevYaw = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private glanceYaw = 0;
  private glancePitch = 0;
  private glanceTimer = 2;
  private accel = new Vector3();
  private prevVel = new Vector3();
  private initialized = false;
  private footActive = true;
  // Bind lengths.
  private readonly lens: { thigh: number; shin: number; upper: number; fore: number; ankleY: number; ballZ: number; ballY: number };
  private readonly shoulderChest: [Vector3, Vector3];
  private readonly thighHip: [Vector3, Vector3];

  constructor(rig: Rig) {
    this.rig = rig;
    this.bones = rig.bones;
    const d = rig.dims;
    const bp = rig.bindPos;
    this.lens = {
      thigh: bp[B.shinL].distanceTo(bp[B.thighL]),
      shin: bp[B.footL].distanceTo(bp[B.shinL]),
      upper: bp[B.foreArmL].distanceTo(bp[B.upperArmL]),
      fore: bp[B.handL].distanceTo(bp[B.foreArmL]),
      ankleY: bp[B.footL].y,
      ballZ: bp[B.toeL].z - bp[B.footL].z,
      ballY: bp[B.toeL].y,
    };
    this.shoulderChest = [bp[B.upperArmL].clone().sub(bp[B.chest]), bp[B.upperArmR].clone().sub(bp[B.chest])];
    this.thighHip = [bp[B.thighL].clone().sub(bp[B.hips]), bp[B.thighR].clone().sub(bp[B.hips])];
    this.gait = new Gait({ stanceWidth: 0.1 * d.w + 0.01, scale: d.h });
    this.glanceTimer = 1.5;
  }

  /** Swap in a rebuilt rig (new look) without losing the gait or smoothing state. */
  setRig(rig: Rig): void {
    this.rig = rig;
    this.bones = rig.bones;
    // A build change replaces the bind pose as well as the bones. Keep the existing smoothing
    // and hand behavior, but solve feet with the new character's actual leg lengths and offsets.
    const bp = rig.bindPos;
    this.lens.thigh = bp[B.shinL].distanceTo(bp[B.thighL]);
    this.lens.shin = bp[B.footL].distanceTo(bp[B.shinL]);
    this.lens.ankleY = bp[B.footL].y;
    this.lens.ballZ = bp[B.toeL].z - bp[B.footL].z;
    this.lens.ballY = bp[B.toeL].y;
    this.thighHip[0].copy(bp[B.thighL]).sub(bp[B.hips]);
    this.thighHip[1].copy(bp[B.thighR]).sub(bp[B.hips]);
  }

  update(dt: number, pose: RiderPose, ctx: AnimContext): void {
    this.time += dt;
    const anchor = ctx.anchor;
    _anchorQ.setFromRotationMatrix(anchor);
    _mInv.copy(anchor).invert();
    // Velocity/acceleration in the anchor frame.
    this.accel.subVectors(pose.velocity, this.prevVel).divideScalar(Math.max(dt, 1e-3));
    if (this.accel.lengthSq() > 900) this.accel.setLength(30);
    this.prevVel.copy(pose.velocity);
    const dy = MathUtils.euclideanModulo(pose.yaw - this.prevYaw + Math.PI, Math.PI * 2) - Math.PI;
    this.prevYaw = pose.yaw;
    this.yawRate = damp(this.yawRate, Math.abs(dy) < 1 ? dy / Math.max(dt, 1e-3) : 0, 8, dt);
    if (!this.initialized || ctx.snapped) {
      this.gait.reset(pose.position, pose.yaw, ctx.ground);
      this.freefallW = pose.freefallTilt !== undefined ? 1 : 0;
      this.initialized = true;
    }

    const wM = ctx.mountW;
    if (wM < 0.999) {
      if (!this.footActive) {
        // Coming back to the ground layer after riding: its state is stale (feet were planted
        // wherever the rider mounted), so start it fresh from here.
        this.gait.reset(pose.position, pose.yaw, ctx.ground);
        const air = pose.action === 'jump' || pose.action === 'fall' || pose.action === 'dismount';
        this.airW = air ? 1 : 0;
        this.wasAir = air;
        this.flailW = 0;
        this.freefallW = 0;
        this.landKick = 0;
      }
      this.footLayer(dt, pose, ctx, this.LF);
      // Supported feet and boarding retain their established pose ownership.
      if (pose.action !== 'fall' && pose.action !== 'jump') this.freefallW = 0;
      else this.freefallW = damp(this.freefallW, pose.freefallTilt !== undefined ? 1 : 0, 10, dt);
      if (this.freefallW > .001) {
        const L = this.LF, d = this.rig.dims, w = this.freefallW;
        const dive = (Math.max(-1, Math.min(1, pose.freefallTilt ?? 0)) + 1) * .5;
        const shape = dive * dive * (3 - 2 * dive);
        const pitch = MathUtils.lerp(Math.PI / 2 - .08, Math.PI - .08, shape), flutter = Math.sin(this.time * 4) * .04;
        const steer = pose.freefallSteer ?? 0;
        L.hipRot.x = MathUtils.lerp(L.hipRot.x, pitch + .12 * (pose.airBoost ?? 0), w);
        L.hipRot.z = MathUtils.lerp(L.hipRot.z, -.36 * steer, w);
        L.spine.x = MathUtils.lerp(L.spine.x, .06, w); L.chest.x = MathUtils.lerp(L.chest.x, .04, w);
        L.head.x = MathUtils.lerp(L.head.x, -.18, w);
        _q.setFromAxisAngle(X, pitch);
        for (let i = 0; i < 2; i++) {
          const side = SIDES[i];
          // Open, slightly bent arms for braking; streamline beside the torso for diving.
          const spread = d.shoulderHalfWidth + .985 * (d.upperArm + d.foreArm);
          _v.set(side * MathUtils.lerp(spread, .27 * d.w, dive),
            MathUtils.lerp(d.chestLen * .98, -.27 * d.h, dive) + (flutter + side * steer * .08) * d.h,
            MathUtils.lerp(-.012, .1 * d.h, dive));
          L.hand[i].lerp(_v, w); L.handQ[i].slerp(_q2.identity(), w);
          L.curl[i] = MathUtils.lerp(L.curl[i], .15, w); L.thumb[i] = .2;
          _v.set(side * (.22 - .1 * dive) * d.w, -.74 * d.h, -.12 * d.h).applyQuaternion(_q).add(L.hip);
          L.foot[i].lerp(_v, w); L.footQ[i].slerp(_q, w);
          _v.set(side * .12, 0, 1).applyQuaternion(_q); L.knee[i].lerp(_v, w).normalize();
        }
      }
      if (pose.equipment === 'tether' || pose.lanceMotion) {
        // Fire from the left forearm. The free right hand retains its natural/freefall pose.
        const L = this.LF, d = this.rig.dims;
        const t = Math.min(1, Math.max(0, pose.lanceMotionT ?? 0));
        const cast = pose.lanceMotion === 'cast' ? Math.sin(Math.PI * t) : 0;
        const recover = pose.lanceMotion === 'recover' ? Math.sin(Math.PI * t) : 0;
        const weight = pose.equipment === 'tether' ? 1 : Math.max(cast, recover);
        const tension = pose.lineTension ?? 0;
        _v.set(.25 * d.w, (-.05 + .12 * cast + .08 * tension) * d.h, (.37 + .12 * cast - .12 * recover) * d.h);
        L.hand[0].lerp(_v, weight); L.curl[0] = MathUtils.lerp(L.curl[0], .3, weight);
        L.thumb[0] = MathUtils.lerp(L.thumb[0], .4, weight);
        L.chest.x += .035 * tension;
      }
    }
    this.footActive = wM < 0.999;
    if (wM > 0.001) this.mountLayer(dt, pose, ctx, this.LM);
    this.blendAndApply(wM, ctx);
    this.prevAction = pose.action;
  }

  // --- Foot layer ---------------------------------------------------------------------------

  private footLayer(dt: number, pose: RiderPose, ctx: AnimContext, L: LayerPose): void {
    const a = pose.action;
    const t = pose.actionTime;
    const v = pose.velocity;
    const speed = Math.sqrt(v.x * v.x + v.z * v.z);
    const d = this.rig.dims;
    const time = this.time;

    // Phase weights.
    const mountT = a === 'mount' ? t / P.mountTime : -1;
    const dismT = a === 'dismount' ? t / P.dismountTime : -1;
    const hopMount = mountT >= 0 ? bump(mountT, 0.12, 0.3, 0.85, 1.2) : 0;
    const hopDis = dismT >= 0 ? 1 - smooth(0.72, 0.98, dismT) : 0;
    const airborne = a === 'jump' || a === 'fall' || hopMount > 0.5 || hopDis > 0.5;
    this.airW = damp(this.airW, airborne ? 1 : 0, airborne ? 14 : 22, dt);
    const flailing = pose.freefallTilt === undefined && a === 'fall' && (t > 0.45 || v.y < -9);
    this.flailW = damp(this.flailW, flailing ? 1 : 0, flailing ? 2.5 : 8, dt);
    const waveT = a === 'wave' ? Math.min(1, t / 0.22) * Math.min(1, Math.max(0, (P.waveTime - t) / 0.3)) : 0;
    this.waveW = damp(this.waveW, waveT, 14, dt);
    if (this.wasAir && !airborne) {
      // Touchdown: plant where the feet are and absorb.
      this.gait.plantAt([this.footWorld(L, 0, _v.clone()), this.footWorld(L, 1, _v2.clone())], ctx.ground, pose.yaw);
      const impact = Math.min(1, Math.max(0.35, -this.prevVelY / 9));
      this.landKick = Math.max(this.landKick, impact);
    }
    // A hard landing: crouch deep and rise over the land action.
    if (a === 'land') this.landKick = Math.max(this.landKick, 0.95 * (1 - smooth(0.05, 0.42, t)));
    this.wasAir = airborne;
    this.prevVelY = v.y;
    this.landKick = Math.max(0, this.landKick - dt * 2.6);
    const kick = Math.sin(Math.min(1, this.landKick) * Math.PI * 0.5);

    // Gait (feet planted in the world).
    if (!airborne) this.gait.update(dt, pose.position, v, pose.yaw, ctx.ground);
    const rb = runBlend(this.gait.speed);
    const moveK = smooth(0.2, 1.2, this.gait.speed);
    const g = this.gait;

    // --- Hips and spine ---
    const breath = Math.sin(time * 1.7);
    const idleK = (1 - moveK) * (1 - this.airW);
    const shift = Math.sin(time * 0.53) * 0.6 + Math.sin(time * 0.21 + 1) * 0.4;
    // Bob: walking vaults over the stance leg, running compresses into it.
    let swingSin = 0;
    let stanceSin = 0;
    for (const f of g.feet) {
      if (!f.planted) swingSin = Math.max(swingSin, Math.sin(Math.PI * f.swing));
      else if (f.stance > 0) stanceSin = Math.max(stanceSin, Math.sin(Math.PI * f.stance));
    }
    const bob = moveK * ((1 - rb) * 0.012 * (swingSin - 0.6) + rb * (0.04 * (0.35 - stanceSin)));
    // Forwardness of each foot (anchor z) drives pelvis yaw and the arm swing.
    const fz = [0, 0];
    for (let i = 0; i < 2; i++) {
      this.toAnchor(g.feet[i].pos, _v);
      fz[i] = _v.z;
    }
    const strideK = Math.max(0.15, 0.6 * Math.min(1, this.gait.speed / 3));
    const swingL = Math.max(-1, Math.min(1, fz[1] / strideK)); // right foot forward → left arm forward
    const swingR = Math.max(-1, Math.min(1, fz[0] / strideK));
    const lean = Math.max(-0.35, Math.min(0.35, -this.yawRate * speed * 0.035));
    const accelF = this.accel.x * Math.sin(pose.yaw) + this.accel.z * Math.cos(pose.yaw);
    L.hip.set(idleK * shift * 0.024 * d.w - lean * 0.05, -0.028 * d.h + bob - kick * 0.2 + idleK * 0.003 * breath, 0);
    L.hipRot.set(0.02 + 0.08 * rb * moveK, -(fz[0] - fz[1]) * 0.22, -idleK * shift * 0.05 + lean * 0.4);
    L.spine.set(0.01 + 0.03 * moveK + 0.07 * rb * moveK + kick * 0.18 + Math.max(-0.1, Math.min(0.12, accelF * 0.012)), -L.hipRot.y * 0.45, lean * 0.2);
    L.chest.set(0.015 * breath * idleK + 0.03 * rb * moveK, -L.hipRot.y * 0.7, -L.hipRot.z * 0.4);
    L.clav[0].set(0, 0, 0.012 * breath * idleK);
    L.clav[1].set(0, 0, -0.012 * breath * idleK);

    // Look: glances when idle, ahead when moving, into turns.
    this.glanceTimer -= dt;
    if (this.glanceTimer <= 0) {
      const r = Math.sin(time * 12.9898) * 43758.5453;
      const rnd = r - Math.floor(r);
      this.glanceTimer = 1.8 + rnd * 3.5;
      const big = rnd > 0.55;
      this.glanceYaw = big ? (rnd > 0.78 ? 1 : -1) * (0.45 + rnd * 0.4) : (rnd - 0.27) * 0.5;
      this.glancePitch = rnd > 0.9 ? 0.35 : (rnd - 0.5) * 0.15;
    }
    const gy = idleK > 0.5 ? this.glanceYaw : -this.yawRate * 0.12;
    const gp = idleK > 0.5 ? this.glancePitch : 0.05 * moveK;
    this.lookYaw = damp(this.lookYaw, gy, 5, dt);
    this.lookPitch = damp(this.lookPitch, gp, 5, dt);
    L.neck.set(this.lookPitch * 0.4 - L.spine.x * 0.3, this.lookYaw * 0.4, 0);
    L.head.set(this.lookPitch * 0.6 - L.spine.x * 0.4 - kick * 0.1, this.lookYaw * 0.6, -lean * 0.3);

    // --- Legs: planted gait feet, blended toward body-relative air poses ---
    const ballZ = this.lens.ballZ;
    for (let i = 0; i < 2; i++) {
      const f = g.feet[i];
      const side = SIDES[i];
      // Ground poses (anchor space).
      this.toAnchor(f.pos, _v);
      const lift = f.lift;
      const pitch = f.pitch;
      // Ankle above the contact point; pitched about the ball (heel up) or the heel (toes up).
      const target = L.foot[i];
      const ay = this.lens.ankleY;
      if (pitch >= 0) {
        // Heel up: rotate the ankle about the ball of the foot, which stays on the ground.
        const yb = ay - this.lens.ballY;
        const zb = -ballZ;
        target.set(
          _v.x,
          _v.y + lift + this.lens.ballY + yb * Math.cos(pitch) - zb * Math.sin(pitch),
          _v.z + ballZ + yb * Math.sin(pitch) + zb * Math.cos(pitch),
        );
      } else {
        // Toes up: rotate about the heel.
        const heel = 0.05;
        target.set(_v.x, _v.y + lift + ay * Math.cos(pitch) - heel * Math.sin(pitch), _v.z - heel + ay * Math.sin(pitch) + heel * Math.cos(pitch));
      }
      // Planted feet keep their world yaw; express it relative to the anchor.
      L.footQ[i].setFromAxisAngle(X, pitch);
      L.toe[i] = f.planted && pitch > 0 ? -pitch * 0.9 : 0;
      L.knee[i].set(side * 0.12, 0, 1).normalize();

      // Air pose (anchor space).
      const air = this.airW;
      if (air > 0.001 || this.flailW > 0.001) {
        const asc = a === 'jump' ? smooth(0.0, 0.12, t) * (1 - smooth(0.25, 0.5, t)) : 0;
        const reachDown = a === 'fall' ? smooth(0, 0.25, t) * (1 - this.flailW) : 0;
        // Default airborne: knees up a little, feet under the hips.
        _v2.set(side * 0.11 * d.w, -0.78 * d.h + 0.18 * asc - 0.07 * reachDown, 0.04 + 0.06 * asc);
        if (this.flailW > 0.001) {
          const w = time * 7.5 + (side > 0 ? 0 : Math.PI);
          _v3.set(side * 0.14 * d.w, -0.68 * d.h + 0.16 * Math.sin(w), 0.05 + 0.16 * Math.cos(w));
          _v2.lerp(_v3, this.flailW);
        }
        if (hopMount > 0) {
          // Swing the outside leg wide and high, push off with the other.
          const swingLeg = side === this.mountSide;
          _v3.set(swingLeg ? side * 0.48 * d.w : side * 0.1, swingLeg ? -0.36 * d.h : -0.84 * d.h, swingLeg ? 0.08 : -0.06);
          _v2.lerp(_v3, hopMount);
        }
        if (hopDis > 0) {
          const over = bump(dismT, -0.1, 0.05, 0.3, 0.5);
          const swingLeg = side === -this.dismountSide;
          _v3.set(side * (swingLeg ? 0.42 * over + 0.12 : 0.12) * d.w, (-0.62 - 0.22 * smooth(0.3, 0.75, dismT)) * d.h + (swingLeg ? 0.25 * over : 0), 0.05 - 0.08 * over);
          _v2.lerp(_v3, hopDis);
        }
        target.lerp(_v2, air);
        _q.setFromAxisAngle(X, 0.35 + 0.25 * this.flailW);
        L.footQ[i].slerp(_q, air);
        L.toe[i] *= 1 - air;
      }
    }
    // Keep both feet within reach: lower the hips as far as the farther foot needs (the natural
    // dip at double support, and stepping down slopes).
    {
      _q.setFromEuler(_e.set(L.hipRot.x, L.hipRot.y, L.hipRot.z, 'YXZ'));
      const reach = (this.lens.thigh + this.lens.shin) * 0.99;
      let maxY = Infinity;
      for (let i = 0; i < 2; i++) {
        const hj = _v.copy(this.thighHip[i]).applyQuaternion(_q).add(L.hip);
        const ft = L.foot[i];
        // Only feet on the ground pull the hips down; a swinging foot just tucks.
        if (!g.feet[i].planted && g.feet[i].lift > 0.02) continue;
        const hzx = ft.x - hj.x;
        const hzz = ft.z - hj.z;
        const hz = Math.sqrt(hzx * hzx + hzz * hzz);
        if (hz >= reach) continue;
        const yMax = ft.y + Math.sqrt(reach * reach - hz * hz) - (hj.y - L.hip.y);
        maxY = Math.min(maxY, yMax);
      }
      if (L.hip.y > maxY) {
        // Soft limit so the dip has no corner.
        const over = L.hip.y - maxY;
        L.hip.y -= over * (1 - 0.35 * Math.exp(-over / 0.02));
      }
    }
    // The planted feet's yaw relative to the anchor (they don't turn with the body until lifted).
    for (let i = 0; i < 2; i++) {
      const f = g.feet[i];
      const rel = MathUtils.euclideanModulo(f.yaw - pose.yaw + Math.PI, Math.PI * 2) - Math.PI;
      _q.setFromAxisAngle(UP, rel * (1 - this.airW) + SIDES[i] * 0.08);
      L.footQ[i].premultiply(_q);
    }

    // --- Arms (chest space FK through IK) ---
    L.handSpace = Space.Chest;
    const l1 = this.lens.upper;
    const l2 = this.lens.fore;
    for (let i = 0; i < 2; i++) {
      const side = SIDES[i];
      const sw = i === 0 ? swingL : swingR;
      // Idle hang + locomotion swing.
      let alpha = 0.05 + moveK * sw * (0.32 + 0.5 * rb) + 0.05 * moveK * rb;
      let beta = 0.13 + 0.06 * rb * moveK + idleK * 0.02 * Math.sin(time * 0.8 + i);
      let eps = 0.22 + moveK * (0.06 + 1.15 * rb) + Math.max(0, sw) * moveK * (0.12 + 0.2 * rb);
      let curl = 0.35 + 0.55 * rb * moveK;
      // Jump: arms up and forward; landing: forward for balance.
      const jumpK = a === 'jump' ? 1 : a === 'fall' ? 1 - this.flailW : 0;
      alpha = MathUtils.lerp(alpha, 0.75, jumpK * this.airW);
      beta = MathUtils.lerp(beta, 0.42, jumpK * this.airW);
      eps = MathUtils.lerp(eps, 0.7, jumpK * this.airW);
      alpha = MathUtils.lerp(alpha, 0.55, kick);
      beta = MathUtils.lerp(beta, 0.3, kick);
      // Flail: windmilling arms.
      if (this.flailW > 0.001) {
        const w = time * 6.8 + (side > 0 ? 0 : Math.PI * 0.8);
        alpha = MathUtils.lerp(alpha, 1.5 + 1.3 * Math.sin(w), this.flailW);
        beta = MathUtils.lerp(beta, 0.85 + 0.35 * Math.cos(w * 1.3), this.flailW);
        eps = MathUtils.lerp(eps, 0.45 + 0.3 * Math.sin(w * 0.7), this.flailW);
        curl = MathUtils.lerp(curl, 0.1, this.flailW);
      }
      // Wave: both arms high, swaying together.
      if (this.waveW > 0.001) {
        const w = Math.sin(time * 2 * Math.PI * 1.9);
        alpha = MathUtils.lerp(alpha, 2.6 - 0.12 * w * side, this.waveW);
        beta = MathUtils.lerp(beta, 0.36 + 0.2 * w * side, this.waveW);
        eps = MathUtils.lerp(eps, 0.4 + 0.25 * Math.max(0, w * side), this.waveW);
        curl = MathUtils.lerp(curl, 0.05, this.waveW);
      }
      // Mount: reach up toward the saddle; dismount: arms out for balance.
      if (mountT >= 0) {
        const reach = bump(mountT, -0.1, 0.12, 0.6, 0.9);
        alpha = MathUtils.lerp(alpha, 1.75, reach);
        beta = MathUtils.lerp(beta, 0.2 + (side === this.mountSide ? 0.25 : 0), reach);
        eps = MathUtils.lerp(eps, 0.35, reach);
      }
      if (dismT >= 0) {
        const out = bump(dismT, 0.1, 0.35, 0.8, 1.05);
        alpha = MathUtils.lerp(alpha, 0.5, out);
        beta = MathUtils.lerp(beta, 0.75, out);
        eps = MathUtils.lerp(eps, 0.4, out);
      }
      armFK(this.shoulderChest[i], side, alpha, beta, eps, l1, l2, L.hand[i], L.elbow[i]);
      // Wrist: relaxed, slightly flexed; a little curl with the swing.
      _e.set(-0.08 - 0.15 * eps * 0.3, 0, side * 0.05, 'YXZ');
      L.handQ[i].setFromEuler(_e);
      L.curl[i] = curl;
      L.thumb[i] = 0.25 + curl * 0.4;
    }

    // Mount/dismount body: crouch to spring, curl up in the hop.
    if (mountT >= 0) {
      const crouch = bump(mountT, -0.05, 0.12, 0.18, 0.32);
      L.hip.y -= 0.13 * crouch;
      L.spine.x += 0.25 * crouch + 0.2 * hopMount;
      L.hipRot.z += this.mountSide * -0.25 * hopMount;
    }
    if (dismT >= 0) {
      L.spine.x += 0.15 * hopDis;
      L.hipRot.y += this.dismountSide * 0.4 * bump(dismT, -0.1, 0.1, 0.35, 0.6);
    }
    // Wave: up on the toes a touch, head up.
    L.hip.y += 0.015 * this.waveW;
    L.head.x -= 0.25 * this.waveW;
    L.spine.x -= 0.08 * this.waveW;
    // Flail: body arches, head looks down.
    L.spine.x -= 0.25 * this.flailW;
    L.head.x += 0.35 * this.flailW;
  }

  private prevVelY = 0;
  /** Which side the saddle is on while mounting (+1 left): that leg swings over. */
  mountSide = -1;
  /** Which side the rider hops off to (+1 left). */
  dismountSide = 1;

  private footWorld(L: LayerPose, i: number, out: Vector3): Vector3 {
    out.copy(L.foot[i]).applyMatrix4(this.anchorM);
    out.y -= this.lens.ankleY;
    return out;
  }

  private anchorM = new Matrix4();

  private toAnchor(world: Vector3, out: Vector3): Vector3 {
    return out.copy(world).applyMatrix4(_mInv);
  }

  // --- Mount layer --------------------------------------------------------------------------

  private mountLayer(dt: number, pose: RiderPose, ctx: AnimContext, L: LayerPose): void {
    const crouch = MathUtils.clamp(pose.crouch, 0, 1);
    const brace = MathUtils.clamp(pose.brace, 0, 1);
    const lean = MathUtils.clamp(pose.lean, -1, 1);
    const time = this.time;
    const d = this.rig.dims;
    const hw = ctx.halfWidth;
    const breath = Math.sin(time * 1.9);
    const ro = ctx.rideOffset;

    // Keep the seated pelvis just above the cushion; hands and boots retain their IK contacts.
    L.hip.set(-lean * 0.04 + ro.x, 0.01 + 0.045 * crouch - 0.01 * brace + ro.y, -0.07 * crouch + 0.02 * brace + ro.z);
    L.hipRot.set(0.1 + 0.42 * crouch - 0.32 * brace + ctx.ridePitch * 0.5, 0, lean * 0.2);
    L.spine.set(0.05 + 0.36 * crouch - 0.14 * brace + ctx.ridePitch * 0.3, -lean * 0.05, lean * 0.14);
    L.chest.set(0.03 + 0.3 * crouch - 0.1 * brace + 0.01 * breath, -lean * 0.05, lean * 0.1);
    const pitchSum = L.hipRot.x + L.spine.x + L.chest.x;
    // Looking ahead whatever the torso does; into the turn a little; glancing when calm.
    const calm = (1 - crouch) * (1 - brace) * (1 - Math.abs(lean));
    const r = Math.sin(Math.floor(time / 3.1) * 12.9898) * 43758.5453;
    const glance = calm * (r - Math.floor(r) - 0.5) * 0.9 * (Math.abs(pose.velocity.length()) < 25 ? 1 : 0.2);
    this.mountLook = damp(this.mountLook, glance + lean * 0.35, 3.5, dt);
    L.neck.set(-pitchSum * 0.42, this.mountLook * 0.4, -lean * 0.12);
    L.head.set(-pitchSum * 0.42 - 0.05 * brace, this.mountLook * 0.6, -lean * 0.22);
    L.clav[0].set(0, 0.06 * crouch, 0.04 * crouch);
    L.clav[1].set(0, -0.06 * crouch, -0.04 * crouch);

    // Legs straddle the body: knees on its curve at the thigh's reach, shins down its flank.
    _q.setFromEuler(_e.set(L.hipRot.x, L.hipRot.y, L.hipRot.z, 'YXZ'));
    for (let i = 0; i < 2; i++) {
      const side = SIDES[i];
      const H = _v.copy(this.thighHip[i]).applyQuaternion(_q).add(L.hip);
      const cy = -0.1 - hw;
      const r2 = hw + 0.075 * d.g;
      const r1 = this.lens.thigh * 0.985;
      // 2D circle intersection in the side plane (x outward, y up).
      const hx = Math.abs(H.x);
      const dx = -hx;
      const dyy = cy - H.y;
      const dist = Math.sqrt(dx * dx + dyy * dyy);
      let kx: number;
      let ky: number;
      if (dist < r1 + r2 && dist > Math.abs(r1 - r2) && hw > 0.05) {
        const aa = (r1 * r1 - r2 * r2 + dist * dist) / (2 * dist);
        const hh = Math.sqrt(Math.max(0, r1 * r1 - aa * aa));
        const ux = dx / dist;
        const uy = dyy / dist;
        // Outer solution (perpendicular pointing outward).
        const px = hx + aa * ux;
        const py = H.y + aa * uy;
        kx = px + hh * -uy;
        ky = py + hh * ux;
        if (kx < hx) {
          kx = px - hh * -uy;
          ky = py - hh * ux;
        }
      } else {
        kx = hx + 0.22;
        ky = H.y - 0.33;
      }
      // Tighter, higher knees in the crouch (jockey), legs forward when bracing.
      ky += 0.06 * crouch;
      const kz = H.z + 0.12 + 0.04 * crouch + 0.02 * brace;
      // On a broad barrel the knee rides on the saddle flap, not inside the ribs: swing the thigh
      // out (about the hip, keeping its length) until the knee clears the body.
      const fl = ctx.flank;
      if (fl) {
        // Raise the thigh just enough (the lowest angle whose knee clears, by bisection), at
        // most ~48 degrees.
        const clear = 0.05 * d.g;
        const ax = kx - hx;
        const ay = ky - H.y;
        const r = Math.sqrt(ax * ax + ay * ay);
        const a = lowestClearing(fl, hx, H.y, r, Math.atan2(ay, ax), 0.84, clear);
        kx = hx + r * Math.cos(a);
        ky = H.y + r * Math.sin(a);
      }
      const knee = _v2.set(side * kx, ky, kz);
      // Shin along the flank: tangent of the body curve, blended toward straight down.
      let tx = ky - cy;
      let ty = -kx;
      const tl = Math.sqrt(tx * tx + ty * ty) || 1;
      tx /= tl;
      ty /= tl;
      let sxo = tx * 0.65;
      let syo = ty * 0.65 - 0.35;
      const szo = -0.62 - 0.5 * crouch + 0.62 * brace;
      if (fl) {
        // Wrap the shin around the barrel: turn it outward (in the side plane) just enough that
        // the ankle clears the ribs, so the lower legs hug the flank instead of sinking into it.
        const clear = 0.07 * d.g;
        const rho = Math.sqrt(sxo * sxo + syo * syo);
        const R = (this.lens.shin * 0.99 * rho) / (Math.sqrt(rho * rho + szo * szo) || 1);
        const a = lowestClearing(fl, kx, ky, R, Math.atan2(syo, sxo), 1.12, clear);
        sxo = rho * Math.cos(a);
        syo = rho * Math.sin(a);
      }
      const shinDir = _v3.set(side * sxo, syo, szo).normalize();
      L.foot[i].copy(knee).addScaledVector(shinDir, this.lens.shin * 0.99);
      // Pole: from the hip/ankle midpoint toward the knee.
      L.knee[i].copy(knee).sub(_v.add(L.foot[i]).multiplyScalar(0.5)).normalize();
      _e.set(0.5 + 0.35 * crouch - 0.4 * brace, side * 0.12, side * -0.25, 'YXZ');
      L.footQ[i].setFromEuler(_e);
      const tread = ctx.stirrups?.[i];
      if (tread) {
        // The hold supports the boot's sole under the ball, not the ankle bone. Keep a modest
        // toes-down ankle attitude and bend forward over the supported tread. Lean/brace move
        // the hips around this contact rather than swinging the boot away from its support.
        L.footQ[i].setFromEuler(_e.set(0.28, side * 0.08, 0, 'YXZ'));
        const ballZ = d.footLen * 0.32;
        // buildFoot models its sole at bind-space y=0. The actual ankle bind height is not
        // dims.ankleY. The tack hold is the rod centre; its 18 mm radius is defined by the
        // stirrup brass() call in wyvern/parts/saddle.ts. Support the sole on its upper surface.
        _v3.set(-side * 0.004 * ballZ / 0.2, -this.lens.ankleY, ballZ).applyQuaternion(L.footQ[i]);
        L.foot[i].copy(tread).sub(_v3);
        L.foot[i].y += 0.018;
        L.knee[i].set(-side * 0.35, 0, 1).normalize();
      }
      L.toe[i] = 0;
    }

    // Hands on the grip.
    L.handSpace = Space.Anchor;
    for (let i = 0; i < 2; i++) {
      const side = SIDES[i];
      L.hand[i].copy(ctx.grip).add(_v.set(side * 0.075, -0.015, -0.035));
      L.elbow[i].set(side * 0.9, -0.2 - 0.4 * crouch, -0.4).normalize();
      // Fingers forward and down around the bar; palms down.
      _v.set(0, -0.75, 1).normalize();
      boneBasis(_v, _v2.set(0, side, 0.1 * side), L.handQ[i]);
      L.curl[i] = 1.45;
      L.thumb[i] = 0.9;
    }
  }

  private mountLook = 0;

  // --- Blend + solve ------------------------------------------------------------------------

  private blendAndApply(wM: number, ctx: AnimContext): void {
    const U = this.U;
    const F = this.LF;
    const M = this.LM;
    const w = wM <= 0.001 ? 0 : wM >= 0.999 ? 1 : wM;
    U.hip.lerpVectors(F.hip, M.hip, w);
    U.hipRot.lerpVectors(F.hipRot, M.hipRot, w);
    U.spine.lerpVectors(F.spine, M.spine, w);
    U.chest.lerpVectors(F.chest, M.chest, w);
    U.neck.lerpVectors(F.neck, M.neck, w);
    U.head.lerpVectors(F.head, M.head, w);
    U.clav[0].lerpVectors(F.clav[0], M.clav[0], w);
    U.clav[1].lerpVectors(F.clav[1], M.clav[1], w);

    const bones = this.bones;
    const hips = bones[B.hips];
    hips.position.copy(U.hip);
    setEuler(hips.quaternion, U.hipRot);
    setEuler(bones[B.spine].quaternion, U.spine);
    setEuler(bones[B.chest].quaternion, U.chest);
    setEuler(bones[B.neck].quaternion, U.neck);
    setEuler(bones[B.head].quaternion, U.head);
    setEuler(bones[B.clavL].quaternion, U.clav[0]);
    setEuler(bones[B.clavR].quaternion, U.clav[1]);
    this.anchorM.copy(ctx.anchor);
    hips.updateMatrixWorld(true);

    // Legs.
    for (let i = 0; i < 2; i++) {
      const leg = LEG_BONES[i];
      const th = leg[0];
      const sh = leg[1];
      const ft = leg[2];
      const to = leg[3];
      const target = _v.lerpVectors(F.foot[i], M.foot[i], w).applyMatrix4(ctx.anchor);
      const pole = _v2.lerpVectors(F.knee[i], M.knee[i], w).transformDirection(ctx.anchor);
      const root = _v3.setFromMatrixPosition(bones[th].matrixWorld);
      solveTwoBone(root, target, pole, this.lens.thigh, this.lens.shin, _ik);
      _q.setFromRotationMatrix(bones[B.hips].matrixWorld);
      const q1 = boneBasis(_ik.dir1, _ik.hinge, _q2);
      // The bind legs have small fore/aft joint offsets, while boneBasis aligns local -Y.
      // For supported contacts, compensate that rest tilt so the solved ankle actually reaches
      // the tread. Blend with mount posture; leave the original on-foot/fallback solve intact.
      if (ctx.stirrups?.[i]) q1.multiply(_q4.setFromAxisAngle(X, Math.atan2(bones[sh].position.z, -bones[sh].position.y) * w));
      bones[th].quaternion.copy(_q).invert().multiply(q1);
      const q2 = boneBasis(_ik.dir2, _ik.hinge, _q3);
      if (ctx.stirrups?.[i]) q2.multiply(_q4.setFromAxisAngle(X, Math.atan2(bones[ft].position.z, -bones[ft].position.y) * w));
      bones[sh].quaternion.copy(q1).invert().multiply(q2);
      // Foot orientation (anchor → world → local to the shin).
      _q.slerpQuaternions(F.footQ[i], M.footQ[i], w).premultiply(_anchorQ);
      bones[ft].quaternion.copy(q2).invert().multiply(_q);
      bones[to].quaternion.setFromAxisAngle(X, MathUtils.lerp(F.toe[i], M.toe[i], w));
    }

    // Arms: convert both layers' targets to world, blend, solve.
    const chestW = bones[B.chest].matrixWorld;
    for (let i = 0; i < 2; i++) {
      const side = SIDES[i];
      const arm = ARM_BONES[i];
      const cl = arm[0];
      const up = arm[1];
      const fo = arm[2];
      const ha = arm[3];
      const f1 = arm[4];
      const f2 = arm[5];
      const thb = arm[6];
      const tF = this.layerHandWorld(F, i, chestW, ctx.anchor, _v);
      const tM = this.layerHandWorld(M, i, chestW, ctx.anchor, _v2);
      const target = tF.lerp(tM, w);
      const pF = this.layerPoleWorld(F, i, chestW, ctx.anchor, _v3);
      const pM = this.layerPoleWorld(M, i, chestW, ctx.anchor, _v4);
      const pole = pF.lerp(pM, w).normalize();
      const root = _v5.setFromMatrixPosition(bones[up].matrixWorld);
      solveTwoBone(root, target, pole, this.lens.upper, this.lens.fore, _ik);
      // Arms hinge the other way round from legs: the bind +X is −hinge.
      _q.setFromRotationMatrix(bones[cl].matrixWorld);
      const hinge = _ik.hinge.negate();
      const q1 = boneBasis(_ik.dir1, hinge, _q2);
      bones[up].quaternion.copy(_q).invert().multiply(q1);
      const q2 = boneBasis(_ik.dir2, hinge, _q3);
      bones[fo].quaternion.copy(q1).invert().multiply(q2);
      // Hand: foot layer is local; mount layer is an anchor-space orientation.
      const qF = F.handQ[i];
      const qM = _q.copy(M.handQ[i]).premultiply(_anchorQ);
      qM.premultiply(_q4.copy(q2).invert());
      bones[ha].quaternion.slerpQuaternions(qF, qM, w);
      const curl = MathUtils.lerp(F.curl[i], M.curl[i], w);
      const thumb = MathUtils.lerp(F.thumb[i], M.thumb[i], w);
      bones[f1].quaternion.setFromAxisAngle(_v.set(0, 0, 1), -side * curl * 0.55);
      bones[f2].quaternion.setFromAxisAngle(_v.set(0, 0, 1), -side * curl * 0.7);
      _e.set(thumb * 0.3, side * thumb * 0.4, -side * thumb * 0.35, 'YXZ');
      bones[thb].quaternion.setFromEuler(_e);
    }
    hips.updateMatrixWorld(true);
  }

  private layerHandWorld(L: LayerPose, i: number, chestW: Matrix4, anchor: Matrix4, out: Vector3): Vector3 {
    out.copy(L.hand[i]);
    return L.handSpace === Space.Chest ? out.applyMatrix4(chestW) : out.applyMatrix4(anchor);
  }

  private layerPoleWorld(L: LayerPose, i: number, chestW: Matrix4, anchor: Matrix4, out: Vector3): Vector3 {
    out.copy(L.elbow[i]);
    return L.handSpace === Space.Chest ? out.transformDirection(chestW) : out.transformDirection(anchor);
  }
}

