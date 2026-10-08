import { describe, expect, it } from 'vitest';
import { cosmeticsFor, DEFAULT_RIDER } from '../../cosmetics/catalog';
import type { RiderLook } from '../../core/types';
import { buildRiderModel } from './model';
import { allClothSpecs } from './accessories';
import { BONE_NAMES } from './rig';

function finite(arr: ArrayLike<number>): boolean {
  for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) return false;
  return true;
}

function looks(): RiderLook[] {
  const out: RiderLook[] = [];
  for (const o of cosmeticsFor('riderOutfit')) out.push({ ...DEFAULT_RIDER, outfit: o.id });
  for (const o of cosmeticsFor('riderHair')) out.push({ ...DEFAULT_RIDER, hair: o.id, headgear: 'none' });
  for (const o of cosmeticsFor('riderHeadgear')) out.push({ ...DEFAULT_RIDER, headgear: o.id });
  for (const o of cosmeticsFor('riderScarf')) out.push({ ...DEFAULT_RIDER, scarf: o.id });
  for (const o of cosmeticsFor('riderCape')) out.push({ ...DEFAULT_RIDER, cape: o.id });
  for (const b of ['slight', 'medium', 'broad'] as const) out.push({ ...DEFAULT_RIDER, build: b, outfit: 'skyknight', cape: 'feathered', hair: 'long' });
  return out;
}

describe('rider model', () => {
  it('builds every catalog option with finite, well-formed attributes', { timeout: 60000 }, () => {
    for (const look of looks()) {
      const m = buildRiderModel(look);
      const g = m.geometry;
      const pos = g.getAttribute('position');
      const nrm = g.getAttribute('normal');
      const sw = g.getAttribute('skinWeight');
      const si = g.getAttribute('skinIndex');
      expect(finite(pos.array), `${JSON.stringify(look)} positions`).toBe(true);
      expect(finite(nrm.array), `${look.outfit}/${look.hair}/${look.headgear} normals`).toBe(true);
      let badNormals = 0;
      for (let i = 0; i < nrm.count; i++) {
        const l = Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
        if (Math.abs(l - 1) > 1e-3) badNormals++;
      }
      expect(badNormals).toBe(0);
      let badWeights = 0;
      for (let i = 0; i < sw.count; i++) {
        const s = sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i);
        if (Math.abs(s - 1) > 1e-4) badWeights++;
        for (let k = 0; k < 4; k++) if (si.getComponent(i, k) >= BONE_NAMES.length) badWeights++;
      }
      expect(badWeights).toBe(0);
      // One draw call's worth of geometry, but not an absurd one.
      expect(pos.count).toBeGreaterThan(2000);
      expect(pos.count).toBeLessThan(40000);
      g.dispose();
    }
  });

  it('declares cloth with valid anchors for every scarf, cape, hair and coat', { timeout: 60000 }, () => {
    for (const look of looks()) {
      const m = buildRiderModel(look);
      for (const spec of allClothSpecs(m.ctx, look)) {
        expect(spec.rest.length).toBe(spec.cols * spec.rows);
        expect(spec.anchorBone.length).toBe(spec.cols * spec.rows);
        // The first row is pinned, so the piece hangs from the body.
        for (let c = 0; c < spec.cols; c++) expect(spec.anchorBone[c]).toBeGreaterThanOrEqual(0);
        for (const p of spec.rest) expect(finite([p.x, p.y, p.z])).toBe(true);
      }
      m.geometry.dispose();
    }
  });

  it('builds quickly enough to restyle live in the stable', () => {
    const t0 = performance.now();
    const m = buildRiderModel({ ...DEFAULT_RIDER, outfit: 'cartographer', cape: 'feathered', hair: 'curls' });
    const ms = performance.now() - t0;
    m.geometry.dispose();
    expect(ms).toBeLessThan(400);
  });

  it('is about 1.75 m tall for the medium build', () => {
    const m = buildRiderModel({ ...DEFAULT_RIDER, hair: 'shaved', headgear: 'none' });
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox!;
    expect(bb.min.y).toBeGreaterThan(-0.02);
    expect(bb.max.y).toBeGreaterThan(1.68);
    expect(bb.max.y).toBeLessThan(1.82);
  });
});
