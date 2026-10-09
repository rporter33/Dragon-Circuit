import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { LAYOUT } from './layout';
import { Terrain } from './terrain';
import { RIM_DROP } from './islandShape';
import type { GroundHit } from '../core/types';

const terrain = new Terrain(LAYOUT);

describe('layout', () => {
  it('has unique island ids and named landmarks', () => {
    const ids = new Set(LAYOUT.islands.map((i) => i.id));
    expect(ids.size).toBe(LAYOUT.islands.length);
    for (const l of LAYOUT.landmarks) expect(l.name.length).toBeGreaterThan(0);
    expect(LAYOUT.islands.length).toBeGreaterThan(40);
  });

  it('keeps every island above the cloud floor and inside the boundary', () => {
    for (const shape of terrain.islands) {
      expect(shape.minY).toBeGreaterThan(-120);
      expect(Math.hypot(shape.def.x, shape.def.z)).toBeLessThan(LAYOUT.boundaryRadius);
    }
  });

  it('lets no two islands interpenetrate', () => {
    const isl = terrain.islands;
    for (let i = 0; i < isl.length; i++) {
      for (let j = i + 1; j < isl.length; j++) {
        const a = isl[i];
        const b = isl[j];
        const dxz = Math.hypot(a.def.x - b.def.x, a.def.z - b.def.z);
        const overlapXZ = dxz < a.maxRadius + b.maxRadius;
        const overlapY = a.minY < b.maxY && b.minY < a.maxY;
        expect(overlapXZ && overlapY, `islands ${a.def.id} and ${b.def.id}`).toBe(false);
      }
    }
  });
});

describe('island shapes', () => {
  it('keeps a solid rim at least 3 m thick all the way round', () => {
    for (const shape of terrain.islands) {
      const d = shape.def;
      for (let k = 0; k < 64; k++) {
        const th = (k / 64) * Math.PI * 2;
        const R = shape.outlineRadius(th) * 0.999;
        const x = d.x + Math.cos(th) * R;
        const z = d.z + Math.sin(th) * R;
        expect(shape.topHeight(x, z) - shape.bottomHeight(x, z)).toBeGreaterThan(d.lip - RIM_DROP - 1);
      }
    }
  });
});

describe('terrain queries', () => {
  it('finds ground at the spawn and at the stable door on the Roost', () => {
    const roost = LAYOUT.islands.find((i) => i.landmark === 'roost')!;
    const g = terrain.groundAt(LAYOUT.spawn.position[0], LAYOUT.spawn.position[2], 1e6)!;
    expect(g).not.toBeNull();
    expect(g.islandId).toBe(roost.id);
    const s = terrain.groundAt(LAYOUT.stable.x, LAYOUT.stable.z, 1e6)!;
    expect(s.islandId).toBe(roost.id);
    expect(s.surface).toBe('stone');
  });

  it('returns no ground over open sky', () => {
    expect(terrain.groundAt(0, 2400, 1e6)).toBeNull();
  });

  it('pushes a sphere sunk into the ground back onto the surface', () => {
    const g = terrain.groundAt(0, 0, 1e6)!;
    const c = new Vector3(0, g.y - 1, 0);
    const push = new Vector3();
    const n = new Vector3();
    expect(terrain.collideSphere(c, 2, push, n)).toBe(true);
    c.add(push);
    expect(c.y).toBeGreaterThan(g.y + 1.5);
    expect(n.y).toBeGreaterThan(0.8);
  });

  it('pushes a sphere against the underside downward', () => {
    const roost = terrain.islands.find((i) => i.def.landmark === 'roost')!;
    const by = roost.bottomHeight(0, 0);
    const c = new Vector3(0, by + 0.5, 0);
    const push = new Vector3();
    const n = new Vector3();
    expect(terrain.collideSphere(c, 2, push, n)).toBe(true);
    expect(n.y).toBeLessThan(-0.5);
  });

  it('raycasts down onto the top surface', () => {
    const g = terrain.groundAt(30, -10, 1e6)!;
    const hit = terrain.raycast(new Vector3(30, g.y + 80, -10), new Vector3(0, -1, 0), 200)!;
    expect(hit).not.toBeNull();
    expect(Math.abs(hit.point.y - g.y)).toBeLessThan(1.5);
  });

  it('has clear air through the middle of the Eye of the Gale', () => {
    const eye = terrain.arches.find((a) => a.def.landmark === 'eye')!;
    expect(eye.distance(eye.center)).toBeGreaterThan(eye.def.radius - eye.def.tube - 1);
    expect(terrain.distance(eye.center)).toBeGreaterThan(30);
  });

  it('plants the Archway Reach arches on their islets', () => {
    const reach = terrain.arches.filter((a) => !a.full && a.def.arcEnd === Math.PI);
    expect(reach.length).toBe(3);
    const p = new Vector3();
    for (const a of reach) {
      for (const end of [0, Math.PI]) {
        a.pointAt(end, p);
        expect(terrain.islandAt(p.x, p.z)).not.toBeNull();
      }
    }
  });
});

describe('groundAt with an out parameter', () => {
  it('writes the same hit into `out` and allocates nothing', () => {
    const t = new Terrain(LAYOUT);
    const out = { y: 0, normal: new Vector3(), islandId: 0, surface: 'grass' as const } as GroundHit;
    for (const [x, z] of [[0, 0], [30, -40], [120, 60], [560, 420], [9000, 9000]]) {
      const a = t.groundAt(x, z, 1e6);
      const b = t.groundAt(x, z, 1e6, out);
      if (!a) {
        expect(b).toBeNull();
        continue;
      }
      expect(b).toBe(out);
      expect(out.y).toBe(a.y);
      expect(out.islandId).toBe(a.islandId);
      expect(out.surface).toBe(a.surface);
      expect(out.normal.toArray()).toEqual(a.normal.toArray());
    }
  });

  it('reports structure tops and spire tops like before', () => {
    const t = new Terrain(LAYOUT);
    const g = t.groundAt(0, 0, 1e6)!;
    t.colliders.add({ kind: 'box', x: 0, y: g.y + 6, z: 0, hx: 4, hy: 1, hz: 4, yaw: 0, surface: 'stone' });
    const roof = t.groundAt(0, 0, g.y + 7.1)!;
    expect(roof.y).toBeCloseTo(g.y + 7);
    expect(roof.surface).toBe('stone');
    expect(roof.normal.toArray()).toEqual([0, 1, 0]);
    const sp = t.spires[0].def;
    const top = t.groundAt(sp.x, sp.z, sp.topY + 1)!;
    expect(top.y).toBe(sp.topY);
    expect(top.islandId).toBe(-1 - sp.id);
  });
});
