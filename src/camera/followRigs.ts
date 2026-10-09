// The gameplay cameras: the flight chase cam, an orbit cam used on foot and mounted on the
// ground, and the fall cam.
//
// Flight: the wyvern's position is followed RIGIDLY (no positional lag, so it can never drift
// away in a turn and nothing between stick and screen feels late). Only the boom's DIRECTION is
// smoothed, aligned mostly to the velocity — so a hard bank swings the camera out wide and you
// see the wyvern's flank and the curve of the turn, then it settles behind. Weight comes from
// what is layered on top: the boom stretches when you accelerate and sags when you climb, the
// lens widens with speed, the horizon sways slowly into the bank (slower for heavier breeds), and
// a flare lifts the camera to show the ground. Bigger, heavier breeds are shot from further back
// on a slightly longer lens, so they read as big. (CameraRig adds the wingbeat heave, the dive
// rush and the pull-out press on top of this shot.)
//
// While racing, the next ring is kept in view above the wyvern: the camera rises just enough
// that the ring can't hide behind the wyvern's head, and the aim reaches further ahead.

import { Vector3 } from 'three';
import { angleDelta, clamp, clamp01, damp, smoothstep, wrapAngle } from '../core/math';
import type { InputFrame } from '../core/types';
import type { PlayerSystem } from '../game/contracts';
import { autoFollowYaw, boomStep, lookReturn, speedFovKick } from './cameraMath';
import { castBoom, liftClear, softContact, solidContact, type BoomHit } from './collision';
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
const toRing = new Vector3();
const toCompanion = new Vector3();
const boomHit: BoomHit = { t: Infinity, soft: false };

/**
 * How big the breed reads on screen, ~1 for the harrier: half wingspan, half body weight (the
 * cube root of mass, i.e. a length). Galewing (huge span) ≈ 1.17, ironback (heavy) ≈ 1.08,
 * skimmer ≈ 0.87.
 */
export function breedScale(breed: { wingspan: number; mass: number }): number {
  return 0.5 * (breed.wingspan / 15.5) + 0.5 * Math.cbrt(breed.mass / 650);
}

/** Body weight relative to the harrier, as a length ratio (cube root of mass): 0.89 … 1.12. */
export function breedWeight(breed: { mass: number }): number {
  return Math.cbrt(breed.mass / 650);
}

