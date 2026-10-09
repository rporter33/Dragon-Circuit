// The wyvern on its feet: turning and walking over the analytic terrain, cliff-edge detection,
// and the standing orientation (yaw plus a little of the ground's slope). Used while the player
// is mounted on the ground and by the riderless wyvern when it follows its rider.

import { Matrix4, Quaternion, Vector3 } from 'three';
import type { BreedStats, ContactInfo, SurfaceKind, TerrainQuery } from '../core/types';
import { angleDelta, clamp, damp, lerp, smoothstep } from '../core/math';
import { PLAYER_TUNING as P } from './tuning';

export type WalkResult = 'ok' | 'edge' | 'blocked';

/**
 * The wyvern's ground gait as the model animates it (creatures/wyvern/gait.ts — mirrored here,
 * since gameplay never imports presentation): four contacts per cycle, a lateral-sequence walk
 * (LH, LF, RH, RF) blending into a bounding run, the cycle covering `cycle` × standHeight of
 * ground. Footsteps fire per contact so the sounds land on the visible footfalls; the phase goes
 * out on WyvernPose.gaitPhase so the animation can follow the same clock.
 */
export const GAIT = {
  walkOffsets: [0, 0.5, 0.25, 0.75] as const,
  runOffsets: [0, 0.08, 0.5, 0.58] as const,
  walkCycle: 1.55,
  runCycle: 2.5,
  /** Walk → run blend between these × the breed's run speed (m/s). */
  runFrom: 0.7,
  runTo: 1.25,
  /** Foot rest spots in body space, × standHeight: [left/right, forward] (hind, then fore). */
  hind: [0.3, -0.2] as const,
  fore: [0.5, 0.55] as const,
};

/** Speed (m/s) at which the model's gait reads as a run (the animator's threshold). */
export function gaitRunSpeed(breed: BreedStats): number {
  return breed.id === 'galewing' ? 5 : 5.5;
}

const _m = new Matrix4();
const _up = new Vector3();
const _fwd = new Vector3();
const _left = new Vector3();
const _probe = new Vector3();
const _push = new Vector3();
const _n = new Vector3();
const _info: ContactInfo = { soft: false };

/**
 * Body probes that keep a wyvern on its feet out of walls, in standHeight units: [height above
 * the ground, forward of the body center, radius]. Knees and chest at the body, and the
 * shoulders/neck ahead of it (the head reaches a wall first).
 */
const BODY_PROBES: readonly (readonly [number, number, number])[] = [
  [0.55, 0, 0.32],
  [1.0, 0, 0.45],
  [1.05, 0.75, 0.3],
];

/**
 * Standing orientation: facing `yaw` (facing = (sin, 0, cos)), up leaning `tilt` of the way
 * toward the ground normal, and pitched by `pitch` (radians, + = nose up).
 */
export function standingOrientation(yaw: number, normal: Vector3, tilt: number, pitch: number, out: Quaternion): Quaternion {
  _up.set(0, 1, 0).lerp(normal, tilt).normalize();
  _fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
  _fwd.addScaledVector(_up, -_fwd.dot(_up)).normalize();
  if (pitch !== 0) {
    // Rotate forward toward up (nose up) about the left axis.
    _left.crossVectors(_up, _fwd);
    const c = Math.cos(pitch);
    const s = Math.sin(pitch);
    const fx = _fwd.x * c + _up.x * s;
    const fy = _fwd.y * c + _up.y * s;
    const fz = _fwd.z * c + _up.z * s;
    _up.set(_up.x * c - _fwd.x * s, _up.y * c - _fwd.y * s, _up.z * c - _fwd.z * s);
    _fwd.set(fx, fy, fz);
  }
  _left.crossVectors(_up, _fwd).normalize();
  _m.makeBasis(_left, _up, _fwd);
  return out.setFromRotationMatrix(_m);
}

/** Yaw (facing = (sin, 0, cos)) of a direction, ignoring its height. */
export function yawOf(dir: Vector3): number {
  return Math.atan2(dir.x, dir.z);
}

