// The gameplay cameras: the flight chase cam, an orbit cam used on foot and mounted on the
// ground, and the fall cam.
//
// Flight: the wyvern's position is followed RIGIDLY (no positional lag, so it can never drift
// away in a turn and nothing between stick and screen feels late). Only the boom's DIRECTION is
// smoothed, aligned mostly to the velocity — so a hard bank swings the camera out wide and you
// see the wyvern's flank and the curve of the turn, then it settles behind. Weight comes from
// what is layered on top: the boom stretches when you accelerate and sags when you climb, the
// lens widens with speed, the horizon rolls a little with the bank, and a flare lifts the camera
// to show the ground.

import { Vector3 } from 'three';
import { angleDelta, clamp, clamp01, damp, smoothstep, wrapAngle } from '../core/math';
import type { InputFrame } from '../core/types';
import type { PlayerSystem } from '../game/contracts';
import { autoFollowYaw, boomStep, lookReturn, speedFovKick } from './cameraMath';
import { liftClear, sphereCast } from './collision';
import { applyLook, type CameraPose, type CameraShot, type Rig, type RigContext } from './rigTypes';

const UP = new Vector3(0, 1, 0);
const D = Math.PI / 180;

// Scratch vectors (rigs run once per frame; nothing allocates).
const fwd = new Vector3();
const vdir = new Vector3();
const chase = new Vector3();
const arm = new Vector3();
const upPerp = new Vector3();
const focus = new Vector3();
const origin = new Vector3();
const toCam = new Vector3();
const lat = new Vector3();
const diff = new Vector3();
const bodyLeft = new Vector3();
const bodyUp = new Vector3();
const right = new Vector3();
const pivot = new Vector3();
const pivotS = new Vector3();
const want = new Vector3();

/** Tuning for the flight chase camera (all distances scale with the breed's wingspan). */
export const FLIGHT_CAM = {
  /** Boom length = span·distSpan + distBase, +distSpeed at full speed. */
  distSpan: 1.1,
  distBase: 5.5,
  distSpeed: 0.06,
  heightSpan: 0.24,
  heightBase: 1.6,
  /** How much the boom aligns to velocity vs. the nose (0..1). */
  velocityWeight: 0.72,
  /** Fraction of the flight path's climb/dive angle the camera follows. */
  pitchFollow: 0.85,
  yawRate: 3.4,
  pitchRate: 2.6,
  /** Look-ahead along the velocity, seconds of travel (capped). */
  lookAheadTime: 0.22,
  lookAheadMax: 16,
  /** Share of the bank angle the camera rolls with. */
  rollShare: 0.3,
  /** Seconds of stick-free time before a look offset springs back (mouse gets longer). */
  returnDelayStick: 1.2,
  returnDelayMouse: 2.0,
  /** Seconds an obstacle may hide the wyvern before the boom pulls in (thin spires flick past). */
  occlusionGrace: 0.3,
  radius: 1.1,
};

export class FlightRig implements Rig {
  private chaseYaw = 0;
  private chasePitch = 0;
  private look = { yaw: 0, pitch: 0 };
  private lookIdle = 99;
  private lookFromStick = true;
  private recenterT = 0;
  private boom = -1;
  private occluded = 0;
  private lagVel = new Vector3();
  private roll = 0;
  private fovKick = 0;
  private flare = 0;

  enter(player: PlayerSystem, _from: CameraPose, _ctx: RigContext): void {
    const pose = player.wyvernPose;
    this.chaseDirection(player, chase);
    this.chaseYaw = Math.atan2(chase.x, chase.z);
    this.chasePitch = this.targetPitch(chase);
    this.look.yaw = this.look.pitch = 0;
    this.lookIdle = 99;
    this.recenterT = 0;
    this.boom = -1;
    this.occluded = 0;
    this.lagVel.copy(pose.velocity);
    this.flare = pose.flare;
    this.roll = 0;
    this.fovKick = 0;
  }

