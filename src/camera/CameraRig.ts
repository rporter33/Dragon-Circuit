// The camera system. Picks a sub-rig from the camera mode and the player's state (flight chase,
// mounted-on-ground orbit, on-foot orbit, falling, title, stable, photo) and glides between rigs
// by ORBITING the subject (distance, bearing and elevation ease separately, so a hand-off never
// passes through the wyvern or rider), or cuts through a short fade when the new subject is far
// across the map. On top it layers the physical feedback that makes the wyvern feel big:
//   - a heave on every downstroke: the camera dips under the beat and rises a touch past rest,
//     further and slower for heavier breeds;
//   - the dive rush: buffeting and a wider lens when tucked and falling fast;
//   - the pull-out press: the view sinks and the lens tightens under load (g);
//   - trauma shake from impacts, high-speed buffeting, stall wobble, a dip on touchdown and a
//     small FOV punch through rings.
// None of it lags the wyvern itself (the rigs follow it rigidly), and reduced motion turns all of
// it off.

import { PerspectiveCamera, Vector3 } from 'three';
import type { GameEventBus } from '../core/events';
import type { InputFrame, Settings } from '../core/types';
import type { CameraMode, CameraSystem, PlayerSystem } from '../game/contracts';
import { clamp, clamp01, damp, smoothstep, wrapAngle } from '../core/math';
import { filmOffsetForShift, heaveFor, springDecay, springStep, type SpringState } from './cameraMath';
import { liftClear, type CameraTerrain } from './collision';
import { CameraShake, type ShakeOffsets } from './shake';
import { FallRig, FlightRig, OrbitRig } from './followRigs';
import { PhotoRig, StableRig, TitleRig, type StableFocus } from './showRigs';
import { createShot, type CameraPose, type CameraShot, type Rig, type RigContext } from './rigTypes';
import { emptyFrame } from '../input/Input';

export type RigKind = 'flight' | 'mounted' | 'foot' | 'falling' | 'title' | 'stable' | 'photo';

/** How quickly the camera glides from one rig to the next (critically damped ω, 1/s). */
export function transitionOmega(from: RigKind, to: RigKind): number {
  if (from === 'title') return 1.6; // the hand-off from the title shot is a slow, graceful glide
  if (to === 'title') return 2.2;
  if (from === 'stable' || to === 'stable') return 3.2;
  if (from === 'photo' || to === 'photo') return 6;
  // The catch: the swoop is fast, so is the swing round behind the wyvern.
  if (from === 'falling' && to === 'flight') return 4.2;
  if ((from === 'flight') !== (to === 'flight')) return 2.8; // take-off and landing
  return 4.5;
}

/** A teleport (respawn, race start) moves the subject further than this in one frame → snap. */
const TELEPORT_DISTANCE = 60;
/** Entering or leaving the stable with the camera further than this from the new shot → fade cut. */
export const CUT_DISTANCE = 22;
/** The fade cut: out, cut, in (seconds). */
export const CUT_OUT = 0.16;
export const CUT_IN = 0.32;

interface VecSpring {
  x: Vector3;
  v: Vector3;
}

function decayVec(s: VecSpring, omega: number, dt: number): void {
  if (!(dt > 0)) return;
  const e = Math.exp(-omega * dt);
  const kx = (s.v.x + omega * s.x.x) * dt;
  const ky = (s.v.y + omega * s.x.y) * dt;
  const kz = (s.v.z + omega * s.x.z) * dt;
  s.x.set((s.x.x + kx) * e, (s.x.y + ky) * e, (s.x.z + kz) * e);
  s.v.set((s.v.x - omega * kx) * e, (s.v.y - omega * ky) * e, (s.v.z - omega * kz) * e);
}

const dirTmp = new Vector3();
const pivotTmp = new Vector3();
const relTmp = new Vector3();
const scratchShot = createShot();
const D = Math.PI / 180;

export class CameraRig implements CameraSystem {
  readonly camera: PerspectiveCamera;
  mode: CameraMode = 'follow';
  /** Horizontal facing of the camera (radians, facing = (sin, 0, cos)). */
  yaw = 0;

