import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { EventBus } from '../core/events';
import type { GameEvents, Settings } from '../core/types';
import { DEFAULT_SETTINGS } from '../game/settings';
import { HapticMixer, Haptics, PATTERNS, STALL_PERIOD, pulseEnvelope, type PatternStep, type RumbleLevels, type RumblePulse } from './haptics';

const levels = (): RumbleLevels => ({ strong: 0, weak: 0, left: 0, right: 0 });

describe('pulseEnvelope', () => {
  it('flat pulses hold then cut', () => {
    const p: RumblePulse = { strong: 1, weak: 1, ms: 50, attackMs: 0, shape: 'flat' };
    expect(pulseEnvelope(p, 0)).toBe(1);
    expect(pulseEnvelope(p, 49)).toBe(1);
    expect(pulseEnvelope(p, 50)).toBe(0);
    expect(pulseEnvelope(p, -1)).toBe(0);
  });
  it('decay pulses hit and fade', () => {
    const p: RumblePulse = { strong: 1, weak: 1, ms: 100, attackMs: 0, shape: 'decay' };
    expect(pulseEnvelope(p, 0)).toBe(1);
    expect(pulseEnvelope(p, 50)).toBeCloseTo(0.25, 2);
    expect(pulseEnvelope(p, 99)).toBeLessThan(0.01);
  });
  it('swells rise and fall', () => {
    const p: RumblePulse = { strong: 1, weak: 1, ms: 100, shape: 'swell' };
    expect(pulseEnvelope(p, 50)).toBeCloseTo(1, 5);
    expect(pulseEnvelope(p, 10)).toBeLessThan(0.4);
  });
});

describe('HapticMixer', () => {
  it('mixes by taking the loudest per motor and honours delays', () => {
    const m = new HapticMixer();
    m.add({ strong: 0.2, weak: 0.8, ms: 100, attackMs: 0, shape: 'flat' });
    m.add({ strong: 0.9, weak: 0.1, ms: 100, attackMs: 0, shape: 'flat' }, 50);
    const out = levels();
    m.advance(10);
    m.sample(out);
    expect(out.strong).toBeCloseTo(0.2);
    expect(out.weak).toBeCloseTo(0.8);
    m.advance(50);
    m.sample(out);
    expect(out.strong).toBeCloseTo(0.9);
    expect(out.weak).toBeCloseTo(0.8);
    m.advance(200);
    m.sample(out);
    expect(out.strong + out.weak).toBe(0);
    expect(m.busy).toBe(false);
  });
});

/** Coarse fingerprint of a pattern: taps, length, and which motor leads. */
function signature(steps: PatternStep[]) {
  const end = Math.max(...steps.map((s) => s.at + s.pulse.ms));
  const strong = Math.max(...steps.map((s) => s.pulse.strong));
  const weak = Math.max(...steps.map((s) => s.pulse.weak));
  return `${steps.length}|${Math.round(end / 40)}|${strong > weak ? 'S' : 'W'}|${Math.round(Math.max(strong, weak) * 5)}`;
}

describe('PATTERNS', () => {
  it('are distinct from each other', () => {
    const sigs = {
      flap: signature(PATTERNS.flap(1)),
      stall: signature(PATTERNS.stallBeat()),
      terrainHit: signature(PATTERNS.terrainHit(15)),
      touchdown: signature(PATTERNS.touchdown(6)),
      ring: signature(PATTERNS.ringPassed()),
      collect: signature(PATTERNS.collect()),
      finish: signature(PATTERNS.raceFinish('gold', false)),
      fellOff: signature(PATTERNS.fellOff()),
      caught: signature(PATTERNS.caught()),
    };
    const values = Object.values(sigs);
    expect(new Set(values).size).toBe(values.length);
  });

  it('scales flap strength and terrain impulse', () => {
    expect(PATTERNS.flap(1)[0].pulse.strong).toBeGreaterThan(PATTERNS.flap(0.2)[0].pulse.strong);
    expect(PATTERNS.terrainHit(20)[0].pulse.strong).toBeGreaterThan(PATTERNS.terrainHit(2)[0].pulse.strong);
    expect(PATTERNS.flap(1)[0].pulse.strong).toBeLessThan(PATTERNS.terrainHit(1)[0].pulse.strong);
  });

  it('ring pass is a double tap with a gap', () => {
    const r = PATTERNS.ringPassed();
    expect(r).toHaveLength(2);
    expect(r[1].at).toBeGreaterThan(r[0].at + r[0].pulse.ms);
  });

  it('a better medal finishes with a fuller swell', () => {
    const swell = (m: 'bronze' | 'gold') => PATTERNS.raceFinish(m, false).find((s) => s.pulse.shape === 'swell')!.pulse.strong;
    expect(swell('gold')).toBeGreaterThan(swell('bronze'));
    expect(PATTERNS.raceFinish('gold', true).length).toBeGreaterThan(PATTERNS.raceFinish('gold', false).length);
  });
});

describe('Haptics', () => {
  function setup(rumble = true) {
    const events = new EventBus<GameEvents>();
    const pulses: { p: RumblePulse; delay: number }[] = [];
    const settings: Settings = { ...DEFAULT_SETTINGS, rumble };
    const h = new Haptics(events, { pulse: (p, delay = 0) => pulses.push({ p, delay }) }, () => settings);
    return { events, pulses, h, settings };
  }

  it('plays a pattern per event', () => {
    const { events, pulses } = setup();
    events.emit('flap', { strength: 0.8, position: new Vector3() });
    events.emit('ringPassed', { raceId: 'r', index: 0, total: 5, splitMs: 0, deltaMs: null, position: new Vector3() });
    expect(pulses).toHaveLength(3);
  });

  it('buzzes rhythmically while stalled and stops on recovery', () => {
    const { events, pulses, h } = setup();
    events.emit('stallStart', {});
    const dt = 1 / 60;
    for (let t = 0; t < 1.0; t += dt) h.update(dt);
    const beats = pulses.length;
    expect(beats).toBeGreaterThanOrEqual(Math.floor(1 / STALL_PERIOD));
    expect(beats).toBeLessThanOrEqual(Math.ceil(1 / STALL_PERIOD) + 1);
    events.emit('stallEnd', {});
    for (let t = 0; t < 1.0; t += dt) h.update(dt);
    expect(pulses.length).toBe(beats);
  });

  it('respects the rumble setting', () => {
    const { events, pulses, h } = setup(false);
    events.emit('terrainHit', { impulse: 20, point: new Vector3(), normal: new Vector3(0, 1, 0) });
    events.emit('stallStart', {});
    h.update(0.5);
    expect(pulses).toHaveLength(0);
  });

  it('unsubscribes on dispose', () => {
    const { events, pulses, h } = setup();
    h.dispose();
    events.emit('collect', { id: 'a', kind: 'feather', name: 'x', position: new Vector3(), total: 1, ofTotal: 2 });
    expect(pulses).toHaveLength(0);
  });
});
