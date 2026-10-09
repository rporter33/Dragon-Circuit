import { describe, expect, it } from 'vitest';
import { applyWeather, createPalette, samplePalette } from './palette';

const vib = (t: number) => samplePalette(t, createPalette()).vibrance;

describe('painterly vibrance by time of day', () => {
  it('lifts daylight and is off from sundown to dawn', () => {
    for (const t of [0.42, 0.5, 0.58]) {
      expect(vib(t)).toBeGreaterThanOrEqual(0.2);
      expect(vib(t)).toBeLessThanOrEqual(0.3);
    }
    // Dusk pinks and violets turn magenta when pushed: none from sundown through the night.
    for (const t of [0.757, 0.78, 0.82, 0.9, 0.95, 0.0, 0.1, 0.2]) expect(vib(t)).toBe(0);
    expect(vib(0.7)).toBeLessThan(vib(0.6));
  });

  it('changes continuously through the day (no jumps between keyframes)', () => {
    let prev = vib(0);
    for (let i = 1; i <= 2000; i++) {
      const v = vib(i / 2000);
      expect(Math.abs(v - prev)).toBeLessThan(0.01);
      prev = v;
    }
  });

  it('fades under an overcast lid and in mist', () => {
    const p = samplePalette(0.5, createPalette());
    const clear = p.vibrance;
    applyWeather(p, { overcast: 1, mist: 0, rain: 0, fog: 1 });
    expect(p.vibrance).toBeLessThan(clear * 0.3);
  });
});
