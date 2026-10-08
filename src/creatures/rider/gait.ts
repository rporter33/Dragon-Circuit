// Foot placement for walking and running: each foot is either planted (fixed in the world, so it
// can never skate) or swinging toward where the body will be when it lands. A gait clock sets the
// rhythm from speed (cadence and duty factor blend from walk to run); at rest, feet step back
// under the body when the rider turns or drifts. Pure logic on three.js vectors.

import { Vector3 } from 'three';

export type GroundFn = (x: number, z: number, nearY: number) => number;

export interface FootState {
  /** Ground contact point under the ankle (world). */
  pos: Vector3;
  planted: boolean;
  /** Swing progress 0..1 while not planted. */
  swing: number;
  /** Seconds the current swing lasts. */
  swingTime: number;
  from: Vector3;
  to: Vector3;
  /** Current height of the sole above the contact point's ground (m). */
  lift: number;
  /** Foot pitch (+ = toes down / heel up), radians. */
  pitch: number;
  /** Stance progress 0..1 (locomotion only; 0 when idle). */
  stance: number;
  /** +1 left, −1 right. */
  side: number;
  /** Facing of the foot (world yaw): planted feet keep theirs while the body turns. */
  yaw: number;
  yawFrom: number;
}

export interface GaitParams {
  /** Half the distance between the feet at rest (m). */
  stanceWidth: number;
  /** Leg length scale (1 = medium build). */
  scale: number;
}

/** Steps per second for a speed (m/s). */
export function cadence(speed: number): number {
  return Math.min(4.6, Math.max(1.9, 2.0 + 0.5 * speed));
}

/** Blend 0 (walk) → 1 (run) by speed. */
export function runBlend(speed: number): number {
  const t = Math.min(1, Math.max(0, (speed - 2.8) / (4.3 - 2.8)));
  return t * t * (3 - 2 * t);
}

/** Fraction of a cycle each foot is on the ground. */
export function dutyFactor(speed: number): number {
  return 0.56 + (0.29 - 0.56) * runBlend(speed);
}

/**
 * How far ahead of the hips a foot lands (and behind it leaves) so that a planted foot moving
 * back at exactly the body speed spans the stance time: A = speed · duty / cadence.
 */
export function strideHalf(speed: number): number {
  return (speed * dutyFactor(speed)) / cadence(speed);
}

/** Shortest signed angle from a to b. */
function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const _fwd = new Vector3();
const _left = new Vector3();
const _v = new Vector3();
const _n = new Vector3();

export class Gait {
  phase = 0;
  speed = 0;
  readonly feet: [FootState, FootState];
  private idleCooldown = 0;
  private readonly p: GaitParams;

  constructor(params: GaitParams) {
    this.p = params;
    const mk = (side: number): FootState => ({
      pos: new Vector3(),
      planted: true,
      swing: 0,
      swingTime: 0.3,
      from: new Vector3(),
      to: new Vector3(),
      lift: 0,
      pitch: 0,
      stance: 0,
      side,
      yaw: 0,
      yawFrom: 0,
    });
    this.feet = [mk(1), mk(-1)];
  }

  /** Neutral standing spot for a foot (world). */
  neutral(side: number, center: Vector3, yaw: number, out: Vector3): Vector3 {
    _left.set(Math.cos(yaw), 0, -Math.sin(yaw));
    _fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    return out.copy(center).addScaledVector(_left, side * this.p.stanceWidth).addScaledVector(_fwd, side * 0.015);
  }

  /** Plant both feet at their neutral spots (spawn, teleport, landing from a jump). */
  reset(center: Vector3, yaw: number, ground: GroundFn): void {
    for (const f of this.feet) {
      this.neutral(f.side, center, yaw, f.pos);
      f.pos.y = ground(f.pos.x, f.pos.z, center.y);
      f.planted = true;
      f.swing = 0;
      f.lift = 0;
      f.pitch = 0;
      f.stance = 0;
      f.yaw = yaw;
    }
    this.speed = 0;
  }

