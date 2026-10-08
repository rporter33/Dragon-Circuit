import { describe, expect, it } from 'vitest';
import { LAYOUT } from '../../layout';
import { Terrain } from '../../terrain';
import { planRoots, strandClearance } from './rootPlan';

const terrain = new Terrain(LAYOUT);
const plan = planRoots(terrain);
const rootfall = terrain.islands.find((s) => s.def.landmark === 'rootfall')!;

describe('hanging roots', () => {
  it('hangs a forest of long roots under Rootfall', () => {
    const roots = plan.strands.filter((s) => s.islandId === rootfall.def.id && s.kind === 'root');
    expect(roots.length).toBeGreaterThan(150);
    const lengths = roots.map((s) => s.points[0].y - s.points[s.points.length - 1].y);
    expect(Math.max(...lengths)).toBeGreaterThan(100);
    // A good number reach well below the island's lowest rock, into open sky.
    const lowest = Math.min(...roots.map((s) => s.points[s.points.length - 1].y));
    const bottom = rootfall.def.y - rootfall.def.depth;
    expect(lowest).toBeLessThan(bottom - 30);
  });

  it('attaches every strand to the underside of its island', () => {
    for (const s of plan.strands) {
      const shape = terrain.islands.find((i) => i.def.id === s.islandId)!;
      const top = s.points[0];
      if (s.fork) continue; // forks start partway down a parent root
      expect(shape.normRadius(top.x, top.z)).toBeLessThan(1);
      expect(top.y).toBeGreaterThan(shape.bottomHeight(top.x, top.z));
      expect(top.y).toBeLessThan(shape.topHeight(top.x, top.z));
      // Strands hang: the tip is below the top.
      expect(s.points[s.points.length - 1].y).toBeLessThan(top.y);
    }
  });

  it('only dresses islands that should have roots', () => {
    const kinds = new Set(plan.strands.map((s) => terrain.islands.find((i) => i.def.id === s.islandId)!.def.kind));
    expect(kinds.has('islet')).toBe(false);
    expect(kinds.has('roost')).toBe(false);
    expect(kinds.has('forest')).toBe(true);
  });

  it('measures clearance from strands for course design', () => {
    const s = plan.strands.find((x) => x.islandId === rootfall.def.id && x.kind === 'root')!;
    const mid = s.points[Math.floor(s.points.length / 2)];
    expect(strandClearance(plan, mid.x, mid.y, mid.z, rootfall.def.id)).toBeLessThan(0);
    expect(strandClearance(plan, rootfall.def.x, rootfall.def.y + 50, rootfall.def.z, rootfall.def.id)).toBeGreaterThan(20);
  });
});
