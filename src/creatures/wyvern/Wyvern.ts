// The wyvern: a procedurally built SkinnedMesh (body + membranes, two draw calls) on a ~53-bone
// skeleton, posed every frame by the procedural animator from the player's WyvernPose.
//
// setLook() only touches uniforms when colors or the pattern change; a breed or a shape cosmetic
// (horns, frill, tail tip, saddle) rebuilds the geometry (and, for a breed, the skeleton) and
// disposes the old resources.

import { Bone, Group, Matrix4, Object3D, Skeleton, SkinnedMesh, Sphere, Vector3, type Material } from 'three';
import type { WyvernLook, WyvernPose } from '../../core/types';
import type { WyvernRenderable } from '../../game/contracts';
import type { TerrainQuery } from '../../core/types';
import { buildRig, type RigDef } from './rig';
import { buildWyvernGeometry, type WyvernMeshInfo } from './geometry';
import {
  applyLookUniforms,
  createBodyMaterial,
  createGhostMaterial,
  createMembraneMaterial,
  createWyvernUniforms,
  type WyvernUniforms,
} from './materials';
import { WyvernAnimator } from './animator';

export interface WyvernOptions {
  /** Render as a translucent race ghost. */
  ghost?: boolean;
  /** Optional terrain for per-foot ground placement (falls back to pose.groundY). */
  terrain?: Pick<TerrainQuery, 'groundAt'>;
}

const _m = new Matrix4();

export class Wyvern implements WyvernRenderable {
  readonly group = new Group();
  readonly saddle = new Object3D();
  readonly uniforms: WyvernUniforms = createWyvernUniforms();
  private look: WyvernLook;
  private readonly ghost: boolean;
  private readonly terrain: WyvernOptions['terrain'];
  private materials: Material[];
  private mesh: SkinnedMesh | null = null;
  private skeleton: Skeleton | null = null;
  private bones: Bone[] = [];
  private rig!: RigDef;
  private info!: WyvernMeshInfo;
  private animator!: WyvernAnimator;
  private shapeKey = '';
  private tipOffset = new Vector3();
  private mouthOffset = new Vector3();

  constructor(look: WyvernLook, opts: WyvernOptions = {}) {
    this.ghost = !!opts.ghost;
    this.terrain = opts.terrain;
    this.look = { ...look };
    this.saddle.name = 'saddle';
    this.materials = this.ghost
      ? [createGhostMaterial(this.uniforms, false), createGhostMaterial(this.uniforms, true)]
      : [createBodyMaterial(this.uniforms), createMembraneMaterial(this.uniforms)];
    this.rebuild();
  }

  /** Triangle and bone counts of the current build (for budgets and tests). */
  get stats(): { triangles: number; vertices: number; bones: number; membraneArea: number } {
    return { triangles: this.info.triangles, vertices: this.info.vertices, bones: this.bones.length, membraneArea: this.info.membraneArea };
  }

  get rigDef(): RigDef {
    return this.rig;
  }

  get skinnedMesh(): SkinnedMesh | null {
    return this.mesh;
  }

  setLook(look: WyvernLook): void {
    this.look = { ...look };
    const key = shapeKeyOf(look);
    if (key !== this.shapeKey) this.rebuild();
    else applyLookUniforms(this.uniforms, look);
  }

  update(dt: number, pose: WyvernPose): void {
    this.group.position.copy(pose.position);
    this.group.quaternion.copy(pose.orientation);
    this.animator.update(dt, pose, this.uniforms);
    this.animator.apply(this.bones);
    this.group.updateMatrixWorld(true);
  }

  getWingtips(outLeft: Vector3, outRight: Vector3): void {
    const w = this.rig.idx.wings;
    const l = this.bones[w[0].fingers[0][1]];
    const r = this.bones[w[1].fingers[0][1]];
    outLeft.copy(this.tipOffset).applyMatrix4(l.matrixWorld);
    outRight.set(-this.tipOffset.x, this.tipOffset.y, this.tipOffset.z).applyMatrix4(r.matrixWorld);
  }

