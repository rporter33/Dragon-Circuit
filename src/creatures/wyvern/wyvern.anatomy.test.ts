// Anatomy, form and level of detail: the body plan of a flier, reptile proportions, the breeds'
// silhouettes and the geometry budgets of every LOD (see the dragon quality bar Q2-Q5, Q15).

import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { BreedId, WyvernLook } from '../../core/types';
import { BREEDS, BREED_ORDER } from '../../flight/breeds';
import { COSMETICS, DEFAULT_WYVERN } from '../../cosmetics/catalog';
import { buildRig, rigFor } from './rig';
import { buildWyvernGeometry } from './geometry';
import { humerusRootRadius } from './parts/wings';
import type { Lod } from './parts/res';

const look = (breed: BreedId, extra: Partial<WyvernLook> = {}): WyvernLook => ({ ...DEFAULT_WYVERN, breed, ...extra });

/** Body plan cross-section at a named key. */
function keyProfile(breed: BreedId, mark: 'neckBase' | 'shoulder' | 'chest' | 'mid' | 'rear' | 'tailBase') {
  const rig = rigFor(breed);
  const s = rig.plan.keyS[rig.plan.marks[mark]];
  return { s, ...rig.plan.profile(s), center: rig.plan.point(s, new Vector3()) };
}

describe('a flier\'s body plan (Q2)', () => {
  it('is broadest at the shoulder girdle, not the belly, with the keel deepest under the shoulders', () => {
    for (const breed of BREED_ORDER) {
      const sh = keyProfile(breed, 'shoulder');
      const mid = keyProfile(breed, 'mid');
      expect(sh.hw / mid.hw, breed).toBeGreaterThanOrEqual(1.1);
      // No pot belly: the belly line rises from the sternum back to the hips.
      const rig = rigFor(breed);
      const k = rig.plan.keyS;
      const m = rig.plan.marks;
      let prev = -Infinity;
      let lowest = Infinity;
      let lowestZ = 0;
      for (let s = k[m.neckBase]; s <= k[m.rear]; s += 0.05) {
        const st = rig.plan.station(s);
        const belly = st.center.y - st.lower;
        if (belly < lowest) {
          lowest = belly;
          lowestZ = st.center.z;
        }
        if (s >= k[m.chest]) {
          expect(belly, `${breed} belly at s=${s.toFixed(2)}`).toBeGreaterThan(prev - 0.002);
          prev = belly;
        }
      }
      // The deepest point is the sternum, between the shoulders and the chest.
      expect(lowestZ / rig.props.shape.torsoLength, breed).toBeGreaterThan(0.1);
    }
  });

  it('carries a massive arm: the humerus root at least 0.85x the thigh', () => {
    for (const breed of BREED_ORDER) {
      const rig = rigFor(breed);
      expect(humerusRootRadius(rig) / rig.props.shape.thighRadius, breed).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('never folds the body tube over itself (cross-sections advance along the centreline)', () => {
    for (const breed of BREED_ORDER) {
      const { plan } = rigFor(breed);
      const a = new Vector3();
      const b = new Vector3();
      for (let s = 0.1; s < plan.length - 0.2; s += 0.05) {
        const t = plan.station(s).tangent;
        for (const th of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          plan.surface(s, th, a);
          plan.surface(s + 0.05, th, b);
          expect(b.sub(a).dot(t), `${breed} s=${s.toFixed(2)} θ=${th.toFixed(2)}`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('predator proportions (Q4)', () => {
  it('keeps the tail at most 40% of nose-to-tip (ironback 37%), and the wings outspan the body', () => {
    for (const breed of BREED_ORDER) {
      const rig = buildRig(breed);
      const len = rig.mouth.z - rig.tailTip.z;
      const tail = rig.bones[rig.idx.tail[0]].pos.z - rig.tailTip.z;
      expect(tail / len, breed).toBeLessThanOrEqual(breed === 'ironback' ? 0.37 : 0.4);
      expect(BREEDS[breed].wingspan, breed).toBeGreaterThan(len);
    }
  });

  it('flattens the tail side to side like a crocodile\'s rudder beyond 30% of its length', () => {
    for (const breed of BREED_ORDER) {
      const { plan } = rigFor(breed);
      const s0 = plan.keyS[plan.marks.tailBase];
      const L = plan.length - s0;
      for (let t = 0.3; t <= 0.9; t += 0.05) {
        const p = plan.profile(s0 + t * L);
        expect(p.hu + p.hl, `${breed} t=${t.toFixed(2)}`).toBeGreaterThan(2 * p.hw);
      }
      // Thick through the first quarter: the tail root anchors the thighs.
      const root = plan.profile(s0 + 0.2 * L);
      expect(root.hw / plan.profile(s0).hw, breed).toBeGreaterThan(0.7);
    }
  });

  it('flows the neck base into the shoulders', () => {
    for (const breed of BREED_ORDER) {
      const base = keyProfile(breed, 'neckBase');
      expect(base.hw / rigFor(breed).props.shape.torsoHalfWidth, breed).toBeGreaterThanOrEqual(0.85);
    }
  });
});

// Builds every breed x catalog id x LOD (~300 meshes): give a loaded shared machine headroom.
describe('levels of detail (Q15)', { timeout: 120000 }, () => {
  const slots = { wyvernHorns: 'horns', wyvernFrill: 'frill', wyvernTail: 'tail', saddle: 'saddle', wyvernPattern: 'pattern' } as const;
  const budget = (breed: BreedId, lod: Lod) => (lod === 0 ? (breed === 'ironback' ? 30000 : 24000) : lod === 1 ? 6000 : 1500);

  it('builds all three LODs of every breed and catalog id within budget, on the same skeleton', () => {
    for (const breed of BREED_ORDER) {
      const rig = rigFor(breed);
      const bones = rig.bones.length;
      for (const c of COSMETICS) {
        const key = slots[c.slot as keyof typeof slots];
        if (!key) continue;
        const tris: number[] = [];
        for (const lod of [0, 1, 2] as Lod[]) {
          const info = buildWyvernGeometry(rig, look(breed, { [key]: c.id }), lod);
          const g = info.geometry;
          tris.push(info.triangles);
          expect(info.triangles, `${breed} ${c.id} LOD${lod}`).toBeLessThanOrEqual(budget(breed, lod));
          // Uint16 indices: well under 65,535 vertices.
          expect(info.vertices).toBeLessThan(60000);
          expect(g.index!.array).toBeInstanceOf(Uint16Array);
          const si = g.getAttribute('skinIndex').array;
          let maxIndex = 0;
          for (let i = 0; i < si.length; i++) maxIndex = Math.max(maxIndex, si[i]);
          expect(maxIndex).toBeLessThan(bones);
          expect(g.groups.length).toBe(2);
          g.dispose();
        }
        // Each level is a real step down.
        expect(tris[1]).toBeLessThan(tris[0] * 0.45);
        expect(tris[2]).toBeLessThan(tris[1] * 0.4);
      }
    }
  });

  it('keeps the bone texture at 16x16 (at most 64 bones)', () => {
    for (const breed of BREED_ORDER) expect(rigFor(breed).bones.length).toBeLessThanOrEqual(64);
  });
});