  /** Mostly-velocity, part-nose direction of travel (unit). */
  private chaseDirection(player: PlayerSystem, out: Vector3): Vector3 {
    const pose = player.wyvernPose;
    fwd.set(0, 0, 1).applyQuaternion(pose.orientation);
    const speed = pose.velocity.length();
    if (speed > 0.5) vdir.copy(pose.velocity).multiplyScalar(1 / speed);
    else vdir.copy(fwd);
    const wv = FLIGHT_CAM.velocityWeight * smoothstep(4, 16, speed);
    out.copy(fwd).multiplyScalar(1 - wv).addScaledVector(vdir, wv);
    if (out.lengthSq() < 1e-6) out.copy(fwd);
    return out.normalize();
  }

  private targetPitch(dir: Vector3): number {
    return clamp(Math.asin(clamp(dir.y, -1, 1)) * FLIGHT_CAM.pitchFollow, -68 * D, 55 * D);
  }

  update(dt: number, input: InputFrame, player: PlayerSystem, ctx: RigContext, out: CameraShot): CameraShot {
    const C = FLIGHT_CAM;
    const pose = player.wyvernPose;
    const span = player.breed.wingspan;
    const speed = pose.velocity.length();
    const reduced = ctx.settings.reducedMotion;

    // --- Boom direction: follow the flight path ------------------------------------------------
    this.chaseDirection(player, chase);
    const horiz = Math.hypot(chase.x, chase.z);
    // Straight up/down the heading is undefined; hold it rather than spin.
    const yawGain = smoothstep(0.08, 0.3, horiz);
    const dy = angleDelta(this.chaseYaw, Math.atan2(chase.x, chase.z));
    // Big heading changes (a snap turn) are caught up faster so the wyvern never leaves frame.
    const yawRate = (C.yawRate + 4 * smoothstep(0.35, 1.2, Math.abs(dy))) * yawGain;
    this.chaseYaw = wrapAngle(this.chaseYaw + dy * (1 - Math.exp(-yawRate * dt)));
    this.chasePitch = damp(this.chasePitch, this.targetPitch(chase), C.pitchRate, dt);

    // --- Look around ---------------------------------------------------------------------------
    if (input.pressed.recenter) {
      this.recenterT = 0.35;
      this.lookIdle = 99;
    }
    if (applyLook(input, dt, this.look)) {
      this.lookIdle = 0;
      this.lookFromStick = input.lookIsRate;
    } else {
      this.lookIdle += dt;
    }
    this.look.yaw = wrapAngle(this.look.yaw);
    if (this.recenterT > 0) {
      this.recenterT -= dt;
      this.look.yaw = damp(this.look.yaw, 0, 16, dt);
      this.look.pitch = damp(this.look.pitch, 0, 16, dt);
    } else {
      const delay = this.lookFromStick ? C.returnDelayStick : C.returnDelayMouse;
      this.look.yaw = lookReturn(this.look.yaw, this.lookIdle, delay, 2.4, dt);
      this.look.pitch = lookReturn(this.look.pitch, this.lookIdle, delay, 2.4, dt);
    }
    // Camera elevation above the path: + = above, looking down. Stays within sane limits.
    const elev = clamp(-this.chasePitch + this.look.pitch, -62 * D, 72 * D);
    this.look.pitch = elev + this.chasePitch;
    const yaw = this.chaseYaw + this.look.yaw;
    // `arm` points from the camera toward the wyvern.
    arm.set(Math.cos(elev) * Math.sin(yaw), -Math.sin(elev), Math.cos(elev) * Math.cos(yaw));
    upPerp.copy(UP).addScaledVector(arm, -arm.dot(UP)).normalize();

    // --- Boom size --------------------------------------------------------------------------
    this.flare = damp(this.flare, pose.flare, 4, dt);
    const speedK = smoothstep(20, 85, speed);
    let dist = (span * C.distSpan + C.distBase) * (1 + C.distSpeed * speedK);
    let height = span * C.heightSpan + C.heightBase;
    // Flaring lifts the camera and tips it down so you can see where you're about to land.
    height += this.flare * (span * 0.35 + 1);
    dist *= (1 - 0.1 * this.flare) * ctx.zoom;

    // --- Weight: the rig lags a little behind accelerations (not velocity, so no drift) -----
    this.lagVel.lerp(pose.velocity, 1 - Math.exp(-3.2 * dt));
    diff.subVectors(pose.velocity, this.lagVel);
    if (speed > 0.5) vdir.copy(pose.velocity).multiplyScalar(1 / speed);
    else vdir.copy(fwd);
    // Drop the sideways part so turning never slides the wyvern off-centre.
    lat.crossVectors(vdir, UP);
    if (lat.lengthSq() > 1e-6) {
      lat.normalize();
      diff.addScaledVector(lat, -diff.dot(lat));
    }
    diff.multiplyScalar(-0.32);
    if (diff.lengthSq() > 2.2 * 2.2) diff.setLength(2.2);
    focus.copy(pose.position).add(diff);

    // --- Place the camera, then keep it out of rock -------------------------------------------
    want.copy(focus).addScaledVector(arm, -dist).addScaledVector(upPerp, height);
    origin.copy(focus).addScaledVector(upPerp, span * 0.08 + 0.8);
    toCam.subVectors(want, origin);
    const boomLen = toCam.length();
    toCam.multiplyScalar(1 / Math.max(1e-6, boomLen));
    const hit = sphereCast(ctx.terrain, origin, toCam, boomLen + 0.5, C.radius);
    let hard = Infinity;
    let soft = Infinity;
    if (hit < boomLen + 0.5) {
      const camInRock = ctx.terrain.distance(want) < C.radius + 0.3;
      if (camInRock || hit < 3) {
        hard = hit;
        this.occluded = C.occlusionGrace;
      } else {
        this.occluded += dt;
        if (this.occluded >= C.occlusionGrace) soft = hit;
      }
    } else {
      this.occluded = 0;
    }
    this.boom = boomStep(this.boom, boomLen, hard, soft, dt);
    out.position.copy(origin).addScaledVector(toCam, this.boom);

    // --- Aim: a little ahead along the path, wyvern in the lower-middle of the frame ----------
    const behind = Math.max(0, Math.cos(this.look.yaw));
    const lookAhead = Math.min(speed * C.lookAheadTime, C.lookAheadMax) * behind;
    out.target.copy(focus).addScaledVector(vdir, lookAhead).addScaledVector(upPerp, height * 0.32);
    out.target.y -= this.flare * 2.5;

    // --- Roll with the bank (a share of it), widen the lens with speed ------------------------
    bodyLeft.set(1, 0, 0).applyQuaternion(pose.orientation);
    bodyUp.set(0, 1, 0).applyQuaternion(pose.orientation);
    const bank = clamp(Math.atan2(bodyLeft.y, bodyUp.y), -100 * D, 100 * D);
    const targetRoll = reduced ? 0 : bank * C.rollShare * behind;
    this.roll = damp(this.roll, targetRoll, 5, dt);
    out.roll = this.roll;

    const tuck = clamp01((1 - pose.wingSpread) / 0.72);
    this.fovKick = damp(this.fovKick, reduced ? 0 : speedFovKick(pose.airspeed || speed, tuck), 2.5, dt);
    out.fov = ctx.settings.fov + this.fovKick;
    out.shift = 0;
    return out;
  }
}