  private settings: () => Settings;
  private override: { position: Vector3; target: Vector3 } | null = null;
  private stableRig = new StableRig();
  private rigs: Record<RigKind, Rig> = {
    flight: new FlightRig(),
    mounted: new OrbitRig('mounted'),
    foot: new OrbitRig('foot'),
    falling: new FallRig(),
    title: new TitleRig(),
    stable: this.stableRig,
    photo: new PhotoRig(),
  };
  private active: RigKind | null = null;
  private pendingSnap = true;
  private shot: CameraShot = createShot();
  /** The blended shot (before shake) shown last frame. */
  private out: CameraShot = createShot();
  /** Orbit blend around the subject: distance, bearing and elevation offsets (decaying). */
  private blendR: SpringState = { x: 0, v: 0 };
  private blendYaw: SpringState = { x: 0, v: 0 };
  private blendPitch: SpringState = { x: 0, v: 0 };
  /** Fallback linear position offset (when the camera starts right on top of the subject). */
  private blendPos: VecSpring = { x: new Vector3(), v: new Vector3() };
  private blendOrbit = false;
  private blendTarget: VecSpring = { x: new Vector3(), v: new Vector3() };
  private blendRoll: SpringState = { x: 0, v: 0 };
  private blendFov: SpringState = { x: 0, v: 0 };
  private blendShift: SpringState = { x: 0, v: 0 };
  private blendOmega = 4;
  private shaker = new CameraShake();
  private shakeOut: ShakeOffsets = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0 };
  /** Vertical dip (m) from landings and take-offs (critically damped). */
  private kick: SpringState = { x: 0, v: 0 };
  /** Wingbeat heave (m): underdamped, so the dip is followed by a small lift. */
  private heave: SpringState = { x: 0, v: 0 };
  private heaveTune = heaveFor(650);
  private tunedMass = 650;
  /** 0..1 smoothed g-load press while pulling out. */
  private press = 0;
  /** 0..1 smoothed dive rush (tucked, steep, fast). */
  private rush = 0;
  /** Extra FOV (deg) punched in by rings and race starts. */
  private fovPunch: SpringState = { x: 0, v: 0 };
  private followZoom = 1;
  private lastWyvern = new Vector3();
  private lastRider = new Vector3();
  private tracking = false;
  private ctx: RigContext;
  private fromPose: CameraPose = { position: new Vector3(), target: new Vector3(), yaw: 0, pitch: 0 };
  private appliedFov = -1;
  private appliedFilm = 0;
  private unsubscribe: (() => void)[] = [];
  private waypointSource: ((out: Vector3) => Vector3 | null) | null = null;
  private waypointTmp = new Vector3();
  /** Fade cut state: 'out' holds the old shot while darkening, 'in' brightens on the new one. */
  private cutPhase: 'none' | 'out' | 'in' = 'none';
  private cutAmount = 0;

  constructor(camera: PerspectiveCamera, terrain: CameraTerrain, settings: () => Settings, events?: GameEventBus) {
    this.camera = camera;
    this.settings = settings;
    this.ctx = { terrain, settings: settings(), camera, time: 0, zoom: 1, waypoint: null };
    if (events) this.subscribe(events);
  }

  /** Which sub-rig is driving the camera (for debugging and UI hints). */
  get rig(): RigKind | null {
    return this.active;
  }

  /** Current shake trauma 0..1 (e.g. for a matching screen effect). */
  get trauma(): number {
    return this.shaker.trauma.value;
  }

  /**
   * 0..1 full-screen fade the camera wants (the dip to black of a cut across the map, e.g.
   * opening the Stable with the wyvern far off). Game combines it with the other fades.
   */
  get fade(): number {
    return this.cutAmount * this.cutAmount * (3 - 2 * this.cutAmount);
  }

  /**
   * While racing, where the next ring (or the finish) is: the chase framing keeps it in view
   * above the wyvern. The source returns null when no race is running.
   */
  setWaypointSource(source: ((out: Vector3) => Vector3 | null) | null): void {
    this.waypointSource = source;
  }

  setOverride(pose: { position: Vector3; target: Vector3 } | null): void {
    this.override = pose ? { position: pose.position.clone(), target: pose.target.clone() } : null;
    if (!pose) this.pendingSnap = true;
  }

  shake(amount: number): void {
    if (!this.settings().reducedMotion) this.shaker.add(amount);
  }

  setStableFocus(subject: StableFocus): void {
    this.stableRig.setFocus(subject);
  }

  snap(_player: PlayerSystem): void {
    this.pendingSnap = true;
  }

  update(dt: number, input: InputFrame, player: PlayerSystem): void {
    // A bad frame time (negative on the first frame after a long startup, NaN) is a still frame.
    dt = dt > 0 ? Math.min(dt, 0.25) : 0;
    const s = this.settings();
    const ctx = this.ctx;
    ctx.settings = s;
    ctx.time += dt;
    ctx.waypoint = this.waypointSource ? this.waypointSource(this.waypointTmp) : null;
    this.tuneFor(player.breed.mass);

    if (this.override) {
      this.camera.position.copy(this.override.position);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.override.target);
      this.applyProjection(s.fov, 0);
      this.updateYaw();
      return;
    }

    let kind = this.pickRig(player);
    const followKind = kind === 'flight' || kind === 'mounted' || kind === 'foot' || kind === 'falling';
    if (followKind && input.zoom) this.followZoom = clamp(this.followZoom * Math.pow(0.92, input.zoom), 0.7, 1.6);
    ctx.zoom = followKind ? this.followZoom : 1;

    // Teleports (respawn, race start) snap instead of gliding across the map.
    if (this.tracking) {
      const w = player.wyvernPose.position;
      const r = player.riderPose.mounted ? w : player.riderPose.position;
      if (w.distanceTo(this.lastWyvern) > TELEPORT_DISTANCE || r.distanceTo(this.lastRider) > TELEPORT_DISTANCE) {
        this.pendingSnap = true;
      }
    }

    // A cut across the map (the stable framing a wyvern 50 m away): dip to black, cut, fade in.
    kind = this.updateCut(dt, kind, player);

    const snapping = this.pendingSnap || this.active === null;
    const switching = snapping || kind !== this.active;
    const rig = this.rigs[kind];
    if (switching) rig.enter(player, this.currentPose(snapping), ctx);
    rig.update(dt, input, player, ctx, this.shot);

    if (switching) {
      if (snapping) this.clearBlend();
      else this.startBlend(transitionOmega(this.active!, kind), kind, player);
      this.active = kind;
      this.pendingSnap = false;
    } else {
      this.decayBlend(dt);
    }

    this.composeOut(kind, player);
    this.applyToCamera(dt, s, player, kind);

    const wp = player.wyvernPose.position;
    this.lastWyvern.copy(wp);
    this.lastRider.copy(player.riderPose.mounted ? wp : player.riderPose.position);
    this.tracking = true;
  }

  // --- Internals ------------------------------------------------------------------------------

  private pickRig(player: PlayerSystem): RigKind {
    if (this.mode === 'title') return 'title';
    if (this.mode === 'stable') return 'stable';
    if (this.mode === 'photo') return 'photo';
    switch (player.mode) {
      case 'flying':
        return 'flight';
      case 'landed':
      case 'mounting':
      case 'dismounting':
        return 'mounted';
      case 'onFoot':
        return 'foot';
      case 'falling':
        return 'falling';
      default:
        // Respawning: hold whichever follow rig was running.
        return this.active === 'mounted' || this.active === 'foot' || this.active === 'falling' ? this.active : 'flight';
    }
  }

  /**
   * Advance the fade cut. Returns the rig to run this frame: while fading out, the old one keeps
   * playing; at black the new one takes over with a snap; then it fades back in.
   */
  private updateCut(dt: number, kind: RigKind, player: PlayerSystem): RigKind {
    if (this.cutPhase === 'none' && this.active !== null && !this.pendingSnap && kind !== this.active) {
      const stable = kind === 'stable' || this.active === 'stable';
      if (stable && this.farFrom(kind, player)) this.cutPhase = 'out';
    }
    if (this.cutPhase === 'none' && kind === 'stable' && this.active === 'stable' && this.stableRig.consumeCut()) {
      this.cutPhase = 'out';
      this.cutAmount = Math.max(this.cutAmount, 0.35); // a refocus is already a quick move
    }
    if (this.cutPhase === 'out') {
      this.cutAmount = Math.min(1, this.cutAmount + dt / CUT_OUT);
      if (this.cutAmount < 1) return this.active ?? kind;
      this.cutPhase = 'in';
      this.pendingSnap = true;
    } else if (this.cutPhase === 'in') {
      this.cutAmount = Math.max(0, this.cutAmount - dt / CUT_IN);
      if (this.cutAmount <= 0) this.cutPhase = 'none';
    }
    return kind;
  }

  /** Would gliding to `kind` cross the map? (Runs the new rig into a scratch shot.) */
  private farFrom(kind: RigKind, player: PlayerSystem): boolean {
    const rig = this.rigs[kind];
    rig.enter(player, this.currentPose(false), this.ctx);
    rig.update(0, IDLE_INPUT, player, this.ctx, scratchShot);
    return (
      scratchShot.position.distanceTo(this.camera.position) > CUT_DISTANCE * 1.5 ||
      scratchShot.target.distanceTo(this.out.target) > CUT_DISTANCE
    );
  }

  /** Where the camera is now, for the next rig to start from. NaN yaw/pitch = "use your default". */
  private currentPose(snapping: boolean): CameraPose {
    const p = this.fromPose;
    p.position.copy(this.camera.position);
    p.target.copy(this.out.target);
    if (snapping) {
      p.yaw = NaN;
      p.pitch = NaN;
    } else {
      this.camera.getWorldDirection(dirTmp);
      p.yaw = this.yaw;
      p.pitch = Math.asin(clamp(-dirTmp.y, -1, 1));
    }
    return p;
  }

  /** The point a transition orbits: the body the new rig is framing. */
  private pivotOf(kind: RigKind, player: PlayerSystem, out: Vector3): Vector3 {
    if (kind === 'flight' || kind === 'mounted') return out.copy(player.wyvernPose.position);
    if (kind === 'stable') return out.copy(this.shot.target);
    const r = player.riderPose;
    if (r.mounted) return out.copy(player.wyvernPose.position);
    out.copy(r.position);
    out.y += 1;
    return out;
  }

  private clearBlend(): void {
    this.blendOrbit = false;
    this.blendR.x = this.blendR.v = 0;
    this.blendYaw.x = this.blendYaw.v = 0;
    this.blendPitch.x = this.blendPitch.v = 0;
    this.blendPos.x.set(0, 0, 0);
    this.blendPos.v.set(0, 0, 0);
    this.blendTarget.x.set(0, 0, 0);
    this.blendTarget.v.set(0, 0, 0);
    this.blendRoll.x = this.blendRoll.v = 0;
    this.blendFov.x = this.blendFov.v = 0;
    this.blendShift.x = this.blendShift.v = 0;
  }

  /** Start gliding from what was on screen (this.out) to the new rig's shot. */
  private startBlend(omega: number, kind: RigKind, player: PlayerSystem): void {
    this.clearBlend();
    this.blendOmega = omega;
    const pivot = this.pivotOf(kind, player, pivotTmp);
    const a = relTmp.subVectors(this.out.position, pivot);
    const ra = a.length();
    const ax = a.x;
    const ay = a.y;
    const az = a.z;
    const b = dirTmp.subVectors(this.shot.position, pivot);
    const rb = b.length();
    if (ra > 1 && rb > 1 && kind !== 'photo') {
      // Orbit: ease distance, bearing and elevation about the subject separately.
      this.blendOrbit = true;
      this.blendR.x = ra - rb;
      this.blendYaw.x = wrapAngle(Math.atan2(ax, az) - Math.atan2(b.x, b.z));
      this.blendPitch.x = Math.asin(clamp(ay / ra, -1, 1)) - Math.asin(clamp(b.y / rb, -1, 1));
    } else {
      this.blendPos.x.subVectors(this.out.position, this.shot.position);
    }
    this.blendTarget.x.subVectors(this.out.target, this.shot.target);
    this.blendRoll.x = this.out.roll - this.shot.roll;
    this.blendFov.x = this.out.fov - this.shot.fov;
    this.blendShift.x = this.out.shift - this.shot.shift;
  }

  private decayBlend(dt: number): void {
    const w = this.blendOmega;
    springDecay(this.blendR, w, dt);
    springDecay(this.blendYaw, w, dt);
    springDecay(this.blendPitch, w, dt);
    decayVec(this.blendPos, w, dt);
    decayVec(this.blendTarget, w, dt);
    springDecay(this.blendRoll, w, dt);
    springDecay(this.blendFov, w, dt);
    springDecay(this.blendShift, w, dt);
  }

  /** The shown shot: the rig's shot plus whatever is left of the transition. */
  private composeOut(kind: RigKind, player: PlayerSystem): void {
    const out = this.out;
    const shot = this.shot;
    const blending = this.blendOrbit && (Math.abs(this.blendR.x) > 1e-3 || Math.abs(this.blendYaw.x) > 1e-4 || Math.abs(this.blendPitch.x) > 1e-4);
    if (blending) {
      const pivot = this.pivotOf(kind, player, pivotTmp);
      const b = relTmp.subVectors(shot.position, pivot);
      const rb = b.length();
      const r = Math.max(0.5, rb + this.blendR.x);
      const yaw = Math.atan2(b.x, b.z) + this.blendYaw.x;
      const el = clamp(Math.asin(clamp(b.y / Math.max(rb, 1e-6), -1, 1)) + this.blendPitch.x, -1.45, 1.45);
      out.position.set(Math.cos(el) * Math.sin(yaw), Math.sin(el), Math.cos(el) * Math.cos(yaw)).multiplyScalar(r).add(pivot);
      // The arc may swing low over a hill or past a wall the rigs never had to avoid.
      liftClear(this.ctx.terrain, out.position, 0.6);
    } else {
      out.position.copy(shot.position).add(this.blendPos.x);
    }
    out.target.copy(shot.target).add(this.blendTarget.x);
    out.roll = shot.roll + this.blendRoll.x;
    out.fov = shot.fov + this.blendFov.x;
    out.shift = shot.shift + this.blendShift.x;
  }

  private applyToCamera(dt: number, s: Settings, player: PlayerSystem, kind: RigKind): void {
    const cam = this.camera;
    const out = this.out;
    const reduced = s.reducedMotion;
    const flying = kind === 'flight';
    const pose = player.wyvernPose;
    const speed = pose.airspeed || pose.velocity.length();
    const camDist = Math.max(4, out.position.distanceTo(pose.position));

    // Heavy-body feedback (flight only, and never with reduced motion).
    const g = flying && !reduced ? player.flight?.gLoad ?? 1 : 1;
    this.press = damp(this.press, smoothstep(1.4, 3.2, Number.isFinite(g) ? g : 1), 4, dt);
    const tuck = clamp01((1 - pose.wingSpread) / 0.72);
    const diving = speed > 1 ? clamp01(-pose.velocity.y / speed) : 0;
    const rushGoal = flying && !reduced ? tuck * smoothstep(28, 70, speed) * smoothstep(0.25, 0.75, diving) : 0;
    this.rush = damp(this.rush, rushGoal, 3, dt);

    const speedBuffet = smoothstep(50, 95, speed);
    this.shaker.buffet = flying && !reduced ? Math.max(speedBuffet, 0.75 * this.rush, 0.55 * this.press) : 0;
    this.shaker.wobble = flying && !reduced ? pose.stall : 0;
    const so = this.shaker.update(dt, this.shakeOut);
    springDecay(this.kick, 9, dt);
    springStep(this.heave, this.heaveTune.omega, this.heaveTune.zeta, dt);
    springDecay(this.fovPunch, 7, dt);

    cam.position.copy(out.position);
    cam.up.set(0, 1, 0);
    if (out.target.distanceToSquared(out.position) < 1e-6) out.target.y -= 0.01;
    cam.lookAt(out.target);
    let fov = out.fov;
    if (reduced) {
      if (out.roll !== 0) cam.rotateZ(-out.roll);
    } else {
      // Local axes after lookAt: Z points back, X right, Y up. Roll right = rotate about −Z.
      cam.rotateZ(-(out.roll + so.roll));
      // The heave nods the view a touch with the dip (a body lifting under you, not a lift shaft).
      cam.rotateX(-so.pitch - 0.12 * this.heave.x / camDist - 0.6 * D * this.press);
      cam.rotateY(so.yaw);
      cam.translateX(so.x);
      // Pressed down under load: the view sinks a little toward the wyvern's belly side.
      cam.translateY(so.y - this.kick.x - this.heave.x - 0.022 * camDist * this.press);
      fov += this.fovPunch.x + 3 * this.rush - 3.5 * this.press;
    }
    this.applyProjection(clamp(fov, 20, 120), out.shift);
    this.updateYaw();
  }

  private applyProjection(fov: number, shift: number): void {
    const cam = this.camera;
    const film = Math.abs(shift) > 1e-4 ? filmOffsetForShift(shift, fov, cam.aspect) : 0;
    // Someone else (resize) may have rebuilt the projection; only skip when nothing changed.
    if (Math.abs(fov - this.appliedFov) > 1e-3 || Math.abs(film - this.appliedFilm) > 1e-4 || cam.fov !== fov || cam.filmOffset !== film) {
      cam.fov = fov;
      cam.filmOffset = film;
      cam.updateProjectionMatrix();
      this.appliedFov = fov;
      this.appliedFilm = film;
    }
  }

  private updateYaw(): void {
    this.camera.getWorldDirection(dirTmp);
    if (dirTmp.x * dirTmp.x + dirTmp.z * dirTmp.z > 1e-6) this.yaw = Math.atan2(dirTmp.x, dirTmp.z);
  }

  private subscribe(events: GameEventBus): void {
    const calm = () => this.settings().reducedMotion;
    const u = this.unsubscribe;
    u.push(events.on('terrainHit', ({ impulse }) => {
      if (!calm()) this.shaker.add(Math.min(1, impulse / 22));
    }));
    u.push(events.on('touchdown', ({ impact }) => {
      if (calm()) return;
      this.shaker.add(clamp(impact / 16, 0.05, 0.55));
      this.kick.v += 1.2 + 0.25 * Math.min(impact, 12);
    }));
    u.push(events.on('flap', ({ strength }) => {
      if (calm() || this.active !== 'flight' || !(strength > 0.05)) return;
      // The downstroke heaves the body up; the camera dips under it and rises a touch past rest.
      const t = this.heaveTune;
      const camDist = this.camera.position.distanceTo(this.lastWyvern);
      const peak = t.amplitude * clamp(camDist, 6, 40) * strength;
      this.heave.v += (peak * t.omega) / 0.59;
      if (strength > 0.7) this.shaker.add(0.025 * strength);
    }));
    u.push(events.on('takeoff', () => {
      if (calm()) return;
      this.shaker.add(0.12);
      this.kick.v += 2.5;
    }));
    u.push(events.on('stallStart', () => {
      if (!calm()) this.shaker.add(0.12);
    }));
    u.push(events.on('caught', () => {
      if (!calm()) this.shaker.add(0.35);
    }));
    u.push(events.on('fellOff', () => {
      if (!calm()) this.shaker.add(0.15);
    }));
    u.push(events.on('ringPassed', () => {
      if (!calm()) this.fovPunch.v += 28;
    }));
    u.push(events.on('raceStart', () => {
      if (calm()) return;
      this.fovPunch.v += 40;
      this.shaker.add(0.08);
    }));
    u.push(events.on('respawn', () => {
      this.shaker.trauma.reset();
      this.heave.x = this.heave.v = 0;
      this.pendingSnap = true;
    }));
  }

  /** Re-tune the wingbeat heave for the current breed (only recomputed when the breed changes). */
  private tuneFor(mass: number): void {
    if (mass !== this.tunedMass) {
      this.heaveTune = heaveFor(mass);
      this.tunedMass = mass;
    }
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
  }
}

/** Neutral input for probing a rig's shot without moving it (farFrom). */
const IDLE_INPUT: InputFrame = emptyFrame();
