// Shared shapes for the camera's sub-rigs. Each rig turns player state + input into a "shot"
// (where the camera is, what it looks at, roll, FOV, lens shift); CameraRig blends between
// shots when the rig changes and layers shake on top.

import { Vector3, type PerspectiveCamera } from 'three';
import type { InputFrame, Settings } from '../core/types';
import type { PlayerSystem } from '../game/contracts';
import type { CameraTerrain } from './collision';

export interface CameraShot {
  position: Vector3;
  target: Vector3;
  /** Roll about the view axis, radians, + = roll right (right side down). */
  roll: number;
  /** Vertical FOV, degrees. */
  fov: number;
  /** Lens shift: optical centre at screen x = 0.5 + shift. */
  shift: number;
}

export function createShot(): CameraShot {
  return { position: new Vector3(), target: new Vector3(), roll: 0, fov: 60, shift: 0 };
}

/** The camera's pose when a rig takes over, so it can start where the last one left off. */
export interface CameraPose {
  position: Vector3;
  target: Vector3;
  /** Facing yaw (radians, facing = (sin, 0, cos)). */
  yaw: number;
  /** Look-down angle (radians, + = looking down). */
  pitch: number;
}

export interface RigContext {
  terrain: CameraTerrain;
  settings: Settings;
  camera: PerspectiveCamera;
  /** Seconds since the rig system started (for slow cinematic motion). */
  time: number;
  /** Player's follow-distance multiplier from the mouse wheel (1 = default). */
  zoom: number;
  /** While racing: the next ring (or the finish) the camera should keep in view; else null. */
  waypoint: Vector3 | null;
}

export interface Rig {
  enter(player: PlayerSystem, from: CameraPose, ctx: RigContext): void;
  update(dt: number, input: InputFrame, player: PlayerSystem, ctx: RigContext, out: CameraShot): CameraShot;
}

/** Look-input conversion shared by the rigs: stick rates in rad/s, mouse already in radians. */
export const LOOK = {
  yawRate: 2.6,
  pitchRate: 1.8,
};

/** Apply this frame's look input to a yaw/pitch pair. Returns true if there was input. */
export function applyLook(input: InputFrame, dt: number, state: { yaw: number; pitch: number }, yawScale = 1, pitchScale = 1): boolean {
  if (!input.lookActive) return false;
  const kx = input.lookIsRate ? LOOK.yawRate * dt : 1;
  const ky = input.lookIsRate ? LOOK.pitchRate * dt : 1;
  // Stick/mouse right turns the view right. Facing (sin, 0, cos) with +X on the LEFT, so
  // turning right DEcreases yaw. + lookY (stick/mouse down) looks down.
  state.yaw -= input.lookX * kx * yawScale;
  state.pitch += input.lookY * ky * pitchScale;
  return true;
}
