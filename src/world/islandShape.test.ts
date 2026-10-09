// Filler islands each get their own silhouette (pointed or blunt hangs, off-center keels, twin
// lobes, a list, a terrace, ragged rims) while the analytic shape stays the one truth for
// collision and meshing.

import { describe, expect, it } from 'vitest';
import { LAYOUT } from './layout';
import { Terrain } from './terrain';

const terrain = new Terrain(LAYOUT);
const fillers = terrain.islands.filter((s) => !s.def.landmark && s.def.kind !== 'roost');

/** A few numbers that describe how an island hangs, independent of its size. */
function silhouette(s: (typeof fillers)[number]) {
  const d = s.def;
  // Where the underside is deepest, relative to the radius.
  let deepest = Infinity;
  let deepX = 0;
  let deepZ = 0;
  for (let i = 0; i <= 20; i++) {
    for (let j = 0; j <= 20; j++) {
      const x = d.x + ((i - 10) / 10) * d.radius * 0.9;
      const z = d.z + ((j - 10) / 10) * d.radius * 0.9;
      if (s.normRadius(x, z) > 1) continue;
      const y = s.bottomHeight(x, z);
      if (y < deepest) {
        deepest = y;
        deepX = x;
        deepZ = z;
      }
    }
  }
  // Fullness: depth half-way out, relative to the deepest point.
  const half = (d.y - s.bottomHeight(d.x + d.radius * 0.5, d.z)) / Math.max(1, d.y - deepest);
  // List: top height difference across the island, relative to the radius.
  const list = Math.abs(s.topHeight(d.x + d.radius * 0.6, d.z) - s.topHeight(d.x - d.radius * 0.6, d.z)) / d.radius;
  return { keel: Math.hypot(deepX - d.x, deepZ - d.z) / d.radius, half, list };
}

describe('filler island silhouettes', () => {
  it('vary from island to island', () => {
    const sil = fillers.map(silhouette);
    const spread = (k: 'keel' | 'half' | 'list') => {
      const v = sil.map((s) => s[k]).sort((a, b) => a - b);
      return v[Math.floor(v.length * 0.85)] - v[Math.floor(v.length * 0.15)];
    };
    expect(fillers.length).toBeGreaterThan(30);
    expect(spread('keel')).toBeGreaterThan(0.15);
    expect(spread('half')).toBeGreaterThan(0.15);
    expect(sil.filter((s) => s.list > 0.08).length).toBeGreaterThan(5);
  });

  it('stay solid and consistent: the underside meets the cliff foot, below the top, within bounds', () => {
    for (const s of terrain.islands) {
      const d = s.def;
      for (let k = 0; k < 48; k++) {
        const th = (k / 48) * Math.PI * 2;
        const R = s.outlineRadius(th);
        expect(R).toBeLessThanOrEqual(s.maxRadius + 1e-6);
        for (const f of [0, 0.3, 0.6, 0.9, 0.999]) {
          const x = d.x + Math.cos(th) * R * f;
          const z = d.z + Math.sin(th) * R * f;
          const top = s.topHeight(x, z);
          const bottom = s.bottomHeight(x, z);
          expect(top - bottom).toBeGreaterThan(3.5);
          expect(top).toBeLessThanOrEqual(s.maxY);
          expect(bottom).toBeGreaterThanOrEqual(s.minY);
        }
        // Exactly at the rim the underside is the cliff foot.
        const x = d.x + Math.cos(th) * R;
        const z = d.z + Math.sin(th) * R;
        expect(s.bottomHeight(x, z)).toBeCloseTo(s.rimBottomAt(th), 3);
      }
    }
  });

  it('leave the landmarks as authored', () => {
    for (const s of terrain.islands.filter((i) => i.def.landmark)) {
      expect(s.lipAt(1.3)).toBe(s.def.lip);
      expect(s.coneExponent).toBe(0.6);
    }
  });
});