  /** Plant both feet where they are (projected to the ground), e.g. on landing. */
  plantAt(positions: [Vector3, Vector3], ground: GroundFn, yaw: number): void {
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      f.pos.copy(positions[i]);
      f.pos.y = ground(f.pos.x, f.pos.z, positions[i].y);
      f.planted = true;
      f.swing = 0;
      f.lift = 0;
      f.pitch = 0;
      f.yaw = yaw;
    }
  }

  update(dt: number, center: Vector3, vel: Vector3, yaw: number, ground: GroundFn): void {
    const sp = Math.hypot(vel.x, vel.z);
    // A touch of smoothing so stride length doesn't jitter with input noise.
    this.speed += (sp - this.speed) * (1 - Math.exp(-12 * dt));
    const s = this.speed;
    const moving = s > 0.35;
    const f = cadence(s);
    const duty = dutyFactor(s);
    const rb = runBlend(s);
    const A = strideHalf(s) * Math.min(1, s / 0.8);
    const lift = (0.075 + 0.17 * rb) * Math.min(1, s / 1.2 + 0.4) * this.p.scale;
    if (moving) this.phase = (this.phase + (dt * f) / 2) % 1;
    _fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    // Travel direction (falls back to facing).
    if (sp > 0.05) _n.set(vel.x / sp, 0, vel.z / sp);
    else _n.copy(_fwd);

    for (const ft of this.feet) {
      const off = ft.side > 0 ? 0 : 0.5;
      const ph = (this.phase + off) % 1;
      if (moving) {
        const inStance = ph < duty;
        if (inStance) {
          ft.stance = ph / duty;
          if (!ft.planted && ft.swing >= 0.999) this.land(ft, ground);
          if (!ft.planted && ft.swing < 0.999) {
            // Swing ran late (speed changed): finish it quickly.
            ft.swingTime = Math.min(ft.swingTime, 0.08);
          }
          if (ft.planted) {
            // Heel rises toward toe-off.
            ft.pitch = 0.5 * Math.pow(Math.max(0, (ft.stance - 0.55) / 0.45), 1.6) * (0.6 + 0.4 * rb);
            if (ft.stance < 0.12) ft.pitch = -0.18 * (1 - ft.stance / 0.12) * (1 - rb * 0.6);
          }
        } else if (ft.planted) {
          // Lift off: swing toward a landing point ahead of where the body will be.
          ft.planted = false;
          ft.swing = 0;
          ft.from.copy(ft.pos);
          ft.yawFrom = ft.yaw;
          ft.swingTime = ((1 - duty) * 2) / f;
          ft.stance = 0;
        }
      } else {
        ft.stance = 0;
      }
      if (!ft.planted) {
        ft.swing = Math.min(1, ft.swing + dt / Math.max(0.05, ft.swingTime));
        const remain = (1 - ft.swing) * ft.swingTime;
        // Landing target: neutral spot at the predicted body position, plus half a stride.
        this.neutral(ft.side * (0.85 + 0.15 * (1 - rb)), center, yaw, ft.to);
        ft.to.addScaledVector(vel, remain);
        if (moving) ft.to.addScaledVector(_n, A);
        ft.to.y = ground(ft.to.x, ft.to.z, center.y);
        const q = ft.swing;
        const e = q * q * q * (q * (q * 6 - 15) + 10);
        ft.pos.lerpVectors(ft.from, ft.to, e);
        ft.yaw = ft.yawFrom + angleDiff(ft.yawFrom, yaw) * e;
        const h = moving ? lift : 0.06 * this.p.scale;
        ft.lift = h * Math.sin(Math.PI * Math.pow(q, moving ? 0.8 : 1));
        // Toes trail down after lift-off and level out before contact.
        ft.pitch = moving ? 0.55 * (1 - q) * (1 - q) * (0.5 + 0.5 * rb) - 0.15 * Math.max(0, q - 0.7) / 0.3 : 0.1 * Math.sin(Math.PI * q);
        if (ft.swing >= 1 && !moving) this.land(ft, ground);
        if (!ft.planted) ft.yaw = ft.yawFrom + angleDiff(ft.yawFrom, yaw) * e;
      } else {
        ft.lift = 0;
        if (!moving) ft.pitch *= Math.exp(-10 * dt);
      }
    }

    if (!moving) this.idleSteps(dt, center, yaw, ground);
  }

  private land(ft: FootState, ground: GroundFn): void {
    ft.planted = true;
    ft.pos.copy(ft.to);
    ft.pos.y = ground(ft.pos.x, ft.pos.z, ft.pos.y);
    ft.swing = 0;
    ft.lift = 0;
  }

  /** At rest: step a foot back under the body if it's far from its neutral spot. */
  private idleSteps(dt: number, center: Vector3, yaw: number, ground: GroundFn): void {
    this.idleCooldown = Math.max(0, this.idleCooldown - dt);
    if (this.feet.some((f) => !f.planted) || this.idleCooldown > 0) return;
    let worst: FootState | null = null;
    let worstErr = 0;
    for (const f of this.feet) {
      this.neutral(f.side, center, yaw, _v);
      const err = Math.hypot(_v.x - f.pos.x, _v.z - f.pos.z);
      if (err > worstErr) {
        worstErr = err;
        worst = f;
      }
    }
    const other = this.feet[0] === worst ? this.feet[1] : this.feet[0];
    this.neutral(other.side, center, yaw, _v);
    const otherErr = Math.hypot(_v.x - other.pos.x, _v.z - other.pos.z);
    // Big drift (turning on the spot) steps at once; small leftovers from stopping get tidied.
    if (worst && (worstErr > 0.17 * this.p.scale || (worstErr > 0.09 && this.speed < 0.08) || (otherErr > 0.09 && this.speed < 0.08))) {
      worst.planted = false;
      worst.swing = 0;
      worst.swingTime = 0.26 + 0.25 * Math.min(1, worstErr);
      worst.from.copy(worst.pos);
      worst.yawFrom = worst.yaw;
      this.idleCooldown = 0.08;
    }
  }
}
