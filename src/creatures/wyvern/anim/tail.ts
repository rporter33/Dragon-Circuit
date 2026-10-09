// Tail layer of the wyvern animator: a heavy reptile tail, a verlet chain in world space carried by
// the body. It lags turns, streams in the airflow, swings opposite the head and out of turns as a
// counterweight, and is pulled toward a rest curve per state: carried out behind on the move, an S
// air brake in the flare and hover, and at rest it sinks and settles into a sideways S like a
// monitor's. Wingbeats and landings send a gentle wave down it; the gait's bob does not (the chain
// is carried with it), and every joint is held inside a cone (deviation from the curve, and an
// absolute bend from its parent), so the tip never kinks, J-hooks or whips.
//
// Heavy, not whippy: a joint moved by its constraint carries the segment hanging from it along
// (the segment keeps its direction and takes the move as momentum) instead of leaving its far end
// behind, which levered every joint's swing into its child doubled; and each joint damps its
// segment's motion relative to its parent's (the joint's own damping), which takes the energy out
// of the chain's bending without slowing its swing as a whole. Without these the chain was a whip
// with a 13-15 Hz bending mode some 500 times as large at the tip as at the root.
//
// Frame-rate independent: the chain steps at a fixed 120 Hz from an accumulator, each step's
// inputs (the base, its direction, the curve, the airflow) interpolated to that step's own time
// between last frame's and this frame's, and it is drawn between its last two steps at the frame's
// time (a constant one-step lag). 60, 144 or 165 Hz, steady or jittery, all show the same motion.
//
// Methods take no number arguments (see frame.ts); bendDir and clampBend take the segment index.

import { Quaternion, Vector3 } from 'three';
import { DEG, TAU, clamp, clamp01, damp, lerp, smoothstep } from '../../../core/math';
import type { RigDef } from '../rig';
import { aimRotation } from '../ik';
import type { WyvernAnimator } from '../animator';
import { UP, type AnimFrame } from './frame';

/** Tail neutral curves (degrees per joint, + raises), root → tip. */
const TAIL_GROUND = [9, -1, -3, -4, -4, -3, -2, 0, 2, 4];
const TAIL_FLIGHT = [4, 0.5, 0.3, 0, 0, 0, 0, 0, 0, 0];
/** Flaring: dropped at the root and curling back up toward the tip, an S that brakes and balances. */
const TAIL_FLARE = [-14, -6, -2, 2, 4, 5, 5, 4, 3, 2];
/** Hovering (B7's hover weight): hanging lower still, the tip barely lifting. */
const TAIL_HOVER = [-18, -8, -3, 0, 2, 3, 3, 2, 1, 0];
/** At rest: the tail sinks from the hips and lies out along the ground... */
const TAIL_REST = [-4, -7, -8, -7, -5, -2, 3, 6, 6, 4];
/**
 * ...drawn for a tail 2.5 times as long as its base is high (REST_REACH = base height / length).
 * A tail shorter for its hips droops more steeply to reach the ground: the curve is scaled by
 * (height / length) / REST_REACH, at most REST_DROOP_MAX (8° × 1.75 = 14°, inside the 15° joint).
 */
const REST_REACH = 0.4;
const REST_DROOP_MAX = 1.75;
/** ...in a sideways S (yaw, degrees per joint, × the side chosen for this rest). */
const TAIL_REST_S = [3, 6, 8, 6, 0, -7, -11, -12, -10, -6];

/** Air (and the landing's dip) not carried with the chain: this much of each sends a wave down it. */
const HEAVE_WAVE = 0.4;
/** The flight rudder's limit (rad per joint). */
const STEER_MAX = 0.12;
/** The wingbeat's wave down the tail: degrees per joint at the tip (light breeds), and its lag per joint (rad of beat phase). */
const WAVE_DEG = 2.4;
const WAVE_LAG = 0.45;

/** The chain's fixed step (s; the physics rate), and the most steps one frame takes (0.1 s, the animator's dt cap). */
const SIM_RATE = 120;
const H = 1 / SIM_RATE;
const MAX_STEPS = 12;
/** Per step: how much of a point's velocity it keeps, along the chain in the air and toward the tip (or all along it on the ground). */
const DAMP_AIR = 0.94;
const DAMP_TIP = 0.9;
/** Per step: how much of a joint's velocity relative to its parent's it loses (the joint's damping). */
const JOINT_DAMP = 0.5;

