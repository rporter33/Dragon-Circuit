import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { LAYOUT } from '../layout';
import { Terrain } from '../terrain';
import { QUALITY } from '../../render/quality';
import { Dressing } from './Dressing';
import { roostPlan } from './structures/roostPlan';
import { signedDistance } from '../colliders';

// Building the whole system takes a second or two; give heavy tests room on a busy machine.
const SLOW = 30000;
const terrain = new Terrain(LAYOUT);
const scene = new Scene();
const dressing = new Dressing({ scene, terrain, quality: QUALITY.high, asyncStreaming: false });

describe('Dressing system', () => {
  it('exposes well-formed colliders for buildings and big trunks', () => {
    expect(dressing.colliders.length).toBeGreaterThan(50);
    for (const c of dressing.colliders) {
      if (c.kind === 'box') expect(Math.min(c.hx, c.hy, c.hz)).toBeGreaterThan(0);
      else if (c.kind === 'sphere') expect(c.radius).toBeGreaterThan(0);
      else {
        expect(c.radius).toBeGreaterThan(0);
        expect(c.y1).toBeGreaterThan(c.y0);
      }
      expect(Number.isFinite(c.x) && Number.isFinite(c.z)).toBe(true);
    }
    // The stable walls are solid; its open front is not.
    const st = LAYOUT.stable;
    const gy = terrain.groundAt(st.x, st.z, 1e6)!.y;
    const solidAt = (x: number, y: number, z: number) => dressing.colliders.some((c) => !c.soft && signedDistance(c, new Vector3(x, y, z), null) < 0);
    expect(solidAt(st.x - 12, gy + 3, st.z - 10)).toBe(true);
    expect(solidAt(st.x, gy + 2, st.z - 1)).toBe(false);
    expect(solidAt(st.x, gy + 2, st.z - 10)).toBe(false);
    const sp = LAYOUT.spawn.position;
    const ws = LAYOUT.wyvernSpawn.position;
    expect(solidAt(sp[0], terrain.groundAt(sp[0], sp[2], 1e6)!.y + 1, sp[2])).toBe(false);
    expect(solidAt(ws[0], terrain.groundAt(ws[0], ws[2], 1e6)!.y + 2, ws[2])).toBe(false);
  });

  it('roofs are walkable, the launch deck and its gates leave room for the biggest wyvern', () => {
    const t = new Terrain(LAYOUT);
    t.colliders.addAll(dressing.colliders);
    const plan = roostPlan(LAYOUT, terrain)!;
    // The stable roof: standing on the ridge from above, within half a meter of the shingles.
    const st = plan.stable;
    const mid = { x: st.x - Math.sin(st.yaw) * (st.depth / 2), z: st.z - Math.cos(st.yaw) * (st.depth / 2) };
    const ridge = t.groundAt(mid.x, mid.z, 1e6)!;
    expect(ridge.y - plan.ground).toBeGreaterThan(12.5);
    expect(ridge.y - plan.ground).toBeLessThan(13.6);
    // Every tower's gallery floor, between the drum and the rail.
    for (const tw of plan.towers) {
      const gy = tw.y + 0.7 + tw.height * 0.72;
      const r = tw.radius * 1.15;
      const g = t.groundAt(tw.x + r, tw.z, gy + 0.5)!;
      expect(Math.abs(g.y - (gy + 0.25))).toBeLessThan(0.05);
    }
    // Along the deck's centerline, nothing solid between 0.3 m and 6.6 m above the planks.
    const d = plan.deck;
    for (let s = -1; s <= d.length; s += 0.5) {
      const x = d.x + d.dirX * s;
      const z = d.z + d.dirZ * s;
      for (let h = 0.3; h <= 6.2; h += 0.4) {
        const solid = dressing.colliders.some((c) => !c.soft && signedDistance(c, new Vector3(x, d.y + h, z), null) < 0.4);
        expect(solid, `blocked at ${s.toFixed(1)} m along the deck, ${h.toFixed(1)} m up`).toBe(false);
      }
    }
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

  it("builds the shipwright's dock: walkable past the rim, clear overhead for the Codex, away from the deck and stable", () => {
    const plan = roostPlan(LAYOUT, terrain)!;
    const d = plan.dock;
    const tip = new Vector3(d.x + d.dirX * (d.length - 2), 0, d.z + d.dirZ * (d.length - 2));
    expect(terrain.groundAt(tip.x, tip.z, 1e6)).toBeNull();
    const hit = dressing.deckAt(tip.x, tip.z, d.y + 1)!;
    expect(hit?.surface).toBe('wood');
    expect(hit.y).toBeCloseTo(d.y);
    // A hull 30-odd metres long sits on the centreline: nothing solid in a 14 m wide, 20 m tall box.
    const p = new Vector3();
    for (let s = 1; s <= d.length - 2; s += 2) {
      for (const across of [-7, -3.5, 0, 3.5, 7]) {
        for (const h of [0.5, 4, 10, 18]) {
          p.set(d.x + d.dirX * s + d.dirZ * across, d.y + h, d.z + d.dirZ * s - d.dirX * across);
          const solid = dressing.colliders.find((c) => !c.soft && signedDistance(c, p, null) < 0);
          expect(solid, `dock blocked at ${s} m along, ${across} m across, ${h} m up`).toBeUndefined();
        }
      }
    }
    // Well away from the launch deck's line and the stable.
    const deckTip = new Vector3(plan.deck.x + plan.deck.dirX * plan.deck.length, 0, plan.deck.z + plan.deck.dirZ * plan.deck.length);
    expect(Math.hypot(d.x - deckTip.x, d.z - deckTip.z)).toBeGreaterThan(80);
    expect(Math.hypot(d.x - plan.stable.x, d.z - plan.stable.z)).toBeGreaterThan(60);
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
  }, SLOW);

  it('buckets the forest into LODs without exceeding the draw budget', () => {
    const cam = new PerspectiveCamera(60, 16 / 9, 0.5, 7000);
    cam.position.set(340, 660, 820);
    cam.lookAt(340, 620, 1000);
    cam.updateMatrixWorld();
    dressing.update(1 / 30, cam, cam.position);
    const f = dressing.forest.stats;
    expect(f.byLod.reduce((a, n) => a + n, 0)).toBeGreaterThan(500);
    expect(f.drawCalls).toBeLessThanOrEqual(40);
  }, SLOW);

  it('rebuilds cleanly on a quality change', () => {
    dressing.setQuality(QUALITY.low);
    expect(dressing.forest.stats.instances).toBeGreaterThan(1000);
    dressing.setQuality(QUALITY.high);
  }, SLOW);
});