export class GroundWalker {
  /** Body center: standHeight above the ground. */
  readonly position = new Vector3();
  yaw = 0;
  /** Forward ground speed (m/s). */
  speed = 0;
  /** Smoothed yaw rate (rad/s), for leaning and tail swing. */
  turnRate = 0;
  groundY = 0;
  readonly normal = new Vector3(0, 1, 0);
  surface: SurfaceKind = 'grass';
  islandId = -1;
  /** Distance walked since the last footstep. */
  private stride = 0;
  private stepSide = 0;
  /** 0..1 position in the gait cycle (see GAIT). */
  gaitPhase = 0;
  /** Bit i set: foot i (LH, RH, LF, RF) touched down during the last gaitStep(). */
  contacts = 0;

  /** Snap onto the ground under (x, z) near `fromY`. False over open air. */
  settle(terrain: TerrainQuery, standHeight: number, fromY = this.position.y + 4): boolean {
    const g = terrain.groundAt(this.position.x, this.position.z, fromY);
    if (!g) return false;
    this.groundY = g.y;
    this.normal.copy(g.normal);
    this.surface = g.surface;
    this.islandId = g.islandId;
    this.position.y = g.y + standHeight;
    return true;
  }

  forward(out: Vector3): Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /**
   * Turn toward `dir` (horizontal, any length; null = stop) and run toward `targetSpeed`.
   * Stops at slopes steeper than ~40°; at a cliff edge either stops (`allowEdge` false) or
   * reports 'edge' without moving so the caller can launch into the air.
   */
  step(dt: number, dir: Vector3 | null, targetSpeed: number, breed: BreedStats, terrain: TerrainQuery, allowEdge: boolean): WalkResult {
    // Heavier, slower-rolling breeds also turn more slowly on the ground.
    const maxTurn = 1.2 + breed.maxRollRate * 0.8;
    let speedTarget = 0;
    let rate = 0;
    if (dir && dir.x * dir.x + dir.z * dir.z > 1e-6) {
      const want = Math.atan2(dir.x, dir.z);
      const err = angleDelta(this.yaw, want);
      rate = clamp(err * 6, -maxTurn, maxTurn);
      // Turn on the spot when facing away; slow down through tight turns.
      speedTarget = targetSpeed * Math.max(0, Math.cos(err));
    }
    this.yaw += rate * dt;
    this.turnRate = damp(this.turnRate, rate, 10, dt);
    const accel = speedTarget > this.speed ? P.wyvernAccel : P.wyvernBrake;
    this.speed += clamp(speedTarget - this.speed, -accel * dt, accel * dt);
    if (this.speed < 1e-3) {
      this.speed = 0;
      // Standing (or turning on the spot) still mustn't leave the head in a wall.
      this.resolveWalls(terrain, breed.standHeight, 0);
      return 'ok';
    }

    const nx = this.position.x + Math.sin(this.yaw) * this.speed * dt;
    const nz = this.position.z + Math.cos(this.yaw) * this.speed * dt;
    const g = terrain.groundAt(nx, nz, this.groundY + 2.5);
    if (!g || g.y < this.groundY - P.edgeDrop) {
      if (allowEdge) return 'edge';
      this.speed = 0;
      return 'blocked';
    }
    // Too steep to climb: walking uphill means walking against the slope's downhill direction.
    if (g.normal.y < P.maxSlopeY && Math.sin(this.yaw) * g.normal.x + Math.cos(this.yaw) * g.normal.z < 0) {
      this.speed = Math.min(this.speed, 0.5);
      return 'blocked';
    }
    const standHeight = this.position.y - this.groundY;
    const x0 = this.position.x;
    const z0 = this.position.z;
    this.position.x = nx;
    this.position.z = nz;
    this.groundY = g.y;
    this.position.y = g.y + standHeight;
    this.normal.copy(g.normal);
    this.surface = g.surface;
    this.islandId = g.islandId;
    // Walls, trunks, posts: pushed back out and along them (sliding), the pace following
    // whatever ground was actually covered.
    if (this.resolveWalls(terrain, standHeight, dt)) {
      const mx = this.position.x - x0;
      const mz = this.position.z - z0;
      const moved = Math.sqrt(mx * mx + mz * mz) / dt;
      this.speed = Math.min(this.speed, moved + 0.5);
      const gw = terrain.groundAt(this.position.x, this.position.z, this.groundY + 2.5);
      if (gw && Math.abs(gw.y - this.groundY) < P.edgeDrop) {
        this.groundY = gw.y;
        this.position.y = gw.y + standHeight;
        this.normal.copy(gw.normal);
        this.surface = gw.surface;
        this.islandId = gw.islandId;
      }
    }
    this.stride += this.speed * dt;
    return 'ok';
  }

