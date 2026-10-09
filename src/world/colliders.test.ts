import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { BoxCollider, Collider, ContactInfo } from '../core/types';
import { ColliderIndex, deckCollider, signedDistance } from './colliders';
import { Terrain, STRUCTURE_GROUND_ID } from './terrain';
import { LAYOUT } from './layout';

const n = new Vector3();

describe('collider shapes', () => {
  it('measures signed distance to a cylinder from the side, the top and inside', () => {
    const c: Collider = { x: 0, z: 0, radius: 2, y0: 0, y1: 10 };
    expect(signedDistance(c, new Vector3(5, 5, 0), n)).toBeCloseTo(3);
    expect(n.x).toBeCloseTo(1);
    expect(signedDistance(c, new Vector3(0, 13, 0), n)).toBeCloseTo(3);
    expect(n.y).toBeCloseTo(1);
    expect(signedDistance(c, new Vector3(1.5, 5, 0), n)).toBeCloseTo(-0.5);
    expect(n.x).toBeCloseTo(1);
  });

  it('handles a box turned about Y', () => {
    // A 10 m long (local z), 2 m wide box turned 90°: it now runs along world x.
    const b: BoxCollider = { kind: 'box', x: 0, y: 0, z: 0, hx: 1, hy: 1, hz: 5, yaw: Math.PI / 2 };
    expect(signedDistance(b, new Vector3(4, 0, 0), n)).toBeLessThan(0);
    expect(signedDistance(b, new Vector3(0, 0, 4), n)).toBeCloseTo(3);
    expect(n.z).toBeCloseTo(1);
  });
});

describe('ColliderIndex', () => {
  it('pushes a sphere out of a wall and reports a solid contact', () => {
    const idx = new ColliderIndex();
    idx.add({ x: 0, z: 0, radius: 1, y0: 0, y1: 5, surface: 'wood' });
    const p = new Vector3(2, 2, 0);
    const out = new Vector3();
    const info: ContactInfo = { soft: true };
    expect(idx.resolveSphere(p, 1.5, out, info)).toBe(true);
    expect(p.x).toBeCloseTo(2.5);
    expect(info.soft).toBe(false);
  });

  it('only cushions soft foliage', () => {
    const idx = new ColliderIndex();
    idx.add({ kind: 'sphere', x: 0, y: 10, z: 0, radius: 4, soft: true });
    const p = new Vector3(4, 10, 0);
    const info: ContactInfo = { soft: false };
    expect(idx.resolveSphere(p, 2, new Vector3(), info)).toBe(true);
    expect(info.soft).toBe(true);
    // Pushed out only part of the way (2 m deep → 0.7 m).
    expect(p.x).toBeCloseTo(4.7);
  });

  it('lets you stand on a deck but not jump onto a wall top', () => {
    const idx = new ColliderIndex();
    idx.add(deckCollider({ x: 0, z: 0, yaw: 0, halfWidth: 2, back: 1, length: 18, y: 100, surface: 'wood' }));
    idx.add({ x: 30, z: 0, radius: 1, y0: 99, y1: 104 });
    expect(idx.groundAt(0, 15, 100.2, 0.6)?.y).toBeCloseTo(100);
    expect(idx.groundAt(0, 19, 100.2, 0.6)).toBeNull();
    expect(idx.groundAt(30, 0, 100, 0.6)).toBeNull();
  });

  it('follows sources that grow and rebuilds when one is replaced', () => {
    const idx = new ColliderIndex();
    let list: Collider[] = [{ x: 0, z: 0, radius: 1, y0: 0, y1: 1 }];
    idx.addSource('trees', () => list);
    expect(idx.size).toBe(1);
    list.push({ x: 5, z: 0, radius: 1, y0: 0, y1: 1 });
    idx.sync();
    expect(idx.size).toBe(2);
    list = [{ x: 9, z: 9, radius: 1, y0: 0, y1: 1 }];
    idx.sync();
    expect(idx.size).toBe(1);
    expect(idx.distance(new Vector3(0, 0.5, 0), 20)).toBeGreaterThan(5);
  });
});

