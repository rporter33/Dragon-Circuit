// Tail layer of the wyvern animator: a verlet chain in world space carried by the body. It lags
// turns, takes the waves of wingbeats and landings, streams in the airflow, and is pulled toward a
// rest curve per state; a counterweight that swings opposite the head and out of turns.
//
// Methods take no number arguments (see frame.ts); bendDir takes the segment index, not angles.

import { Quaternion, Vector3 } from 'three';
import { DEG, TAU, clamp, lerp, smoothstep } from '../../../core/math';
import type { RigDef } from '../rig';
import { aimRotation, rotateAbout } from '../ik';
import type { WyvernAnimator } from '../animator';
import { UP, type AnimFrame } from './frame';

/** Tail neutral curves (degrees per segment, + raises). */
const TAIL_GROUND = [9, -1, -3, -4, -4, -3, -2, 0, 2, 4];
const TAIL_FLIGHT = [4, 0.5, 0.3, 0, 0, 0, 0, 0, 0, 0];
const TAIL_FLARE = [-9, -4, -3, -2, -1, 0, 0, 0, 1, 2];

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

export class TailLayer {
  private readonly a: WyvernAnimator;
  private readonly f: AnimFrame;
  private readonly rig: RigDef;
  private readonly tailX: Vector3[] = [];
  private readonly tailXp: Vector3[] = [];
  private readonly tailLen: number[] = [];
  private readonly tailRestDir: Vector3[] = [];
  private readonly tailBase = new Vector3();
  private readonly tailBasePrev = new Vector3();
  /** The visual root offset (heave, dip) in world space, now and last frame: the tail lags it. */
  private readonly rootOffW = new Vector3();
  private readonly rootOffWPrev = new Vector3();
  private readonly tailPitch: Float32Array;
  private readonly tailYaw: Float32Array;
  private tailInit = false;

  constructor(a: WyvernAnimator) {
    this.a = a;
    this.f = a.frame;
    this.rig = a.rig;
    const rig = a.rig;
    const B = rig.bones;
    const T = rig.idx.tail;
    this.tailPitch = new Float32Array(T.length);
    this.tailYaw = new Float32Array(T.length);
    for (let i = 0; i <= T.length; i++) {
      this.tailX.push(new Vector3());
      this.tailXp.push(new Vector3());
    }
    for (let i = 0; i < T.length; i++) {
      const p = B[T[i]].pos;
      const q = i + 1 < T.length ? B[T[i + 1]].pos : rig.tailTip;
      this.tailLen.push(p.distanceTo(q));
      this.tailRestDir.push(q.clone().sub(p).normalize());
    }
  }

  /** After a teleport: the chain is laid out along its rest curve again. */
  reset(): void {
    this.tailInit = false;
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
    this.rootOffW.copy(a.rootOffset).applyQuaternion(a.qW);

    // Target curve per segment (radians): pitch (+ raises) and yaw (+ swings to the body's left).
    const t = f.time;
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
      const lash = buffet * 0.09 * Math.sin(f.stallT * 5 - i * 0.6);
      const counterYaw = -lookYaw * 0.03 * groundW * (1 - 0.5 * stretch);
      this.tailYaw[i] = sway * (1 - 0.6 * stretch) + steer + lash + counterYaw;
    }

    if (f.teleport || !this.tailInit) {
      X[0].copy(this.tailBase);
      const d = _v4.copy(baseDir);
      for (let i = 0; i < n; i++) {
        this.bendDir(d, bodyUp, i);
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
      const groundY = a.groundRef;
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
          this.bendDir(d, bodyUp, i - 1);
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
            const fl = len / el;
            xi.x = xa.x + ex * fl;
            xi.y = xa.y + ey * fl;
            xi.z = xa.z + ez * fl;
          }
          // Stay above the ground.
          const minY = groundY + 0.05 + 0.4 * baseR * (1 - (i - 1) / n);
          if (!airborne && xi.y < minY) xi.y = minY;
        }
      }
    }

    // Bones follow the chain: aim each segment at the next point, rolling gently with the bank.
    for (let i = 0; i < n; i++) {
      const dirM = a.toModel(X[i + 1], _v4).sub(a.toModel(X[i], _v5));
      const parentQ = a.modelQ[a.parent[T[i]]];
      _ref.copy(UP).applyQuaternion(parentQ);
      rotateAbout(_ref, _refN.copy(dirM).normalize(), clamp(-om.z * 0.04, -0.08, 0.08));
      aimRotation(this.tailRestDir[i], UP, dirM, _ref, _q);
      a.setModel(T[i], _q);
    }
  }

  /**
   * Bend a direction by tail segment i's target pitch (raise) and yaw (to the body's left)
   * relative to itself. Takes the index, not the angles: numbers passed into a call the JIT
   * doesn't inline get boxed, and this runs ~30 times a frame.
   */
  private bendDir(d: Vector3, up: Vector3, i: number): void {
    const pitch = this.tailPitch[i];
    const yaw = this.tailYaw[i];
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
