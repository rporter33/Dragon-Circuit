// The wyvern on its feet: turning and walking over the analytic terrain, cliff-edge detection,
// and the standing orientation (yaw plus a little of the ground's slope). Used while the player
// is mounted on the ground and by the riderless wyvern when it follows its rider.

import { Matrix4, Quaternion, Vector3 } from 'three';
import type { BreedStats, SurfaceKind, TerrainQuery } from '../core/types';
import { angleDelta, clamp, damp } from '../core/math';
import { PLAYER_TUNING as P } from './tuning';

export type WalkResult = 'ok' | 'edge' | 'blocked';

const _m = new Matrix4();
const _up = new Vector3();
const _fwd = new Vector3();
const _left = new Vector3();

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
    if (g.normal.y < P.maxSlopeY && g.y > this.groundY + 0.02) {
      this.speed = Math.min(this.speed, 0.5);
      return 'blocked';
    }
    const standHeight = this.position.y - this.groundY;
    this.position.x = nx;
    this.position.z = nz;
    this.groundY = g.y;
    this.position.y = g.y + standHeight;
    this.normal.copy(g.normal);
    this.surface = g.surface;
    this.islandId = g.islandId;
    this.stride += this.speed * dt;
    return 'ok';
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
