import { describe, expect, it } from 'vitest';
import { levels, loopable, noiseLoop, reverbImpulse, softClipCurve } from './dsp';

describe('noise loops', () => {
  it('are normalized, finite, centered and the requested length', () => {
    for (const color of ['white', 'pink', 'brown'] as const) {
      const b = noiseLoop(color, 8000, 2, 42);
      expect(b.length).toBe(16000);
      const l = levels(b);
      expect(l.nan).toBe(false);
      expect(l.peak).toBeCloseTo(0.9, 5);
      expect(l.rms).toBeGreaterThan(0.05);
      let mean = 0;
      for (const v of b) mean += v;
      expect(Math.abs(mean / b.length)).toBeLessThan(0.05);
    }
  });

  it('pink and brown carry more low-frequency energy than white', () => {
    // Lag-1 autocorrelation: ~0 for white, high for brown.
    const corr = (b: Float32Array) => {
      let num = 0;
      let den = 0;
      for (let i = 1; i < b.length; i++) {
        num += b[i] * b[i - 1];
        den += b[i] * b[i];
      }
      return num / den;
    };
    const w = corr(noiseLoop('white', 8000, 1, 1));
    const p = corr(noiseLoop('pink', 8000, 1, 1));
    const br = corr(noiseLoop('brown', 8000, 1, 1));
    expect(Math.abs(w)).toBeLessThan(0.05);
    expect(p).toBeGreaterThan(w + 0.2);
    expect(br).toBeGreaterThan(p);
  });

  it('is deterministic per seed', () => {
    expect(noiseLoop('pink', 4000, 0.5, 9)).toEqual(noiseLoop('pink', 4000, 0.5, 9));
    expect(noiseLoop('pink', 4000, 0.5, 9)).not.toEqual(noiseLoop('pink', 4000, 0.5, 10));
  });

  it('loops without a jump at the seam', () => {
    // A ramp makes any seam discontinuity obvious; after loopable the wrap step stays small.
    const n = 2000;
    const ramp = new Float32Array(n).map((_, i) => Math.sin(i * 0.05));
    const l = loopable(ramp, 200);
    const seam = Math.abs(l[0] - l[l.length - 1]);
    expect(seam).toBeLessThan(0.1);
  });
});

describe('reverb impulse', () => {
  it('decays to near silence and starts after the pre-delay', () => {
    const [L, R] = reverbImpulse(8000, 2, 3);
    expect(L.length).toBe(16000);
    expect(L[0]).toBe(0);
    const head = levels(L.subarray(200, 2000)).rms;
    const tail = levels(L.subarray(14000)).rms;
    expect(tail).toBeLessThan(head * 0.05);
    expect(levels(R).nan).toBe(false);
    // Decorrelated channels for width.
    expect(L).not.toEqual(R);
  });
});

describe('soft clip curve', () => {
  it('is unity below the knee, odd-symmetric and never reaches 1', () => {
    const c = softClipCurve(2001, 0.75, 0.98);
    const at = (x: number) => c[Math.round(((x + 1) / 2) * 2000)];
    expect(at(0.5)).toBeCloseTo(0.5, 3);
    expect(at(-0.5)).toBeCloseTo(-0.5, 3);
    expect(at(1)).toBeLessThan(0.98);
    expect(at(1)).toBeGreaterThan(0.9);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
  });
});