  /**
   * Push the standing/walking body horizontally out of solid walls (foliage is walked through).
   * True if anything pushed.
   */
  resolveWalls(terrain: TerrainQuery, standHeight: number, _dt: number): boolean {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    let pushed = false;
    for (const [h, fwd, r] of BODY_PROBES) {
      _probe.set(this.position.x + s * fwd * standHeight, this.groundY + h * standHeight, this.position.z + c * fwd * standHeight);
      if (!terrain.collideSphere(_probe, r * standHeight, _push, _n, _info) || _info.soft) continue;
      const hl = Math.sqrt(_push.x * _push.x + _push.z * _push.z);
      // A purely vertical push (an eave overhead, a step underfoot) isn't a wall.
      if (hl < 1e-4) continue;
      this.position.x += _push.x;
      this.position.z += _push.z;
      pushed = true;
    }
    return pushed;
  }

  /**
   * Advance the gait clock by the ground covered this step (or the turn on the spot) and note
   * which feet touched down. Returns the contact bitmask (0 when none).
   */
  gaitStep(dt: number, breed: BreedStats, moving = true): number {
    this.contacts = 0;
    const sh = breed.standHeight;
    const speed = Math.abs(this.speed);
    const go = moving && (speed > 0.35 || Math.abs(this.turnRate) > 0.35);
    if (!go) return 0;
    const run = smoothstep(gaitRunSpeed(breed) * GAIT.runFrom, gaitRunSpeed(breed) * GAIT.runTo, speed);
    const cycle = lerp(GAIT.walkCycle, GAIT.runCycle, run) * sh;
    const speedEff = Math.max(speed, Math.abs(this.turnRate) * 0.9 * sh);
    const prev = this.gaitPhase;
    const next = prev + (speedEff / cycle) * dt;
    for (let i = 0; i < 4; i++) {
      // Model foot order is LH, RH, LF, RF; a foot lands when its own phase wraps past 1.
      const off = lerp(GAIT.walkOffsets[i], GAIT.runOffsets[i], run);
      if (Math.floor(prev + off) !== Math.floor(next + off)) this.contacts |= 1 << i;
    }
    this.gaitPhase = next % 1;
    return this.contacts;
  }

  /** World position of foot i (LH, RH, LF, RF) at rest on the ground under the body. */
  footPosition(i: number, standHeight: number, out: Vector3): Vector3 {
    const spot = i < 2 ? GAIT.hind : GAIT.fore;
    const side = i % 2 === 0 ? 1 : -1; // left is +X in the body frame
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    const lx = side * spot[0] * standHeight;
    const fz = spot[1] * standHeight;
    // Body left = (cos yaw, 0, −sin yaw), forward = (sin yaw, 0, cos yaw).
    return out.set(this.position.x + c * lx + s * fz, this.groundY, this.position.z - s * lx + c * fz);
  }

  /** True once per stride (a heavy footfall); `strideLength` scales with the body. */
  footstep(strideLength: number): boolean {
    if (this.stride < strideLength) return false;
    this.stride -= strideLength;
    this.stepSide ^= 1;
    return true;
  }

  /** Which foot landed last (0 left, 1 right), for placing footstep effects. */
  get side(): number {
    return this.stepSide;
  }
}
