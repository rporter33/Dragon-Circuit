import { describe, expect, it } from 'vitest';
import { Scene, Vector3 } from 'three';
import { Drifters } from './drifters';

const forest = {
  islandAt: () => ({ def: { kind: 'forest' as const, trees: 1, grass: 1 }, topHeight: () => 100 }),
};

describe('leaf bursts (foliageBrush)', () => {
  it('shakes leaves loose at the brush point, within capacity', () => {
    const d = new Drifters(new Scene(), forest, 40);
    d.setDensity(1.4);
    expect(d.burst(0, 120, 0, 30, 0, 0, 12)).toBe(12);
    expect(d.count).toBe(12);
    // Capacity caps a burst; it never throws or overruns.
    expect(d.burst(0, 120, 0, 30, 0, 0, 100)).toBe(28);
    expect(d.count).toBe(40);
  });

  it('they flutter down and settle on the ground below, then go', () => {
    const d = new Drifters(new Scene(), forest, 40);
    d.setDensity(0); // no ambient drifters: only the burst
    d.burst(0, 120, 0, 0, 0, 0, 10);
    const cam = new Vector3(0, 110, 0);
    const fwd = new Vector3(0, 0, 1);
    const wind = new Vector3(1, 0, 0);
    for (let i = 0; i < 60 * 30 && d.count > 0; i++) d.update(1 / 60, cam, fwd, wind, 0.3, new Vector3(0, 500, 0), new Vector3(), true);
    expect(d.count).toBe(0);
  });
});
