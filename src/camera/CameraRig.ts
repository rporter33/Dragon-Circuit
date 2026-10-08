// The camera system. Picks a sub-rig from the camera mode and the player's state (flight chase,
// mounted-on-ground orbit, on-foot orbit, falling, title, stable, photo), glides between rigs
// with a critically damped offset (no cuts, no steady-state lag), and layers the physical
// feedback on top: trauma shake from impacts, high-speed buffeting, stall wobble, a dip on each
// heavy wingbeat and a small FOV punch through rings. Reduced motion turns all of that off.

import { PerspectiveCamera, Vector3 } from 'three';
import type { GameEventBus } from '../core/events';
import type { InputFrame, Settings, TerrainQuery } from '../core/types';
import type { CameraMode, CameraSystem, PlayerSystem } from '../game/contracts';
import { clamp, smoothstep } from '../core/math';
import { filmOffsetForShift, springDecay, type SpringState } from './cameraMath';
import { CameraShake, type ShakeOffsets } from './shake';
import { FlightRig, OrbitRig } from './followRigs';
import { PhotoRig, StableRig, TitleRig, type StableFocus } from './showRigs';
import { createShot, type CameraPose, type CameraShot, type Rig, type RigContext } from './rigTypes';

export type RigKind = 'flight' | 'mounted' | 'foot' | 'falling' | 'title' | 'stable' | 'photo';

/** How quickly the camera glides from one rig to the next (critically damped ω, 1/s). */
export function transitionOmega(from: RigKind, to: RigKind): number {
  if (from === 'title') return 1.6; // the hand-off from the title shot is a slow, graceful glide
  if (to === 'title') return 2.2;
  if (from === 'stable' || to === 'stable') return 3.2;
  if (from === 'photo' || to === 'photo') return 6;
  if ((from === 'flight') !== (to === 'flight')) return 2.8; // take-off and landing
  return 4.5;
}

/** A teleport (respawn, race start) moves the subject further than this in one frame → snap. */
const TELEPORT_DISTANCE = 60;

interface VecSpring {
  x: Vector3;
  v: Vector3;
}

function decayVec(s: VecSpring, omega: number, dt: number): void {
  const e = Math.exp(-omega * dt);
  const kx = (s.v.x + omega * s.x.x) * dt;
  const ky = (s.v.y + omega * s.x.y) * dt;
  const kz = (s.v.z + omega * s.x.z) * dt;
  s.x.set((s.x.x + kx) * e, (s.x.y + ky) * e, (s.x.z + kz) * e);
  s.v.set((s.v.x - omega * kx) * e, (s.v.y - omega * ky) * e, (s.v.z - omega * kz) * e);
}

