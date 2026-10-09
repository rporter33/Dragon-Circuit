import { describe, expect, it } from 'vitest';
import { Scene, Vector3 } from 'three';
import { LAYOUT } from '../../layout';
import { Terrain } from '../../terrain';
import { QUALITY } from '../../../render/quality';
import { Dressing } from '../Dressing';
import { signedDistance } from '../../colliders';
import { VENTARI_SITES } from '../../../research/registry';

const SLOW = 30000;
const terrain = new Terrain(LAYOUT);
const dressing = new Dressing({ scene: new Scene(), terrain, quality: QUALITY.high, asyncStreaming: false });
const sites = dressing.ventariSites;

describe('Ventari site plan', () => {
  it('places every registry site, in registry order', () => {
    expect(sites.map((s) => s.id)).toEqual(VENTARI_SITES.map((s) => s.id));
  });

  it('puts each site on its landmark island, on the ground', () => {
    for (const s of sites) {
      const def = VENTARI_SITES.find((v) => v.id === s.id)!;
      const island = terrain.islands.find((sh) => sh.def.id === s.islandId)!;
      expect(island.def.landmark, s.id).toBe(def.landmark);
      expect(Math.abs(island.topHeight(s.x, s.z) - s.y), s.id).toBeLessThan(0.5);
      // The inscription stands inside the footprint, on the island's top.
      const di = Math.hypot(s.inscription.x - s.x, s.inscription.z - s.z);
      expect(di, s.id).toBeLessThanOrEqual(s.radius);
      expect(Math.abs(island.topHeight(s.inscription.x, s.inscription.z) - s.inscription.y), s.id).toBeLessThan(0.5);
    }
  }, SLOW);

  it('keeps new sites clear of earlier buildings and props', () => {
    const fresh = sites.filter((s) => s.id !== 'observatory' && s.id !== 'wind-counters');
    expect(fresh.length).toBe(4);
    const p = new Vector3();
    for (const s of fresh) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        for (const r of [0, s.radius * 0.5, s.radius * 0.9]) {
          p.set(s.x + Math.cos(a) * r, s.y + 1.5, s.z + Math.sin(a) * r);
          const solid = dressing.colliders.find((c) => !c.soft && signedDistance(c, p, null) < 0);
          expect(solid, `${s.id} blocked at r=${r.toFixed(1)}`).toBeUndefined();
        }
      }
    }
  }, SLOW);

  it("faces the Shrine of the First Wind toward the Roost (the opening's landing looks home)", () => {
    const shrine = sites.find((s) => s.id === 'gullrest-shrine')!;
    const gull = terrain.islands.find((sh) => sh.def.id === shrine.islandId)!.def;
    const roost = LAYOUT.islands[0];
    const toRoost = new Vector3(roost.x - gull.x, 0, roost.z - gull.z).normalize();
    const offset = new Vector3(shrine.x - gull.x, 0, shrine.z - gull.z).normalize();
    expect(offset.dot(toRoost)).toBeGreaterThan(0.5);
  });
});