// Scratch (module-level: the animator never re-enters).
const _q = new Quaternion();
const _q2 = new Quaternion();
const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _v4 = new Vector3();
const _v5 = new Vector3();
const _ref = new Vector3();
const _refN = new Vector3();
const _anchor = new Vector3();
const _dirS = new Vector3();
const _upS = new Vector3();
const _velS = new Vector3();
const _accS = new Vector3();

export class TailLayer {
  private readonly a: WyvernAnimator;
  private readonly f: AnimFrame;
  private readonly rig: RigDef;
  private readonly tailX: Vector3[] = [];
  private readonly tailXp: Vector3[] = [];
  private readonly tailLen: number[] = [];
  private readonly tailRestDir: Vector3[] = [];
  /** The chain as drawn: between its last two steps, at the frame's time. */
  private readonly tailR: Vector3[] = [];
  private readonly tailBase = new Vector3();
  /** The part of the visual root offset NOT carried with the chain (world). */
  private readonly waveW = new Vector3();
  /** This frame's target curve (rad per joint), and the one a step being taken is pulled toward. */
  private readonly tailPitch: Float32Array;
  private readonly tailYaw: Float32Array;
  private readonly stepPitch: Float32Array;
  private readonly stepYaw: Float32Array;
  /**
   * Last frame's inputs, each step's interpolated between them and this frame's: the tail base,
   * the point the chain is carried with (and where it was carried to last), the base direction,
   * the body's up, the curve, the airflow, the body's acceleration and the stream's strength.
   */
  private readonly basePrev = new Vector3();
  private readonly anchorPrev = new Vector3();
  private readonly anchorChain = new Vector3();
  private readonly dirPrev = new Vector3();
  private readonly upPrev = new Vector3();
  private readonly pitchPrev: Float32Array;
  private readonly yawPrev: Float32Array;
  private readonly velPrev = new Vector3();
  private readonly accelPrev = new Vector3();
  private streamPrev = 0;
  /** Time (s) not yet stepped: the chain's last step lies this far behind the frame. */
  private acc = 0;
  /** Per joint: how far it may stray from its curve (pitch, yaw; rad), stiffness and damping. */
  private readonly devPitch: Float32Array;
  private readonly devYaw: Float32Array;
  private readonly stiff: Float32Array;
  /** The most any joint past the root bends from its parent (rad; 20° on the light skimmer, 15° else). */
  private readonly cosMax: number;
  private readonly sinMax: number;
  /** The rest pose: weight, the side of its S, how long it has been idle. */
  private restW = 0;
  private restSide = 1;
  private idleT = 0;
  private wasIdle = false;
  private rng = 777;
  private tailInit = false;
  /** How much steeper than TAIL_REST this tail droops at rest (see REST_REACH). */
  private readonly restDroop: number;

  constructor(a: WyvernAnimator) {
    this.a = a;
    this.f = a.frame;
    this.rig = a.rig;
    const rig = a.rig;
    const B = rig.bones;
    const T = rig.idx.tail;
    const n = T.length;
    const heft = a.heft;
    this.tailPitch = new Float32Array(n);
    this.tailYaw = new Float32Array(n);
    this.devPitch = new Float32Array(n);
    this.devYaw = new Float32Array(n);
    this.stiff = new Float32Array(n);
    this.stepPitch = new Float32Array(n);
    this.stepYaw = new Float32Array(n);
    this.pitchPrev = new Float32Array(n);
    this.yawPrev = new Float32Array(n);
    for (let i = 0; i <= n; i++) {
      this.tailX.push(new Vector3());
      this.tailXp.push(new Vector3());
      this.tailR.push(new Vector3());
    }
    // Heavier tails stray less from their curve and are stiffer toward the tip.
    const cone = 1 - 0.35 * heft;
    for (let i = 0; i < n; i++) {
      const p = B[T[i]].pos;
      const q = i + 1 < n ? B[T[i + 1]].pos : rig.tailTip;
      this.tailLen.push(p.distanceTo(q));
      this.tailRestDir.push(q.clone().sub(p).normalize());
      const s = i / (n - 1);
      this.devPitch[i] = lerp(8, 18, s) * cone * DEG;
      this.devYaw[i] = 14 * cone * DEG;
      this.stiff[i] = lerp(0.5, 0.26 + 0.14 * heft, s);
    }
    // The tail base's height above the ground standing, against the tail's length.
    let len = 0;
    for (let i = 0; i < n; i++) len += this.tailLen[i];
    const baseH = rig.props.standHeight + B[T[0]].pos.y;
    this.restDroop = clamp(baseH / len / REST_REACH, 1, REST_DROOP_MAX);
    const maxBend = lerp(20, 15, smoothstep(0.1, 0.3, heft)) * DEG;
    this.cosMax = Math.cos(maxBend);
    this.sinMax = Math.sin(maxBend);
  }