  getHead(out: Vector3): Vector3 {
    return out.copy(this.mouthOffset).applyMatrix4(this.bones[this.rig.idx.head].matrixWorld);
  }

  dispose(): void {
    this.disposeMesh();
    for (const m of this.materials) m.dispose();
    this.group.removeFromParent();
  }

  // --- Internals ----------------------------------------------------------------------------------

  private disposeMesh(): void {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.removeFromParent();
      this.mesh = null;
    }
    if (this.skeleton) {
      this.skeleton.dispose();
      this.skeleton = null;
    }
    if (this.bones.length) {
      this.bones[0].removeFromParent();
      this.bones = [];
    }
  }

  private rebuild(): void {
    const look = this.look;
    const breedChanged = !this.rig || this.rig.props.breed !== look.breed;
    this.disposeMesh();
    if (breedChanged) this.rig = buildRig(look.breed);
    const rig = this.rig;
    this.info = buildWyvernGeometry(rig, look);
    this.shapeKey = shapeKeyOf(look);

    // Bones: identity rest rotations, positions relative to the parent.
    const bones: Bone[] = rig.bones.map((d) => {
      const b = new Bone();
      b.name = d.name;
      return b;
    });
    const inverses: Matrix4[] = [];
    rig.bones.forEach((d, i) => {
      const b = bones[i];
      if (d.parent >= 0) {
        bones[d.parent].add(b);
        b.position.subVectors(d.pos, rig.bones[d.parent].pos);
      } else b.position.copy(d.pos);
      inverses.push(new Matrix4().makeTranslation(-d.pos.x, -d.pos.y, -d.pos.z));
    });
    this.bones = bones;
    this.group.add(bones[0]);
    this.skeleton = new Skeleton(bones, inverses);

    const mesh = new SkinnedMesh(this.info.geometry, this.materials);
    mesh.bind(this.skeleton, _m.identity());
    const S = rig.props.shape;
    mesh.boundingSphere = new Sphere(new Vector3(0, 0, -0.5), Math.max(rig.props.wingspan, S.neckLength + S.torsoLength + S.tailLength + S.headLength) * 0.62);
    mesh.castShadow = !this.ghost;
    mesh.receiveShadow = !this.ghost;
    mesh.renderOrder = this.ghost ? 5 : 0;
    this.mesh = mesh;
    this.group.add(mesh);

    // Saddle anchor rides on the chest bone, like the saddle geometry.
    const chest = bones[rig.idx.chest];
    chest.add(this.saddle);
    this.saddle.position.copy(this.info.saddle.seat).sub(rig.bones[rig.idx.chest].pos);
    this.saddle.quaternion.identity();
    this.saddle.userData.halfWidth = this.info.saddle.halfWidth;
    this.saddle.userData.gripOffset = this.info.saddle.grip.clone();

    // Wingtip: end of the distal wingtip finger, in that bone's space. Mouth: in head space.
    const fb = rig.idx.wings[0].fingers[0][1];
    this.tipOffset.subVectors(rig.fingerTips[0], rig.bones[fb].pos);
    this.mouthOffset.subVectors(rig.mouth, rig.bones[rig.idx.head].pos);

    this.uniforms.uEyeCenter.value.copy(this.info.eyeCenter);
    this.uniforms.uEyeAxis.value.copy(this.info.eyeAxis);
    this.uniforms.uEyeRadius.value = this.info.eyeRadius;
    this.uniforms.uBodyScale.value = S.torsoLength / 3.3;
    applyLookUniforms(this.uniforms, look);

    const prev = this.animator;
    this.animator = new WyvernAnimator(rig, this.terrain);
    if (prev && !breedChanged) this.animator.copyStateFrom(prev);
  }
}

function shapeKeyOf(look: WyvernLook): string {
  return `${look.breed}|${look.horns}|${look.frill}|${look.tail}|${look.saddle}`;
}

