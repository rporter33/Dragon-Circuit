import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { LAYOUT } from '../layout';
import { IslandShape } from '../islandShape';
import { ISLAND_LODS, buildIslandMesh, runToEnd, BROW_OUT, type IslandMeshResult } from './islandMesh';
import { topWeights, type TopWeights } from './islandPaint';
import type { MeshData } from './MeshBuilder';

const shapes = LAYOUT.islands.map((d) => new IslandShape(d));
const byKind = (k: string) => shapes.find((s) => s.def.kind === k)!;
// A spread of sizes and kinds: the hub, the biggest, a rocky one, a tiny islet.
const sample = [
  shapes.find((s) => s.def.landmark === 'roost')!,
  shapes.find((s) => s.def.landmark === 'cascade')!,
  byKind('rocky'),
  shapes.reduce((a, b) => (b.def.radius < a.def.radius ? b : a)),
];

const tmpN = new Vector3();
const cache = new Map<string, IslandMeshResult>();
function mesh(shape: IslandShape, lod: number): IslandMeshResult {
  const key = `${shape.def.id}:${lod}`;
  let m = cache.get(key);
  if (!m) cache.set(key, (m = runToEnd(buildIslandMesh(shape, ISLAND_LODS[lod]))));
  return m;
}

/** Every undirected edge must be shared by exactly two triangles: closed, no gaps, no T-joins. */
function openEdges(data: MeshData): number {
  const edges = new Map<number, number>();
  const n = data.positions.length / 3;
  const idx = data.indices;
  for (let k = 0; k < idx.length; k += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx[k + e];
      const b = idx[k + ((e + 1) % 3)];
      const key = Math.min(a, b) * n + Math.max(a, b);
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let bad = 0;
  for (const c of edges.values()) if (c !== 2) bad++;
  return bad;
}

describe('island meshes', () => {
  it('puts every top vertex exactly on topHeight', () => {
    for (const shape of sample) {
      for (let lod = 0; lod < ISLAND_LODS.length; lod++) {
        const m = mesh(shape, lod);
        const p = m.data.positions;
        const d = shape.def;
        let worst = 0;
        for (let i = 0; i < m.topVertexCount; i++) {
          const x = p[i * 3] + d.x;
          const z = p[i * 3 + 2] + d.z;
          worst = Math.max(worst, Math.abs(p[i * 3 + 1] + d.y - shape.topHeight(x, z)));
        }
        expect(worst, `island ${d.id} lod ${lod}`).toBeLessThan(2e-3);
      }
    }
  });

  it('is watertight: the rim band joins top and underside with no gaps', () => {
    for (const shape of sample) {
      for (let lod = 0; lod < ISLAND_LODS.length; lod++) {
        const m = mesh(shape, lod);
        expect(openEdges(m.data), `island ${shape.def.id} lod ${lod}`).toBe(0);
        // The cliff foot ring sits on the analytic rim of the underside.
        const p = m.data.positions;
        for (let i = 0; i < m.footRing.count; i++) {
          const v = m.footRing.start + i;
          expect(p[v * 3 + 1]).toBeCloseTo(shape.rimBottomAt((i / m.footRing.count) * Math.PI * 2) - shape.def.y, 4);
        }
      }
    }
  });

  it('splits its index buffer into the top and cliff band, then the underside', () => {
    for (const shape of sample) {
      for (let lod = 0; lod < ISLAND_LODS.length; lod++) {
        const m = mesh(shape, lod);
        const idx = m.data.indices;
        const p = m.data.positions;
        expect(m.splitIndex % 3).toBe(0);
        expect(m.splitIndex).toBeGreaterThan(0);
        expect(m.splitIndex).toBeLessThan(idx.length);
        // Nothing drawn in the top part hangs below the cliff foot; nothing in the underside part
        // rises above it.
        let footMin = Infinity;
        let footMax = -Infinity;
        for (let i = 0; i < m.footRing.count; i++) {
          const y = p[(m.footRing.start + i) * 3 + 1];
          footMin = Math.min(footMin, y);
          footMax = Math.max(footMax, y);
        }
        for (let k = 0; k < m.splitIndex; k++) expect(p[idx[k] * 3 + 1]).toBeGreaterThanOrEqual(footMin - 1e-3);
        for (let k = m.splitIndex; k < idx.length; k++) expect(p[idx[k] * 3 + 1]).toBeLessThanOrEqual(footMax + 1e-3);
      }
    }
  });

  it('faces outward: top normals point up, underside normals point down', () => {
    const m = mesh(sample[0], 1);
    const n = m.data.normals;
    expect(n[1]).toBeGreaterThan(0.9); // top center
    const last = m.data.positions.length / 3 - 1;
    expect(n[last * 3 + 1]).toBeLessThan(-0.5); // bottom tip
  });

  it('keeps visible rock inside the collision volume (within the brow overhang)', () => {
    for (const shape of sample) {
      const m = mesh(shape, 0);
      const d = shape.def;
      const p = m.data.positions;
      const nv = p.length / 3;
      for (let i = m.topVertexCount; i < nv; i++) {
        const x = p[i * 3] + d.x;
        const y = p[i * 3 + 1] + d.y;
        const z = p[i * 3 + 2] + d.z;
        const rxz = Math.hypot(x - d.x, z - d.z);
        const R = shape.outlineRadius(Math.atan2(z - d.z, x - d.x));
        expect(rxz).toBeLessThan(R + BROW_OUT + 1e-3);
        if (rxz < R - 0.05) expect(y).toBeGreaterThan(shape.bottomHeight(x, z) - 0.01);
      }
    }
  });

  it('paints top surfaces in agreement with surfaceAt (footsteps match what you see)', () => {
    const w: TopWeights = { rock: 0, dirt: 0, stone: 0, grass: 0, track: 0, nearRock: 0, nearDirt: 0, nearStone: 0, nearTrack: 0 };
    for (const shape of [...sample, shapes.find((s) => s.def.kind === 'ruin')!]) {
      const m = mesh(shape, 0);
      const d = shape.def;
      const p = m.data.positions;
      let checked = 0;
      let mismatched = 0;
      for (let i = 0; i < m.topVertexCount; i++) {
        const x = p[i * 3] + d.x;
        const z = p[i * 3 + 2] + d.z;
        const ny = shape.topNormal(x, z, tmpN).y;
        const kind = shape.surfaceAt(x, z, ny);
        topWeights(shape, x, z, shape.normRadius(x, z), ny, w);
        const painted = w[kind as keyof TopWeights];
        checked++;
        if (painted < 0.5 - 1e-6) mismatched++;
      }
      // Only vertices straddling two soft boundaries at once may disagree.
      expect(mismatched / checked, `island ${d.id}`).toBeLessThan(0.01);
    }
  });

  it('reports sizes', () => {
    const rows: string[] = [];
    let total = [0, 0, 0];
    for (const shape of shapes) {
      const t: number[] = [];
      for (let lod = 0; lod < 3; lod++) {
        const t0 = performance.now();
        const m = runToEnd(buildIslandMesh(shape, ISLAND_LODS[lod]));
        const ms = performance.now() - t0;
        t.push(m.data.indices.length / 3, ms);
        total[lod] += m.data.indices.length / 3;
      }
      rows.push(`${shape.def.id} ${shape.def.kind} r=${shape.def.radius} tris ${t[0]} ${t[2]} ${t[4]}  ms ${t[1].toFixed(1)} ${t[3].toFixed(1)} ${t[5].toFixed(1)}`);
    }
    console.log(rows.join('\n'));
    console.log('total tris', total);
  });
});
