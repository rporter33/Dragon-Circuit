import { describe, expect, it } from 'vitest';
import { ExclusionSet, exclusionDistance } from './exclusions';

describe('exclusion zones', () => {
  it('measures signed distance to circles and capsules', () => {
    expect(exclusionDistance({ kind: 'circle', x: 0, z: 0, r: 5, grassOk: false }, 8, 0)).toBeCloseTo(3);
    expect(exclusionDistance({ kind: 'circle', x: 0, z: 0, r: 5, grassOk: false }, 1, 0)).toBeCloseTo(-4);
    const cap = { kind: 'capsule' as const, ax: 0, az: 0, bx: 10, bz: 0, r: 2, grassOk: false };
    expect(exclusionDistance(cap, 5, 3)).toBeCloseTo(1);
    expect(exclusionDistance(cap, -3, 0)).toBeCloseTo(1);
    expect(exclusionDistance(cap, 12, 0)).toBeCloseTo(0);
  });

  it('answers blocked() across grid cells and honors grassOk', () => {
    const ex = new ExclusionSet();
    ex.circle(100, 100, 10, true);
    ex.capsule(-50, 0, 50, 0, 3);
    expect(ex.blocked(105, 100)).toBe(true);
    expect(ex.blocked(105, 100, 0, true)).toBe(false); // grass may grow there
    expect(ex.blocked(30, 1)).toBe(true);
    expect(ex.blocked(30, 6)).toBe(false);
    expect(ex.blocked(30, 6, 4)).toBe(true); // padding
    expect(ex.distance(1000, 1000)).toBe(Infinity);
  });

  it('prefilters zones touching a box', () => {
    const ex = new ExclusionSet();
    ex.circle(0, 0, 5);
    ex.circle(200, 200, 5);
    expect(ex.inBox(-10, -10, 10, 10).length).toBe(1);
    expect(ex.inBox(300, 300, 310, 310).length).toBe(0);
  });
});
