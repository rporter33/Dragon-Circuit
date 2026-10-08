import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { DEFAULT_RIDER, DEFAULT_WYVERN } from '../cosmetics/catalog';
import { GHOST_RATE, GHOST_STRIDE, GhostRecorder, createGhostSample, ghostDuration, lerpPhase, readGhostSample, sampleGhost } from './ghost';

function record(n: number, initialSeconds = 180) {
  const rec = new GhostRecorder(initialSeconds);
  const q = new Quaternion();
  for (let i = 0; i < n; i++) {
    q.setFromAxisAngle(new Vector3(0, 1, 0), i * 0.01);
    rec.push(new Vector3(i, 100 + i * 0.5, -i * 2), q, (i * 0.1) % 1, 0.5, 1 - i * 0.001, 0);
  }
  return rec.finish({ raceId: 'r', breed: 'skimmer', look: DEFAULT_WYVERN, rider: DEFAULT_RIDER, timeMs: (n - 1) * (1000 / GHOST_RATE), splits: [1, 2] });
}

describe('ghost packing', () => {
  it('packs 11 floats per sample and decodes them exactly', () => {
    const g = record(5);
    expect(g.samples.length).toBe(5 * GHOST_STRIDE);
    expect(g.rate).toBe(GHOST_RATE);
    const s = readGhostSample(g, 3, createGhostSample());
    expect(s.position.toArray()).toEqual([3, 101.5, -6]);
    expect(s.flapPhase).toBeCloseTo(0.3, 5);
    expect(s.wingSpread).toBeCloseTo(0.997, 5);
    expect(s.orientation.angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.03))).toBeLessThan(1e-4);
  });

  it('grows past its initial capacity and copies out on finish', () => {
    const g = record(200, 1); // 1 s of capacity = 30 samples, so it has to grow
    expect(g.samples.length).toBe(200 * GHOST_STRIDE);
    expect(readGhostSample(g, 199, createGhostSample()).position.x).toBe(199);
    expect(ghostDuration(g)).toBeCloseTo(199 / GHOST_RATE, 6);
  });

  it('interpolates between samples and clamps outside the recording', () => {
    const g = record(10);
    const out = createGhostSample();
    sampleGhost(g, 2.5 / GHOST_RATE, out);
    expect(out.position.x).toBeCloseTo(2.5, 5);
    expect(out.velocity.x).toBeCloseTo(GHOST_RATE, 3);
    expect(out.velocity.z).toBeCloseTo(-2 * GHOST_RATE, 3);
    sampleGhost(g, -1, out);
    expect(out.position.x).toBe(0);
    sampleGhost(g, 99, out);
    expect(out.position.x).toBe(9);
  });

  it('wraps the flap phase the short way round', () => {
    expect(lerpPhase(0.9, 0.1, 0.5)).toBeCloseTo(0, 6);
    expect(lerpPhase(0.9, 0.1, 0.25)).toBeCloseTo(0.95, 6);
    expect(lerpPhase(0.2, 0.4, 0.5)).toBeCloseTo(0.3, 6);
  });
});
