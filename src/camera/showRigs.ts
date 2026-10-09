// Presentation cameras: the title screen's slow cinematic orbit, the stable's turntable framing
// for customization, and a free photo camera.

import { Vector3 } from 'three';
import { DEG, angleDelta, clamp, damp, smoothstep, wrapAngle } from '../core/math';
import type { InputFrame } from '../core/types';
import type { PlayerSystem } from '../game/contracts';
import { boomStep, fitDistance } from './cameraMath';
import { castBoom, liftClear, type BoomHit } from './collision';
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
 * The title's hero composition with the rider on foot near the wyvern: a two-shot in depth, rider
 * in the foreground on the left third, the wyvern further in on the right third (three-quarter
 * front), the camera low so the sky and the floating islands own the frame — and the centre
 * column clear for the logo above and the menu below. Screen positions are NDC.
 */
export const TITLE_SHOT = {
  riderX: -0.44,
  wyvernX: 0.54,
  /** The rider's chest sits this low in frame (the horizon low, the sky owning the frame). */
  riderY: -0.52,
  /** The wyvern stands this many times further from the camera than the rider. */
  depth: 2.5,
  /** Camera height above the rider's feet (m): a low, heroic eye line. */
  eye: 1.15,
  /**
   * Intro (first `introTime` s): starts a little higher (m), further back (×) and swung round
   * (rad), then settles — a slow parallax move with the pair held in place on screen.
   */
  introTime: 9,
  craneIntro: 0.6,
  dollyIntro: 0.1,
  swingIntro: 0.24,
  /** Slow drift: azimuth (rad) and height (m) breathing about the pair. */
  swayAz: 0.09,
  swayHeight: 0.35,
  /** Beyond this separation (m) the pair can't share a frame: the old rider-led drift takes over. */
  maxPair: 34,
};

const riderFeet = new Vector3();
const wyvernFeet = new Vector3();
const pairU = new Vector3();
const pairN = new Vector3();
const titleHit: BoomHit = { t: Infinity, soft: false };

/**
 * Title. On foot with the wyvern close by: the hero two-shot above, held from the first frame (the
 * intro only cranes down and pushes in, so the rider never wanders behind the menu), drifting
 * slowly. Mounted, or with the pair far apart, it drifts round the wyvern (or behind the rider)
 * instead.
 */
export class TitleRig implements Rig {
  private t0 = 0;
  private boom = -1;

  enter(_player: PlayerSystem, _from: CameraPose, ctx: RigContext): void {
    this.t0 = ctx.time;
    this.boom = -1;
  }

  update(dt: number, _input: InputFrame, player: PlayerSystem, ctx: RigContext, out: CameraShot): CameraShot {
    const T = TITLE_SHOT;
    const t = ctx.time - this.t0;
    const intro = 1 - smoothstep(0, T.introTime, t);
    const r = player.riderPose;
    const w = player.wyvernPose;
    out.roll = 0;
    out.fov = clamp(ctx.settings.fov - 10, 38, 70);
    if (!r.mounted) {
      riderFeet.copy(r.position);
      wyvernFeet.set(w.position.x, w.groundY ?? w.position.y - player.breed.standHeight, w.position.z);
      pairU.set(wyvernFeet.x - riderFeet.x, 0, wyvernFeet.z - riderFeet.z);
      const L = pairU.length();
      if (L > 2 && L < T.maxPair) return this.twoShot(dt, t, intro, L, player, ctx, out);
    }
    return this.drift(dt, t, intro, player, ctx, out);
  }

