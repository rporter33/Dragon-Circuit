// Weather as a deterministic, seeded state machine. Every few minutes the sky picks its next
// state from a small Markov table (clear skies most often, rain usually clearing afterwards),
// then blends every parameter toward it over most of a minute. Pure: no scene, no clock other
// than the dt it is fed, so the same seed always produces the same weather.

import type { WeatherKind } from '../core/types';
import { Rng } from '../core/rng';
import { angleDelta, clamp01, lerp, smoothstep } from '../core/math';

export interface WeatherParams {
  /** Prevailing wind speed (m/s). */
  windSpeed: number;
  /** 0..1 how gusty: amplitude of the spatio-temporal gust field. */
  gust: number;
  /** 0..1 how much cloud: mid-level banks shown, high-deck coverage. */
  cloudCover: number;
  /** 0..1 grey lid: desaturates, flattens and dims the light. */
  overcast: number;
  /** 0..1 low visibility. */
  mist: number;
  /** 0..1 precipitation. */
  rain: number;
  /** Fog density multiplier on top of the time-of-day palette. */
  fog: number;
  /** Thermal strength multiplier (weak sun → weak thermals). Never below ~0.6: rides stay kind. */
  thermal: number;
  /** 0..1 chance weight for distant lightning. */
  storm: number;
}

export const WEATHER_KINDS: WeatherKind[] = ['clear', 'breezy', 'overcast', 'mist', 'rain'];

export const WEATHER_PRESETS: Record<WeatherKind, WeatherParams> = {
  clear: { windSpeed: 4, gust: 0.22, cloudCover: 0.38, overcast: 0, mist: 0, rain: 0, fog: 1, thermal: 1, storm: 0 },
  breezy: { windSpeed: 9.5, gust: 0.7, cloudCover: 0.55, overcast: 0.08, mist: 0, rain: 0, fog: 0.8, thermal: 0.9, storm: 0 },
  overcast: { windSpeed: 6, gust: 0.4, cloudCover: 0.85, overcast: 0.82, mist: 0.08, rain: 0, fog: 1.25, thermal: 0.72, storm: 0 },
  mist: { windSpeed: 2, gust: 0.12, cloudCover: 0.5, overcast: 0.38, mist: 1, rain: 0, fog: 1, thermal: 0.8, storm: 0 },
  rain: { windSpeed: 8, gust: 0.6, cloudCover: 1, overcast: 1, mist: 0.12, rain: 1, fog: 1.15, thermal: 0.62, storm: 1 },
};

/** Next-state weights. A state never transitions to itself. */
const TRANSITIONS: Record<WeatherKind, [WeatherKind, number][]> = {
  clear: [['breezy', 0.4], ['overcast', 0.3], ['mist', 0.18], ['rain', 0.12]],
  breezy: [['clear', 0.45], ['overcast', 0.35], ['rain', 0.2]],
  overcast: [['rain', 0.4], ['clear', 0.25], ['mist', 0.2], ['breezy', 0.15]],
  mist: [['clear', 0.55], ['overcast', 0.3], ['breezy', 0.15]],
  rain: [['overcast', 0.45], ['clear', 0.35], ['breezy', 0.2]],
};

/** How long each state holds (s): fair weather lingers, rain passes. */
const DURATION: Record<WeatherKind, [number, number]> = {
  clear: [240, 420],
  breezy: [150, 300],
  overcast: [150, 280],
  mist: [120, 220],
  rain: [120, 200],
};

/** Seconds to blend from one state to the next. */
export const TRANSITION_SECONDS = 45;
/** Prevailing wind heading (radians, wind blows toward (cos, 0, sin)): out of the west-southwest. */
export const BASE_HEADING = 0.45;
/** Wetness follows rain: soaks in quickly, dries slowly. Time constants (s). */
const WET_RISE = 35;
const WET_DRY = 150;

export function createParams(): WeatherParams {
  return { windSpeed: 0, gust: 0, cloudCover: 0, overcast: 0, mist: 0, rain: 0, fog: 1, thermal: 1, storm: 0 };
}

export function copyParams(src: WeatherParams, out: WeatherParams): WeatherParams {
  out.windSpeed = src.windSpeed;
  out.gust = src.gust;
  out.cloudCover = src.cloudCover;
  out.overcast = src.overcast;
  out.mist = src.mist;
  out.rain = src.rain;
  out.fog = src.fog;
  out.thermal = src.thermal;
  out.storm = src.storm;
  return out;
}

export function lerpParams(a: WeatherParams, b: WeatherParams, t: number, out: WeatherParams): WeatherParams {
  out.windSpeed = lerp(a.windSpeed, b.windSpeed, t);
  out.gust = lerp(a.gust, b.gust, t);
  out.cloudCover = lerp(a.cloudCover, b.cloudCover, t);
  out.overcast = lerp(a.overcast, b.overcast, t);
  out.mist = lerp(a.mist, b.mist, t);
  out.rain = lerp(a.rain, b.rain, t);
  out.fog = lerp(a.fog, b.fog, t);
  out.thermal = lerp(a.thermal, b.thermal, t);
  out.storm = lerp(a.storm, b.storm, t);
  return out;
}

