import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Terrain } from '../world/terrain';
import { LAYOUT } from '../world/layout';
import { signedDistance } from '../world/colliders';
import { windhavenHull } from '../world/airship/windhavenHull';
import { WINDHAVEN_ORIGIN as O } from '../world/airship/windhavenPlan';
import { TraversalWorld } from './sweep';
import { SkyLance } from './SkyLance';

/** Combined-feature coverage: the bracer must query the ship's actual new solid. */
describe('Windline and stationary Windhaven integration', () => {
  function rig() {
    const terrain = new Terrain({ ...LAYOUT, islands: [], spires: [], arches: [] });
    const local = windhavenHull().collider;
    const hull = { ...local, x: local.x + O.x, y: local.y + O.y, z: local.z + O.z };
    let source = [hull];
    terrain.colliders.addSource('windhaven-integration', () => source);
    return { terrain, hull, world: new TraversalWorld(terrain), replace: () => { source = [{ ...hull }]; } };
  }

  it('anchors on the curved underside and invalidates replaced or moved hulls', () => {
    for (const change of ['replace', 'move'] as const) {
      const r = rig(), lance = new SkyLance(r.world), origin = new Vector3(O.x, O.y - 20, O.z);
      expect(lance.throw(origin, new Vector3(0, 1, 0), new Vector3())).toBe(true);
      for (let i = 0; i < 120 && lance.state === 'projectile'; i++) lance.step(1 / 120, origin);
      expect(lance.state).toBe('anchored');
      expect(lance.position.y).toBeCloseTo(O.y - 7.26, 1);
      expect(signedDistance(r.hull, lance.position, null)).toBeCloseTo(.08, 4);
      expect(lance.validate(origin)).toBe(true);
      if (change === 'replace') r.replace(); else r.hull.x += 1;
      expect(lance.validate(origin)).toBe(false);
      expect(lance.rope).toBeNull();
      for (let i = 0; i < 60; i++) lance.step(1 / 120, origin);
      expect(lance.state).toBe('ready');
    }
  });

  it('does not grapple invisible hull bounding-box corners', () => {
    const r = rig();
    expect(r.world.sweep(new Vector3(O.x + 13.5, O.y - 12, O.z + 26),
      new Vector3(O.x + 13.5, O.y - 5, O.z + 26), .08)).toBeNull();
  });
});
