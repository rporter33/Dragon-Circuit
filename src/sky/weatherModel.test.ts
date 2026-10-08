import { describe, expect, it } from 'vitest';
import type { WeatherKind } from '../core/types';
import { TRANSITION_SECONDS, WEATHER_KINDS, WEATHER_PRESETS, WeatherClock, type WeatherParams } from './weatherModel';

const KEYS: (keyof WeatherParams)[] = ['windSpeed', 'gust', 'cloudCover', 'overcast', 'mist', 'rain', 'fog', 'thermal', 'storm'];

function run(clock: WeatherClock, seconds: number, dt = 0.25) {
  const changes: { from: WeatherKind; to: WeatherKind; at: number }[] = [];
  let t = 0;
  while (t < seconds) {
    clock.update(dt);
    t += dt;
    if (clock.changed) changes.push({ ...clock.changed, at: t });
  }
  return changes;
}

describe('weather presets', () => {
  it('stay in sane ranges and keep thermals kind', () => {
    for (const k of WEATHER_KINDS) {
      const p = WEATHER_PRESETS[k];
      for (const key of ['gust', 'cloudCover', 'overcast', 'mist', 'rain', 'storm'] as const) {
        expect(p[key]).toBeGreaterThanOrEqual(0);
        expect(p[key]).toBeLessThanOrEqual(1);
      }
      expect(p.thermal).toBeGreaterThanOrEqual(0.6);
      expect(p.windSpeed).toBeGreaterThan(0);
      expect(p.windSpeed).toBeLessThan(15);
    }
  });
});

describe('weather schedule', () => {
  it('starts clear and steady', () => {
    const c = new WeatherClock(42);
    c.update(0.1);
    expect(c.kind).toBe('clear');
    expect(c.params.rain).toBe(0);
    expect(c.changed).toBeNull();
  });

  it('changes every few minutes, never to the same state, and announces each change once', () => {
    const c = new WeatherClock(7);
    const changes = run(c, 60 * 60);
    expect(changes.length).toBeGreaterThan(8);
    expect(changes.length).toBeLessThan(30);
    let prev: WeatherKind = 'clear';
    let prevAt = 0;
    for (const ch of changes) {
      expect(ch.from).toBe(prev);
      expect(ch.to).not.toBe(ch.from);
      expect(ch.at - prevAt).toBeGreaterThanOrEqual(prevAt === 0 ? 60 : 110);
      prev = ch.to;
      prevAt = ch.at;
    }
    // Over an hour every state shows up.
    const seen = new Set(changes.map((c) => c.to));
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });

  it('is deterministic for a seed and differs between seeds', () => {
    const a = run(new WeatherClock(1234), 3600).map((c) => `${c.to}@${c.at}`);
    const b = run(new WeatherClock(1234), 3600).map((c) => `${c.to}@${c.at}`);
    const d = run(new WeatherClock(999), 3600).map((c) => `${c.to}@${c.at}`);
    expect(a).toEqual(b);
    expect(a).not.toEqual(d);
  });

  it('blends parameters smoothly with no jumps', () => {
    const c = new WeatherClock(3);
    const dt = 0.1;
    let prev = { ...c.params };
    let prevHeading = c.heading;
    for (let i = 0; i < 20000; i++) {
      c.update(dt);
      for (const k of KEYS) {
        const range = Math.max(1, ...WEATHER_KINDS.map((w) => WEATHER_PRESETS[w][k]));
        // Max slope of a smoothstep blend over the transition, plus slack.
        const maxStep = (range * 1.6 * dt) / TRANSITION_SECONDS;
        expect(Math.abs(c.params[k] - prev[k])).toBeLessThanOrEqual(maxStep);
      }
      expect(Math.abs(c.heading - prevHeading)).toBeLessThan(0.02);
      prev = { ...c.params };
      prevHeading = c.heading;
    }
  });

  it('reaches the target preset once the blend is done', () => {
    const c = new WeatherClock(5);
    c.set('rain');
    expect(c.changed).toEqual({ from: 'clear', to: 'rain' });
    c.update(TRANSITION_SECONDS / 2);
    expect(c.params.rain).toBeGreaterThan(0.2);
    expect(c.params.rain).toBeLessThan(0.8);
    c.update(TRANSITION_SECONDS / 2 + 1);
    for (const k of KEYS) expect(c.params[k]).toBeCloseTo(WEATHER_PRESETS.rain[k], 6);
  });

  it('snaps when asked to, and redirects mid-blend from where it is', () => {
    const c = new WeatherClock(5);
    c.set('mist', true);
    c.update(0.01);
    expect(c.params.mist).toBeCloseTo(1, 6);
    c.set('rain');
    c.update(10);
    const midMist = c.params.mist;
    c.set('clear');
    expect(c.changed).toEqual({ from: 'rain', to: 'clear' });
    c.update(0.01);
    expect(Math.abs(c.params.mist - midMist)).toBeLessThan(0.01);
  });

  it('wets quickly in rain and dries slowly after', () => {
    const c = new WeatherClock(9);
    c.set('rain', true);
    expect(c.wetness).toBe(1);
    c.set('clear', true);
    c.wetness = 0;
    c.set('rain');
    run(c, 120);
    expect(c.wetness).toBeGreaterThan(0.6);
    const wet = c.wetness;
    c.set('clear');
    run(c, 60);
    expect(c.wetness).toBeLessThan(wet);
    expect(c.wetness).toBeGreaterThan(0.25);
  });

  it('only throws lightning in a storm, rarely', () => {
    const calm = new WeatherClock(11);
    let strikes = 0;
    for (let i = 0; i < 4000; i++) {
      calm.update(0.25);
      if (calm.strike) strikes++;
      if (calm.kind === 'rain') calm.set('clear', true);
    }
    expect(strikes).toBe(0);

    const storm = new WeatherClock(11);
    storm.set('rain', true);
    const seen: number[] = [];
    for (let i = 0; i < 240; i++) {
      storm.update(0.25);
      if (storm.strike) {
        seen.push(i * 0.25);
        expect(storm.strike.distance).toBeGreaterThan(2000);
      }
    }
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.length).toBeLessThanOrEqual(10);
  });
});
