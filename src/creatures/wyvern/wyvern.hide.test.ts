// Wyvern hide: patterns, the ghost shell, reptile scales and armour, region seams (stream D).
// Shared poses and helpers: wyvern.testkit.ts.

import { describe, expect, it } from 'vitest';
import { cosmeticsFor } from '../../cosmetics/catalog';
import { Wyvern } from './Wyvern';
import { PATTERN_IDS } from './materials';
import { gliding, look } from './wyvern.testkit';

describe('model budget and cosmetics', () => {
  it('maps every pattern id to a distinct shader pattern', () => {
    const ids = cosmeticsFor('wyvernPattern').map((c) => PATTERN_IDS[c.id]);
    expect(ids.every((v) => v !== undefined)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('ghost', () => {
  it('is translucent and casts no shadows', () => {
    const w = new Wyvern(look('galewing'), { ghost: true });
    const m = w.skinnedMesh!;
    expect(m.castShadow).toBe(false);
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      expect(mat.transparent).toBe(true);
      expect(mat.depthWrite).toBe(false);
    }
    w.update(1 / 60, gliding());
    w.dispose();
  });
});

describe('reptile hide', { timeout: 60000 }, () => {
  it('armors the ironback like a crocodile: paired keeled osteoderms from nape to tail, none under the saddle', () => {
    const w = new Wyvern(look('ironback'));
    const g = w.skinnedMesh!.geometry;
    const pos = g.getAttribute('position');
    const mat = g.getAttribute('aMat');
    const rig = w.rigDef;
    let left = 0;
    let right = 0;
    let zMax = -Infinity;
    let zMin = Infinity;
    let underSaddle = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.round(mat.getX(i)) !== 8) continue;
      const x = pos.getX(i);
      const z = pos.getZ(i);
      if (x > 0.01) left++;
      else if (x < -0.01) right++;
      zMax = Math.max(zMax, z);
      zMin = Math.min(zMin, z);
      if (Math.abs(z - rig.seat.z) < 0.35 && pos.getY(i) > rig.seat.y - 0.6) underSaddle++;
    }
    // Paired rows, mirror-symmetric.
    expect(left).toBeGreaterThan(400);
    expect(Math.abs(left - right)).toBeLessThan(left * 0.02);
    // From up the neck (well ahead of the shoulders) to far down the tail.
    expect(zMax).toBeGreaterThan(rig.props.shoulder[2] + 1);
    expect(zMin).toBeLessThan(rig.tailTip.z * 0.6);
    expect(underSaddle).toBe(0);
    w.dispose();
    // The other breeds go unarmored.
    const h = new Wyvern(look('harrier'));
    const hm = h.skinnedMesh!.geometry.getAttribute('aMat');
    let plates = 0;
    for (let i = 0; i < hm.count; i++) if (Math.round(hm.getX(i)) === 8) plates++;
    expect(plates).toBe(0);
    h.dispose();
  });

  it('paints every triangle in one material region (no seams of the ids in between)', () => {
    for (const saddle of ['rider', 'royal', 'nomad', 'racing']) {
      const w = new Wyvern(look('ironback', { saddle }));
      const g = w.skinnedMesh!.geometry;
      const mat = g.getAttribute('aMat');
      const idx = g.index!.array;
      let mixed = 0;
      for (let t = 0; t < idx.length; t += 3) {
        const r0 = mat.getX(idx[t]);
        if (mat.getX(idx[t + 1]) !== r0 || mat.getX(idx[t + 2]) !== r0) mixed++;
      }
      expect(mixed, saddle).toBe(0);
      w.dispose();
    }
  });

  it('tells the body shader the angle around the tube for its rows of keeled scales', () => {
    const w = new Wyvern(look('harrier'));
    const geo = w.skinnedMesh!.geometry;
    const mat = geo.getAttribute('aMat');
    // Body group only (membranes use the channel for their flutter).
    const body = new Set<number>();
    const idx = geo.index!.array;
    for (let i = geo.groups[0].start; i < geo.groups[0].start + geo.groups[0].count; i++) body.add(idx[i]);
    let tube = 0;
    let bad = 0;
    for (const i of body) {
      if (Math.round(mat.getX(i)) !== 0) continue;
      const a = mat.getW(i);
      if (a > 0.5) {
        tube++;
        if (a < 1 - 1e-6 || a > 3 + 1e-6) bad++;
      }
    }
    expect(tube).toBeGreaterThan(1000);
    expect(bad).toBe(0);
    w.dispose();
  });
});
