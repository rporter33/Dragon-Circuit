import { describe, expect, it } from 'vitest';
import { sharpenFor, wrapShaderTime } from './renderer';

describe('wrapShaderTime (TIME-01)', () => {
  it('leaves short sessions alone', () => {
    expect(wrapShaderTime(100, true)).toBe(100);
    expect(wrapShaderTime(4000, true)).toBe(4000);
  });

  it('wraps behind a fade once past an hour or so, exactly', () => {
    expect(wrapShaderTime(4096.5, false)).toBe(4096.5);
    expect(wrapShaderTime(4096.5, true)).toBe(0.5);
  });

  it('wraps regardless before float32 steps become visible', () => {
    const t = wrapShaderTime(4 * 4096 + 1.25, false);
    expect(t).toBe(3 * 4096 + 1.25);
    // float32 spacing at the largest value it ever holds stays under 2 ms.
    expect(Math.fround(t + 2 ** -10) - Math.fround(t)).toBeLessThan(0.002);
  });

  it('a whole day of play keeps the uniform bounded', () => {
    let t = 0;
    for (let s = 0; s < 24 * 3600; s += 1) t = wrapShaderTime(t + 1, s % 600 === 0);
    expect(t).toBeLessThanOrEqual(4 * 4096 + 1);
  });
});

describe('sharpenFor', () => {
  it('is off at native resolution and grows with the browser upscale', () => {
    expect(sharpenFor(1)).toBe(0);
    expect(sharpenFor(1.02)).toBe(0);
    expect(sharpenFor(1.25)).toBeGreaterThan(0.15);
    expect(sharpenFor(1 / 0.6)).toBeLessThanOrEqual(0.5);
    expect(sharpenFor(Number.NaN)).toBe(0);
  });
});
