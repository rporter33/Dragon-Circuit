// Shadow-only meshes: drawn into shadow maps, culled from every other pass.
//
// three draws an object in the main pass and in the shadow pass from the same scene traversal;
// the only per-pass hook before an object is queued is its frustum test, which both passes run
// through object.intersectsFrustum(frustum) with their own frustum. A shadow-only mesh passes
// that test only for the frustums of registered shadow-casting lights, so it costs nothing on
// screen (not even a draw call) while still casting. The world uses it to cast island shadows
// from a coarse stand-in of the rock that is drawn.

import { Mesh, MeshBasicMaterial, type Frustum } from 'three';

const shadowFrustums = new WeakSet<Frustum>();

/** Register a light's shadow frustum (`light.shadow.getFrustum()`, a stable object). */
export function registerShadowFrustum(frustum: Frustum): void {
  shadowFrustums.add(frustum);
}

/** True for frustums registered with registerShadowFrustum. */
export function isShadowFrustum(frustum: Frustum): boolean {
  return shadowFrustums.has(frustum);
}

let material: MeshBasicMaterial | null = null;

/**
 * A material for shadow-only meshes: it is never drawn on screen (the mesh is culled from the
 * main pass), and if it ever were it would write nothing. The shadow pass uses its own depth
 * material.
 */
export function shadowOnlyMaterial(): MeshBasicMaterial {
  material ??= new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  material.name = 'shadow-only';
  return material;
}

/** Make `mesh` draw only into registered shadow maps (it is still culled against them). */
export function makeShadowOnly<T extends Mesh>(mesh: T): T {
  mesh.frustumCulled = true;
  mesh.intersectsFrustum = function (this: T, frustum: Frustum): boolean {
    return shadowFrustums.has(frustum) && Mesh.prototype.intersectsFrustum.call(this, frustum);
  };
  return mesh;
}
