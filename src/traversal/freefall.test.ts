import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { fallSpeed, freefallDrag } from './freefall';
import { integrate } from './tether';
const dt = 1 / 120;
describe('independent rider slow fall', () => {
  it.each([[-1, 9], [0, 13], [1, 18]])('tilt %s approaches %s m/s without overshooting from rest', (tilt, limit) => {
    const position = new Vector3(), velocity = new Vector3();
    expect(fallSpeed(tilt)).toBe(limit);
    for (let i = 0; i < 1200; i++) {
      integrate(position, velocity, dt, null, undefined, .01, undefined, fallSpeed(tilt));
      expect(-velocity.y).toBeLessThanOrEqual(limit + 1e-10);
    }
    expect(-velocity.y).toBeCloseTo(limit, 5);
  });
  it('brakes excess inherited downward speed progressively instead of snapping release velocity', () => {
    const position = new Vector3(), velocity = new Vector3(24, -60, 0);
    integrate(position, velocity, dt, null, undefined, .01, undefined, 7);
    expect(velocity.y).toBeLessThan(-50); expect(velocity.y).toBeGreaterThan(-60);
    expect(velocity.x).toBeGreaterThan(23.9);
    for (let i = 0; i < 600; i++) integrate(position, velocity, dt, null, undefined, .01, undefined, 7);
    expect(-velocity.y).toBeCloseTo(7, 5);
  });
  it('vertical braking does not consume horizontal momentum and drag cannot add kinetic energy', () => {
    const fast = new Vector3(20, -60, 10), slow = new Vector3(20, -5, 10), initialEnergy = fast.lengthSq();
    freefallDrag(fast, dt, .01, 7); freefallDrag(slow, dt, .01, 7);
    expect(fast.x).toBe(slow.x); expect(fast.z).toBe(slow.z); expect(fast.lengthSq()).toBeLessThan(initialEnergy);
    expect(fast.x).toBeGreaterThan(19.9);
  });
  it('terminal limits never alter an attached swing', () => {
    const rope = { anchor: new Vector3(0, 10, 0), length: 10 };
    const a = new Vector3(), b = new Vector3(), va = new Vector3(24, 0, 0), vb = va.clone();
    for (let i = 0; i < 1200; i++) {
      integrate(a, va, dt, rope); integrate(b, vb, dt, rope, undefined, 0, undefined, 7);
    }
    expect(a.toArray()).toEqual(b.toArray()); expect(va.toArray()).toEqual(vb.toArray());
  });
});