describe('Terrain with structures', () => {
  it('folds colliders into collideSphere, groundAt, distance and raycast', () => {
    const t = new Terrain(LAYOUT);
    const g = t.groundAt(0, 0, 1e6)!;
    t.colliders.add({ kind: 'box', x: 0, y: g.y + 6, z: 0, hx: 4, hy: 1, hz: 4, yaw: 0, surface: 'wood' });
    // Standing on the roof.
    const roof = t.groundAt(0, 0, g.y + 7.1)!;
    expect(roof.islandId).toBe(STRUCTURE_GROUND_ID);
    expect(roof.y).toBeCloseTo(g.y + 7);
    // Under the roof, the island is still the ground.
    expect(t.groundAt(0, 0, g.y + 1)!.islandId).not.toBe(STRUCTURE_GROUND_ID);
    // A flying sphere hits it, the camera's ray stops on it.
    const push = new Vector3();
    expect(t.collideSphere(new Vector3(0, g.y + 7.5, 0), 2, push, new Vector3())).toBe(true);
    expect(push.y).toBeGreaterThan(1);
    expect(t.distance(new Vector3(0, g.y + 10, 0))).toBeCloseTo(3, 0);
    const hit = t.raycast(new Vector3(0, g.y + 30, 0), new Vector3(0, -1, 0), 60)!;
    expect(hit.point.y).toBeGreaterThan(g.y + 6.5);
  });
});

describe('sphere tracing past distant structures', () => {
  it('stops at a wall 40 m away in open sky instead of stepping through it', () => {
    const t = new Terrain(LAYOUT);
    // High over the Roost: the nearest rock is hundreds of meters away.
    const origin = new Vector3(0, 900, 0);
    expect(t.distance(origin)).toBeGreaterThan(100);
    // A thin wall (1 m thick) 40 m east.
    t.colliders.add({ kind: 'box', x: 40, y: 900, z: 0, hx: 0.5, hy: 10, hz: 10, yaw: 0 });
    const hit = t.raycast(origin, new Vector3(1, 0, 0), 200)!;
    expect(hit).not.toBeNull();
    expect(hit.distance).toBeGreaterThan(38.5);
    expect(hit.distance).toBeLessThan(40);
  });
});

describe('cost', () => {
  it('stays cheap with thousands of colliders (only nearby shapes are tested)', () => {
    const t = new Terrain(LAYOUT);
    // A forest's worth of trunks + canopies + buildings scattered over the islands.
    let k = 0;
    for (const isl of t.islands) {
      for (let i = 0; i < 160; i++, k++) {
        const a = (i * 2.399) % (Math.PI * 2);
        const r = isl.def.radius * 0.85 * Math.sqrt((i + 0.5) / 160);
        const x = isl.def.x + Math.cos(a) * r;
        const z = isl.def.z + Math.sin(a) * r;
        const y = isl.topHeight(x, z);
        t.colliders.add({ x, z, radius: 0.6, y0: y - 1, y1: y + 9 });
        t.colliders.add({ kind: 'sphere', x, y: y + 11, z, radius: 4, soft: true });
      }
    }
    expect(t.colliders.size).toBeGreaterThan(10000);
    const g = t.groundAt(0, 0, 1e6)!;
    const p = new Vector3();
    const push = new Vector3();
    const nn = new Vector3();
    const N = 20000;
    let t0 = performance.now();
    for (let i = 0; i < N; i++) {
      p.set(Math.sin(i) * 120, g.y + 6 + (i % 7), Math.cos(i * 1.3) * 120);
      t.collideSphere(p, 2.4, push, nn);
    }
    const perCollide = ((performance.now() - t0) * 1000) / N;
    t0 = performance.now();
    const M = 300;
    for (let i = 0; i < M; i++) {
      p.set(Math.sin(i) * 80, g.y + 15, Math.cos(i) * 80);
      t.raycast(p, nn.set(0.3, -0.5, 0.8).normalize(), 40);
    }
    const perRay = ((performance.now() - t0) * 1000) / M;
    console.log(`[colliders] ${t.colliders.size} colliders: collideSphere ${perCollide.toFixed(1)} µs, camera raycast ${perRay.toFixed(1)} µs`);
    // Budget: a frame makes ~8 sphere queries (120 Hz body + wingtips) and 1–2 camera rays.
    expect(perCollide).toBeLessThan(400); // generous: shared CI/dev machines are noisy
    expect(perRay).toBeLessThan(6000);
  });
});