  /** After a teleport: the chain is laid out along its rest curve again. */
  reset(): void {
    this.tailInit = false;
  }

  private rand(): number {
    this.rng = (this.rng * 1664525 + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  updateTail(): void {
    const a = this.a;
    const f = this.f;
    const rig = this.rig;
    const pose = f.pose;
    const { dt, airborne, groundW, flare, tuck, buffet, idle, moving, gaitPhase, accel, stretch } = f;
    const lookYaw = f.lookYaw;
    const lookPitch = f.lookPitch;
    const T = rig.idx.tail;
    const n = T.length;
    const X = this.tailX;
    const Xp = this.tailXp;
    const om = f.om;
    const pelvis = rig.idx.pelvis;
    // Base of the tail and its rest direction (world).
    const pelvisWorldQ = _q2.multiplyQuaternions(a.qW, a.modelQ[pelvis]);
    a.toWorld(_v.copy(a.offset[T[0]]).applyQuaternion(a.modelQ[pelvis]).add(a.modelP[pelvis]), this.tailBase);
    const baseDir = _v2.copy(this.tailRestDir[0]).applyQuaternion(pelvisWorldQ);
    const bodyUp = _v3.copy(UP).applyQuaternion(a.qW);
    // The chain is carried with the body's travel and every part of the visual root offset (the
    // gait's bob, breathing, the stretch) except part of the wingbeat's heave and the landing dip:
    // those it follows through its springs, a gentle wave down the tail each beat and touchdown.
    const wave = HEAVE_WAVE * (f.heave + f.dipV);
    this.waveW.copy(bodyUp).multiplyScalar(wave);

    // Rest: idle a moment, the tail sinks and settles into an S, to a side chosen afresh each time.
    if (idle && !this.wasIdle) this.restSide = this.rand() < 0.5 ? 1 : -1;
    this.wasIdle = idle;
    this.idleT = idle ? this.idleT + dt : 0;
    const resting = idle && this.idleT > 1.5 && !f.baskOn;
    this.restW = damp(this.restW, resting ? 1 : 0, resting ? 0.9 : 5, dt);
    const restW = this.restW * groundW;

    // Target curve per joint (radians): pitch (+ raises) and yaw (+ swings to the body's left).
    const t = f.time;
    // Counter-steer: in a turn the tail swings out to the outside, a counterweight to the turn; in
    // the air the rudder (B3's tailSteer) adds to it.
    const steer = clamp(clamp(om.y * (airborne ? -0.07 : -0.045), -0.08, 0.08) + f.tailSteer * f.airW, -STEER_MAX, STEER_MAX);
    const hover = clamp01(f.hover) * (1 - groundW);
    const flareW = flare * (1 - groundW);
    // A resting reptile's tail is still: the idle sway dies away as it settles.
    const swayAmp = (idle ? 0.045 : 0.015) * (1 - 0.95 * this.restW);
    // Each wingbeat sends a gentle wave down the tail (the body rises on the downstroke and the
    // tail follows a beat behind), larger toward the tip, smaller on the heavy tails.
    const beatWave = WAVE_DEG * DEG * f.flap * f.airW * (1 - tuck) * (1 - 0.4 * f.heft) * (1 - 0.6 * flareW);
    const beatPhase = f.phase * TAU;
    for (let i = 0; i < n; i++) {
      let p = lerp(TAIL_FLIGHT[i], TAIL_GROUND[i], groundW);
      p = lerp(p, TAIL_FLARE[i], flareW);
      p = lerp(p, TAIL_HOVER[i], hover);
      p = lerp(p, TAIL_REST[i] * this.restDroop, restW);
      p *= (1 - tuck * 0.7) * (1 - 0.75 * stretch);
      // On the ground the tail balances the head and neck: it lifts as the head goes down and
      // swings the other way when the head turns; the stretch holds it straight out.
      const counterPitch = -lookPitch * 0.014 * groundW + stretch * 0.03 * (1 - i / n);
      const wave = beatWave > 0 ? beatWave * (0.3 + 0.7 * (i / (n - 1))) * Math.sin(beatPhase - WAVE_LAG * i) : 0;
      this.tailPitch[i] = p * DEG + (idle ? 0.02 * (1 - restW) * Math.sin(t * 0.9 - i * 0.4) : 0) + counterPitch + wave;
      const sway = swayAmp * Math.sin(t * (idle ? 0.75 : 1.4) - i * 0.45) + (moving ? 0.05 * Math.sin(gaitPhase * TAU - i * 0.5) : 0);
      // A stall makes it lash.
      const lash = buffet * 0.09 * Math.sin(f.stallT * 5 - i * 0.6);
      const counterYaw = -lookYaw * 0.03 * groundW * (1 - 0.5 * stretch);
      this.tailYaw[i] = sway * (1 - 0.6 * stretch) + steer + lash + counterYaw + this.restSide * TAIL_REST_S[i] * DEG * restW;
    }

    const vel = pose.velocity;
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    // It streams out in the airflow, but not while it is held down as an air brake.
    const stream = airborne ? smoothstep(4, 20, speed) * 0.04 * (1 - 0.8 * Math.max(flareW, hover)) : 0;
    const anchor = _anchor.copy(this.tailBase).sub(this.waveW);
    const R = this.tailR;

    if (f.teleport || !this.tailInit) {
      this.stepPitch.set(this.tailPitch);
      this.stepYaw.set(this.tailYaw);
      X[0].copy(this.tailBase);
      const d = _v4.copy(baseDir);
      for (let i = 0; i < n; i++) {
        this.bendDir(d, bodyUp, i);
        X[i + 1].copy(X[i]).addScaledVector(d, this.tailLen[i]);
      }
      for (let i = 0; i <= n; i++) {
        Xp[i].copy(X[i]);
        R[i].copy(X[i]);
      }
      this.acc = 0;
      this.anchorChain.copy(anchor);
      this.tailInit = true;
    } else if (dt > 0) {
      // Fixed steps from the accumulator (none on a frame shorter than what is left of one; none
      // at all on a render-only frame, dt 0, which changes nothing).
      const acc0 = this.acc;
      let acc = acc0 + dt;
      const steps = Math.min(MAX_STEPS, Math.floor(acc * SIM_RATE + 1e-6));
      acc -= steps * H;
      this.acc = acc < 0 ? 0 : acc > H ? H : acc;
      const grav = (airborne ? 1.2 : 6) * H * H;
      const inertia = 0.35 * H * H;
      const groundY = a.groundRef;
      const baseR = rig.props.shape.tailBaseRadius;
      for (let s = 0; s < steps; s++) {
        // This step's time, as a fraction of the way from last frame to this one: its inputs.
        // (Scalar math throughout: a double passed into a call the JIT doesn't inline is boxed.)
        let u = ((s + 1) * H - acc0) / dt;
        if (u > 1) u = 1;
        else if (u < 0) u = 0;
        const v = 1 - u;
        // Carried with the body (see above) to this step's time. Rotations and accelerations
        // make it lag.
        const ap = this.anchorPrev;
        const ac = this.anchorChain;
        const cx = ap.x * v + anchor.x * u;
        const cy = ap.y * v + anchor.y * u;
        const cz = ap.z * v + anchor.z * u;
        const sx = cx - ac.x;
        const sy = cy - ac.y;
        const sz = cz - ac.z;
        ac.x = cx;
        ac.y = cy;
        ac.z = cz;
        for (let i = 0; i <= n; i++) {
          X[i].x += sx;
          X[i].y += sy;
          X[i].z += sz;
          Xp[i].x += sx;
          Xp[i].y += sy;
          Xp[i].z += sz;
        }
        Xp[0].copy(X[0]);
        const bp = this.basePrev;
        const tb = this.tailBase;
        X[0].x = bp.x * v + tb.x * u;
        X[0].y = bp.y * v + tb.y * u;
        X[0].z = bp.z * v + tb.z * u;
        const dp = this.dirPrev;
        const dirS = _dirS;
        dirS.x = dp.x * v + baseDir.x * u;
        dirS.y = dp.y * v + baseDir.y * u;
        dirS.z = dp.z * v + baseDir.z * u;
        dirS.normalize();
        const up = this.upPrev;
        const upS = _upS;
        upS.x = up.x * v + bodyUp.x * u;
        upS.y = up.y * v + bodyUp.y * u;
        upS.z = up.z * v + bodyUp.z * u;
        upS.normalize();
        const vp = this.velPrev;
        const velS = _velS;
        velS.x = vp.x * v + vel.x * u;
        velS.y = vp.y * v + vel.y * u;
        velS.z = vp.z * v + vel.z * u;
        const cp = this.accelPrev;
        const accS = _accS;
        accS.x = cp.x * v + accel.x * u;
        accS.y = cp.y * v + accel.y * u;
        accS.z = cp.z * v + accel.z * u;
        const streamS = this.streamPrev * v + stream * u;
        const speedS = velS.length();
        for (let i = 0; i < n; i++) {
          this.stepPitch[i] = this.pitchPrev[i] * v + this.tailPitch[i] * u;
          this.stepYaw[i] = this.yawPrev[i] * v + this.tailYaw[i] * u;
        }
        // Verlet, heavily damped (on the ground all along it, in the air toward the tip), and
        // each joint's velocity pulled toward its parent's (the joint's damping).
        let pvx = 0;
        let pvy = 0;
        let pvz = 0;
        for (let i = 1; i <= n; i++) {
          const x = X[i];
          const px = Xp[i];
          const damping = !airborne || i > n - 3 ? DAMP_TIP : DAMP_AIR;
          let vx = (x.x - px.x) * damping;
          let vy = (x.y - px.y) * damping;
          let vz = (x.z - px.z) * damping;
          if (i > 1) {
            vx += (pvx - vx) * JOINT_DAMP;
            vy += (pvy - vy) * JOINT_DAMP;
            vz += (pvz - vz) * JOINT_DAMP;
          }
          pvx = vx;
          pvy = vy;
          pvz = vz;
          px.copy(x);
          x.x += vx - accS.x * inertia;
          x.y += vy - grav - accS.y * inertia;
          x.z += vz - accS.z * inertia;
        }
        // Constraints, root to tip. (mx, my, mz): how far the joint before moved in this pass; the
        // segment hanging from it is carried along before its own constraint.
        const d = _v4;
        let mx = 0;
        let my = 0;
        let mz = 0;
        for (let i = 1; i <= n; i++) {
          const xi = X[i];
          const xa = X[i - 1];
          const bx = xi.x;
          const by = xi.y;
          const bz = xi.z;
          xi.x += mx;
          xi.y += my;
          xi.z += mz;
          if (i > 1) d.subVectors(xa, X[i - 2]).normalize();
          else d.copy(dirS);
          this.bendDir(d, upS, i - 1);
          const kStiff = this.stiff[i - 1];
          const len = this.tailLen[i - 1];
          xi.x += (xa.x + d.x * len - xi.x) * kStiff;
          xi.y += (xa.y + d.y * len - xi.y) * kStiff;
          xi.z += (xa.z + d.z * len - xi.z) * kStiff;
          if (streamS > 0 && speedS > 1) {
            const k = (-streamS * len) / speedS;
            xi.x += velS.x * k;
            xi.y += velS.y * k;
            xi.z += velS.z * k;
          }
          // Keep the segment length...
          const ex = xi.x - xa.x;
          const ey = xi.y - xa.y;
          const ez = xi.z - xa.z;
          const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
          if (el > 1e-6) {
            const fl = len / el;
            xi.x = xa.x + ex * fl;
            xi.y = xa.y + ey * fl;
            xi.z = xa.z + ez * fl;
          }
          // ...and the joint inside its cone (d is this joint's target direction).
          this.clampBend(i, d, upS);
          // Stay above the ground: swing the segment up about its joint (its length kept).
          if (!airborne) {
            const minY = groundY + 0.05 + 0.4 * baseR * (1 - (i - 1) / n);
            if (xi.y < minY) {
              const dy = minY - xa.y;
              const hx = xi.x - xa.x;
              const hz = xi.z - xa.z;
              const hl = Math.sqrt(hx * hx + hz * hz);
              if (dy < len && hl > 1e-6) {
                const k = Math.sqrt(len * len - dy * dy) / hl;
                xi.x = xa.x + hx * k;
                xi.z = xa.z + hz * k;
              }
              xi.y = minY;
              // A lift that kinks the joint gives way to the cone: the tip may brush the grass,
              // but the tail never hooks over the ground.
              if (i > 1) this.clampToParent(i);
            }
          }
          mx = xi.x - bx;
          my = xi.y - by;
          mz = xi.z - bz;
        }
      }
      // Drawn between the last two steps at the frame's time: a constant one-step lag, so the
      // motion is as smooth on a frame that took no step as on one that took two.
      const r = this.acc * SIM_RATE;
      const q = 1 - r;
      for (let i = 0; i <= n; i++) {
        R[i].x = Xp[i].x * q + X[i].x * r;
        R[i].y = Xp[i].y * q + X[i].y * r;
        R[i].z = Xp[i].z * q + X[i].z * r;
      }
    }
    this.basePrev.copy(this.tailBase);
    this.anchorPrev.copy(anchor);
    this.dirPrev.copy(baseDir);
    this.upPrev.copy(bodyUp);
    this.pitchPrev.set(this.tailPitch);
    this.yawPrev.set(this.tailYaw);
    this.velPrev.copy(vel);
    this.accelPrev.copy(accel);
    this.streamPrev = stream;

    // Bones follow the chain: aim each segment at the next point, rolling gently with the bank
    // (a scalar Rodrigues turn of the parent's up about the segment, inline: no doubles through
    // calls).
    const roll = clamp(-om.z * 0.04, -0.08, 0.08);
    const rc = Math.cos(roll);
    const rs = Math.sin(roll);
    for (let i = 0; i < n; i++) {
      const dirM = a.toModel(R[i + 1], _v4).sub(a.toModel(R[i], _v5));
      const parentQ = a.modelQ[a.parent[T[i]]];
      _ref.copy(UP).applyQuaternion(parentQ);
      if (roll !== 0) {
        const ax = _refN.copy(dirM).normalize();
        const vx = _ref.x;
        const vy = _ref.y;
        const vz = _ref.z;
        const k = (ax.x * vx + ax.y * vy + ax.z * vz) * (1 - rc);
        _ref.x = vx * rc + (ax.y * vz - ax.z * vy) * rs + ax.x * k;
        _ref.y = vy * rc + (ax.z * vx - ax.x * vz) * rs + ax.y * k;
        _ref.z = vz * rc + (ax.x * vy - ax.y * vx) * rs + ax.z * k;
      }
      aimRotation(this.tailRestDir[i], UP, dirM, _ref, _q);
      a.setModel(T[i], _q);
    }
  }

  /**
   * Hold tail joint i (the segment from X[i−1] to X[i], length-constrained) inside its cone: no
   * further from its target direction `d` than the joint's pitch/yaw allowance (an ellipse), and,
   * past the root, bent no more than the breed's limit from the segment before it. Scalar math,
   * no temporaries.
   */
  private clampBend(i: number, d: Vector3, up: Vector3): void {
    const X = this.tailX;
    const xi = X[i];
    const xa = X[i - 1];
    const len = this.tailLen[i - 1];
    let ax = (xi.x - xa.x) / len;
    let ay = (xi.y - xa.y) / len;
    let az = (xi.z - xa.z) / len;
    // The target's frame: u = up made perpendicular to d, l = d × u.
    const dx = d.x;
    const dy = d.y;
    const dz = d.z;
    const ud = up.x * dx + up.y * dy + up.z * dz;
    let ux = up.x - dx * ud;
    let uy = up.y - dy * ud;
    let uz = up.z - dz * ud;
    let l = Math.sqrt(ux * ux + uy * uy + uz * uz);
    if (l < 1e-6) return;
    ux /= l;
    uy /= l;
    uz /= l;
    const lx = dy * uz - dz * uy;
    const ly = dz * ux - dx * uz;
    const lz = dx * uy - dy * ux;
    const c = ax * dx + ay * dy + az * dz;
    let pd = Math.atan2(ax * ux + ay * uy + az * uz, c);
    let yd = Math.atan2(ax * lx + ay * ly + az * lz, c);
    const pm = this.devPitch[i - 1];
    const ym = this.devYaw[i - 1];
    const e = (pd * pd) / (pm * pm) + (yd * yd) / (ym * ym);
    if (e > 1 || c <= 0) {
      const k = e > 1 ? 1 / Math.sqrt(e) : 1;
      pd *= k;
      yd *= k;
      const tp = Math.tan(pd);
      const ty = Math.tan(yd);
      ax = dx + ux * tp + lx * ty;
      ay = dy + uy * tp + ly * ty;
      az = dz + uz * tp + lz * ty;
      l = Math.sqrt(ax * ax + ay * ay + az * az);
      ax /= l;
      ay /= l;
      az /= l;
    }
    xi.x = xa.x + ax * len;
    xi.y = xa.y + ay * len;
    xi.z = xa.z + az * len;
    // Past the root: the bend from the segment before it.
    if (i > 1) this.clampToParent(i);
  }

  /** Hold tail joint i (i > 1) to the breed's bend limit from the segment before it. */
  private clampToParent(i: number): void {
    const X = this.tailX;
    const xi = X[i];
    const xa = X[i - 1];
    const xb = X[i - 2];
    const len = this.tailLen[i - 1];
    let ax = (xi.x - xa.x) / len;
    let ay = (xi.y - xa.y) / len;
    let az = (xi.z - xa.z) / len;
    let px = xa.x - xb.x;
    let py = xa.y - xb.y;
    let pz = xa.z - xb.z;
    let l = Math.sqrt(px * px + py * py + pz * pz);
    if (l < 1e-6) return;
    px /= l;
    py /= l;
    pz /= l;
    const cp = ax * px + ay * py + az * pz;
    if (cp >= this.cosMax) return;
    let qx = ax - px * cp;
    let qy = ay - py * cp;
    let qz = az - pz * cp;
    l = Math.sqrt(qx * qx + qy * qy + qz * qz);
    if (l < 1e-6) {
      // Folded straight back on itself: bend it upward (any perpendicular will do).
      qx = -px * py;
      qy = 1 - py * py;
      qz = -pz * py;
      l = Math.sqrt(qx * qx + qy * qy + qz * qz) || 1;
    }
    ax = px * this.cosMax + (qx / l) * this.sinMax;
    ay = py * this.cosMax + (qy / l) * this.sinMax;
    az = pz * this.cosMax + (qz / l) * this.sinMax;
    xi.x = xa.x + ax * len;
    xi.y = xa.y + ay * len;
    xi.z = xa.z + az * len;
  }

  /**
   * Bend a direction by tail segment i's target pitch (raise) and yaw (to the body's left) at the
   * step being taken (stepPitch, stepYaw), relative to itself. Takes the index, not the angles:
   * numbers passed into a call the JIT doesn't inline get boxed, and this runs ~30 times a frame.
   */
  private bendDir(d: Vector3, up: Vector3, i: number): void {
    const pitch = this.stepPitch[i];
    const yaw = this.stepYaw[i];
    // Scalar Rodrigues rotations (no temporaries).
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
