import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { LAYOUT } from '../layout';
import { Terrain } from '../terrain';
import { QUALITY } from '../../render/quality';
import { Dressing } from './Dressing';
import { roostPlan } from './structures/roostPlan';

const terrain = new Terrain(LAYOUT);
const scene = new Scene();
const dressing = new Dressing({ scene, terrain, quality: QUALITY.high, asyncStreaming: false });

describe('Dressing system', () => {
  it('exposes well-formed colliders for buildings and big trunks', () => {
    expect(dressing.colliders.length).toBeGreaterThan(50);
    for (const c of dressing.colliders) {
      expect(c.radius).toBeGreaterThan(0);
      expect(c.y1).toBeGreaterThan(c.y0);
      expect(Number.isFinite(c.x) && Number.isFinite(c.z)).toBe(true);
    }
    // The stable walls are solid; its open front is not.
    const st = LAYOUT.stable;
    const near = (x: number, z: number) => dressing.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.radius);
    expect(near(st.x - 12, st.z - 10)).toBe(true);
    expect(near(st.x, st.z - 1)).toBe(false);
    expect(near(LAYOUT.spawn.position[0], LAYOUT.spawn.position[2])).toBe(false);
    expect(near(LAYOUT.wyvernSpawn.position[0], LAYOUT.wyvernSpawn.position[2])).toBe(false);
  });

  it('lets walkers stand on the launch deck past the rim', () => {
    const d = roostPlan(LAYOUT, terrain)!.deck;
    const tip = new Vector3(d.x + d.dirX * (d.length - 2), 0, d.z + d.dirZ * (d.length - 2));
    expect(terrain.groundAt(tip.x, tip.z, 1e6)).toBeNull();
    const hit = dressing.deckAt(tip.x, tip.z, d.y + 1)!;
    expect(hit).not.toBeNull();
    expect(hit.surface).toBe('wood');
    expect(hit.y).toBeCloseTo(d.y);
    expect(dressing.deckAt(tip.x, tip.z, d.y - 5)).toBeNull(); // from below you don't stand on it
    expect(dressing.deckAt(0, 2400, 1e6)).toBeNull();
  });

  it('streams grass around the camera and drops it when the camera leaves', () => {
    const cam = new PerspectiveCamera(60, 16 / 9, 0.5, 7000);
    cam.position.set(60, 242, 60);
    cam.lookAt(100, 240, 100);
    cam.updateMatrixWorld();
    for (let i = 0; i < 4; i++) dressing.update(1 / 30, cam, new Vector3(60, 243, 60));
    expect(dressing.grass.stats.chunks).toBeGreaterThan(10);
    expect(dressing.grass.stats.tufts).toBeGreaterThan(10000);
    cam.position.set(0, 2000, 2800);
    dressing.update(1 / 30, cam, cam.position);
    expect(dressing.grass.stats.chunks).toBe(0);
  });

  it('buckets the forest into LODs without exceeding the draw budget', () => {
    const cam = new PerspectiveCamera(60, 16 / 9, 0.5, 7000);
    cam.position.set(340, 660, 820);
    cam.lookAt(340, 620, 1000);
    cam.updateMatrixWorld();
    dressing.update(1 / 30, cam, cam.position);
    const f = dressing.forest.stats;
    expect(f.byLod[0] + f.byLod[1] + f.byLod[2]).toBeGreaterThan(500);
    expect(f.drawCalls).toBeLessThanOrEqual(33);
  });

  it('rebuilds cleanly on a quality change', () => {
    dressing.setQuality(QUALITY.low);
    expect(dressing.forest.stats.instances).toBeGreaterThan(1000);
    dressing.setQuality(QUALITY.high);
  });
});
