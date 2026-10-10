import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { signedDistance } from '../colliders';
import { Terrain } from '../terrain';
import { LAYOUT } from '../layout';
import { windhavenHull } from './windhavenHull';
import { WINDHAVEN_ORIGIN as O, windhavenColliders } from './windhavenPlan';

describe('continuous Windhaven hull', () => {
  it('shares its complete rendered triangle surface with collision inside the existing envelope', () => {
    const { geometry, collider } = windhavenHull();
    const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
    const p = new Vector3(), n = new Vector3();
    expect(collider.hx * 2).toBe(28);
    expect(collider.hz * 2).toBe(72);
    expect(collider.y + collider.hy).toBeCloseTo(-0.78);
    expect(collider.y - collider.hy).toBeGreaterThan(-7.3);
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i);
      expect(p.x - collider.x).toBeCloseTo(collider.convex!.triangles[i * 3], 5);
      expect(p.y - collider.y).toBeCloseTo(collider.convex!.triangles[i * 3 + 1], 5);
      expect(p.z - collider.z).toBeCloseTo(collider.convex!.triangles[i * 3 + 2], 5);
      n.fromBufferAttribute(normal, i);
      expect(n.length()).toBeCloseTo(1, 5);
      if (i % 51 === 0) expect(Math.abs(signedDistance(collider, p, n))).toBeLessThan(0.0001);
    }
  });

  it('collides with the curved underside and raycasts onto it without invisible box corners', () => {
    const terrain = new Terrain(LAYOUT);
    terrain.colliders.addSource('windhaven', () => windhavenColliders());
    const hit = terrain.raycast(new Vector3(O.x, O.y - 20, 0), new Vector3(0, 1, 0), 30)!;
    expect(hit).not.toBeNull();
    expect(hit.point.y - O.y).toBeCloseTo(-7.18, 0);
    expect(hit.normal.y).toBeLessThan(-0.9);
    const p = new Vector3(O.x, O.y - 7.4, 0), push = new Vector3(), normal = new Vector3();
    expect(terrain.collideSphere(p, 0.5, push, normal)).toBe(true);
    expect(push.y).toBeLessThan(-0.2);
    expect(signedDistance(windhavenHull().collider, new Vector3(13.5, -6, 26), null)).toBeGreaterThan(3);
    expect(terrain.groundAt(O.x, 0, O.y + 0.1)?.y).toBeCloseTo(O.y);
  });
});
