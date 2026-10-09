import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrameClock, FrameGuard } from './frameGuard';

describe('FrameClock', () => {
  it('starts at zero even when the first timestamp predates the start (DT-01)', () => {
    const c = new FrameClock();
    // The first rAF timestamp was queued 4 s before start() returned: no negative step.
    expect(c.tick(1000)).toBe(0);
    expect(c.tick(1016)).toBeCloseTo(0.016, 6);
  });

  it('never returns a negative or non-finite step', () => {
    const c = new FrameClock();
    c.tick(5000);
    expect(c.tick(4000)).toBe(0);
    expect(c.tick(Number.NaN)).toBe(0);
    expect(c.tick(4100)).toBeCloseTo(0.1, 6);
  });
});

describe('FrameGuard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps going after a frame throws and logs each distinct error once (LOOP-01)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const g = new FrameGuard();
    let n = 0;
    const frame = () => {
      n++;
      if (n <= 5) throw new Error('one-off glitch');
    };
    for (let i = 0; i < 10; i++) g.run(frame);
    expect(n).toBe(10);
    expect(g.failures).toBe(5);
    expect(err).toHaveBeenCalledTimes(1);
    expect(g.failed).toBe(false);
  });

  it('reports once when frames keep failing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const g = new FrameGuard();
    const fatal = vi.fn();
    g.onFatal = fatal;
    for (let i = 0; i < 100; i++) g.run(() => {
      throw new Error('broken');
    });
    expect(fatal).toHaveBeenCalledTimes(1);
    expect(g.failed).toBe(true);
  });

  it('a recovered streak does not count toward the fatal report', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const g = new FrameGuard();
    const fatal = vi.fn();
    g.onFatal = fatal;
    for (let i = 0; i < 200; i++) g.run(() => {
      if (i % 20 !== 0) throw new Error('flaky');
    });
    expect(fatal).not.toHaveBeenCalled();
  });
});
