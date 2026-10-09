// What you see is what you hit: every species' collision shapes are measured against its drawn
// (LOD0) geometry. "Covered" = share of drawn vertices inside or within 0.5 m of a shape;
// "honest" = share of points on the shapes' surfaces within 0.75 m of something drawn (nothing
// invisible in the way).

import { describe, expect, it } from 'vitest';
import { Triangle, Vector3 } from 'three';
import type { Collider } from '../../../core/types';
import { signedDistance } from '../../colliders';
import { SPECIES, speciesShapes, type SpeciesId } from './species';
import { instanceColliders } from './Forest';

function shapesAt(id: SpeciesId): Collider[] {
  const out: Collider[] = [];
  instanceColliders({ species: id, islandId: 0, x: 0, y: 0, z: 0, yaw: 0, scale: 1, scaleY: 1, leanX: 0, leanZ: 0, tint: [1, 1, 1] }, out);
  return out;
}

function surfaceSamples(c: Collider): Vector3[] {
  const pts: Vector3[] = [];
  if (c.kind === 'sphere') {
    const n = 200;
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n;
      const r = Math.sqrt(1 - y * y);
      const th = i * 2.399963;
      pts.push(new Vector3(c.x + Math.cos(th) * r * c.radius, c.y + y * c.radius, c.z + Math.sin(th) * r * c.radius));
    }
  } else if (c.kind !== 'box') {
    for (let k = 0; k <= 8; k++) {
      const y = c.y0 + ((c.y1 - c.y0) * k) / 8;
      for (let j = 0; j < 16; j++) {
        const th = (j / 16) * Math.PI * 2;
        pts.push(new Vector3(c.x + Math.cos(th) * c.radius, y, c.z + Math.sin(th) * c.radius));
      }
    }
  }
  return pts;
}

describe('species collision shapes fit what is drawn', () => {
  const ids = (Object.keys(SPECIES) as SpeciesId[]).filter((id) => speciesShapes(id).length > 0);
  for (const id of ids) {
    it(id, () => {
      const cols = shapesAt(id);
      const geo = SPECIES[id].build(0);
      const pos = geo.getAttribute('position');
      const verts: Vector3[] = [];
      for (let i = 0; i < pos.count; i++) verts.push(new Vector3().fromBufferAttribute(pos, i));
      const idx = geo.getIndex()!;
      const tris: Triangle[] = [];
      for (let i = 0; i < idx.count; i += 3) tris.push(new Triangle(verts[idx.getX(i)], verts[idx.getX(i + 1)], verts[idx.getX(i + 2)]));
      const q = new Vector3();
      let covered = 0;
      for (const v of verts) {
        let d = Infinity;
        for (const c of cols) d = Math.min(d, signedDistance(c, v, null));
        if (d <= 0.5) covered++;
      }
      // Ignore samples below ground (y < 0) and inside other shapes.
      const honesty = (soft: boolean) => {
        let honest = 0;
        let total = 0;
        for (const c of cols) {
          if (!!c.soft !== soft) continue;
          for (const p of surfaceSamples(c)) {
            if (p.y < 0.05) continue;
            if (cols.some((o) => o !== c && signedDistance(o, p, null) < -0.05)) continue;
            total++;
            let best = Infinity;
            for (const t of tris) {
              t.closestPointToPoint(p, q);
              const d = q.distanceToSquared(p);
              if (d < best) best = d;
            }
            if (Math.sqrt(best) < 0.75) honest++;
          }
        }
        return total ? honest / total : 1;
      };
      const cov = covered / verts.length;
      const solid = honesty(false);
      const soft = honesty(true);
      console.log(`${id}: ${cols.length} shapes, covered ${(cov * 100).toFixed(1)}%, honest solid ${(solid * 100).toFixed(1)}% soft ${(soft * 100).toFixed(1)}%`);
      // Most of what is drawn is within half a meter of a shape...
      expect(cov).toBeGreaterThan(0.65);
      // ...solid shapes hug what is drawn (nothing invisible blocks)...
      expect(solid).toBeGreaterThan(0.85);
      // ...and foliage cushions sit mostly on leaves.
      expect(soft).toBeGreaterThan(0.55);
    });
  }
});