/** Tuning for the flight chase camera (all distances scale with the breed's wingspan). */
export const FLIGHT_CAM = {
  /** Boom length = span·distSpan + distBase, +distSpeed at full speed. */
  distSpan: 1.1,
  distBase: 5.5,
  distSpeed: 0.06,
  /** Extra boom per unit of body weight above the harrier's (heavier = shot from further back). */
  distWeight: 0.35,
  /** Camera height above the path: span·heightSpan + heightBase (the wyvern sits low in frame). */
  heightSpan: 0.27,
  heightBase: 2.4,
  /** Lens: degrees narrower per unit of breed scale above 1 (a big beast on a longer lens). */
  fovScale: 10,
  /** How much the boom aligns to velocity vs. the nose (0..1). */
  velocityWeight: 0.72,
  /** Fraction of the flight path's climb/dive angle the camera follows. */
  pitchFollow: 0.85,
  yawRate: 3.4,
  pitchRate: 2.6,
  /** Look-ahead along the velocity, seconds of travel (capped). */
  lookAheadTime: 0.3,
  lookAheadMax: 20,
  /** Share of the bank angle the camera rolls with… */
  rollShare: 0.32,
  /** …and how fast it sways into it (1/s, for the harrier; heavier breeds lean in slower). */
  rollRate: 2.6,
  /** Racing: a higher, further-reaching framing so the next ring shows above the wyvern. */
  race: { heightSpan: 0.3, heightBase: 3.4, lookAheadTime: 0.45, lookAheadMax: 28 },
  /** Racing: the next ring's rim stays at least this far (rad) above the wyvern on screen. */
  ringClearance: 0.24,
  /** Foliage may pull the boom in to no less than this share of its length. */
  softMin: 0.45,
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
  /** 0..1 blend toward the race framing. */
  private race = 0;
  /** Extra height (m) that keeps the next ring clear of the wyvern's head. */
  private ringLift = 0;

  enter(player: PlayerSystem, _from: CameraPose, ctx: RigContext): void {
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
    this.race = ctx.waypoint ? 1 : 0;
    this.ringLift = 0;
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
    this.race = damp(this.race, ctx.waypoint ? 1 : 0, 1.5, dt);
    const R = C.race;
    const race = this.race;
    const weight = breedWeight(player.breed);
    const speedK = smoothstep(20, 85, speed);
    let dist = (span * C.distSpan + C.distBase) * (1 + C.distSpeed * speedK) * (1 + C.distWeight * (weight - 1));
    let height = span * (C.heightSpan + (R.heightSpan - C.heightSpan) * race) + C.heightBase + (R.heightBase - C.heightBase) * race;
    // Flaring lifts the camera and tips it down so you can see where you're about to land.
    height += this.flare * (span * 0.35 + 1);
    dist *= (1 - 0.1 * this.flare) * ctx.zoom;
    // Racing: if the next ring lies further below the path than the camera sits above it, the
    // ring would hide behind the wyvern's head — rise just enough to see it over the shoulders.
    let liftGoal = 0;
    if (ctx.waypoint && race > 0.01) {
      toRing.subVectors(ctx.waypoint, pose.position);
      const ringDist = toRing.length();
      const ahead = toRing.dot(arm);
      if (ringDist > 1 && ahead > 0.2 * ringDist) {
        // Seen from the camera (dist behind, h above), the wyvern sits atan(h/dist) below the
        // boom axis and the ring atan((h + down)/(dist + ahead)): solve for the h that keeps
        // the ring `ringClearance` above the wyvern (a contraction: three steps converge).
        const down = -toRing.dot(upPerp);
        // The whole ring, not just its centre: add its angular radius (rings are ~6–10 m).
        const clearance = C.ringClearance + Math.atan2(6, ringDist);
        let h = height;
        for (let i = 0; i < 3; i++) h = dist * Math.tan(clamp(clearance + Math.atan2(h + down, dist + ahead), 0, 38 * D));
        liftGoal = Math.max(0, h - height) * race * smoothstep(12, 30, ringDist);
      }
    }
    this.ringLift = damp(this.ringLift, liftGoal, 2.8, dt);
    height += this.ringLift;

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

    // --- Place the camera, then keep it out of rock, buildings and trunks ---------------------
    want.copy(focus).addScaledVector(arm, -dist).addScaledVector(upPerp, height);
    origin.copy(focus).addScaledVector(upPerp, span * 0.08 + 0.8);
    toCam.subVectors(want, origin);
    const boomLen = toCam.length();
    toCam.multiplyScalar(1 / Math.max(1e-6, boomLen));
    const hit = castBoom(ctx.terrain, origin, toCam, boomLen + 0.5, C.radius, boomHit);
    let hard = Infinity;
    let soft = Infinity;
    if (hit.t < boomLen + 0.5) {
      const camInSolid = solidContact(ctx.terrain, want, C.radius + 0.3);
      if (hit.soft && !camInSolid) {
        // Foliage: never snap. A canopy that keeps hiding the wyvern eases the boom in front of
        // it, but not all the way (the wyvern itself may be brushing the leaves). If the camera
        // itself would sit in the leaves, there is no grace period.
        this.occluded += dt;
        if (this.occluded >= C.occlusionGrace || softContact(ctx.terrain, want, C.radius)) {
          soft = Math.max(hit.t, boomLen * C.softMin);
        }
      } else if (camInSolid || hit.t < 3) {
        hard = hit.t;
        this.occluded = C.occlusionGrace;
      } else {
        this.occluded += dt;
        if (this.occluded >= C.occlusionGrace) soft = hit.t;
      }
    } else {
      this.occluded = 0;
    }
    this.boom = boomStep(this.boom, boomLen, hard, soft, dt);
    out.position.copy(origin).addScaledVector(toCam, this.boom);

    // --- Aim: a little ahead along the path, wyvern in the lower part of the frame -------------
    const behind = Math.max(0, Math.cos(this.look.yaw));
    const aheadTime = C.lookAheadTime + (R.lookAheadTime - C.lookAheadTime) * race;
    const aheadMax = C.lookAheadMax + (R.lookAheadMax - C.lookAheadMax) * race;
    const lookAhead = Math.min(speed * aheadTime, aheadMax) * behind;
    out.target.copy(focus).addScaledVector(vdir, lookAhead).addScaledVector(upPerp, (height - this.ringLift) * 0.32);
    out.target.y -= this.flare * 2.5;

    // --- Sway into the bank (a share of it, slowly: a big body leaning), widen with speed -----
    bodyLeft.set(1, 0, 0).applyQuaternion(pose.orientation);
    bodyUp.set(0, 1, 0).applyQuaternion(pose.orientation);
    const bank = clamp(Math.atan2(bodyLeft.y, bodyUp.y), -100 * D, 100 * D);
    const targetRoll = reduced ? 0 : bank * C.rollShare * behind;
    this.roll = damp(this.roll, targetRoll, C.rollRate / (weight * weight), dt);
    out.roll = this.roll;

    const tuck = clamp01((1 - pose.wingSpread) / 0.72);
    this.fovKick = damp(this.fovKick, reduced ? 0 : speedFovKick(pose.airspeed || speed, tuck), 2.5, dt);
    // A bigger beast on a slightly longer lens (and a small one on a wider one).
    const lens = clamp(-C.fovScale * (breedScale(player.breed) - 1), -3, 3);
    out.fov = ctx.settings.fov + lens + this.fovKick;
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
  // Over the right shoulder: straight behind, the tail ran down the bottom centre of the frame
  // through the prompt row (raising or pitching the camera can't clear it; the tail tip is only a
  // few metres in front of the lens). Offset, it runs off to the lower left.
  mounted: { dist: 6.5, orbitMin: -0.1, distSpan: 0.6, runExtra: 1.5, pitch: 0.26, pitchMin: -0.45, pitchMax: 1.2, shoulder: 2.0, radius: 0.7, follow: 0.85 },
};

/** Below this boom length (m) the orbit aims along its view rather than at the subject's head. */
const MIN_LOOK = 1.6;

/** How fast (rad/s) the idle on-foot camera swings off a wyvern that fills the frame. */
const COMPANION_SWING = 0.6;

/**
 * Third-person orbit: the stick/mouse turns the view freely, it gently swings round behind the
 * direction you travel when you leave it alone, and it collides with terrain, buildings and
 * trunks (pulling in fast, easing back out slowly) and softly with foliage. On foot it also
 * drifts off the waiting wyvern when that would fill a third of the frame.
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
    if (this.kind === 'foot' && this.lookIdle > 0.7 && this.recenterT <= 0) {
      this.view.yaw += this.companionSwing(player, hspeed, ctx) * dt;
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
      const sh = castBoom(ctx.terrain, pivot, right, shoulder + P.radius, P.radius, boomHit);
      if (!sh.soft) shoulder = Math.min(shoulder, Math.max(0, sh.t - 0.05));
      // Sphere tracing takes minimum steps, so it can stop a little past the contact: back the
      // shoulder off until the boom's start is clear. A start inside a rail or a lintel would
      // collapse the whole boom onto the rider's head.
      for (let i = 0; i < 6 && shoulder > 0 && ctx.terrain.distance(want.copy(pivot).addScaledVector(right, shoulder)) < P.radius + 0.02; i++) {
        shoulder = Math.max(0, shoulder - 0.12);
      }
    }
    pivotS.copy(pivot).addScaledVector(right, shoulder);
    toCam.copy(arm).multiplyScalar(-1);
    // Squeezed (the head right under a beam, against a post): trace a thinner boom, so the camera
    // still finds the open air behind instead of stopping at the rider.
    const clear = ctx.terrain.distance(pivotS);
    const radius = clear < P.radius + 0.02 ? Math.max(0.06, clear - 0.04) : P.radius;
    const hit = castBoom(ctx.terrain, pivotS, toCam, this.distSmooth + radius, radius, boomHit);
    if (hit.soft && !solidContact(ctx.terrain, want.copy(pivotS).addScaledVector(toCam, this.distSmooth), P.radius)) {
      // Leaves: ease in front of them (never snap, never closer than 40% of the boom).
      this.boom = boomStep(this.boom, this.distSmooth, Infinity, Math.max(hit.t, this.distSmooth * 0.4), dt, 5, 3);
    } else {
      this.boom = boomStep(this.boom, this.distSmooth, hit.t, Infinity, dt, 30, 3);
    }
    out.position.copy(pivotS).addScaledVector(toCam, this.boom);
    out.target.copy(pivotS).addScaledVector(UP, this.kind === 'mounted' ? 0.5 : 0.3);
    // A boom pulled in to almost nothing would look straight up from the subject's head: aim
    // along the view instead, past the subject.
    if (this.boom < MIN_LOOK) out.target.addScaledVector(arm, MIN_LOOK - this.boom);
    if (tiltUp > 0) {
      want.subVectors(out.target, out.position).applyAxisAngle(right, tiltUp);
      out.target.copy(out.position).add(want);
    }
    out.roll = 0;
    out.fov = ctx.settings.fov;
    out.shift = 0;
    return out;
  }

  /**
   * On foot with the wyvern waiting close by, the orbit can end up with its flank right beside
   * the camera, filling a third of the frame next to the rider. Returns a yaw rate (rad/s) that
   * swings the camera round, away from it, until it stands further back in the scene (it then
   * reads as the rider's companion behind them, not a wall). 0 when clear, far, or walking.
   */
  private companionSwing(player: PlayerSystem, hspeed: number, ctx: RigContext): number {
    if (player.riderPose.mounted || hspeed > 1.5) return 0;
    const w = player.wyvernPose.position;
    const r = player.riderPose.position;
    const camDist = this.boom > 0 ? this.boom : ORBIT_CAM.foot.dist * ctx.zoom;
    if (Math.hypot(w.x - r.x, w.z - r.z) > camDist + player.breed.wingspan) return 0;
    // The wyvern relative to where the camera stands, in the camera's frame.
    const fx = Math.sin(this.view.yaw);
    const fz = Math.cos(this.view.yaw);
    toCompanion.set(w.x - (r.x - fx * camDist), 0, w.z - (r.z - fz * camDist));
    const along = toCompanion.x * fx + toCompanion.z * fz;
    const side = -toCompanion.x * fz + toCompanion.z * fx; // + = to the camera's right
    const range = toCompanion.length();
    // In view (within ~50° of the line of sight) and near the camera (closer than ~1.5× the rider).
    const inView = 1 - smoothstep(0.8, 1.05, Math.atan2(Math.abs(side), Math.max(along, 1e-3)));
    const near = 1 - smoothstep(1.4 * camDist, 1.85 * camDist, range);
    // Fades out as it comes to stand right behind the rider (no flip-flopping across the axis).
    const offAxis = smoothstep(0.4, 1.6, Math.abs(side));
    const slow = 1 - smoothstep(0.5, 1.5, hspeed);
    return -Math.sign(side) * COMPANION_SWING * inView * near * offAxis * slow;
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
    const hit = castBoom(ctx.terrain, pivot, toCam, len + 0.6, 0.6, boomHit);
    if (hit.soft) this.boom = boomStep(this.boom, len, Infinity, Math.max(hit.t, len * 0.4), dt, 6, 3);
    else this.boom = boomStep(this.boom, len, hit.t, Infinity, dt, 30, 3);
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
