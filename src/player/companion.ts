// The wyvern while its rider is on foot: it idles where it was left, looks around, walks after a
// rider who wanders off, hops (a short flight) when walking won't get it there, and swoops to
// catch a rider who falls off an island. Kinematic: these are short, scripted motions, not flight.

import { Quaternion, Vector3 } from 'three';
import type { BreedStats, GameEvents, TerrainQuery, WyvernGait } from '../core/types';
import type { EventBus } from '../core/events';
import { angleDelta, clamp, clamp01, lerp, smoothstep } from '../core/math';
import { GroundWalker, slopeLimitY, standingOrientation, yawOf } from './ground';
import { gaitProfile } from '../core/gait';
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
  private airRecall = false;
  private readonly recallOrientation = new Quaternion();
  /**
   * How far the rider may wander before the wyvern follows. Normally the follow distance; at a
   * new game the wyvern starts further away than that and waits where it was placed.
   */
  leash: number = P.followDistance;

  private p0 = new Vector3();
  private p1 = new Vector3();
  private p2 = new Vector3();
  private duration = 1;
  private landYaw = 0;
  private prevPos = new Vector3();
  /** The planned greeting: body center, yaw, and where the rider stood when it was planned. */
  private readonly greetAt = new Vector3();
  private greetYaw = 0;
  private readonly greetFrom = new Vector3();
  private greetPlanned = false;
  /** Called and stopped beside the rider (squaring up to them), and when that happened. */
  private arrived = false;
  private arriveTime = 0;
  /**
   * Counts called arrivals: each time the wyvern comes to a stop beside its rider it greets them
   * (the player cues WyvernPose.cue 'greet' when this changes).
   */
  greetings = 0;
  /** How much of the ground's slope the standing body takes (the breed's GaitProfile.slopeTilt). */
  private slopeTilt = gaitProfile('harrier').slopeTilt;
  /** Where foot i's footstep is heard (the Player's footstepAt); null: the walker's estimate. */
  footAt: ((i: number, out: Vector3) => Vector3 | null) | null = null;

  get position(): Vector3 {
    return this.walker.position;
  }

  /** Stand at the walker's current position facing its yaw. */
  standStill(): void {
    this.state = 'idle';
    this.airRecall = false;
    this.stateTime = 0;
    this.walker.speed = 0;
    this.velocity.set(0, 0, 0);
    this.anim.airborne = false;
    this.anim.gait = 'idle';
    this.anim.wingSpread = 0.22;
    this.anim.flapStrength = 0;
    this.anim.flare = 0;
    standingOrientation(this.walker.yaw, this.walker.normal, this.slopeTilt, 0, this.orientation);
  }

  /** Begin the catch: dive from wherever the wyvern is to just below the falling rider. */
  beginSwoop(rider: Vector3, riderVel: Vector3, catchPoint: Vector3, duration: number): void {
    this.state = 'swoop';
    this.airRecall = false;
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

  /** Cancel a pending rescue without snapping an airborne wyvern into a standing pose. */
  cancelRescue(ground: Vector3, standHeight: number): void {
    if (this.state !== 'swoop') return;
    this.called = false;
    this.beginHop(ground, standHeight, this.walker.yaw);
  }

  /** Hop (short flight) to land at `target` (a ground point), facing `faceYaw`. */
  private beginHop(target: Vector3, standHeight: number, faceYaw: number): void {
    this.state = 'hop';
    this.airRecall = false;
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
    this.slopeTilt = gaitProfile(breed.id).slopeTilt;
    this.prevPos.copy(this.walker.position);
    const w = this.walker;
    const sh = breed.standHeight;
    const dx = rider.x - w.position.x;
    const dz = rider.z - w.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    switch (this.state) {
      case 'idle':
      case 'follow': {
        // Called, it walks up beside its rider (the greeting point, see planGreeting); otherwise it
        // keeps a polite distance, its chest stopping `followStop` short.
        const wantsToCome = riderGrounded && (dist > this.leash || this.called);
        if (this.state === 'idle' && wantsToCome) {
          this.state = 'follow';
          this.stateTime = 0;
          this.greetPlanned = false;
          this.arrived = false;
        }
        if (this.state === 'follow') {
          const riderGround = terrain.groundAt(rider.x, rider.z, rider.y + 1);
          const sameLevel = riderGround && Math.abs(riderGround.y - w.groundY) < 6 && riderGround.islandId === w.islandId;
          if (!riderGrounded) {
            // Wait for the rider to land somewhere.
            w.step(dt, null, 0, breed, terrain, false);
          } else if (!this.arrived && (!sameLevel || dist > 90)) {
            this.hopToward(rider, breed, terrain);
          } else if (this.called) {
            this.approachGreeting(dt, rider, breed, terrain);
          } else {
            this.approachFollow(dt, rider, breed, terrain);
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
          standingOrientation(w.yaw, w.normal, this.slopeTilt, 0, this.orientation);
          // Footsteps on the visible footfalls, where the model's feet come down (heavy for the
          // feet carrying more than an even share of the weight, the hind feet).
          const contacts = w.gaitStep(dt, breed);
          const load = gaitProfile(breed.id).load;
          for (let i = 0; contacts !== 0 && i < 4; i++) {
            if (!(contacts & (1 << i))) continue;
            const at = this.footAt?.(i, new Vector3()) ?? w.footPosition(i, sh, new Vector3());
            events?.emit('footstep', { position: at, surface: w.surface, heavy: load[i] > 0.25 });
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
        const flatLen = Math.sqrt(_tan.x * _tan.x + _tan.z * _tan.z);
        const hop = this.state === 'hop';
        // A long hop to a lower island is scripted travel, not a high-speed aerodynamic dive.
        // Keep its silhouette readable and level the body before supported contact.
        const pitch = clamp(Math.atan2(_tan.y, flatLen), hop ? -0.55 : -0.9, 0.7)
          * (hop ? 1-smoothstep(0.75,1,t) : 1);
        if (flatLen > 0.05) w.yaw = Math.atan2(_tan.x, _tan.z);
        if (this.state === 'hop' && t > 0.8) w.yaw = lerp(w.yaw, this.landYaw, smoothstep(0.8, 1, t));
        standingOrientation(w.yaw, _a.set(0, 1, 0), 0, pitch, this.orientation);
        if (this.airRecall) this.orientation.slerpQuaternions(this.recallOrientation, this.orientation, smoothstep(0,.12,t));
        // Hop feet remain airborne until settle() actually establishes support below.
        this.anim.airborne = (this.airRecall || t > 0.06) && (hop || t < 0.97);
        this.anim.gait = t < 0.15 ? 'takeoff' : t > 0.82 ? 'landing' : 'jump';
        this.anim.wingSpread = this.state === 'swoop' && t > 0.3 && t < 0.75 ? 0.45 : 1;
        this.anim.flapStrength = this.state === 'hop' ? (t < 0.6 ? 0.85 : 0.4) : t < 0.3 ? 0.9 : 0.2;
        this.anim.flapPhase = (flapClock * breed.flapRate) % 1;
        const descent = hop ? smoothstep(.1,.65,-_tan.y/Math.max(.1,flatLen))*.8 : 0;
        this.anim.flare = Math.max(descent,smoothstep(0.7, 0.95, t) * (hop ? 1 : 0.5));
        const g = terrain.groundAt(w.position.x, w.position.z, w.position.y);
        w.groundY = g ? g.y : w.groundY;
        if (this.state === 'hop' && t >= 1) {
          w.position.copy(this.p2);
          w.speed = 0;
          if (w.settle(terrain, sh)) {
            events?.emit('footstep', { position: w.position.clone().setY(w.groundY), surface: w.surface, heavy: true });
          }
          // It came down beside its rider: a called hop ends in the greeting.
          if (this.called) this.greetings++;
          this.standStill();
          this.called = false;
          this.leash = P.followDistance;
        }
        break;
      }
    }
    this.velocity.copy(w.position).sub(this.prevPos).multiplyScalar(1 / Math.max(dt, 1e-6));
  }

  /**
   * Walk up to the greeting point and stop there (easing in, the last few metres slow), then turn
   * square to the greeting yaw. The moment it stops it greets its rider (`greetings` counts up).
   */
  private approachGreeting(dt: number, rider: Vector3, breed: BreedStats, terrain: TerrainQuery): void {
    const w = this.walker;
    const sh = breed.standHeight;
    // (Re)plan on the call, and again if the rider walks off before it gets there.
    if (!this.arrived && (!this.greetPlanned || this.greetFrom.distanceToSquared(rider) > 1.5 * 1.5)) {
      this.planGreeting(rider, sh, w.position, this.greetAt);
      this.greetPlanned = true;
    }
    const fx = Math.sin(this.greetYaw);
    const fz = Math.cos(this.greetYaw);
    const gx = this.greetAt.x - w.position.x;
    const gz = this.greetAt.z - w.position.z;
    const s = Math.sqrt(gx * gx + gz * gz);
    if (!this.arrived) {
      // There (or just past it, along its own heading): stop.
      const ahead = gx * Math.sin(w.yaw) + gz * Math.cos(w.yaw);
      const there = s < 0.15 || (s < 1 && ahead < 0);
      if (there) {
        _dir.set(fx, 0, fz);
        w.step(dt, _dir, 0, breed, terrain, false, rider);
        if (w.speed === 0) {
          this.arrived = true;
          this.arriveTime = this.stateTime;
          this.greetings++;
        }
      } else {
        // Steer for a point behind the goal on the greeting line, so it walks in straight.
        const back = Math.min(0.6 * s, 5);
        _dir.set(gx - fx * back, 0, gz - fz * back);
        const res = w.step(dt, _dir, this.approachSpeed(s, breed), breed, terrain, false, rider);
        if (res === 'blocked' && this.stateTime > 0.5) this.hopToward(rider, breed, terrain);
      }
      return;
    }
    // Arrived: square up to the greeting yaw on the spot, then settle.
    _dir.set(fx, 0, fz);
    w.step(dt, _dir, 0, breed, terrain, false, rider);
    if (Math.abs(angleDelta(w.yaw, this.greetYaw)) < 0.1 || this.stateTime - this.arriveTime > 4) this.settle();
  }

  /** Follow a rider who wandered off: walk (or run, from far) until the chest is `followStop` from them. */
  private approachFollow(dt: number, rider: Vector3, breed: BreedStats, terrain: TerrainQuery): void {
    const w = this.walker;
    w.chest(breed.standHeight, _a);
    _dir.set(rider.x - w.position.x, 0, rider.z - w.position.z);
    const s = Math.hypot(rider.x - _a.x, rider.z - _a.z) - P.followStop;
    if (s <= 0.15) {
      // Pull up and turn to face the rider before settling.
      w.step(dt, _dir, 0, breed, terrain, false, rider);
      const facing = Math.abs(angleDelta(w.yaw, Math.atan2(_dir.x, _dir.z))) < 0.35;
      if (w.speed === 0 && (facing || this.stateTime > 6)) this.settle();
      return;
    }
    const res = w.step(dt, _dir, this.approachSpeed(s, breed), breed, terrain, false, rider);
    if (res === 'blocked' && this.stateTime > 0.5) this.hopToward(rider, breed, terrain);
  }

  /**
   * Approach speed `s` m short of the stop: a walk (approachWalk × groundSpeed) inside
   * approachRunFrom, a run from further that eases down into the walk, slowing at approachDecel
   * to approachSlowSpeed for the last approachSlowFrom m and on to a stop.
   */
  private approachSpeed(s: number, breed: BreedStats): number {
    const walk = P.approachWalk * breed.groundSpeed;
    const slow = Math.min(P.approachSlowSpeed, walk);
    const a = P.approachDecel;
    let v = s > P.approachRunFrom ? Math.sqrt(walk * walk + 2 * a * (s - P.approachRunFrom)) : walk;
    v = Math.min(v, breed.groundSpeed);
    if (s > P.approachSlowFrom) return Math.min(v, Math.sqrt(slow * slow + 2 * a * (s - P.approachSlowFrom)));
    return Math.min(slow, Math.sqrt(2 * a * Math.max(0, s)));
  }

  /** Done coming over: stand and idle where it is. */
  private settle(): void {
    this.called = false;
    this.leash = P.followDistance;
    this.state = 'idle';
    this.airRecall = false;
    this.stateTime = 0;
    this.greetPlanned = false;
  }

  /**
   * The greeting pose for a wyvern coming from `from`: the body center `out` and `greetYaw`, with
   * the rider beside its near (left) shoulder (greetAlong ahead of the center, greetWrist +
   * greetSide out from the midline, and the chest at least calledStop away). It walks in along
   * that line, so the yaw is the bearing to the rider turned just enough to pass them on its left.
   * `yawOffset` turns the approach about the rider (alternatives for a hop).
   */
  private planGreeting(rider: Vector3, sh: number, from: Vector3, out: Vector3, yawOffset = 0): Vector3 {
    const along = P.greetAlong * sh;
    const chestGap = (P.chestAhead - P.greetAlong) * sh;
    const lat = Math.max(P.greetWrist * sh + P.greetSide, Math.sqrt(Math.max(0, P.calledStop * P.calledStop - chestGap * chestGap)));
    const dx = rider.x - from.x;
    const dz = rider.z - from.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const bearing = d > 1e-3 ? Math.atan2(dx, dz) : this.walker.yaw;
    const yaw = bearing - Math.asin(clamp(lat / Math.max(d, 1e-3), -1, 1)) + yawOffset;
    this.greetYaw = yaw;
    this.greetFrom.copy(rider);
    // Center = rider − forward·along − left·lat (left = (cos yaw, 0, −sin yaw)).
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    return out.set(rider.x - s * along - c * lat, rider.y, rider.z - c * along + s * lat);
  }

  /** Ground recall of an independently flying dragon. Failure leaves its current flight intact. */
  recallFromAir(rider: Vector3, breed: BreedStats, terrain: TerrainQuery): boolean {
    return this.hopToward(rider, breed, terrain, true);
  }

  /** Find a landing spot beside the rider (a greeting point) and hop there. */
  private hopToward(rider: Vector3, breed: BreedStats, terrain: TerrainQuery, fromAir = false): boolean {
    const sh = breed.standHeight;
    for (let k = 0; k < 8; k++) {
      const off = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 4);
      this.planGreeting(rider, sh, this.walker.position, _a, off);
      const g = terrain.groundAt(_a.x, _a.z, rider.y + 3);
      if (!g || g.normal.y < slopeLimitY(breed.id, 'walk') || Math.abs(g.y - rider.y) > 3) continue;
      _a.y = g.y;
      // Land on the greeting line, facing along it.
      this.beginHop(_a, sh, this.greetYaw);
      // Already airborne: never replay the ground launch or plant feet at the old perch.
      this.airRecall = fromAir;
      this.recallOrientation.copy(this.orientation);
      return true;
    }
    if (fromAir) { this.called = false; return false; }
    // Nowhere to land near the rider: stay put.
    this.called = false;
    this.state = 'idle';
    this.airRecall = false;
    this.stateTime = 0;
    return false;
  }
}