export type OrbitKind = 'foot' | 'mounted';

/** Tuning per orbit flavour. */
export const ORBIT_CAM: Record<OrbitKind, {
  dist: number;
  /** Lowest orbit elevation (rad); looking up beyond it tilts the view instead. */
  orbitMin: number;
  distSpan: number;
  runExtra: number;
  pitch: number;
  pitchMin: number;
  pitchMax: number;
  shoulder: number;
  radius: number;
  follow: number;
}> = {
  foot: { dist: 5.2, orbitMin: -0.12, distSpan: 0, runExtra: 0.9, pitch: 0.14, pitchMin: -0.5, pitchMax: 1.15, shoulder: 0.55, radius: 0.35, follow: 1.0 },
  mounted: { dist: 6.5, orbitMin: -0.1, distSpan: 0.6, runExtra: 1.5, pitch: 0.26, pitchMin: -0.45, pitchMax: 1.2, shoulder: 0, radius: 0.7, follow: 0.85 },
};

/**
 * Third-person orbit: the stick/mouse turns the view freely, it gently swings round behind the
 * direction you travel when you leave it alone, and it collides with terrain (pulling in fast,
 * easing back out slowly).
 */
export class OrbitRig implements Rig {
  private view = { yaw: 0, pitch: 0 };
  private lookIdle = 99;
  private recenterT = 0;
  private boom = -1;
  private distSmooth = -1;

