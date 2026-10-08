import { describe, expect, it } from 'vitest';
import { LAYOUT } from '../../layout';
import { Terrain } from '../../terrain';
import { ExclusionSet } from '../exclusions';
import { CHUNK_SIZE, generateFieldChunk, keepFraction, prefixCount, tuftCapacity } from './fieldChunk';

const terrain = new Terrain(LAYOUT);
const params = { density: 1, flowerDensity: 1 };
const gull = LAYOUT.islands.find((i) => i.landmark === 'gullrest')!;
const cx = Math.floor(gull.x / CHUNK_SIZE);
const cz = Math.floor(gull.z / CHUNK_SIZE);

describe('ground cover chunks', () => {
  it('is deterministic', () => {
    const a = generateFieldChunk(terrain, null, cx, cz, params);
    const b = generateFieldChunk(terrain, null, cx, cz, params);
    expect(a.tufts.count).toBeGreaterThan(1000);
    expect(b.tufts.count).toBe(a.tufts.count);
    expect(Array.from(b.tufts.pos.slice(0, 40))).toEqual(Array.from(a.tufts.pos.slice(0, 40)));
    expect(b.flowers.count).toBe(a.flowers.count);
  });

  it('only grows on grass, inside the chunk, at the surface height', () => {
    const c = generateFieldChunk(terrain, null, cx, cz, params);
    const shape = terrain.islands.find((s) => s.def.id === gull.id)!;
    for (let i = 0; i < c.tufts.count; i += 17) {
      const x = c.tufts.pos[i * 4];
      const y = c.tufts.pos[i * 4 + 1];
      const z = c.tufts.pos[i * 4 + 2];
      expect(x).toBeGreaterThanOrEqual(cx * CHUNK_SIZE - 0.5);
      expect(x).toBeLessThanOrEqual((cx + 1) * CHUNK_SIZE + 0.5);
      const g = terrain.groundAt(x, z, 1e6)!;
      expect(g.surface).toBe('grass');
      // Heights come from a 2 m lattice: within a few centimeters except at the rim roll-off.
      expect(Math.abs(y - shape.topHeight(x, z))).toBeLessThan(0.25);
      expect(c.tufts.shape[i * 4]).toBeGreaterThan(0.05);
    }
  });

  it('emits instances in ascending rank so prefixes are even samples', () => {
    const c = generateFieldChunk(terrain, null, cx, cz, params);
    for (let i = 1; i < c.tufts.count; i++) expect(c.tufts.shape[i * 4 + 2]).toBeGreaterThanOrEqual(c.tufts.shape[(i - 1) * 4 + 2]);
    expect(prefixCount(c.tufts, 1)).toBe(c.tufts.count);
    const half = prefixCount(c.tufts, 0.3);
    expect(half).toBeGreaterThan(c.tufts.count * 0.3);
    expect(half).toBeLessThan(c.tufts.count * 0.5);
  });

  it('thins with distance but never to nothing', () => {
    expect(keepFraction(0)).toBe(1);
    expect(keepFraction(10)).toBe(1);
    expect(keepFraction(60)).toBeLessThan(0.35);
    expect(keepFraction(5000)).toBeGreaterThan(0);
    for (let d = 1; d < 300; d += 7) expect(keepFraction(d + 7)).toBeLessThanOrEqual(keepFraction(d));
  });

  it('is empty over open sky and respects capacity and density', () => {
    const sky = generateFieldChunk(terrain, null, 70, 70, params);
    expect(sky.tufts.count).toBe(0);
    const dense = generateFieldChunk(terrain, null, cx, cz, { density: 1.5, flowerDensity: 1 });
    const sparse = generateFieldChunk(terrain, null, cx, cz, { density: 0.25, flowerDensity: 1 });
    expect(dense.tufts.count).toBeLessThanOrEqual(tuftCapacity(1.5));
    expect(sparse.tufts.count).toBeLessThan(dense.tufts.count * 0.3);
  });

  it('keeps grass out of keep-out zones', () => {
    const ex = new ExclusionSet();
    const mx = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
    const mz = cz * CHUNK_SIZE + CHUNK_SIZE / 2;
    ex.circle(mx, mz, 8);
    const c = generateFieldChunk(terrain, ex, cx, cz, params);
    for (let i = 0; i < c.tufts.count; i++) {
      expect(Math.hypot(c.tufts.pos[i * 4] - mx, c.tufts.pos[i * 4 + 2] - mz)).toBeGreaterThan(8);
    }
  });
});
