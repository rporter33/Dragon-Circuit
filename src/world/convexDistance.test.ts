import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import type { BoxCollider } from '../core/types';
import { ColliderIndex, signedDistance } from './colliders';
import { colliderView } from './dressing/colliderView';

function prism(): BoxCollider {
  const points = [-1, 1].flatMap(y => [[-2, -2], [2, -2], [2, 0], [0, 2], [-2, 2]].map(([x, z]) => new Vector3(x, y, z)));
  const geo = new ConvexGeometry(points), triangles = new Float32Array(geo.getAttribute('position').array);
  const planes = new Float64Array(triangles.length / 9 * 4), normal = geo.getAttribute('normal');
  for (let i = 0, f = 0; i < triangles.length; i += 9, f += 4) {
    const n = new Vector3().fromBufferAttribute(normal, i / 3);
    planes.set([n.x, n.y, n.z, -n.dot(new Vector3().fromArray(triangles, i))], f);
  }
  return { kind: 'box', x: 0, y: 0, z: 0, hx: 2, hy: 1, hz: 2, yaw: 0, convex: { triangles, planes } };
}
describe('convex solid collision', () => {
  it('finds exact face, corner and inside distances with normalized contact normals', () => {
    const c = prism(), n = new Vector3();
    expect(signedDistance(c, new Vector3(), n)).toBeCloseTo(-1);
    expect(signedDistance(c, new Vector3(3, 2, 3), n)).toBeCloseTo(3);
    expect(n.toArray()).toEqual([2 / 3, 1 / 3, 2 / 3]);
    expect(signedDistance(c, new Vector3(1.5, 0, 1.5), n)).toBeCloseTo(Math.SQRT1_2);
    c.yaw = Math.PI / 2; c.x = 20;
    expect(signedDistance(c, new Vector3(23, 2, -3), n)).toBeCloseTo(3);
    expect(n.x).toBeCloseTo(2 / 3); expect(n.z).toBeCloseTo(-2 / 3);
  });
  it('uses the actual polygon for ground support, sphere contact and debug wireframes', () => {
    const c = prism(), index = new ColliderIndex(); index.add(c);
    expect(index.groundAt(1.5, 1.5, 1.1, 0.2)).toBeNull();
    expect(index.groundAt(0, 0, 1.1, 0.2)?.y).toBe(1);
    const p = new Vector3(1.1, 0, 1.1), n = new Vector3();
    expect(index.resolveSphere(p, 0.5, n, { soft: false })).toBe(true);
    expect(signedDistance(c, p, null)).toBeCloseTo(0.5, 4);
    const view = colliderView([[c]]);
    expect(view.children).toHaveLength(1);
    expect(view.children[0].type).toBe('Mesh');
  });
});