  constructor(readonly kind: OrbitKind) {}

  /** The subject's facing yaw (behind which "recenter" puts the camera). */
  private facing(player: PlayerSystem): number {
    if (this.kind === 'foot') return player.riderPose.yaw;
    fwd.set(0, 0, 1).applyQuaternion(player.wyvernPose.orientation);
    return Math.atan2(fwd.x, fwd.z);
  }

  private pivotOf(player: PlayerSystem, out: Vector3): Vector3 {
    if (this.kind === 'mounted') {
      return out.copy(player.wyvernPose.position).addScaledVector(UP, player.breed.wingspan * 0.06 + 1.5);
    }
    return out.copy(player.riderPose.position).addScaledVector(UP, 1.45);
  }

  enter(player: PlayerSystem, from: CameraPose, _ctx: RigContext): void {
    const P = ORBIT_CAM[this.kind];
    // Continue from wherever the camera is looking, so the hand-over is short.
    this.view.yaw = Number.isFinite(from.yaw) ? from.yaw : this.facing(player);
    this.view.pitch = clamp(Number.isFinite(from.pitch) ? from.pitch : P.pitch, P.pitchMin, P.pitchMax);
    this.lookIdle = 99;
    this.recenterT = 0;
    this.boom = -1;
    this.distSmooth = -1;
  }

  update(dt: number, input: InputFrame, player: PlayerSystem, ctx: RigContext, out: CameraShot): CameraShot {
    const P = ORBIT_CAM[this.kind];
    const vel = this.kind === 'mounted' ? player.wyvernPose.velocity : player.riderPose.velocity;
    const hspeed = Math.hypot(vel.x, vel.z);

    if (input.pressed.recenter) {
      this.recenterT = 0.3;
      this.lookIdle = 99;
    }
    if (applyLook(input, dt, this.view)) this.lookIdle = 0;
    else this.lookIdle += dt;

    if (this.recenterT > 0) {
      this.recenterT -= dt;
      this.view.yaw += angleDelta(this.view.yaw, this.facing(player)) * (1 - Math.exp(-14 * dt));
      this.view.pitch = damp(this.view.pitch, P.pitch, 14, dt);
    } else if (this.lookIdle > 0.7 && hspeed > 0.7) {
      const strength = P.follow * Math.min(1, hspeed / 4);
      this.view.yaw = autoFollowYaw(this.view.yaw, Math.atan2(vel.x, vel.z), strength, dt);
      if (this.lookIdle > 2) this.view.pitch = damp(this.view.pitch, P.pitch, 0.8, dt);
    }
    this.view.yaw = wrapAngle(this.view.yaw);
    this.view.pitch = clamp(this.view.pitch, P.pitchMin, P.pitchMax);

    const run = smoothstep(4, 8, hspeed);
    const desired = (P.dist + P.distSpan * player.breed.wingspan + P.runExtra * run) * ctx.zoom;
    this.distSmooth = this.distSmooth < 0 ? desired : damp(this.distSmooth, desired, 2, dt);

    const yaw = this.view.yaw;
    const pitch = this.view.pitch;
    // The camera only orbits down to just below the subject's eye line; looking up further just
    // tilts the view, so the subject drops to the bottom of the frame instead of the boom
    // collapsing against the ground and the subject filling the screen.
    const orbitPitch = Math.max(pitch, P.orbitMin);
    const tiltUp = orbitPitch - pitch;
    arm.set(Math.cos(orbitPitch) * Math.sin(yaw), -Math.sin(orbitPitch), Math.cos(orbitPitch) * Math.cos(yaw));
    right.set(-Math.cos(yaw), 0, Math.sin(yaw));
    this.pivotOf(player, pivot);

    // Shoulder offset first (so a wall beside you shortens it), then the boom.
    let shoulder = P.shoulder;
    if (shoulder > 0) {
      const sh = sphereCast(ctx.terrain, pivot, right, shoulder + P.radius, P.radius);
      shoulder = Math.min(shoulder, Math.max(0, sh - 0.05));
    }
    pivotS.copy(pivot).addScaledVector(right, shoulder);
    toCam.copy(arm).multiplyScalar(-1);
    const hit = sphereCast(ctx.terrain, pivotS, toCam, this.distSmooth + P.radius, P.radius);
    this.boom = boomStep(this.boom, this.distSmooth, hit, Infinity, dt, 30, 3);
    out.position.copy(pivotS).addScaledVector(toCam, this.boom);
    out.target.copy(pivotS).addScaledVector(UP, this.kind === 'mounted' ? 0.5 : 0.3);
    if (tiltUp > 0) {
      want.subVectors(out.target, out.position).applyAxisAngle(right, tiltUp);
      out.target.copy(out.position).add(want);
    }
    out.roll = 0;
    out.fov = ctx.settings.fov;
    out.shift = 0;
    return out;
  }
}

