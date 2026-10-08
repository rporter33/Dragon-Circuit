// The wyvern while its rider is on foot: it idles where it was left, looks around, walks after a
// rider who wanders off, hops (a short flight) when walking won't get it there, and swoops to
// catch a rider who falls off an island. Kinematic: these are short, scripted motions, not flight.

import { Quaternion, Vector3 } from 'three';
import type { BreedStats, GameEvents, TerrainQuery, WyvernGait } from '../core/types';
import type { EventBus } from '../core/events';
import { clamp, clamp01, lerp, smoothstep } from '../core/math';
import { GroundWalker, standingOrientation, yawOf } from './ground';
import { PLAYER_TUNING as P } from './tuning';

export type CompanionState = 'idle' | 'follow' | 'hop' | 'swoop';

/** Animation channels the companion drives (copied into WyvernPose by the player). */
export interface CompanionAnim {
  airborne: boolean;
  gait: WyvernGait;
  wingSpread: number;
  flapPhase: number;
  flapStrength: number;
  flare: number;
}

const _dir = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _tan = new Vector3();

/** Quadratic Bézier point and tangent. */
function bezier(p0: Vector3, p1: Vector3, p2: Vector3, t: number, out: Vector3, tangent?: Vector3): Vector3 {
  const u = 1 - t;
  out.set(0, 0, 0).addScaledVector(p0, u * u).addScaledVector(p1, 2 * u * t).addScaledVector(p2, t * t);
  if (tangent) {
    tangent
      .copy(p1)
      .sub(p0)
      .multiplyScalar(2 * u)
      .addScaledVector(_b.copy(p2).sub(p1), 2 * t);
  }
  return out;
}

export class Companion {
  readonly walker = new GroundWalker();
  readonly orientation = new Quaternion();
  readonly velocity = new Vector3();
  state: CompanionState = 'idle';
  stateTime = 0;
  anim: CompanionAnim = { airborne: false, gait: 'idle', wingSpread: 0.22, flapPhase: 0, flapStrength: 0, flare: 0 };
  /** Set when the wyvern should come to the rider even if it's within the follow distance. */
  called = false;

  private p0 = new Vector3();
  private p1 = new Vector3();
  private p2 = new Vector3();
  private duration = 1;
  private landYaw = 0;
  private prevPos = new Vector3();

  get position(): Vector3 {
    return this.walker.position;
  }

  /** Stand at the walker's current position facing its yaw. */
  standStill(): void {
    this.state = 'idle';
    this.stateTime = 0;
    this.walker.speed = 0;
    this.velocity.set(0, 0, 0);
    this.anim.airborne = false;
    this.anim.gait = 'idle';
    this.anim.wingSpread = 0.22;
    this.anim.flapStrength = 0;
    this.anim.flare = 0;
    standingOrientation(this.walker.yaw, this.walker.normal, 0.35, 0, this.orientation);
  }

  /** Begin the catch: dive from wherever the wyvern is to just below the falling rider. */
  beginSwoop(rider: Vector3, riderVel: Vector3, catchPoint: Vector3, duration: number): void {
    this.state = 'swoop';
    this.stateTime = 0;
    this.duration = duration;
    this.p0.copy(this.walker.position);
    // If the wyvern is far away, start the swoop from a believable distance behind the rider.
    _dir.copy(this.p0).sub(rider);
    if (_dir.length() > 70) this.p0.copy(rider).addScaledVector(_dir.normalize(), 60).add(_a.set(0, 25, 0));
    this.p2.copy(catchPoint);
    // Control point: up and out, so the wyvern rises off its perch and then dives in.
    this.p1.lerpVectors(this.p0, this.p2, 0.35);
    this.p1.y = Math.max(this.p0.y, this.p2.y) + 10;
    this.landYaw = yawOf(_a.set(riderVel.x, 0, riderVel.z).lengthSq() > 0.5 ? _a : _dir.set(-_dir.x, 0, -_dir.z));
  }

  /** Hop (short flight) to land at `target` (a ground point), facing `faceYaw`. */
  private beginHop(target: Vector3, standHeight: number, faceYaw: number): void {
    this.state = 'hop';
    this.stateTime = 0;
    this.p0.copy(this.walker.position);
    this.p2.copy(target);
    this.p2.y += standHeight;
    const dist = this.p0.distanceTo(this.p2);
    this.duration = clamp(dist / 14, 1.2, 5);
    this.p1.lerpVectors(this.p0, this.p2, 0.5);
    this.p1.y = Math.max(this.p0.y, this.p2.y) + clamp(dist * 0.3, 5, 30);
    this.landYaw = faceYaw;
  }

