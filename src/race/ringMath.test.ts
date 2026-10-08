import { describe, expect, it } from 'vitest';
import { ringGeom, sweepRing, type RingGeom } from './ringMath';

// A ring at the origin facing +Z with a 10 m hole.
const R: RingGeom = ringGeom({ position: [0, 0, 0], normal: [0, 0, 1], radius: 10 });

describe('swept ring crossing', () => {
  it('passes straight through the middle with the exact crossing fraction', () => {
    const c = sweepRing(0, 0, -1, 0, 0, 3, R);
    expect(c?.kind).toBe('pass');
    expect(c?.t).toBeCloseTo(0.25, 9);
    expect(c?.dist).toBe(0);
  });

  it('counts a fast crossing that starts and ends far from the plane (no tunnelling)', () => {
    // 200 m in one step: a 24000 m/s body would still be caught.
    const c = sweepRing(3, -4, -100, 3, -4, 100, R);
    expect(c?.kind).toBe('pass');
    expect(c?.t).toBeCloseTo(0.5, 9);
    expect(c?.dist).toBeCloseTo(5, 9);
  });

  it('a diagonal crossing is measured where it meets the plane, not at either end', () => {
    // Starts outside the hole, crosses the plane inside it.
    const c = sweepRing(-30, 0, -10, 10, 0, 10, R);
    expect(c?.kind).toBe('pass');
    expect(c?.dist).toBeCloseTo(10, 6);
    // ...and the other way: both ends inside the radius sideways, but the plane is crossed outside.
    const m = sweepRing(8, 8, -1, 8, 8, 1, R);
    expect(m?.kind).toBe('miss');
  });

  it('grazing: exactly on the rim passes, a hair outside misses', () => {
    expect(sweepRing(10, 0, -1, 10, 0, 1, R)?.kind).toBe('pass');
    expect(sweepRing(10.001, 0, -1, 10.001, 0, 1, R)?.kind).toBe('miss');
  });

  it('a segment sliding along the plane never crosses it', () => {
    expect(sweepRing(-5, 0, 0, 5, 0, 0, R)).toBeNull();
    expect(sweepRing(-5, 0, 0.5, 5, 0, 0.5, R)).toBeNull();
  });

  it('counts a point resting on the plane exactly once', () => {
    // Step 1 arrives exactly on the plane, step 2 leaves it.
    expect(sweepRing(0, 0, -1, 0, 0, 0, R)?.kind).toBe('pass');
    expect(sweepRing(0, 0, 0, 0, 0, 1, R)).toBeNull();
  });

  it('ignores the wrong direction', () => {
    expect(sweepRing(0, 0, 1, 0, 0, -1, R)).toBeNull();
    expect(sweepRing(0, 0, 5, 0, 0, 2, R)).toBeNull();
  });

  it('crossings beyond the miss radius are not about this ring', () => {
    expect(sweepRing(30, 0, -1, 30, 0, 1, R, 50)?.kind).toBe('miss');
    expect(sweepRing(60, 0, -1, 60, 0, 1, R, 50)).toBeNull();
  });

  it('works for tilted rings (normals are normalized)', () => {
    const tilted = ringGeom({ position: [100, 50, 0], normal: [3, 4, 0], radius: 8 });
    // Fly along the normal through the center.
    const c = sweepRing(100 - 3, 50 - 4, 0, 100 + 3, 50 + 4, 0, tilted);
    expect(c?.kind).toBe('pass');
    expect(c?.t).toBeCloseTo(0.5, 9);
    // Fly along +x only: still crosses forward (normal has +x), 0 offset at the plane.
    expect(sweepRing(90, 50, 0, 110, 50, 0, tilted)?.kind).toBe('pass');
    // Backwards along the normal: ignored.
    expect(sweepRing(103, 54, 0, 97, 46, 0, tilted)).toBeNull();
  });
});