export interface LightningStrike {
  /** Azimuth around the observer (radians). */
  azimuth: number;
  /** Horizontal distance from the observer (m). */
  distance: number;
  /** Seed for the bolt's shape. */
  seed: number;
}

/**
 * The weather timeline. Call update(dt) once per frame; read `params`, `heading`, `wetness`.
 * `changed` and `strike` are set for exactly one update when something happens.
 */
export class WeatherClock {
  /** The state we are in or blending toward. */
  kind: WeatherKind;
  /** The state we are blending from. */
  from: WeatherKind;
  /** Current blended parameters. */
  readonly params: WeatherParams = createParams();
  /** Current prevailing wind heading (radians). */
  heading = BASE_HEADING;
  /** 0..1 how wet the world is. */
  wetness = 0;
  /** Seconds since the current state began (including its blend-in). */
  elapsed = 0;
  /** How long the current state holds before the next one begins. */
  duration = 0;
  /** Set during the update() in which the target state changed. */
  changed: { from: WeatherKind; to: WeatherKind } | null = null;
  /** Set during the update() in which a lightning bolt struck. */
  strike: LightningStrike | null = null;
  /** Seconds until the next possible strike. */
  private strikeTimer = 8;

  private rng: Rng;
  private stormRng: Rng;
  private fromParams = createParams();
  private fromHeading = BASE_HEADING;
  private targetHeading = BASE_HEADING;
  private transition = TRANSITION_SECONDS;

  constructor(seed = 0x5eed_c10d, start: WeatherKind = 'clear') {
    this.rng = new Rng(seed);
    this.stormRng = new Rng(seed ^ 0x9e3779b9);
    this.kind = start;
    this.from = start;
    this.duration = this.rollDuration(start);
    this.targetHeading = this.rollHeading();
    this.heading = this.fromHeading = this.targetHeading;
    copyParams(WEATHER_PRESETS[start], this.params);
    copyParams(this.params, this.fromParams);
    this.elapsed = this.transition;
    this.wetness = this.params.rain;
  }

  /** 0..1 progress of the blend into the current state. */
  get blend(): number {
    return smoothstep(0, 1, this.elapsed / this.transition);
  }

  /**
   * Start blending to `kind` now (or snap to it). The new state holds for a freshly rolled
   * duration either way, so a forced state isn't immediately replaced.
   */
  set(kind: WeatherKind, immediate = false): void {
    const prev = this.kind;
    // Blend from wherever we are right now, even mid-transition, so nothing ever jumps.
    copyParams(this.params, this.fromParams);
    this.fromHeading = this.heading;
    this.from = prev;
    this.kind = kind;
    this.elapsed = 0;
    this.transition = TRANSITION_SECONDS;
    this.duration = this.rollDuration(kind);
    this.targetHeading = this.rollHeading();
    if (immediate) {
      this.elapsed = this.transition;
      copyParams(WEATHER_PRESETS[kind], this.params);
      this.heading = this.targetHeading;
      this.wetness = this.params.rain;
    }
    if (prev !== kind) this.changed = { from: prev, to: kind };
  }

  update(dt: number): void {
    this.changed = null;
    this.strike = null;
    this.elapsed += dt;
    if (this.elapsed >= this.duration) {
      this.set(this.nextKind(this.kind));
    }
    const b = this.blend;
    lerpParams(this.fromParams, WEATHER_PRESETS[this.kind], b, this.params);
    this.heading = this.fromHeading + angleDelta(this.fromHeading, this.targetHeading) * b;

    const target = this.params.rain;
    const tau = target > this.wetness ? WET_RISE : WET_DRY;
    this.wetness = clamp01(this.wetness + (target - this.wetness) * (1 - Math.exp(-dt / tau)));

    this.updateStorm(dt);
  }

  /** Deterministic sequence: the next state after `kind` for this clock's seed. */
  private nextKind(kind: WeatherKind): WeatherKind {
    const options = TRANSITIONS[kind];
    let total = 0;
    for (const [, w] of options) total += w;
    let r = this.rng.float() * total;
    for (const [k, w] of options) {
      r -= w;
      if (r <= 0) return k;
    }
    return options[options.length - 1][0];
  }

  private rollDuration(kind: WeatherKind): number {
    const [lo, hi] = DURATION[kind];
    return this.rng.range(lo, hi);
  }

  private rollHeading(): number {
    return BASE_HEADING + this.rng.range(-0.75, 0.75);
  }

  private updateStorm(dt: number): void {
    const storm = this.params.storm * this.params.rain;
    if (storm < 0.5) {
      this.strikeTimer = Math.max(this.strikeTimer, 4);
      return;
    }
    this.strikeTimer -= dt * storm;
    if (this.strikeTimer > 0) return;
    this.strikeTimer = this.stormRng.range(7, 22);
    this.strike = {
      azimuth: this.stormRng.range(0, Math.PI * 2),
      distance: this.stormRng.range(2600, 5200),
      seed: (this.stormRng.float() * 0xffffffff) >>> 0,
    };
  }
}
