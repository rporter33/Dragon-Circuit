import { describe, expect, it, vi } from 'vitest';
import { TitleMusic } from './titleMusic';

function setup() {
  let resolve!: (buffer: AudioBuffer) => void;
  let reject!: () => void;
  const loaded = new Promise<AudioBuffer>((yes, no) => { resolve = yes; reject = no; });
  const source = { buffer: null, loop: false, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() };
  const ctx = { createBufferSource: vi.fn(() => source) };
  const bus = {} as AudioNode;
  const music = new TitleMusic(ctx as unknown as AudioContext, bus, () => loaded);
  return { music, source, ctx, bus, resolve, reject };
}

describe('title recording lifecycle', () => {
  it('loops through the supplied mixer bus and starts only when both active and loaded', async () => {
    const s = setup();
    s.music.setActive(true);
    expect(s.source.start).not.toHaveBeenCalled();
    s.resolve({} as AudioBuffer);
    await Promise.resolve();
    expect(s.source.loop).toBe(true);
    expect(s.source.connect).toHaveBeenCalledWith(s.bus);
    expect(s.source.start).toHaveBeenCalledTimes(1);
    s.music.setActive(true);
    expect(s.source.start).toHaveBeenCalledTimes(1);
    s.music.setActive(false);
    expect(s.source.stop).toHaveBeenCalledTimes(1);
    expect(s.source.disconnect).toHaveBeenCalledTimes(1);
    s.music.setActive(false);
    expect(s.source.stop).toHaveBeenCalledTimes(1);
  });

  it('does not start a late download after the player has entered gameplay', async () => {
    const s = setup();
    s.music.setActive(true);
    s.music.setActive(false);
    s.resolve({} as AudioBuffer);
    await Promise.resolve();
    expect(s.ctx.createBufferSource).not.toHaveBeenCalled();
    s.music.setActive(true);
    expect(s.source.start).toHaveBeenCalledTimes(1);
  });

  it('handles unavailable audio without blocking screen transitions', async () => {
    const s = setup();
    s.music.setActive(true);
    s.reject();
    await Promise.resolve();
    s.music.setActive(false);
    expect(s.source.start).not.toHaveBeenCalled();
  });
});
