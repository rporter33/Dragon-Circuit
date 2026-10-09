import { describe, expect, it } from 'vitest';
import { BoxGeometry, Frustum, Matrix4, Mesh, MeshBasicMaterial, OrthographicCamera } from 'three';
import { isShadowFrustum, makeShadowOnly, registerShadowFrustum } from './shadowOnly';

function frustumAround(size: number): Frustum {
  const cam = new OrthographicCamera(-size, size, size, -size, 0.1, 100);
  cam.position.set(0, 0, 50);
  cam.updateMatrixWorld();
  return new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
}

describe('makeShadowOnly', () => {
  it('passes only registered shadow frustums, and still culls against them', () => {
    const mesh = makeShadowOnly(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
    mesh.updateMatrixWorld();
    const main = frustumAround(10);
    const shadow = frustumAround(10);
    registerShadowFrustum(shadow);
    expect(isShadowFrustum(shadow)).toBe(true);
    expect(isShadowFrustum(main)).toBe(false);
    // Inside both: drawn into the shadow map only.
    expect(mesh.intersectsFrustum(main)).toBe(false);
    expect(mesh.intersectsFrustum(shadow)).toBe(true);
    expect(mesh.frustumCulled).toBe(true);
    // Outside the shadow box: culled there too.
    mesh.position.set(500, 0, 0);
    mesh.updateMatrixWorld();
    expect(mesh.intersectsFrustum(shadow)).toBe(false);
  });

  it('leaves other meshes alone', () => {
    const plain = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    plain.updateMatrixWorld();
    expect(plain.intersectsFrustum(frustumAround(10))).toBe(true);
  });
});
