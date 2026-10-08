import { describe, expect, it } from 'vitest';
import { LAYOUT } from '../../layout';
import { Terrain } from '../../terrain';
import { roostPlan } from './roostPlan';

const terrain = new Terrain(LAYOUT);
const plan = roostPlan(LAYOUT, terrain)!;
const roost = terrain.islands.find((s) => s.def.kind === 'roost')!;

describe('the Roost site plan', () => {
  it('keeps the spawn points and the stable door clear', () => {
    const things = [
      ...plan.towers.map((t) => ({ x: t.x, z: t.z, r: t.radius + 1 })),
      ...plan.banners.map((b) => ({ x: b.x, z: b.z, r: 0.5 })),
      ...plan.lanterns.map((l) => ({ x: l.x, z: l.z, r: 0.5 })),
      ...plan.paddock.map((p) => ({ x: p.x, z: p.z, r: 0.5 })),
      { x: plan.well.x, z: plan.well.z, r: 1.9 },
      { x: plan.trough.x, z: plan.trough.z, r: 1.8 },
    ];
    for (const c of plan.clear) {
      for (const t of things) expect(Math.hypot(t.x - c.x, t.z - c.z), `${t.x},${t.z}`).toBeGreaterThan(c.r + t.r);
    }
    // The stable's footprint (behind the door) holds neither spawn.
    const st = LAYOUT.stable;
    for (const sp of [LAYOUT.spawn.position, LAYOUT.wyvernSpawn.position]) {
      const lz = (sp[0] - st.x) * Math.sin(st.yaw) + (sp[2] - st.z) * Math.cos(st.yaw);
      expect(lz).toBeGreaterThan(2);
    }
  });

  it('stands everything on the Roost', () => {
    for (const t of plan.towers) expect(roost.normRadius(t.x, t.z)).toBeLessThan(0.8);
    for (const l of plan.lanterns) expect(roost.normRadius(l.x, l.z)).toBeLessThan(0.97);
    for (const p of plan.path) expect(roost.normRadius(p.x, p.z)).toBeLessThan(1);
  });

  it('roots the launch deck on land and juts it out over the void', () => {
    const d = plan.deck;
    expect(roost.normRadius(d.x, d.z)).toBeLessThan(1);
    const tipX = d.x + d.dirX * d.length;
    const tipZ = d.z + d.dirZ * d.length;
    expect(roost.normRadius(tipX, tipZ)).toBeGreaterThan(1.05);
    expect(terrain.groundAt(tipX, tipZ, 1e6)).toBeNull();
    // Level with the ground at its root, a step up.
    expect(d.y - roost.topHeight(d.x, d.z)).toBeGreaterThan(0.2);
    expect(d.y - roost.topHeight(d.x, d.z)).toBeLessThan(3);
  });
});
