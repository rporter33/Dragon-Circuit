// Presentation cameras: the title screen's slow cinematic orbit, the stable's turntable framing
// for customization, and a free photo camera.

import { Vector3 } from 'three';
import { DEG, angleDelta, clamp, damp, smoothstep, wrapAngle } from '../core/math';
import type { InputFrame } from '../core/types';
import type { PlayerSystem } from '../game/contracts';
import { boomStep, fitDistance } from './cameraMath';
import { liftClear, sphereCast } from './collision';
import { applyLook, type CameraPose, type CameraShot, type Rig, type RigContext } from './rigTypes';

const UP = new Vector3(0, 1, 0);
const fwd = new Vector3();
const center = new Vector3();
const riderHead = new Vector3();
const dir = new Vector3();
const want = new Vector3();
const move = new Vector3();

/** What the stable frames: set by the UI as you move between wyvern and rider tabs. */
export type StableFocus = 'wyvern' | 'rider' | 'both';

interface Subject {
  /** Bounding radius to fit in frame (m). */
  radius: number;
  /** Which way the subject faces; the hero view is a three-quarter front view of this. */
  heroYaw: number;
  riderNear: boolean;
}

const subject: Subject = { radius: 1, heroYaw: 0, riderNear: false };

/** The framing subject (rider, wyvern or both): writes its centre into `out`. Reuses one result. */
function subjectOf(player: PlayerSystem, out: Vector3, focus: StableFocus = 'both'): Subject {
  const w = player.wyvernPose;
  const r = player.riderPose;
  const span = player.breed.wingspan;
  fwd.set(0, 0, 1).applyQuaternion(w.orientation);
  const wyvernYaw = Math.atan2(fwd.x, fwd.z);
  // A standing wyvern with folded wings is roughly a 0.42·span sphere around its body.
  const wyvernR = span * 0.42;
  const s = subject;
  if (focus === 'rider') {
    if (r.mounted) {
      out.copy(w.position).addScaledVector(UP, 1.7);
      s.radius = 2.4;
      s.heroYaw = wyvernYaw;
    } else {
      out.copy(r.position).addScaledVector(UP, 0.95);
      s.radius = 1.25;
      s.heroYaw = r.yaw;
    }
    s.riderNear = true;
    return s;
  }
  if (r.mounted) {
    out.copy(w.position).addScaledVector(UP, 0.8);
    s.radius = wyvernR + 0.6;
    s.heroYaw = wyvernYaw;
    s.riderNear = true;
    return s;
  }
  riderHead.copy(r.position).addScaledVector(UP, 1.0);
  const sep = Math.hypot(riderHead.x - w.position.x, riderHead.z - w.position.z);
  if (focus === 'wyvern' || sep > span * 3.5) {
    // Too far apart to frame together: favour the wyvern (it is what you customize most).
    out.copy(w.position).addScaledVector(UP, 0.6);
    s.radius = wyvernR;
    s.heroYaw = wyvernYaw;
    s.riderNear = false;
    return s;
  }
  // Centre between the two, weighted toward the (much bigger) wyvern.
  out.copy(w.position).lerp(riderHead, 0.4);
  s.radius = Math.max(wyvernR, sep * 0.5 + 1.6);
  s.heroYaw = r.yaw;
  s.riderNear = true;
  return s;
}

/**
 * Title: a slow push-in from high and wide, then a gentle drift. With the rider on foot it is a
 * depth composition: the rider in the foreground, the wyvern further in, the camera low behind
 * the rider so the sky and the floating islands fill the frame beyond them. Mounted (or with
 * no rider nearby) it drifts round the wyvern instead.
 */
export class TitleRig implements Rig {
  private t0 = 0;
  private boom = -1;

  enter(_player: PlayerSystem, _from: CameraPose, ctx: RigContext): void {
    this.t0 = ctx.time;
    this.boom = -1;
  }

