import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { keyLightDirection, moonDirection, moonKeyWeight, nightAmount, shadowStrength, sunDirection } from './sunPath';
import { COLOR_KEYS, KEYFRAMES, NUMBER_KEYS, applyWeather, createPalette, samplePalette } from './palette';

const sun = new Vector3();
const moon = new Vector3();
const key = new Vector3();

describe('sun and moon', () => {
  it('rises in the east at 0.25, peaks at noon over the south, sets in the west at 0.75', () => {
    sunDirection(0.25, sun);
    expect(sun.y).toBeCloseTo(0, 5);
    expect(sun.x).toBeGreaterThan(0.9);
    sunDirection(0.5, sun);
    expect(sun.y).toBeGreaterThan(0.75);
    expect(sun.z).toBeLessThan(-0.4);
    expect(Math.abs(sun.x)).toBeLessThan(1e-6);
    sunDirection(0.75, sun);
    expect(sun.y).toBeCloseTo(0, 5);
    expect(sun.x).toBeLessThan(-0.9);
    sunDirection(0, sun);
    expect(sun.y).toBeLessThan(-0.75);
  });

  it('keeps the golden hour low and the dusk sun below the horizon', () => {
    expect(sunDirection(0.71, sun).y).toBeGreaterThan(0.12);
    expect(sun.y).toBeLessThan(0.3);
    expect(sunDirection(0.78, sun).y).toBeLessThan(-0.05);
  });

  it('puts the moon up at night', () => {
    for (const t of [0.85, 0.95, 0.0, 0.1, 0.18]) expect(moonDirection(t, moon).y).toBeGreaterThan(0.2);
  });

  it('hands the key light to the moon after sunset, with no jumps', () => {
    let prev = keyLightDirection(sunDirection(0.6, sun), moonDirection(0.6, moon), new Vector3());
    for (let t = 0.6; t <= 1.4; t += 0.0005) {
      keyLightDirection(sunDirection(t, sun), moonDirection(t, moon), key);
      expect(key.length()).toBeCloseTo(1, 6);
      expect(key.y).toBeGreaterThanOrEqual(0.07 - 1e-9);
      // 0.0005 of a day is ~0.7 s on the default 24-minute day: the dim blue-hour handover
      // sweeps at most ~6°/s, never jumps.
      expect(key.angleTo(prev)).toBeLessThan(0.1);
      prev.copy(key);
    }
    expect(moonKeyWeight(sunDirection(0.5, sun).y)).toBe(0);
    expect(moonKeyWeight(sunDirection(0.95, sun).y)).toBe(1);
    keyLightDirection(sunDirection(0.95, sun), moonDirection(0.95, moon), key);
    expect(key.angleTo(moon)).toBeLessThan(1e-6);
  });

  it('agrees on night and shadows', () => {
    expect(nightAmount(sunDirection(0.5, sun).y)).toBe(0);
    expect(nightAmount(sunDirection(0.95, sun).y)).toBe(1);
    expect(nightAmount(sunDirection(0.78, sun).y)).toBeGreaterThan(0.3);
    expect(shadowStrength(sunDirection(0.5, sun), moonDirection(0.5, moon))).toBe(1);
    expect(shadowStrength(sunDirection(0.95, sun), moonDirection(0.95, moon))).toBeGreaterThan(0.9);
    // Through the handover the shadows fade out rather than swing.
    expect(shadowStrength(sunDirection(0.765, sun), moonDirection(0.765, moon))).toBeLessThan(0.5);
  });
});

describe('palettes', () => {
  it('has sorted keyframes that loop', () => {
    for (let i = 1; i < KEYFRAMES.length; i++) expect(KEYFRAMES[i].t).toBeGreaterThan(KEYFRAMES[i - 1].t);
    expect(KEYFRAMES[0].t).toBe(0);
    expect(KEYFRAMES[KEYFRAMES.length - 1].t).toBe(1);
    const a = samplePalette(0, createPalette());
    const b = samplePalette(0.99999, createPalette());
    for (const k of COLOR_KEYS) expect(a[k].r).toBeCloseTo(b[k].r, 3);
    for (const k of NUMBER_KEYS) expect(a[k]).toBeCloseTo(b[k], 3);
  });

  it('changes continuously through the day', () => {
    const p = createPalette();
    const q = createPalette();
    samplePalette(0, q);
    for (let t = 0.0005; t < 1; t += 0.0005) {
      samplePalette(t, p);
      for (const k of COLOR_KEYS) {
        expect(Math.abs(p[k].r - q[k].r) + Math.abs(p[k].g - q[k].g) + Math.abs(p[k].b - q[k].b)).toBeLessThan(0.06);
      }
      expect(Math.abs(p.keyI - q.keyI)).toBeLessThan(0.04);
      expect(Math.abs(p.exposure - q.exposure)).toBeLessThan(0.04);
      for (const k of COLOR_KEYS) q[k].copy(p[k]);
      for (const k of NUMBER_KEYS) q[k] = p[k];
    }
  });

  it('keeps night playable: moonlight, ambient and exposure never collapse', () => {
    const p = createPalette();
    for (let t = 0; t < 1; t += 0.01) {
      samplePalette(t, p);
      // Effective brightness of the world's lighting after exposure.
      const light = (p.keyI * 2.6 + p.hemiI * 0.6) * p.exposure;
      expect(light, `t=${t.toFixed(2)}`).toBeGreaterThan(0.8);
      expect(p.exposure).toBeLessThan(1.7);
    }
  });

  it('weather greys, fogs and darkens without breaking anything', () => {
    const clear = samplePalette(0.5, createPalette());
    const grey = applyWeather(samplePalette(0.5, createPalette()), { overcast: 1, mist: 0, rain: 0, fog: 1 });
    const mist = applyWeather(samplePalette(0.5, createPalette()), { overcast: 0.3, mist: 1, rain: 0, fog: 1 });
    const rain = applyWeather(samplePalette(0.5, createPalette()), { overcast: 1, mist: 0.2, rain: 1, fog: 1.2 });
    const chroma = (c: { r: number; g: number; b: number }) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
    expect(chroma(grey.zenith)).toBeLessThan(chroma(clear.zenith) * 0.5);
    expect(grey.keyI).toBeLessThan(clear.keyI * 0.5);
    expect(grey.saturation).toBeLessThan(clear.saturation);
    expect(mist.fogDensity).toBeGreaterThan(clear.fogDensity * 4);
    expect(rain.keyI).toBeLessThan(grey.keyI);
    expect(rain.fogDensity).toBeGreaterThan(grey.fogDensity);
    for (const p of [grey, mist, rain]) {
      for (const k of NUMBER_KEYS) expect(Number.isFinite(p[k])).toBe(true);
      expect(p.exposure).toBeGreaterThan(0.8);
    }
  });
});
