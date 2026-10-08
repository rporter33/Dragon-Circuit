import { describe, expect, it } from 'vitest';
import { LAYOUT } from '../../layout';
import { Terrain } from '../../terrain';
import { fallDuration, fallOffset, maxPoolDepth, planWaterfalls } from './waterfallPlan';

const terrain = new Terrain(LAYOUT);
const plans = planWaterfalls(terrain, null);

describe('waterfalls', () => {
  it('gives Cascade Isle its five falls and every island its waterfalls hint', () => {
    for (const shape of terrain.islands) {
      const n = plans.filter((p) => p.islandId === shape.def.id).length;
      expect(n, `island ${shape.def.id}`).toBe(Math.round(shape.def.waterfalls));
    }
    const cascade = terrain.islands.find((s) => s.def.landmark === 'cascade')!;
    expect(plans.filter((p) => p.islandId === cascade.def.id).length).toBe(5);
  });

  it('runs each stream downhill on the island top to a lip at the rim', () => {
    for (const p of plans) {
      const shape = terrain.islands.find((s) => s.def.id === p.islandId)!;
      expect(shape.normRadius(p.lip.x, p.lip.z)).toBeGreaterThan(0.97);
      expect(shape.normRadius(p.lip.x, p.lip.z)).toBeLessThanOrEqual(1);
      for (let i = 1; i < p.stream.length; i++) {
        // Water never climbs more than a hair, and never sits buried under the ground.
        expect(p.stream[i].y).toBeLessThanOrEqual(p.stream[i - 1].y + 1e-9);
        expect(p.stream[i].y).toBeGreaterThan(shape.topHeight(p.stream[i].x, p.stream[i].z) + 0.1);
      }
      expect(p.stream[0].y).toBeGreaterThan(p.lip.y);
      expect(maxPoolDepth(shape, p)).toBeLessThan(1.6);
    }
  });

  it('arcs clear of the cliff and drops past the underside into mist above the cloud sea', () => {
    for (const p of plans) {
      const shape = terrain.islands.find((s) => s.def.id === p.islandId)!;
      for (let k = 1; k <= 40; k++) {
        const t = (k / 40) * p.duration;
        const f = fallOffset(p.speed, t);
        const x = p.lip.x + p.outX * f.out;
        const z = p.lip.z + p.outZ * f.out;
        const y = p.lip.y - f.down;
        // Below the rim the water is outside the island's footprint: it never cuts through rock.
        if (y < p.lip.y - 2) expect(shape.normRadius(x, z)).toBeGreaterThan(1);
      }
      expect(p.lip.y - p.drop).toBeLessThan(shape.def.y - shape.def.depth);
      expect(p.lip.y - p.drop).toBeGreaterThan(LAYOUT.cloudFloor - 10);
    }
  });

  it('solves flight time for a drop consistently', () => {
    for (const drop of [50, 200, 450]) {
      const t = fallDuration(5, drop);
      expect(fallOffset(5, t).down).toBeCloseTo(drop, 1);
    }
    // Drag caps the horizontal throw.
    expect(fallOffset(6, 100).out).toBeLessThan(6 / 0.33 + 1e-6);
  });
});