  update(dt: number, _input: InputFrame, player: PlayerSystem, ctx: RigContext, out: CameraShot): CameraShot {
    const t = ctx.time - this.t0;
    const intro = 1 - smoothstep(0, 9, t);
    const r = player.riderPose;
    const w = player.wyvernPose;
    let pivotPt: Vector3;
    if (!r.mounted) {
      // Rider's feet → wyvern's feet, horizontally.
      const wy = w.groundY ?? w.position.y - player.breed.standHeight;
      dir.set(w.position.x - r.position.x, 0, w.position.z - r.position.z);
      const d = Math.max(1, dir.length());
      dir.multiplyScalar(1 / d);
      // Behind the rider (away from the wyvern), swung off to one side so the rider never
      // hides the wyvern; the swing breathes slowly between 0.2 and 0.8 rad.
      const az = Math.atan2(-dir.x, -dir.z) + 0.5 + 0.3 * Math.sin((t * Math.PI * 2) / 40);
      const radius = (7.5 + 0.05 * Math.min(d, 60)) * (1 + 1.6 * intro + 0.08 * Math.sin((t * Math.PI * 2) / 31));
      // Low, near eye level, so the horizon sits low and the sky owns the frame.
      const height = 1.1 + 0.4 * Math.sin((t * Math.PI * 2) / 53 + 1) + 9 * intro;
      center.copy(r.position);
      want.set(center.x + Math.sin(az) * radius, center.y + height, center.z + Math.cos(az) * radius);
      // Aim into the scene, between the two, lifted so the horizon sits low.
      const reach = clamp(d * 0.45, 3, 24);
      out.target.set(
        r.position.x + dir.x * reach,
        Math.max(r.position.y, wy) + 3.6 + 0.08 * Math.min(d, 40) + 2 * intro,
        r.position.z + dir.z * reach,
      );
      center.y += 1.2;
      pivotPt = center;
      // Lens shift: rider on the left third, wyvern on the right, the middle left for the logo.
      out.shift = 0.14;
    } else {
      const s = subjectOf(player, center);
      const az = s.heroYaw + 0.6 + 0.42 * Math.sin((t * Math.PI * 2) / 64);
      const radius = Math.max(12, s.radius * 2.6) * (1 + 1.3 * intro);
      const height = 1.6 + 1.2 * Math.sin((t * Math.PI * 2) / 47 + 1) + 14 * intro;
      want.set(center.x + Math.sin(az) * radius, center.y + height, center.z + Math.cos(az) * radius);
      out.target.copy(center).addScaledVector(UP, s.radius * 0.55 + 1.5 * intro);
      pivotPt = center;
      out.shift = 0;
    }
    liftClear(ctx.terrain, want, 1.6);
    // Keep the subject in clear view: shorten the boom if a hill gets in the way.
    move.subVectors(want, pivotPt);
    const len = move.length();
    move.multiplyScalar(1 / Math.max(1e-6, len));
    const hit = sphereCast(ctx.terrain, pivotPt, move, len + 0.8, 0.8);
    this.boom = boomStep(this.boom, len, hit, Infinity, dt, 6, 1.5);
    out.position.copy(pivotPt).addScaledVector(move, this.boom);
    out.roll = 0;
    out.fov = clamp(ctx.settings.fov - 10, 38, 70);
    return out;
  }
}

/** Fraction of the screen the stable UI panel covers on the left. */
export const STABLE_UI_FRACTION = 0.4;

/**
 * Stable: frames the wyvern (and the rider beside it) in the right 60% of the screen using a
 * lens shift, so the customization panel on the left never covers them. Right stick / drag turns
 * the view, triggers / wheel zoom; left alone it slowly turns like a display turntable.
 */
export class StableRig implements Rig {
  private view = { yaw: 0, pitch: 0.14 };
  private zoom = 1;
  private idle = 0;
  private boom = -1;
  private center = new Vector3();
  private radius = 6;
  private focus: StableFocus = 'both';
  /** Seconds left of the glide to a new subject's hero angle. */
  private refocus = 0;

  /** Frame the wyvern, the rider or both (the UI calls this when its tab changes). */
  setFocus(focus: StableFocus): void {
    if (focus === this.focus) return;
    this.focus = focus;
    this.refocus = 0.9;
    this.zoom = 1;
  }

  enter(player: PlayerSystem, _from: CameraPose, _ctx: RigContext): void {
    const s = subjectOf(player, this.center, this.focus);
    this.radius = s.radius;
    // Three-quarter front view (for the wyvern, from its left: its head turns toward the UI).
    this.view.yaw = s.heroYaw + 0.75;
    this.view.pitch = 0.14;
    this.zoom = 1;
    this.idle = 0;
    this.boom = -1;
    this.refocus = 0;
  }

