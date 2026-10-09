// Tail layer of the wyvern animator: a heavy reptile tail, a verlet chain in world space carried by
// the body. It lags turns, streams in the airflow, swings opposite the head and out of turns as a
// counterweight, and is pulled toward a rest curve per state: carried out behind on the move, an S
// air brake in the flare and hover, and at rest it sinks and settles into a sideways S like a
// monitor's. Wingbeats and landings send a gentle wave down it; the gait's bob does not (the chain
// is carried with it), and every joint is held inside a cone (deviation from the curve, and an
// absolute bend from its parent), so the tip never kinks, J-hooks or whips.
//
// Methods take no number arguments (see frame.ts); bendDir and clampBend take the segment index.

import { Quaternion, Vector3 } from 'three';
import { DEG, TAU, clamp, clamp01, damp, lerp, smoothstep } from '../../../core/math';
import type { RigDef } from '../rig';
import { aimRotation, rotateAbout } from '../ik';
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
/** ...in a sideways S (yaw, degrees per joint, × the side chosen for this rest). */
const TAIL_REST_S = [3, 6, 8, 6, 0, -7, -11, -12, -10, -6];

/** Air (and the landing's dip) not carried with the chain: this much of each sends a wave down it. */
const HEAVE_WAVE = 0.4;
/** The flight rudder's limit (rad per joint). */
const STEER_MAX = 0.12;
/** The wingbeat's wave down the tail: degrees per joint at the tip (light breeds), and its lag per joint (rad of beat phase). */
const WAVE_DEG = 2.4;
const WAVE_LAG = 0.45;

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
  /** The part of the visual root offset NOT carried with the chain (world), now and last frame. */
  private readonly waveW = new Vector3();
  private readonly waveWPrev = new Vector3();
  private readonly tailPitch: Float32Array;
  private readonly tailYaw: Float32Array;
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
  /** The last sub-step's length (s), for the time-corrected verlet. */
  private hPrev = 1 / 120;

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
    for (let i = 0; i <= n; i++) {
      this.tailX.push(new Vector3());
      this.tailXp.push(new Vector3());
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
      p = lerp(p, TAIL_REST[i], restW);
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

    if (f.teleport || !this.tailInit) {
      X[0].copy(this.tailBase);
      const d = _v4.copy(baseDir);
      for (let i = 0; i < n; i++) {
        this.bendDir(d, bodyUp, i);
        X[i + 1].copy(X[i]).addScaledVector(d, this.tailLen[i]);
      }
      for (let i = 0; i <= n; i++) Xp[i].copy(X[i]);
      this.tailBasePrev.copy(this.tailBase);
      this.waveWPrev.copy(this.waveW);
      this.tailInit = true;
    } else {
      // Carry the chain with the body (see above). Rotations and accelerations make it lag.
      const sx = this.tailBase.x - this.tailBasePrev.x - (this.waveW.x - this.waveWPrev.x);
      const sy = this.tailBase.y - this.tailBasePrev.y - (this.waveW.y - this.waveWPrev.y);
      const sz = this.tailBase.z - this.tailBasePrev.z - (this.waveW.z - this.waveWPrev.z);
      for (let i = 0; i <= n; i++) {
        X[i].x += sx;
        X[i].y += sy;
        X[i].z += sz;
        Xp[i].x += sx;
        Xp[i].y += sy;
        Xp[i].z += sz;
      }
      this.tailBasePrev.copy(this.tailBase);
      this.waveWPrev.copy(this.waveW);
      // Sub-steps of at most 1/120 s; none at all for a frame that takes no time (a render-only
      // frame), which would otherwise replay the last step's velocity and kick the chain.
      const steps = dt > 1e-6 ? Math.min(10, Math.ceil(dt * 120)) : 0;
      const h = steps > 0 ? dt / steps : 0;
      // Time-corrected verlet: the carried velocity is rescaled when the step length changes, and
      // the damping (per 1/120 s) follows the step length too.
      const hRatio = steps > 0 ? clamp(h / this.hPrev, 0, 2) : 0;
      if (steps > 0) this.hPrev = h;
      const dampGround = Math.pow(0.9, h * 120);
      const dampAir = Math.pow(0.94, h * 120);
      const grav = (airborne ? 1.2 : 6) * h * h;
      const inertia = 0.35 * h * h;
      const groundY = a.groundRef;
      const vel = pose.velocity;
      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
      // It streams out in the airflow, but not while it is held down as an air brake.
      const stream = airborne ? smoothstep(4, 20, speed) * 0.04 * (1 - 0.8 * Math.max(flareW, hover)) : 0;
      const baseR = rig.props.shape.tailBaseRadius;
      for (let s = 0; s < steps; s++) {
        X[0].copy(this.tailBase);
        for (let i = 1; i <= n; i++) {
          const x = X[i];
          const px = Xp[i];
          // Heavily damped: on the ground all along it, in the air toward the tip.
          const damping = (!airborne || i > n - 3 ? dampGround : dampAir) * (s === 0 ? hRatio : 1);
          const vx = (x.x - px.x) * damping;
          const vy = (x.y - px.y) * damping;
          const vz = (x.z - px.z) * damping;
          px.copy(x);
          x.x += vx - accel.x * inertia;
          x.y += vy - grav - accel.y * inertia;
          x.z += vz - accel.z * inertia;
        }
        const d = _v4.copy(baseDir);
        for (let i = 1; i <= n; i++) {
          if (i > 1) d.subVectors(X[i - 1], X[i - 2]).normalize();
          this.bendDir(d, bodyUp, i - 1);
          const kStiff = this.stiff[i - 1];
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
          this.clampBend(i, d, bodyUp);
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
