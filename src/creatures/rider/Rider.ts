// Procedural rider. (Baseline placeholder capsule; the rider module owner builds the real
// model, cloth and animation.)

import { CapsuleGeometry, Group, Matrix4, Mesh, type Object3D } from 'three';
import type { RiderLook, RiderPose } from '../../core/types';
import type { RiderRenderable } from '../../game/contracts';
import { toonMaterial } from '../../render/painterly';

const m4 = new Matrix4();

export class Rider implements RiderRenderable {
  readonly group = new Group();
  private body: Mesh;

  constructor(look: RiderLook) {
    this.body = new Mesh(new CapsuleGeometry(0.3, 1.0, 4, 8), toonMaterial({ color: look.outfitPrimary }));
    this.body.position.y = 0.8;
    this.body.castShadow = true;
    this.group.add(this.body);
  }

  setLook(_look: RiderLook): void {}

  update(_dt: number, pose: RiderPose, saddle: Object3D | null): void {
    if (pose.mounted && saddle) {
      saddle.updateWorldMatrix(true, false);
      m4.copy(saddle.matrixWorld);
      m4.decompose(this.group.position, this.group.quaternion, this.group.scale);
    } else {
      this.group.position.copy(pose.position);
      this.group.rotation.set(0, pose.yaw, 0);
      this.group.scale.setScalar(1);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
