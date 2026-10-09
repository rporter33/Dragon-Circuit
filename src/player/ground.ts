// The wyvern on its feet: turning and walking over the analytic terrain, cliff-edge detection,
// and the standing orientation (yaw plus a little of the ground's slope). Used while the player
// is mounted on the ground and by the riderless wyvern when it follows its rider.

import { Matrix4, Quaternion, Vector3 } from 'three';
import type { BreedId, BreedStats, ContactInfo, SurfaceKind, TerrainQuery } from '../core/types';
import { angleDelta, clamp, damp, smoothstep } from '../core/math';
import { TURN_CYCLE, footOffset, froudeStride, gaitProfile, runBlendAt } from '../core/gait';
import { PLAYER_TUNING as P } from './tuning';

export type WalkResult = 'ok' | 'edge' | 'blocked';

/**
 * Where the feet stand in the body frame, × standHeight: [left/right, forward] (hind, then fore).
 * A footstep's position when no model reports its foot (PlayerDeps.foot).
 */
export const GAIT = {
  hind: [0.3, -0.2] as const,
  fore: [0.5, 0.55] as const,
};

/**
 * The slope limits, per breed: the least ground normal y the wyvern can land on ('land') and walk
 * up ('walk'). Its GaitProfile's own limit, else the global one (PLAYER_TUNING landNormalY,
 * maxSlopeY); a breed that climbs steeper ground is one field in its profile row.
 */
export function slopeLimitY(breed: BreedId, kind: 'land' | 'walk'): number {
  const g = gaitProfile(breed);
  return kind === 'land' ? (g.landNormalY ?? P.landNormalY) : (g.walkNormalY ?? P.maxSlopeY);
}