  /** Rider foreground-left, wyvern mid-ground-right; solved from the two positions each frame. */
  private twoShot(dt: number, t: number, intro: number, L: number, player: PlayerSystem, ctx: RigContext, out: CameraShot): CameraShot {
    const T = TITLE_SHOT;
    const aspect = ctx.camera.aspect || 16 / 9;
    const tanV = Math.tan((out.fov * DEG) / 2);
    const tanH = tanV * aspect;
    // Bearings of the two subjects off the view axis (rider to the left, wyvern to the right).
    const thR = Math.atan(-T.riderX * tanH);
    const thW = Math.atan(T.wyvernX * tanH);
    const alpha = thR + thW;
    const k = T.depth;
    // Triangle rider–wyvern–camera: |C−R| = dR, |C−W| = k·dR, angle α at the camera.
    const dR = L / Math.sqrt(Math.max(0.05, 1 + k * k - 2 * k * Math.cos(alpha)));
    const cx = (L * L - (k * k - 1) * dR * dR) / (2 * L);
    const cy = Math.sqrt(Math.max(0, dR * dR - cx * cx));
    pairU.multiplyScalar(1 / L);
    // The camera stands on the side from which the rider is on the LEFT (facing (sin, 0, cos),
    // left = (cos, −sin)): n = (−u.z, u.x).
    pairN.set(-pairU.z, 0, pairU.x);
    // Slow azimuth drift about the pair's middle, and the intro's push-in.
    const az = T.swayAz * Math.sin((t * Math.PI * 2) / 46) * (1 - intro) + T.swingIntro * intro;
    const dolly = 1 + T.dollyIntro * intro;
    const mx = riderFeet.x + pairU.x * L * 0.4;
    const mz = riderFeet.z + pairU.z * L * 0.4;
    let px = riderFeet.x + pairU.x * cx + pairN.x * cy - mx;
    let pz = riderFeet.z + pairU.z * cx + pairN.z * cy - mz;
    const ca = Math.cos(az);
    const sa = Math.sin(az);
    const rx = px * ca + pz * sa;
    const rz = -px * sa + pz * ca;
    px = mx + rx * dolly;
    pz = mz + rz * dolly;
    const groundY = Math.max(riderFeet.y, Math.min(wyvernFeet.y, riderFeet.y + 2));
    const height = T.eye + T.craneIntro * intro + T.swayHeight * Math.sin((t * Math.PI * 2) / 53 + 1) * (1 - intro);
    want.set(px, groundY + height, pz);
    liftClear(ctx.terrain, want, 0.9);
    // Keep a clear line to the pair: shorten toward their middle if something solid is in the way.
    center.set(mx, groundY + 1.4, mz);
    move.subVectors(want, center);
    const len = move.length();
    move.multiplyScalar(1 / Math.max(1e-6, len));
    const hit = castBoom(ctx.terrain, center, move, len + 0.8, 0.6, titleHit);
    this.boom = boomStep(this.boom, len, hit.soft ? Infinity : hit.t, hit.soft ? Math.max(hit.t, len * 0.5) : Infinity, dt, 6, 1.5);
    out.position.copy(center).addScaledVector(move, this.boom);
    // Aim: the rider's bearing minus its offset; the rider's chest at riderY.
    const yawR = Math.atan2(riderFeet.x - out.position.x, riderFeet.z - out.position.z);
    const yaw = yawR - thR * (1 / dolly);
    const horiz = Math.hypot(riderFeet.x - out.position.x, riderFeet.z - out.position.z);
    const below = Math.atan2(out.position.y - (riderFeet.y + 1.05), Math.max(0.5, horiz));
    // The rider's chest at riderY — but never so low that their feet leave the frame (wide
    // screens bring the rider closer).
    const chest = Math.min(Math.atan(-T.riderY * tanV), Math.atan(0.88 * tanV) - Math.atan2(1.05, horiz));
    const pitch = chest * (1 / dolly) - below;
    out.target.set(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)).multiplyScalar(dR).add(out.position);
    out.shift = 0;
    return out;
  }

  /** Mounted, or the pair far apart: a slow drift round the wyvern (or behind the rider). */
  private drift(dt: number, t: number, intro: number, player: PlayerSystem, ctx: RigContext, out: CameraShot): CameraShot {
    const r = player.riderPose;
    let pivotPt: Vector3;
    if (!r.mounted) {
      // Behind the rider, swung off to one side, the rider held on the left third from the start.
      const wpos = player.wyvernPose.position;
      dir.set(wpos.x - r.position.x, 0, wpos.z - r.position.z);
      const d = Math.max(1, dir.length());
      dir.multiplyScalar(1 / d);
      const az = Math.atan2(-dir.x, -dir.z) + 0.5 + 0.3 * Math.sin((t * Math.PI * 2) / 40);
      const radius = 9 * (1 + 0.8 * intro + 0.08 * Math.sin((t * Math.PI * 2) / 31));
      const height = 1.1 + 0.4 * Math.sin((t * Math.PI * 2) / 53 + 1) + 7 * intro;
      center.copy(r.position);
      want.set(center.x + Math.sin(az) * radius, center.y + height, center.z + Math.cos(az) * radius);
      const reach = clamp(d * 0.45, 3, 24);
      out.target.set(r.position.x + dir.x * reach, r.position.y + 3.6 + 2 * intro, r.position.z + dir.z * reach);
      center.y += 1.2;
      pivotPt = center;
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
    const hit = castBoom(ctx.terrain, pivotPt, move, len + 0.8, 0.8, titleHit);
    this.boom = boomStep(this.boom, len, hit.soft ? Infinity : hit.t, hit.soft ? Math.max(hit.t, len * 0.5) : Infinity, dt, 6, 1.5);
    out.position.copy(pivotPt).addScaledVector(move, this.boom);
    return out;
  }
}

/** Fraction of the screen the stable UI panel covers on the left. */
export const STABLE_UI_FRACTION = 0.4;
/** A new stable subject further than this (m) from the current one is reached by a fade cut. */
export const STABLE_CUT_JUMP = 14;

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
  /** The new subject is across the plaza: CameraRig should cut (through a fade) rather than glide. */
  private cutWanted = false;

  /** True once after a refocus asked for a cut (CameraRig then re-enters this rig at black). */
  consumeCut(): boolean {
    const c = this.cutWanted;
    this.cutWanted = false;
    return c;
  }

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
    this.cutWanted = false;
  }

  update(dt: number, input: InputFrame, player: PlayerSystem, ctx: RigContext, out: CameraShot): CameraShot {
    // Subject is re-read every frame (breed changes resize it) but eased so swaps glide…
    const s = subjectOf(player, center, this.focus);
    // …unless the new subject is across the plaza (the rider 50 m from the wyvern): cut instead.
    if (this.refocus > 0 && center.distanceTo(this.center) > STABLE_CUT_JUMP) this.cutWanted = true;
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
    const hit = castBoom(ctx.terrain, this.center, dir, dist + 0.6, 0.6, titleHit);
    // Walls and rock pull the camera in at once; leaves only ease it in front of them.
    if (hit.soft) this.boom = boomStep(this.boom, dist, Infinity, Math.max(hit.t, dist * 0.5), dt, 6, 3);
    else this.boom = boomStep(this.boom, dist, hit.t, Infinity, dt, 20, 3);
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