/**
 * Falling (walked off an edge): the camera rides down with the rider, a few metres out over the
 * drop and off to one side, looking down past them — the cliff face slides by on one side of the
 * frame, the cloud sea opens below, and the wyvern's rescue swoop plays out in view. Rigidly
 * attached (the world rushing past sells the speed); CameraRig's blend eases the hand-off.
 */
export class FallRig implements Rig {
  private away = new Vector3(0, 0, 1);
  private side = new Vector3(1, 0, 0);
  private boom = -1;

  enter(player: PlayerSystem, from: CameraPose, _ctx: RigContext): void {
    const r = player.riderPose;
    // Outward = the direction they were travelling when they went over.
    this.away.set(r.velocity.x, 0, r.velocity.z);
    if (this.away.lengthSq() < 0.25) {
      if (Number.isFinite(from.yaw)) this.away.set(Math.sin(from.yaw), 0, Math.cos(from.yaw));
      else this.away.set(Math.sin(r.yaw), 0, Math.cos(r.yaw));
    }
    this.away.normalize();
    this.side.set(this.away.z, 0, -this.away.x);
    // Swing out on whichever side the camera already is, so the hand-off is short.
    if (Number.isFinite(from.yaw)) {
      diff.subVectors(from.position, r.position);
      if (diff.dot(this.side) < 0) this.side.multiplyScalar(-1);
    }
    this.boom = -1;
  }

  update(dt: number, _input: InputFrame, player: PlayerSystem, ctx: RigContext, out: CameraShot): CameraShot {
    const r = player.riderPose.position;
    pivot.copy(r).addScaledVector(UP, 0.8);
    want.copy(r).addScaledVector(this.side, 6.5).addScaledVector(this.away, 3).addScaledVector(UP, 3.5);
    toCam.subVectors(want, pivot);
    const len = toCam.length();
    toCam.multiplyScalar(1 / Math.max(1e-6, len));
    const hit = sphereCast(ctx.terrain, pivot, toCam, len + 0.6, 0.6);
    this.boom = boomStep(this.boom, len, hit, Infinity, dt, 30, 3);
    out.position.copy(pivot).addScaledVector(toCam, this.boom);
    liftClear(ctx.terrain, out.position, 0.8);
    // Look a little below the rider: the drop is the story.
    out.target.copy(r).addScaledVector(UP, -0.8);
    out.roll = 0;
    out.fov = ctx.settings.fov;
    out.shift = 0;
    return out;
  }
}