  update(
    dt: number,
    rider: Vector3,
    riderGrounded: boolean,
    breed: BreedStats,
    terrain: TerrainQuery,
    events: EventBus<GameEvents> | undefined,
    flapClock: number,
  ): void {
    this.stateTime += dt;
    this.prevPos.copy(this.walker.position);
    const w = this.walker;
    const sh = breed.standHeight;
    const dx = rider.x - w.position.x;
    const dz = rider.z - w.position.z;
    const dist = Math.hypot(dx, dz);

    switch (this.state) {
      case 'idle':
      case 'follow': {
        const wantsToCome = riderGrounded && (dist > P.followDistance || (this.called && dist > P.followStop));
        if (this.state === 'idle' && wantsToCome) {
          this.state = 'follow';
          this.stateTime = 0;
        }
        if (this.state === 'follow') {
          const riderGround = terrain.groundAt(rider.x, rider.z, rider.y + 1);
          const sameLevel = riderGround && Math.abs(riderGround.y - w.groundY) < 6 && riderGround.islandId === w.islandId;
          if (!riderGrounded) {
            // Wait for the rider to land somewhere.
            w.step(dt, null, 0, breed, terrain, false);
          } else if (dist <= P.followStop) {
            this.called = false;
            w.step(dt, null, 0, breed, terrain, false);
            if (w.speed === 0) {
              this.state = 'idle';
              this.stateTime = 0;
            }
          } else if (!sameLevel || dist > 90) {
            this.hopToward(rider, breed, terrain);
          } else {
            _dir.set(dx, 0, dz);
            const speed = dist > P.followDistance * 1.5 ? breed.groundSpeed : breed.groundSpeed * 0.6;
            const res = w.step(dt, _dir, speed, breed, terrain, false);
            if (res === 'blocked' && this.stateTime > 0.5) this.hopToward(rider, breed, terrain);
          }
        } else {
          w.step(dt, null, 0, breed, terrain, false);
        }
        if (this.state === 'idle' || this.state === 'follow') {
          this.anim.airborne = false;
          this.anim.wingSpread = 0.22;
          this.anim.flapStrength = Math.max(0, this.anim.flapStrength - dt * 2);
          this.anim.flare = 0;
          this.anim.gait = w.speed < 0.3 ? 'idle' : w.speed < breed.groundSpeed * P.walkFraction ? 'walk' : 'run';
          standingOrientation(w.yaw, w.normal, 0.35, 0, this.orientation);
          if (w.footstep(sh * (w.speed > breed.groundSpeed * P.walkFraction ? 1.3 : 0.9))) {
            events?.emit('footstep', { position: w.position.clone().setY(w.groundY), surface: w.surface, heavy: true });
          }
        }
        break;
      }
      case 'hop':
      case 'swoop': {
        const t = clamp01(this.stateTime / this.duration);
        // Ease: a quick launch, a glide through the middle, a braking arrival.
        const e = this.state === 'swoop' ? t * t * (3 - 2 * t) : smoothstep(0, 1, t);
        bezier(this.p0, this.p1, this.p2, e, w.position, _tan);
        if (_tan.lengthSq() < 1e-6) _tan.set(Math.sin(w.yaw), 0, Math.cos(w.yaw));
        const flatLen = Math.hypot(_tan.x, _tan.z);
        const pitch = clamp(Math.atan2(_tan.y, flatLen), -0.9, 0.7);
        if (flatLen > 0.05) w.yaw = Math.atan2(_tan.x, _tan.z);
        if (this.state === 'hop' && t > 0.8) w.yaw = lerp(w.yaw, this.landYaw, smoothstep(0.8, 1, t));
        standingOrientation(w.yaw, _a.set(0, 1, 0), 0, pitch, this.orientation);
        this.anim.airborne = t > 0.06 && t < 0.97;
        this.anim.gait = t < 0.15 ? 'takeoff' : t > 0.82 ? 'landing' : 'jump';
        this.anim.wingSpread = this.state === 'swoop' && t > 0.3 && t < 0.75 ? 0.45 : 1;
        this.anim.flapStrength = this.state === 'hop' ? (t < 0.6 ? 0.85 : 0.4) : t < 0.3 ? 0.9 : 0.2;
        this.anim.flapPhase = (flapClock * breed.flapRate) % 1;
        this.anim.flare = smoothstep(0.7, 0.95, t) * (this.state === 'hop' ? 1 : 0.5);
        const g = terrain.groundAt(w.position.x, w.position.z, w.position.y);
        w.groundY = g ? g.y : w.groundY;
        if (this.state === 'hop' && t >= 1) {
          w.position.copy(this.p2);
          w.speed = 0;
          if (w.settle(terrain, sh)) {
            events?.emit('footstep', { position: w.position.clone().setY(w.groundY), surface: w.surface, heavy: true });
          }
          this.standStill();
          this.called = false;
        }
        break;
      }
    }
    this.velocity.copy(w.position).sub(this.prevPos).multiplyScalar(1 / Math.max(dt, 1e-6));
  }

  /** Find a landing spot near the rider and hop there. */
  private hopToward(rider: Vector3, breed: BreedStats, terrain: TerrainQuery): void {
    const w = this.walker;
    _dir.set(w.position.x - rider.x, 0, w.position.z - rider.z);
    if (_dir.lengthSq() < 1e-4) _dir.set(1, 0, 0);
    _dir.normalize();
    const base = Math.atan2(_dir.x, _dir.z);
    for (let k = 0; k < 8; k++) {
      const ang = base + (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 4);
      _a.set(rider.x + Math.sin(ang) * 7, rider.y, rider.z + Math.cos(ang) * 7);
      const g = terrain.groundAt(_a.x, _a.z, rider.y + 3);
      if (!g || g.normal.y < P.maxSlopeY || Math.abs(g.y - rider.y) > 3) continue;
      _a.y = g.y;
      // Land facing the rider.
      this.beginHop(_a, breed.standHeight, Math.atan2(rider.x - _a.x, rider.z - _a.z));
      return;
    }
    // Nowhere to land near the rider: stay put.
    this.called = false;
    this.state = 'idle';
    this.stateTime = 0;
  }
}

