// Chase camera. (Baseline; the camera module owner implements the full rig: spring arm, look
// around, speed FOV, shake, terrain avoidance, on-foot orbit, title/stable/photo modes.)

import { PerspectiveCamera, Vector3 } from 'three';
import type { InputFrame, Settings } from '../core/types';
import type { CameraMode, CameraSystem, PlayerSystem } from '../game/contracts';
import type { Terrain } from '../world/terrain';
import { damp } from '../core/math';

const desired = new Vector3();
const target = new Vector3();
const back = new Vector3();

export class CameraRig implements CameraSystem {
  readonly camera: PerspectiveCamera;
  mode: CameraMode = 'follow';
  yaw = 0;
  private override: { position: Vector3; target: Vector3 } | null = null;
  private terrain: Terrain;
  private settings: () => Settings;

  constructor(camera: PerspectiveCamera, terrain: Terrain, settings: () => Settings) {
    this.camera = camera;
    this.terrain = terrain;
    this.settings = settings;
  }

  setOverride(pose: { position: Vector3; target: Vector3 } | null): void {
    this.override = pose ? { position: pose.position.clone(), target: pose.target.clone() } : null;
  }

  shake(_amount: number): void {}

  snap(player: PlayerSystem): void {
    this.place(player, 1);
  }

  update(dt: number, _input: InputFrame, player: PlayerSystem): void {
    if (this.override) {
      this.camera.position.copy(this.override.position);
      this.camera.lookAt(this.override.target);
      return;
    }
    this.place(player, 1 - Math.exp(-6 * dt));
  }

  private place(player: PlayerSystem, t: number): void {
    const pose = player.wyvernPose;
    back.set(0, 0, 1).applyQuaternion(pose.orientation);
    back.y = 0;
    if (back.lengthSq() < 1e-4) back.set(0, 0, 1);
    back.normalize();
    desired.copy(pose.position).addScaledVector(back, -22).add(new Vector3(0, 7, 0));
    this.camera.position.lerp(desired, t);
    target.copy(pose.position).addScaledVector(back, 10);
    this.camera.lookAt(target);
    this.yaw = Math.atan2(back.x, back.z);
    const fov = this.settings().fov;
    this.camera.fov = damp(this.camera.fov, fov, 4, 1 / 60);
    this.camera.updateProjectionMatrix();
  }
}