  update(dt: number, input: InputFrame, player: PlayerSystem, ctx: RigContext, out: CameraShot): CameraShot {
    // Subject is re-read every frame (breed changes resize it) but eased so swaps glide.
    const s = subjectOf(player, center, this.focus);
    this.center.lerp(center, 1 - Math.exp(-6 * dt));
    this.radius = damp(this.radius, s.radius, 6, dt);

    const looked = applyLook(input, dt, this.view, 0.75, 0.7);
    const zoomed = (input.zoom ?? 0) !== 0;
    if (zoomed) this.zoom = clamp(this.zoom * Math.pow(0.88, input.zoom ?? 0), 0.65, 1.6);
    this.idle = looked || zoomed ? 0 : this.idle + dt;
    if (this.refocus > 0) {
      this.refocus = looked ? 0 : this.refocus - dt;
      this.view.yaw += angleDelta(this.view.yaw, s.heroYaw + 0.75) * (1 - Math.exp(-5 * dt));
      this.view.pitch = damp(this.view.pitch, 0.14, 5, dt);
    }
    if (this.idle > 6) this.view.yaw += 0.05 * dt * smoothstep(6, 9, this.idle);
    this.view.yaw = wrapAngle(this.view.yaw);
    this.view.pitch = clamp(this.view.pitch, -0.05, 0.85);

    const fov = clamp(ctx.settings.fov - 14, 34, 60);
    const aspect = ctx.camera.aspect || 16 / 9;
    const dist = fitDistance(this.radius, fov, aspect, 1 - STABLE_UI_FRACTION, 0.82) * this.zoom;
    const yaw = this.view.yaw;
    const pitch = this.view.pitch;
    dir.set(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw));
    const hit = sphereCast(ctx.terrain, this.center, dir, dist + 0.6, 0.6);
    this.boom = boomStep(this.boom, dist, hit, Infinity, dt, 20, 3);
    out.position.copy(this.center).addScaledVector(dir, this.boom);
    liftClear(ctx.terrain, out.position, 0.8);
    // Zoomed in, aim up toward the saddle and head, where the detail is.
    out.target.copy(this.center).addScaledVector(UP, Math.max(0, 1 - this.zoom) * this.radius * 0.6);
    out.roll = 0;
    out.fov = fov;
    // Optical centre moves to the middle of the visible 60%: x = 0.4 + 0.3 = 0.7.
    out.shift = STABLE_UI_FRACTION / 2;
    return out;
  }
}

/** Photo mode: a free camera tethered to the player. LS moves, RS looks, RT/LT up/down, wheel zooms. */
export class PhotoRig implements Rig {
  private pos = new Vector3();
  private view = { yaw: 0, pitch: 0 };
  private fov = 60;

  enter(player: PlayerSystem, from: CameraPose, ctx: RigContext): void {
    if (Number.isFinite(from.yaw) && Number.isFinite(from.pitch)) {
      this.pos.copy(from.position);
      this.view.yaw = from.yaw;
      this.view.pitch = from.pitch;
    } else {
      // Entered on a snap: start behind and above the wyvern, looking at it.
      fwd.set(0, 0, 1).applyQuaternion(player.wyvernPose.orientation);
      const yaw = Math.atan2(fwd.x, fwd.z);
      const back = player.breed.wingspan * 1.4 + 4;
      this.pos.set(-Math.sin(yaw) * back, back * 0.35, -Math.cos(yaw) * back).add(player.wyvernPose.position);
      this.view.yaw = yaw;
      this.view.pitch = 0.3;
    }
    this.fov = Number.isFinite(ctx.camera.fov) ? ctx.camera.fov : ctx.settings.fov;
  }

  update(dt: number, input: InputFrame, player: PlayerSystem, ctx: RigContext, out: CameraShot): CameraShot {
    applyLook(input, dt, this.view, 0.7, 0.7);
    this.view.yaw = wrapAngle(this.view.yaw);
    this.view.pitch = clamp(this.view.pitch, -85 * DEG, 85 * DEG);
    const yaw = this.view.yaw;
    const speed = input.foot.sprint ? 24 : 9;
    move.set(
      Math.sin(yaw) * input.foot.moveY - Math.cos(yaw) * input.foot.moveX,
      input.flight.flap - input.flight.flare,
      Math.cos(yaw) * input.foot.moveY + Math.sin(yaw) * input.foot.moveX,
    );
    this.pos.addScaledVector(move, speed * dt);
    // Tethered: stay within 90 m of the subject.
    const anchor = player.wyvernPose.position;
    dir.subVectors(this.pos, anchor);
    if (dir.length() > 90) this.pos.copy(anchor).addScaledVector(dir.normalize(), 90);
    liftClear(ctx.terrain, this.pos, 0.8);
    this.fov = clamp(this.fov - (input.zoom ?? 0) * 3, 20, 95);

    const pitch = this.view.pitch;
    out.position.copy(this.pos);
    out.target.set(Math.cos(pitch) * Math.sin(yaw), -Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)).add(this.pos);
    out.roll = 0;
    out.fov = this.fov;
    out.shift = 0;
    return out;
  }
}