const _m = new Matrix4();
const _up = new Vector3();
const _fwd = new Vector3();
const _left = new Vector3();
const _probe = new Vector3();
const _push = new Vector3();
const _n = new Vector3();
const _info: ContactInfo = { soft: false };
const _stride = new Float64Array(2);

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
  /** Yaw rate (rad/s, + = left), limited in acceleration. */
  yawRate = 0;
  /** Smoothed yaw rate (rad/s), for leaning and tail swing. */
  turnRate = 0;
  /** Horizontal velocity of the body center (m/s): the walk plus the pivot of a turn. */
  readonly velocity = new Vector3();
  groundY = 0;
  readonly normal = new Vector3(0, 1, 0);
  surface: SurfaceKind = 'grass';
  islandId = -1;
  /** Distance walked since the last footstep. */
  private stride = 0;
  private stepSide = 0;
  /**
   * 0..1 position in the gait cycle (the breed's GaitProfile, core/gait.ts): goes out on
   * WyvernPose.gaitPhase, and the model's feet follow it, so each footstep lands on a footfall.
   */
  gaitPhase = 0;
  /** Bit i set: foot i (LH, RH, LF, RF) touched down during the last gaitStep(). */
  contacts = 0;
  /**
   * Each foot's own phase (0..1, touching down as it wraps): the clock plus the foot's offset, held
   * while a change of gait moves its offset back faster than the clock runs (it never steps twice).
   */
  private readonly footPh = new Float64Array(4).fill(NaN);

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
   * reports 'edge' without moving so the caller can launch into the air. With `keepOut` (the
   * riderless wyvern's rider, on foot), its chest never comes within `riderKeepOut` of that point.
   */
  step(
    dt: number,
    dir: Vector3 | null,
    targetSpeed: number,
    breed: BreedStats,
    terrain: TerrainQuery,
    allowEdge: boolean,
    keepOut: Vector3 | null = null,
  ): WalkResult {
    // A big animal turns slowly (each breed its own rate), winding the turn up and easing it out
    // at the yaw-acceleration limit, and on the spot it pivots on its haunches.
    const maxTurn = P.groundTurnRate[breed.id];
    const yawAccel = P.groundYawAccel;
    let speedTarget = 0;
    let rate = 0;
    if (dir && dir.x * dir.x + dir.z * dir.z > 1e-6) {
      const want = Math.atan2(dir.x, dir.z);
      const err = angleDelta(this.yaw, want);
      const ae = Math.abs(err);
      // The fastest rate that can still stop on the heading at the yaw-acceleration limit
      // (proportional close in, so it settles without hunting).
      rate = Math.sign(err) * Math.min(maxTurn, ae * 6, Math.sqrt(2 * yawAccel * ae));
      // Turn on the spot when facing away; slow down through tight turns.
      speedTarget = targetSpeed * Math.max(0, Math.cos(err));
    }
    const dRate = clamp(rate - this.yawRate, -yawAccel * dt, yawAccel * dt);
    this.yawRate += dRate;
    const dYaw = this.yawRate * dt;
    const s0 = Math.sin(this.yaw);
    const c0 = Math.cos(this.yaw);
    this.yaw += dYaw;
    this.turnRate = damp(this.turnRate, this.yawRate, 10, dt);
    const accel = speedTarget > this.speed ? P.wyvernAccel : P.wyvernBrake;
    this.speed += clamp(speedTarget - this.speed, -accel * dt, accel * dt);
    // Pivot: the body center swings about the hind point instead of turning about itself.
    const pivotW = 1 - smoothstep(P.turnPivotSpeed, 2 * P.turnPivotSpeed, this.speed);
    let px = 0;
    let pz = 0;
    if (pivotW > 0 && dYaw !== 0) {
      const k = pivotW * P.turnPivot * breed.standHeight;
      px = (Math.sin(this.yaw) - s0) * k;
      pz = (Math.cos(this.yaw) - c0) * k;
    }
    if (this.speed < 1e-3) {
      this.speed = 0;
      if (px !== 0 || pz !== 0) this.pivot(px, pz, terrain);
      this.velocity.set(dt > 0 ? px / dt : 0, 0, dt > 0 ? pz / dt : 0);
      // Standing (or turning on the spot) still mustn't leave the head in a wall, or the chest
      // on its rider.
      this.resolveWalls(terrain, breed.standHeight, 0, slopeLimitY(breed.id, 'land'));
      if (keepOut) this.stayClear(keepOut, breed.standHeight);
      return 'ok';
    }

    const nx = this.position.x + Math.sin(this.yaw) * this.speed * dt + px;
    const nz = this.position.z + Math.cos(this.yaw) * this.speed * dt + pz;
    const g = terrain.groundAt(nx, nz, this.groundY + 2.5);
    if (!g || g.y < this.groundY - P.edgeDrop) {
      if (allowEdge) return 'edge';
      this.speed = 0;
      return 'blocked';
    }
    // Too steep to climb: walking uphill means walking against the slope's downhill direction.
    if (g.normal.y < slopeLimitY(breed.id, 'walk') && Math.sin(this.yaw) * g.normal.x + Math.cos(this.yaw) * g.normal.z < 0) {
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
    if (this.resolveWalls(terrain, standHeight, dt, slopeLimitY(breed.id, 'land'))) {
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
    if (keepOut) this.stayClear(keepOut, breed.standHeight);
    this.velocity.set(Math.sin(this.yaw) * this.speed + px / dt, 0, Math.cos(this.yaw) * this.speed + pz / dt);
    this.stride += this.speed * dt;
    return 'ok';
  }

  /** Swing the standing body by (dx, dz) about its pivot, if there is ground to stand on there. */
  private pivot(dx: number, dz: number, terrain: TerrainQuery): void {
    const x = this.position.x + dx;
    const z = this.position.z + dz;
    const g = terrain.groundAt(x, z, this.groundY + 2.5);
    // Not over a drop or up a step it couldn't walk: then it turns about its middle instead.
    if (!g || Math.abs(g.y - this.groundY) > 0.5) return;
    const standHeight = this.position.y - this.groundY;
    this.position.x = x;
    this.position.z = z;
    this.groundY = g.y;
    this.position.y = g.y + standHeight;
    this.normal.copy(g.normal);
    this.surface = g.surface;
    this.islandId = g.islandId;
  }

  /** Chest point (world, at the body center's height): `chestAhead` × standHeight ahead of it. */
  chest(standHeight: number, out: Vector3): Vector3 {
    const k = P.chestAhead * standHeight;
    return out.set(this.position.x + Math.sin(this.yaw) * k, this.position.y, this.position.z + Math.cos(this.yaw) * k);
  }

  /**
   * Keep the chest `riderKeepOut` m clear of `p` (horizontally): the body is pushed straight back
   * out, and a wyvern that walked into it stops. True if it pushed.
   */
  private stayClear(p: Vector3, standHeight: number): boolean {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    const k = P.chestAhead * standHeight;
    const dx = this.position.x + s * k - p.x;
    const dz = this.position.z + c * k - p.z;
    const r = P.riderKeepOut;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return false;
    const d = Math.sqrt(d2);
    // Straight back along its heading when the point is dead on the chest.
    const nx = d > 1e-4 ? dx / d : -s;
    const nz = d > 1e-4 ? dz / d : -c;
    this.position.x += nx * (r - d);
    this.position.z += nz * (r - d);
    if (nx * s + nz * c < 0) this.speed = 0;
    return true;
  }

  /**
   * Push the standing/walking body horizontally out of solid walls (foliage is walked through).
   * Ground it can stand on (a push whose direction's y is at least `floorY`, the slope limit) is
   * floor, not wall: the uphill side of a steep slope it stands on never shoves it downhill.
   * True if anything pushed.
   */
  resolveWalls(terrain: TerrainQuery, standHeight: number, _dt: number, floorY: number): boolean {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    let pushed = false;
    for (const [h, fwd, r] of BODY_PROBES) {
      _probe.set(this.position.x + s * fwd * standHeight, this.groundY + h * standHeight, this.position.z + c * fwd * standHeight);
      if (!terrain.collideSphere(_probe, r * standHeight, _push, _n, _info) || _info.soft) continue;
      const hl = Math.sqrt(_push.x * _push.x + _push.z * _push.z);
      // A purely vertical push (an eave overhead, a step underfoot) isn't a wall, nor is ground.
      if (hl < 1e-4 || _push.y >= floorY * Math.sqrt(hl * hl + _push.y * _push.y)) continue;
      this.position.x += _push.x;
      this.position.z += _push.z;
      pushed = true;
    }
    return pushed;
  }

  /**
   * Advance the gait clock by the ground covered this step (or the turn on the spot) and note
   * which feet touched down. The breed's GaitProfile and the stride by dynamic similarity
   * (core/gait.ts), as the model's gait runs them. Returns the contact bitmask (0 when none).
   */
  gaitStep(dt: number, breed: BreedStats, moving = true): number {
    this.contacts = 0;
    const sh = breed.standHeight;
    const speed = Math.abs(this.speed);
    const prof = gaitProfile(breed.id);
    const run = runBlendAt(prof, speed);
    const go = moving && (speed > 0.35 || Math.abs(this.turnRate) > 0.35);
    if (go) {
      const turnEff = Math.abs(this.turnRate) * 0.9 * sh;
      const speedEff = Math.max(speed, turnEff);
      // Turning on the spot: short, quick steps round the pivot.
      const turning = speedEff > 1e-6 ? clamp((turnEff - speed) / speedEff, 0, 1) : 0;
      const stride = froudeStride(speedEff, sh, _stride)[0];
      const cycle = stride + (TURN_CYCLE * sh - stride) * turning;
      this.gaitPhase = (this.gaitPhase + (speedEff / cycle) * dt) % 1;
    }
    for (let i = 0; i < 4; i++) {
      // Model foot order is LH, RH, LF, RF; a foot lands when its own phase wraps past 1.
      const want = this.gaitPhase + footOffset(prof, i, run);
      const was = this.footPh[i];
      if (!go || was !== was) {
        this.footPh[i] = want - Math.floor(want);
        continue;
      }
      let d = want - was;
      d -= Math.round(d);
      // (Held while the offset runs back; a jump of the clock, a re-phase, is followed.)
      if (d <= 0 && d >= -0.25) continue;
      const now = was + d;
      if (d > 0 && now >= 1) this.contacts |= 1 << i;
      this.footPh[i] = now - Math.floor(now);
    }
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
