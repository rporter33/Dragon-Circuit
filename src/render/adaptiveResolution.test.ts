import { describe, expect, it } from 'vitest';
import { AdaptiveResolution } from './adaptiveResolution';

function run(a: AdaptiveResolution, dt: number, seconds: number): number[] {
  const changes: number[] = [];
  for (let t = 0; t < seconds; t += dt) {
    const s = a.sample(dt);
    if (s !== null) changes.push(s);
  }
  return changes;
}

describe('AdaptiveResolution', () => {
  it('holds full resolution at a steady 60 fps', () => {
    const a = new AdaptiveResolution();
    expect(run(a, 1 / 60, 30)).toEqual([]);
    expect(a.scale).toBe(1);
  });

  it('steps down while frames stay slow, but not below the floor', () => {
    const a = new AdaptiveResolution();
    const changes = run(a, 1 / 30, 60);
    expect(changes[0]).toBe(0.9);
    expect(a.scale).toBe(0.6);
    expect(Math.min(...changes)).toBeGreaterThanOrEqual(0.6);
  });

  it('ignores isolated hitches', () => {
    const a = new AdaptiveResolution();
    for (let i = 0; i < 600; i++) a.sample(i % 120 === 0 ? 0.5 : 1 / 60);
    expect(a.scale).toBe(1);
  });

  it('climbs back with headroom, but not straight into a level that was just too slow', () => {
    const a = new AdaptiveResolution();
    run(a, 1 / 30, 3); // one step down: 1 → 0.9 (1 is now off limits for a while)
    expect(a.scale).toBe(0.9);
    run(a, 1 / 70, 20);
    expect(a.scale).toBe(0.9);
    run(a, 1 / 70, 30); // the memory expires, and it tries full resolution again
    expect(a.scale).toBe(1);
  });

  it('startup shader hitches (unclamped frame times) do not lower the resolution (ADAPT-01)', () => {
    const a = new AdaptiveResolution();
    const changes: number[] = [];
    // 25 frames that really took 0.4-1.6 s each (program links): the game now passes the raw time.
    for (let i = 0; i < 25; i++) {
      const s = a.sample(0.4 + i * 0.05);
      if (s !== null) changes.push(s);
    }
    changes.push(...run(a, 1 / 60, 20));
    expect(changes).toEqual([]);
    expect(a.scale).toBe(1);
  });
});

