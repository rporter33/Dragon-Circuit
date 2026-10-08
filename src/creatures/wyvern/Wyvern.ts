// Procedural wyvern. (Baseline placeholder: a body and two flapping wings. The wyvern module
// owner builds the real model and animation.)

import { BoxGeometry, ConeGeometry, Group, Mesh, Object3D, Vector3 } from 'three';
import type { WyvernLook, WyvernPose } from '../../core/types';
import type { WyvernRenderable } from '../../game/contracts';
import { toonMaterial } from '../../render/painterly';
import { BREEDS } from '../../flight/breeds';

export interface WyvernOptions {
  /** Render as a translucent race ghost. */
  ghost?: boolean;
}

export class Wyvern implements WyvernRenderable {
  readonly group = new Group();
  readonly saddle = new Object3D();
  private body: Mesh;
  private wingL = new Group();
  private wingR = new Group();
  private tipL = new Object3D();
  private tipR = new Object3D();
  private head = new Object3D();
  private look: WyvernLook;

  constructor(look: WyvernLook, _opts: WyvernOptions = {}) {
    this.look = look;
    const mat = toonMaterial({ color: look.primary });
    const wingMat = toonMaterial({ color: look.membrane });
    this.body = new Mesh(new ConeGeometry(1.2, 9, 8).rotateX(Math.PI / 2), mat);
    this.body.castShadow = true;
    this.group.add(this.body);
    const span = BREEDS[look.breed].wingspan / 2;
    for (const [wing, side, tip] of [[this.wingL, 1, this.tipL], [this.wingR, -1, this.tipR]] as const) {
      const m = new Mesh(new BoxGeometry(span, 0.2, 3), wingMat);
      m.position.x = (side * span) / 2;
      m.castShadow = true;
      wing.add(m);
      tip.position.x = side * span;
      wing.add(tip);
      wing.position.set(0, 0.6, 1);
      this.group.add(wing);
    }
    this.saddle.position.set(0, 1.3, 1.2);
    this.group.add(this.saddle);
    this.head.position.set(0, 0.5, 5);
    this.group.add(this.head);
  }

  setLook(look: WyvernLook): void {
    this.look = look;
  }

  update(_dt: number, pose: WyvernPose): void {
    this.group.position.copy(pose.position);
    this.group.quaternion.copy(pose.orientation);
    const a = Math.cos(pose.flapPhase * Math.PI * 2) * 0.8 * pose.flapStrength + (1 - pose.wingSpread) * 0.9;
    this.wingL.rotation.z = a;
    this.wingR.rotation.z = -a;
  }

  getWingtips(outLeft: Vector3, outRight: Vector3): void {
    this.group.updateMatrixWorld();
    this.tipL.getWorldPosition(outLeft);
    this.tipR.getWorldPosition(outRight);
  }

  getHead(out: Vector3): Vector3 {
    return this.head.getWorldPosition(out);
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
