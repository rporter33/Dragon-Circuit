import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { LAYOUT } from '../layout';
import { Terrain } from '../terrain';
import { ISLAND_LODS, buildIslandMesh, runToEnd } from './islandMesh';
import { SPIRE_LODS, buildSpireMesh } from './spireMesh';
import { ARCH_DISPLACE, ARCH_LODS, buildArchMesh } from './archMesh';
import { DEBRIS_MAX_SIZE, placeDebris } from './debris';
import { BoundsLOD, boundsDistance } from './BoundsLOD';
import { Object3D, PerspectiveCamera } from 'three';
import type { MeshData } from './MeshBuilder';

const terrain = new Terrain(LAYOUT);

/** Every undirected edge shared by exactly two triangles. */
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

const vertexCount = (d: MeshData) => d.positions.length / 3;

describe('spire meshes', () => {
  it('are closed, with a flat landable platform exactly at topY', () => {
    for (const shape of [terrain.spires[0], terrain.spires[3]]) {
      for (const spec of SPIRE_LODS) {
        const { data } = runToEnd(buildSpireMesh(shape, spec));
        expect(openEdges(data), `spire ${shape.def.id} lod ${spec.level}`).toBe(0);
        const p = data.positions;
        let onTop = 0;
        let above = 0;
        for (let i = 0; i < p.length / 3; i++) {
          const y = p[i * 3 + 1];
          if (y > 1e-4) above++;
          if (Math.abs(y) < 1e-4) {
            onTop++;
            // Platform vertices stay inside the collision platform radius.
            expect(Math.hypot(p[i * 3], p[i * 3 + 2])).toBeLessThan(shape.def.topRadius * 1.25);
          }
        }
        expect(above).toBe(0);
        expect(onTop).toBeGreaterThan(8);
      }
    }
  });

  it('stays within the documented radius profile (recessed only)', () => {
    const shape = terrain.spires[0];
    const d = shape.def;
    const { data } = runToEnd(buildSpireMesh(shape, SPIRE_LODS[0]));
    const p = data.positions;
    for (let i = 0; i < p.length / 3; i++) {
      const y = p[i * 3 + 1] + d.topY;
      if (y > d.topY - 1 || y < d.tipY + 1) continue;
      const r = Math.hypot(p[i * 3], p[i * 3 + 2]);
      const th = Math.atan2(p[i * 3 + 2], p[i * 3]);
      expect(r).toBeLessThanOrEqual(shape.radiusAt(y, th) + 1e-3);
    }
  });
});

describe('arch meshes', () => {
  it('keep every rock vertex within ±1 m of the collision tube, never outside it at the ends', () => {
    for (const shape of terrain.arches) {
      const { data } = runToEnd(buildArchMesh(shape, ARCH_LODS[0], terrain));
      const c = shape.center;
      const p = data.positions;
      const q = new Vector3();
      const { arcStart, arcEnd } = shape.def;
      for (let i = 0; i < p.length / 3; i++) {
        q.set(p[i * 3] + c.x, p[i * 3 + 1] + c.y, p[i * 3 + 2] + c.z);
        const dist = shape.distance(q);
        // Rock below an island's top is inside that island's solid, so it may leave the tube.
        const island = terrain.islandAt(q.x, q.z);
        const underground = island !== null && q.y < island.topHeight(q.x, q.z) - 0.05 && q.y > island.bottomHeight(q.x, q.z);
        if (!underground) expect(dist, `arch ${shape.def.id}`).toBeLessThanOrEqual(ARCH_DISPLACE + 1e-3);
        // Along the body (away from end caps and buried feet) the rock hugs the tube.
        q.sub(c);
        let a = Math.atan2(q.dot(shape.up), q.dot(shape.right));
        while (a < arcStart) a += Math.PI * 2;
        const interior = shape.full || (a > arcStart + 0.08 && a < arcEnd - 0.08);
        if (interior) expect(dist, `arch ${shape.def.id}`).toBeGreaterThan(-ARCH_DISPLACE - 0.05);
      }
    }
  });

  it('are closed meshes at every LOD', () => {
    for (const shape of terrain.arches) {
      for (const spec of ARCH_LODS) {
        const { data } = runToEnd(buildArchMesh(shape, spec, terrain));
        expect(openEdges(data), `arch ${shape.def.id} lod ${spec.level}`).toBe(0);
      }
    }
  });

  it('bury the Archway Reach feet in their islets', () => {
    const reach = terrain.arches.filter((a) => !a.full && a.def.arcEnd === Math.PI);
    for (const shape of reach) {
      const { data } = runToEnd(buildArchMesh(shape, ARCH_LODS[1], terrain));
      const c = shape.center;
      const p = data.positions;
      // The lowest vertices of each foot are below the islet's top surface.
      let lowest = Infinity;
      let lx = 0;
      let lz = 0;
      for (let i = 0; i < p.length / 3; i++) {
        if (p[i * 3 + 1] < lowest) {
          lowest = p[i * 3 + 1];
          lx = p[i * 3] + c.x;
          lz = p[i * 3 + 2] + c.z;
        }
      }
      const island = terrain.islandAt(lx, lz);
      expect(island).not.toBeNull();
      expect(lowest + c.y).toBeLessThan(island!.topHeight(lx, lz) - 2);
    }
  });
});

