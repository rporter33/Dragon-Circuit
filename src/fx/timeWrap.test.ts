import { describe, expect, it } from 'vitest';
import { Scene, Vector3, type InstancedBufferAttribute, type ShaderMaterial } from 'three';
import { BurstParticles, blankSpec } from './particles';
import { ShockRings } from './rings';
import { WingTrails } from './trails';

// Effect clocks wrap like the shared shader time (TIME-01): birth times must move with the clock
// so live effects keep their age exactly (4096 is a power of two: the float32 shift is exact).
const W = 4096;

describe('fx clocks wrap without disturbing live effects', () => {
  it('BurstParticles keeps every particle age', () => {
    const p = new BurstParticles(new Scene(), 32, { additive: false, name: 't' });
    for (let i = 0; i < 4100 * 4; i++) p.update(0.25, 600);
    p.emit({ ...blankSpec(), life: 3 });
    p.update(0.5, 600);
    const T = (p.mesh.geometry.getAttribute('aTime') as InstancedBufferAttribute).array as Float32Array;
    const uNow = () => (p.mesh.material as ShaderMaterial).uniforms.uNow.value as number;
    const ageBefore = uNow() - T[0];
    const unusedBefore = uNow() - T[4];
    p.wrapTime(W);
    expect(uNow()).toBeCloseTo(4100 + 0.5 - W, 6);
    expect(uNow() - T[0]).toBe(ageBefore);
    // Never-emitted slots stay long dead.
    expect(uNow() - T[4]).toBe(unusedBefore);
  });

  it('ShockRings keeps every ring age', () => {
    const r = new ShockRings(new Scene(), 4);
    for (let i = 0; i < 5000; i++) r.update(1);
    r.spawn(0, 0, 0, 0, 1, 0, 1, 5, 2, 1, 1, 1, 1);
    r.update(0.75);
    const P = (r.mesh.geometry.getAttribute('aParams') as InstancedBufferAttribute).array as Float32Array;
    const age = r.now - P[0];
    r.wrapTime(W);
    expect(r.now).toBeCloseTo(5000.75 - W, 6);
    expect(r.now - P[0]).toBeCloseTo(age, 9);
  });

  it('WingTrails keeps sample ages', () => {
    const t = new WingTrails(new Scene(), 8);
    const L = new Vector3();
    const R = new Vector3(4, 0, 0);
    for (let i = 0; i < 4200; i++) {
      L.z = R.z = i * 2;
      t.update(1, L, R, 1);
    }
    const birth = (t as unknown as { left: { birth: Float32Array } }).left.birth;
    const now = () => (t as unknown as { now: number }).now;
    const ages = Array.from(birth.slice(0, 3), (b) => now() - b);
    t.wrapTime(W);
    expect(now()).toBe(4200 - W);
    expect(Array.from(birth.slice(0, 3), (b) => now() - b)).toEqual(ages);
  });
});
