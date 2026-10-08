import { describe, expect, it } from 'vitest';
import { LAYOUT } from '../../layout';
import { Terrain } from '../../terrain';
import { ExclusionSet } from '../exclusions';
import { scatterIsland } from './placement';
import { SPECIES } from './species';

const terrain = new Terrain(LAYOUT);
const byLandmark = (id: string) => terrain.islands.find((s) => s.def.landmark === id)!;

describe('tree and prop scatter', () => {
  it('is deterministic per island', () => {
    const shape = byLandmark('rootfall');
    const a = scatterIsland(shape, null, { density: 1 });
    const b = scatterIsland(shape, null, { density: 1 });
    expect(a.length).toBeGreaterThan(500);
    expect(b.map((p) => [p.species, p.x, p.z])).toEqual(a.map((p) => [p.species, p.x, p.z]));
  });

  it('plants trees on grass, on gentle ground, inside the island', { timeout: 30000 }, () => {
    for (const id of ['rootfall', 'cascade', 'gullrest', 'highmoor', 'glowcap']) {
      const shape = byLandmark(id);
      for (const p of scatterIsland(shape, null, { density: 1 })) {
        expect(shape.normRadius(p.x, p.z)).toBeLessThan(1);
        if (SPECIES[p.species].trunkRadius > 0) {
          const g = terrain.groundAt(p.x, p.z, 1e6)!;
          expect(g.surface).toBe('grass');
          expect(g.normal.y).toBeGreaterThan(0.74);
          expect(Math.abs(p.y - g.y)).toBeLessThan(0.5);
        }
      }
    }
  });

  it('gives each landmark its own character', { timeout: 30000 }, () => {
    const count = (id: string, sp: string) => scatterIsland(byLandmark(id), null, { density: 1 }).filter((p) => p.species === sp).length;
    expect(count('glowcap', 'glowcap')).toBeGreaterThan(40);
    expect(count('gullrest', 'blossom')).toBeGreaterThan(5);
    expect(count('highmoor', 'windbent')).toBeGreaterThan(10);
    expect(count('highmoor', 'broadleaf')).toBe(0);
    expect(count('rootfall', 'giant')).toBeGreaterThan(30);
  });

  it('respects keep-out zones and spacing', { timeout: 30000 }, () => {
    const shape = byLandmark('rootfall');
    const ex = new ExclusionSet();
    ex.circle(shape.def.x, shape.def.z, 60);
    const props = scatterIsland(shape, ex, { density: 1 });
    for (const p of props) expect(Math.hypot(p.x - shape.def.x, p.z - shape.def.z)).toBeGreaterThan(60);
    const trees = props.filter((p) => SPECIES[p.species].trunkRadius > 0);
    for (let i = 0; i < Math.min(trees.length, 200); i++) {
      for (let j = i + 1; j < trees.length; j++) {
        expect(Math.hypot(trees[i].x - trees[j].x, trees[i].z - trees[j].z)).toBeGreaterThan(2);
      }
    }
  });

  it('thins ground clutter more than trees at low quality', () => {
    const shape = byLandmark('cascade');
    const hi = scatterIsland(shape, null, { density: 1 });
    const lo = scatterIsland(shape, null, { density: 0.5 });
    const trees = (l: typeof hi) => l.filter((p) => SPECIES[p.species].trunkRadius > 0).length;
    expect(lo.length).toBeLessThan(hi.length);
    expect(trees(lo) / trees(hi)).toBeGreaterThan(0.7);
  });
});
