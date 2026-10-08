import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { boneBasis, createTwoBoneResult, solveTwoBone } from './ik';

describe('two-bone IK', () => {
  it('reaches a target within range with the right bone lengths', () => {
    const r = createTwoBoneResult();
    const root = new Vector3(0, 1, 0);
    const target = new Vector3(0.2, 0.3, 0.25);
    solveTwoBone(root, target, new Vector3(0, 0, 1), 0.42, 0.41, r);
    const end = r.mid.clone().addScaledVector(r.dir2, 0.41);
    expect(end.distanceTo(target)).toBeLessThan(1e-6);
    expect(r.mid.distanceTo(root)).toBeCloseTo(0.42, 6);
  });

  it('bends the knee toward the pole', () => {
    const r = createTwoBoneResult();
    solveTwoBone(new Vector3(0, 1, 0), new Vector3(0, 0.4, 0), new Vector3(0, 0, 1), 0.42, 0.41, r);
    expect(r.mid.z).toBeGreaterThan(0.1);
    solveTwoBone(new Vector3(0, 1, 0), new Vector3(0, 0.4, 0), new Vector3(0, 0, -1), 0.42, 0.41, r);
    expect(r.mid.z).toBeLessThan(-0.1);
  });

  it('straightens toward unreachable targets without NaN', () => {
    const r = createTwoBoneResult();
    solveTwoBone(new Vector3(0, 1, 0), new Vector3(0, -5, 0), new Vector3(0, 0, 1), 0.42, 0.41, r);
    expect(r.reach).toBe(1);
    expect(r.dir1.y).toBeLessThan(-0.999);
    expect(r.dir2.y).toBeLessThan(-0.999);
    // Degenerate: target on the root, pole along the limb.
    solveTwoBone(new Vector3(), new Vector3(), new Vector3(0, -1, 0), 0.3, 0.3, r);
    for (const v of [r.dir1, r.dir2, r.hinge, r.mid]) expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
  });

  it('gives (nearly) the bind rotation for a straight leg; the knee keeps a hair of bend', () => {
    const r = createTwoBoneResult();
    solveTwoBone(new Vector3(0, 1, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1), 0.42, 0.41, r);
    const q = boneBasis(r.dir1, r.hinge, new Quaternion());
    expect(q.angleTo(new Quaternion())).toBeLessThan(0.05);
  });

  it('builds bone bases that point the bone along the requested direction', () => {
    const dir = new Vector3(0.3, -0.8, 0.5).normalize();
    const q = boneBasis(dir, new Vector3(1, 0, 0), new Quaternion());
    const down = new Vector3(0, -1, 0).applyQuaternion(q);
    expect(down.distanceTo(dir)).toBeLessThan(1e-6);
  });
});
