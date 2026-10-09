import { describe, expect, it } from 'vitest';
import type { Mesh } from 'three';
import { Terrain } from '../../terrain';
import { LAYOUT } from '../../layout';
import { ExclusionSet } from '../exclusions';
import { QUALITY } from '../../../render/quality';
import { Structures } from './Structures';

describe('ruin shadows', () => {
  const terrain = new Terrain(LAYOUT);
  const s = new Structures(terrain, { exclusions: new ExclusionSet(), colliders: [], decks: [] }, (t) => t(), QUALITY.high);
  const find = (re: RegExp) => {
    const out: Mesh[] = [];
    s.group.traverse((o) => {
      if ((o as Mesh).isMesh && re.test(o.name)) out.push(o as Mesh);
    });
    return out;
  };

  it('cast from one shadow-only mesh per island instead of the world-wide merged mesh', () => {
    const solid = find(/^ruins-solid$/)[0];
    const shadows = find(/^ruins-shadow-/);
    expect(solid.castShadow).toBe(false);
    const islands = new Set(s.ruins.map((r) => r.islandId));
    expect(shadows.length).toBe(islands.size);
    // Together they cover exactly the merged mesh's triangles, sharing its buffers.
    const total = shadows.reduce((n, m) => n + m.geometry.drawRange.count, 0);
    expect(total).toBe(solid.geometry.getIndex()!.count);
    for (const m of shadows) {
      expect(m.castShadow).toBe(true);
      expect(m.geometry.getIndex()).toBe(solid.geometry.getIndex());
      expect(m.geometry.getAttribute('position')).toBe(solid.geometry.getAttribute('position'));
      // Island-sized bounds (Highmoor's are the widest), not the archipelago's: the shadow camera
      // culls the islands far from the player.
      expect(m.geometry.boundingSphere!.radius).toBeLessThan(200);
    }
  });

  it('follow the shadows setting', () => {
    s.setQuality(QUALITY.low);
    expect(find(/^ruins-shadow-/).every((m) => !m.castShadow)).toBe(true);
    s.setQuality(QUALITY.high);
    expect(find(/^ruins-shadow-/).every((m) => m.castShadow)).toBe(true);
  });
});
