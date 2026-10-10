import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { SailCloth } from './SailCloth';
const make = () => new SailCloth('test', (u, v) => new Vector3(u * 12, 10 - Math.sin(u * Math.PI) * Math.sin(v * Math.PI), v * 8), false, false, 13, 9);
const run = (sail: SailCloth, wind: Vector3, seconds = 2, fps = 60) => {
  for (let i = 0; i < seconds * fps; i++) sail.update(1 / fps, wind);
};
describe('Windhaven sail physics', () => {
  it('responds differently to calm and gusts while keeping all spar anchors fixed', () => {
    const calm = make(), gust = make();
    run(calm, new Vector3()); run(gust, new Vector3(8, 6, -12));
    let difference = 0;
    for (let i = 0; i < gust.pinned.length; i++) for (let k = 0; k < 3; k++) {
      const j = i * 3 + k;
      if (gust.pinned[i]) expect(gust.solver.pos[j]).toBe(gust.rest[j]);
      difference = Math.max(difference, Math.abs(gust.solver.pos[j] - calm.solver.pos[j]));
    }
    expect(difference).toBeGreaterThan(0.05);
    const rendered = gust.mesh.geometry.getAttribute('position');
    for (let i = 0; i < gust.pinned.length; i++) expect(rendered.getY(i)).toBeCloseTo(gust.solver.pos[i * 3 + 1], 5);
  });
  it('uses fixed substeps independent of frame partition and stays still when paused', () => {
    const a = make(), b = make(), wind = new Vector3(4, 3, 10);
    run(a, wind, 2, 30); run(b, wind, 2, 120);
    a.solver.pos.forEach((v, i) => expect(v).toBeCloseTo(b.solver.pos[i], 8));
    const before = Array.from(a.solver.pos);
    a.update(0, wind);
    expect(Array.from(a.solver.pos)).toEqual(before);
  });
  it('survives extreme winds and frame stalls without escaping its travel envelope', () => {
    const sail = make();
    for (let i = 0; i < 100; i++) sail.update(i === 20 ? 5 : 1 / 30, new Vector3(100, -100, 100));
    for (let j = 0; j < sail.rest.length; j += 3) {
      const p = sail.solver.pos, r = sail.rest;
      expect(Math.hypot(p[j] - r[j], p[j + 1] - r[j + 1], p[j + 2] - r[j + 2])).toBeLessThanOrEqual(1.2000001);
    }
  });
});