describe('LOD budgets', () => {
  it('keeps vertex counts within budget per LOD', () => {
    // Per-feature vertex budgets for the largest instances in the world.
    const islandBudget = [80000, 14000, 3000];
    const spireBudget = [30000, 4000, 700];
    const archBudget = [40000, 6000, 1200];
    const biggest = terrain.islands.reduce((a, b) => (b.def.radius > a.def.radius ? b : a));
    ISLAND_LODS.forEach((spec, k) => {
      const m = runToEnd(buildIslandMesh(biggest, spec));
      expect(vertexCount(m.data), `island lod ${k}`).toBeLessThan(islandBudget[k]);
    });
    SPIRE_LODS.forEach((spec, k) => {
      const { data } = runToEnd(buildSpireMesh(terrain.spires[0], spec));
      expect(vertexCount(data), `spire lod ${k}`).toBeLessThan(spireBudget[k]);
    });
    const eye = terrain.arches.find((a) => a.def.landmark === 'eye')!;
    ARCH_LODS.forEach((spec, k) => {
      const { data } = runToEnd(buildArchMesh(eye, spec, terrain));
      expect(vertexCount(data), `arch lod ${k}`).toBeLessThan(archBudget[k]);
    });
  });

  it('keeps the whole world at the coarsest LOD light', () => {
    let tris = 0;
    for (const s of terrain.islands) tris += runToEnd(buildIslandMesh(s, ISLAND_LODS[2])).data.indices.length / 3;
    for (const s of terrain.spires) tris += runToEnd(buildSpireMesh(s, SPIRE_LODS[2])).data.indices.length / 3;
    for (const s of terrain.arches) tris += runToEnd(buildArchMesh(s, ARCH_LODS[2], terrain)).data.indices.length / 3;
    expect(tris).toBeLessThan(80000);
  });

  it('LOD levels get strictly coarser', () => {
    const shape = terrain.islands[0];
    const counts = ISLAND_LODS.map((spec) => vertexCount(runToEnd(buildIslandMesh(shape, spec)).data));
    expect(counts[0]).toBeGreaterThan(counts[1] * 3);
    expect(counts[1]).toBeGreaterThan(counts[2] * 3);
  });
});

describe('floating debris', () => {
  const pieces = placeDebris(terrain);
  it('is small, sparse and clear of all rock', () => {
    expect(pieces.length).toBeGreaterThan(60);
    expect(pieces.length).toBeLessThan(400);
    const p = new Vector3();
    for (const d of pieces) {
      expect(d.size).toBeLessThanOrEqual(DEBRIS_MAX_SIZE);
      p.set(...d.position);
      expect(terrain.distance(p)).toBeGreaterThan(d.size + 1);
    }
  });

  it('never hangs in the Eye of the Gale’s hole', () => {
    const eye = terrain.arches.find((a) => a.def.landmark === 'eye')!;
    const p = new Vector3();
    for (const d of pieces) {
      p.set(...d.position).sub(eye.center);
      const along = p.dot(eye.normal);
      const inPlane = Math.sqrt(Math.max(0, p.lengthSq() - along * along));
      if (Math.abs(along) < eye.def.tube) expect(inPlane).toBeGreaterThan(eye.def.radius - eye.def.tube);
    }
  });

  it('is deterministic', () => {
    expect(placeDebris(terrain)).toEqual(pieces);
  });
});

describe('BoundsLOD', () => {
  it('measures distance to bounds, not to the origin', () => {
    const cyl = { kind: 'cylinder' as const, x: 0, z: 0, radius: 100, minY: -50, maxY: 10 };
    expect(boundsDistance(cyl, 50, 0, 0)).toBe(0);
    expect(boundsDistance(cyl, 130, 0, 0)).toBeCloseTo(30);
    expect(boundsDistance(cyl, 0, 40, 0)).toBeCloseTo(30);
    expect(boundsDistance(cyl, 103, 14, 0)).toBeCloseTo(5);
  });

  it('switches levels by bounds distance and falls back to whatever is built', () => {
    const lod = new BoundsLOD({ kind: 'cylinder', x: 0, z: 0, radius: 200, minY: -10, maxY: 10 });
    const fine = new Object3D();
    const coarse = new Object3D();
    lod.setLevel(coarse, 500);
    const cam = new PerspectiveCamera();
    cam.position.set(150, 0, 0); // inside the footprint, 150 m from the origin
    cam.updateMatrixWorld();
    lod.update(cam);
    expect(coarse.visible).toBe(true); // only level built: shown at any distance
    lod.setLevel(fine, 0);
    lod.update(cam);
    expect(fine.visible).toBe(true);
    expect(coarse.visible).toBe(false);
    cam.position.set(1000, 0, 0);
    cam.updateMatrixWorld();
    lod.update(cam);
    expect(fine.visible).toBe(false);
    expect(coarse.visible).toBe(true);
  });
});