const dirTmp = new Vector3();

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
    falling: new OrbitRig('falling'),
    title: new TitleRig(),
    stable: this.stableRig,
    photo: new PhotoRig(),
  };
  private active: RigKind | null = null;
  private pendingSnap = true;
  private shot: CameraShot = createShot();
  /** The blended shot (before shake) shown last frame. */
  private out: CameraShot = createShot();
  private blendPos: VecSpring = { x: new Vector3(), v: new Vector3() };
  private blendTarget: VecSpring = { x: new Vector3(), v: new Vector3() };
  private blendRoll: SpringState = { x: 0, v: 0 };
  private blendFov: SpringState = { x: 0, v: 0 };
  private blendShift: SpringState = { x: 0, v: 0 };
  private blendOmega = 4;
  private shaker = new CameraShake();
  private shakeOut: ShakeOffsets = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0 };
  /** Vertical dip (m) from heavy wingbeats and landings. */
  private kick: SpringState = { x: 0, v: 0 };
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

  constructor(camera: PerspectiveCamera, terrain: Pick<TerrainQuery, 'distance'>, settings: () => Settings, events?: GameEventBus) {
    this.camera = camera;
    this.settings = settings;
    this.ctx = { terrain, settings: settings(), camera, time: 0, zoom: 1 };
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
    const s = this.settings();
    const ctx = this.ctx;
    ctx.settings = s;
    ctx.time += dt;

    if (this.override) {
      this.camera.position.copy(this.override.position);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.override.target);
      this.applyProjection(s.fov, 0);
      this.updateYaw();
      return;
    }

    const kind = this.pickRig(player);
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

    const snapping = this.pendingSnap || this.active === null;
    const switching = snapping || kind !== this.active;
    const rig = this.rigs[kind];
    if (switching) rig.enter(player, this.currentPose(snapping), ctx);
    rig.update(dt, input, player, ctx, this.shot);

    if (switching) {
      if (snapping) this.clearBlend();
      else this.startBlend(transitionOmega(this.active!, kind));
      this.active = kind;
      this.pendingSnap = false;
    } else {
      this.decayBlend(dt);
    }

    const out = this.out;
    out.position.copy(this.shot.position).add(this.blendPos.x);
    out.target.copy(this.shot.target).add(this.blendTarget.x);
    out.roll = this.shot.roll + this.blendRoll.x;
    out.fov = this.shot.fov + this.blendFov.x;
    out.shift = this.shot.shift + this.blendShift.x;

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

  private clearBlend(): void {
    this.blendPos.x.set(0, 0, 0);
    this.blendPos.v.set(0, 0, 0);
    this.blendTarget.x.set(0, 0, 0);
    this.blendTarget.v.set(0, 0, 0);
    this.blendRoll.x = this.blendRoll.v = 0;
    this.blendFov.x = this.blendFov.v = 0;
    this.blendShift.x = this.blendShift.v = 0;
  }

  /** Start gliding from what was on screen (this.out) to the new rig's shot. */
  private startBlend(omega: number): void {
    this.blendOmega = omega;
    this.blendPos.x.subVectors(this.out.position, this.shot.position);
    this.blendTarget.x.subVectors(this.out.target, this.shot.target);
    this.blendRoll.x = this.out.roll - this.shot.roll;
    this.blendFov.x = this.out.fov - this.shot.fov;
    this.blendShift.x = this.out.shift - this.shot.shift;
    this.blendPos.v.set(0, 0, 0);
    this.blendTarget.v.set(0, 0, 0);
    this.blendRoll.v = this.blendFov.v = this.blendShift.v = 0;
  }

  private decayBlend(dt: number): void {
    const w = this.blendOmega;
    decayVec(this.blendPos, w, dt);
    decayVec(this.blendTarget, w, dt);
    springDecay(this.blendRoll, w, dt);
    springDecay(this.blendFov, w, dt);
    springDecay(this.blendShift, w, dt);
  }

  private applyToCamera(dt: number, s: Settings, player: PlayerSystem, kind: RigKind): void {
    const cam = this.camera;
    const out = this.out;
    const reduced = s.reducedMotion;
    const flying = kind === 'flight';
    const pose = player.wyvernPose;

    this.shaker.buffet = flying && !reduced ? smoothstep(50, 95, pose.airspeed || pose.velocity.length()) : 0;
    this.shaker.wobble = flying && !reduced ? pose.stall : 0;
    const so = this.shaker.update(dt, this.shakeOut);
    springDecay(this.kick, 9, dt);
    springDecay(this.fovPunch, 7, dt);

    cam.position.copy(out.position);
    cam.up.set(0, 1, 0);
    if (out.target.distanceToSquared(out.position) < 1e-6) out.target.y -= 0.01;
    cam.lookAt(out.target);
    if (reduced) {
      if (out.roll !== 0) cam.rotateZ(-out.roll);
    } else {
      // Local axes after lookAt: Z points back, X right, Y up. Roll right = rotate about −Z.
      cam.rotateZ(-(out.roll + so.roll));
      cam.rotateX(-so.pitch);
      cam.rotateY(so.yaw);
      cam.translateX(so.x);
      cam.translateY(so.y - this.kick.x);
    }
    this.applyProjection(out.fov + (reduced ? 0 : this.fovPunch.x), out.shift);
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
      if (calm() || strength < 0.35) return;
      // The downstroke heaves the body up; the camera dips under it a beat behind.
      this.kick.v += 6 * strength;
      if (strength > 0.7) this.shaker.add(0.03 * strength);
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
      this.pendingSnap = true;
    }));
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
  }
}
