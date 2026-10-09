import { describe, expect, it } from 'vitest';
import {
  ambienceMix,
  emptyAmbienceMix,
  emptyWindMix,
  impactWeight,
  loudestFall,
  spatial,
  touchdownWeight,
  volumeToGain,
  windMix,
  wingbeatParams,
  WHISTLE_SPEED,
  type FallSource,
  type WindInput,
} from './mix';

const flying = (airspeed: number, extra: Partial<WindInput> = {}): WindInput => ({
  airspeed,
  tuck: 0,
  flare: 0,
  gLoad: 1,
  grounded: false,
  ambientWind: 3,
  ...extra,
});

describe('volumeToGain', () => {
  it('is 0 at 0, 1 at 1, monotonic and safe on junk', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBeCloseTo(0.25);
    expect(volumeToGain(-1)).toBe(0);
    expect(volumeToGain(3)).toBe(1);
    expect(volumeToGain(NaN)).toBe(0);
  });
});

describe('windMix', () => {
  it('gets louder and brighter with airspeed', () => {
    let prevGain = -1;
    let prevCut = -1;
    for (const v of [5, 15, 25, 40, 60, 85]) {
      const m = windMix(flying(v), emptyWindMix());
      expect(m.bodyGain).toBeGreaterThan(prevGain);
      expect(m.bodyCutoff).toBeGreaterThan(prevCut);
      prevGain = m.bodyGain;
      prevCut = m.bodyCutoff;
    }
  });

  it('only whistles at very high speed', () => {
    expect(windMix(flying(30), emptyWindMix()).whistleGain).toBe(0);
    expect(windMix(flying(WHISTLE_SPEED - 1), emptyWindMix()).whistleGain).toBe(0);
    expect(windMix(flying(80), emptyWindMix()).whistleGain).toBeGreaterThan(0.03);
  });

  it('tucking brightens the wind and raises the whistle; flaring buffets', () => {
    const open = windMix(flying(70), emptyWindMix());
    const tucked = windMix(flying(70, { tuck: 1 }), emptyWindMix());
    expect(tucked.bodyCutoff).toBeGreaterThan(open.bodyCutoff);
    expect(tucked.whistleGain).toBeGreaterThan(open.whistleGain);
    expect(open.buffetDepth).toBe(0);
    const flare = windMix(flying(25, { flare: 1 }), emptyWindMix());
    expect(flare.buffetDepth).toBeGreaterThan(0.3);
    expect(windMix(flying(4, { flare: 1 }), emptyWindMix()).buffetDepth).toBe(0);
  });

  it('is much quieter on the ground and follows the breeze there', () => {
    const air = windMix(flying(25), emptyWindMix());
    const calm = windMix({ ...flying(0), grounded: true, ambientWind: 0 }, emptyWindMix());
    const breezy = windMix({ ...flying(0), grounded: true, ambientWind: 12 }, emptyWindMix());
    expect(calm.bodyGain).toBeLessThan(air.bodyGain);
    expect(breezy.bodyGain).toBeGreaterThan(calm.bodyGain);
    expect(breezy.whistleGain).toBe(0);
  });

  it('never produces NaN, even from junk input', () => {
    const m = windMix(flying(-5, { tuck: 3, flare: -2, gLoad: 99 }), emptyWindMix());
    for (const v of Object.values(m)) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('spatial', () => {
  const L = { x: 0, y: 0, z: 0 };
  const R = { x: 1, y: 0, z: 0 };
  const sp = { gain: 0, pan: 0 };

  it('is full gain inside the reference distance and falls off beyond', () => {
    expect(spatial(L, R, { x: 0, y: 0, z: -5 }, 10, 500, sp).gain).toBe(1);
    expect(spatial(L, R, { x: 0, y: 0, z: -40 }, 10, 500, sp).gain).toBeCloseTo(0.25);
    expect(spatial(L, R, { x: 0, y: 0, z: -600 }, 10, 500, sp).gain).toBe(0);
  });

  it('pans toward the side the source is on, never fully', () => {
    expect(spatial(L, R, { x: 50, y: 0, z: 0 }, 10, 500, sp).pan).toBeCloseTo(0.85);
    expect(spatial(L, R, { x: -50, y: 0, z: 0 }, 10, 500, sp).pan).toBeCloseTo(-0.85);
    expect(spatial(L, R, { x: 0, y: 0, z: -50 }, 10, 500, sp).pan).toBeCloseTo(0);
    expect(spatial(L, R, L, 10, 500, sp).pan).toBe(0);
  });
});

describe('ambienceMix', () => {
  const base = { night: 0, timeOfDay: 0.45, rain: 0, nearGround: 1 };
  it('crickets only at night, near the ground, not in rain', () => {
    expect(ambienceMix(base, emptyAmbienceMix()).crickets).toBe(0);
    expect(ambienceMix({ ...base, night: 1 }, emptyAmbienceMix()).crickets).toBeGreaterThan(0);
    expect(ambienceMix({ ...base, night: 1, nearGround: 0 }, emptyAmbienceMix()).crickets).toBe(0);
    expect(ambienceMix({ ...base, night: 1, rain: 1 }, emptyAmbienceMix()).crickets).toBe(0);
  });

  it('birds sing by day and most at dawn', () => {
    const noon = ambienceMix(base, emptyAmbienceMix()).birds;
    const dawn = ambienceMix({ ...base, timeOfDay: 0.29 }, emptyAmbienceMix()).birds;
    expect(noon).toBeGreaterThan(0);
    expect(dawn).toBeGreaterThan(noon);
    expect(ambienceMix({ ...base, night: 1 }, emptyAmbienceMix()).birds).toBe(0);
  });

  it('rain brings hiss and, when heavy, thunder', () => {
    expect(ambienceMix(base, emptyAmbienceMix()).rainHiss).toBe(0);
    const light = ambienceMix({ ...base, rain: 0.3 }, emptyAmbienceMix());
    const heavy = ambienceMix({ ...base, rain: 1 }, emptyAmbienceMix());
    expect(light.rainHiss).toBeGreaterThan(0);
    expect(heavy.rainHiss).toBeGreaterThan(light.rainHiss);
    expect(light.thunder).toBe(0);
    expect(heavy.thunder).toBe(1);
  });

  it('the edge storm rises with weather.boundary and drowns the calm air', () => {
    const calm = ambienceMix(base, emptyAmbienceMix());
    expect(calm.storm).toBe(0);
    // Optional input: missing or garbage reads as no storm.
    expect(ambienceMix({ ...base, boundary: Number.NaN }, emptyAmbienceMix()).storm).toBe(0);
    const near = ambienceMix({ ...base, boundary: 0.5 }, emptyAmbienceMix());
    const deep = ambienceMix({ ...base, boundary: 1 }, emptyAmbienceMix());
    expect(near.storm).toBeGreaterThan(0);
    expect(deep.storm).toBeGreaterThan(near.storm);
    expect(deep.storm).toBeLessThan(0.2);
    expect(deep.air).toBeLessThan(calm.air * 0.3);
  });
});

describe('loudestFall', () => {
  const falls: FallSource[] = [
    { lip: { x: 0, y: 500, z: 0 }, outX: 1, outZ: 0, drop: 300, width: 6 },
    { lip: { x: 1000, y: 500, z: 0 }, outX: 0, outZ: 1, drop: 300, width: 3 },
  ];
  const h = { gain: 0, x: 0, y: 0, z: 0 };

  it('hears the nearest fall loudest and nothing from far away', () => {
    loudestFall({ x: 30, y: 450, z: 0 }, falls, h);
    expect(h.gain).toBeGreaterThan(0.5);
    expect(h.x).toBeLessThan(20);
    loudestFall({ x: 980, y: 480, z: 40 }, falls, h);
    expect(h.x).toBeGreaterThan(900);
    loudestFall({ x: 500, y: 2000, z: 3000 }, falls, h);
    expect(h.gain).toBe(0);
  });

  it('the roar follows you down the column', () => {
    loudestFall({ x: 20, y: 350, z: 0 }, falls, h);
    expect(h.y).toBeCloseTo(350);
    loudestFall({ x: 20, y: 900, z: 0 }, falls, h);
    expect(h.y).toBe(500);
  });
});

describe('event scaling', () => {
  it('heavier breeds beat lower and louder; stronger beats are louder', () => {
    const light = wingbeatParams(1, 470);
    const heavy = wingbeatParams(1, 920);
    expect(heavy.pitch).toBeLessThan(light.pitch);
    expect(heavy.gain).toBeGreaterThan(light.gain);
    expect(wingbeatParams(0.2, 650).gain).toBeLessThan(wingbeatParams(1, 650).gain);
  });

  it('impact and touchdown weights rise with speed and stay in 0..1', () => {
    expect(impactWeight(0)).toBe(0);
    expect(impactWeight(30)).toBe(1);
    expect(impactWeight(5)).toBeGreaterThan(impactWeight(2));
    expect(touchdownWeight(0)).toBeGreaterThan(0);
    expect(touchdownWeight(10)).toBe(1);
  });
});
