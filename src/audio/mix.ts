// Pure mappings from game state to mixer parameters. The AudioSystem samples the game once per
// frame, runs these, and glides the WebAudio params toward the results. Keeping them pure means
// the feel ("how loud is the wind at 60 m/s?") is unit-tested and tunable in one place.

import { clamp01, smoothstep } from '../core/math';

/** Settings slider (0..1) to linear gain. Squared so the slider feels even to the ear. */
export function volumeToGain(v: number): number {
  const c = clamp01(Number.isFinite(v) ? v : 0);
  return c * c;
}

// ---------------------------------------------------------------------------------------------
// Wind
// ---------------------------------------------------------------------------------------------

export interface WindInput {
  /** Airspeed (m/s) while flying. */
  airspeed: number;
  /** 0..1 how folded the wings are (1 = full tuck). */
  tuck: number;
  /** 0..1 flare (air brake). */
  flare: number;
  /** Load factor (g). */
  gLoad: number;
  /** Standing or walking: the wind is the weather's breeze, not airspeed. */
  grounded: boolean;
  /** Weather wind speed (m/s). */
  ambientWind: number;
}

export interface WindMix {
  /** Broadband body of the wind (lowpassed pink noise). */
  bodyGain: number;
  bodyCutoff: number;
  /** Bright rush layered on at speed (bandpassed white noise). */
  rushGain: number;
  rushFreq: number;
  /** Tonal whistle at very high speed. */
  whistleGain: number;
  whistleFreq: number;
  /** 0..1 depth of the buffeting tremolo (flaring), and its rate (Hz). */
  buffetDepth: number;
  buffetRate: number;
}

/** Speed above which the whistle layer starts to sing. */
export const WHISTLE_SPEED = 50;

export function windMix(w: WindInput, out: WindMix): WindMix {
  if (w.grounded) {
    // A breeze around your ears: soft, dark, gusty (the gusts come from the caller's modulation).
    const b = smoothstep(0, 14, w.ambientWind);
    out.bodyGain = 0.025 + 0.09 * b;
    out.bodyCutoff = 260 + 520 * b;
    out.rushGain = 0.008 * b;
    out.rushFreq = 1400;
    out.whistleGain = 0;
    out.whistleFreq = 1200;
    out.buffetDepth = 0;
    out.buffetRate = 8;
    return out;
  }
  const v = Math.max(0, w.airspeed);
  const s = clamp01(v / 85);
  const tuck = clamp01(w.tuck);
  const flare = clamp01(w.flare);
  // Pulling g makes the wind roar a little harder (more pressure over the membranes).
  const g = 1 + 0.3 * clamp01((w.gLoad - 1.4) / 3);
  out.bodyGain = (0.03 + 0.36 * Math.pow(s, 1.35)) * g * (1 - 0.15 * tuck);
  // Folded wings are a sleeker shape: the wind gets thinner and brighter, less rumble.
  out.bodyCutoff = (170 + 2300 * Math.pow(s, 1.2)) * (1 + 0.45 * tuck * s) * (1 - 0.35 * flare);
  out.rushGain = 0.26 * smoothstep(0.22, 0.85, s) * (1 + 0.5 * tuck) * (1 - 0.4 * flare);
  out.rushFreq = 800 + 3200 * s;
  out.whistleGain = 0.07 * smoothstep(WHISTLE_SPEED, WHISTLE_SPEED + 28, v) * (0.55 + 0.45 * tuck);
  out.whistleFreq = 900 + 1000 * smoothstep(WHISTLE_SPEED, 92, v);
  // Flaring at speed: the membranes shudder. Depth grows with dynamic pressure.
  out.buffetDepth = 0.55 * flare * smoothstep(9, 26, v);
  out.buffetRate = 7 + 6 * s;
  return out;
}

export function emptyWindMix(): WindMix {
  return { bodyGain: 0, bodyCutoff: 200, rushGain: 0, rushFreq: 1000, whistleGain: 0, whistleFreq: 1000, buffetDepth: 0, buffetRate: 8 };
}

// ---------------------------------------------------------------------------------------------
// Spatialization (cheap stereo: distance attenuation + equal-power-ish pan)
// ---------------------------------------------------------------------------------------------

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface Spatial {
  gain: number;
  /** -1 (left) .. 1 (right). */
  pan: number;
}

/**
 * Attenuation and pan of a source relative to the listener. Inverse-distance beyond `ref`
 * meters, faded to silence by `maxDist`. Pan is the source direction projected on the listener's
 * right axis, kept off the extremes so nothing ever sits in one ear only.
 */
export function spatial(listener: Vec3Like, right: Vec3Like, src: Vec3Like, ref: number, maxDist: number, out: Spatial): Spatial {
  const dx = src.x - listener.x;
  const dy = src.y - listener.y;
  const dz = src.z - listener.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  out.gain = (ref / Math.max(ref, d)) * (1 - smoothstep(maxDist * 0.6, maxDist, d));
  out.pan = d > 1e-3 ? Math.max(-0.85, Math.min(0.85, ((dx * right.x + dy * right.y + dz * right.z) / d) * 0.85)) : 0;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Ambience
// ---------------------------------------------------------------------------------------------

export interface AmbienceInput {
  /** 0 day … 1 night. */
  night: number;
  /** 0..1 (0.25 sunrise, 0.75 sunset). */
  timeOfDay: number;
  /** 0..1 rain amount. */
  rain: number;
  /** 0..1 how close the listener is to an island surface (1 = standing on it). */
  nearGround: number;
}

export interface AmbienceMix {
  /** Soft daytime air bed. */
  air: number;
  /** Night crickets. */
  crickets: number;
  /** Probability weight of bird phrases (0..1), daytime near islands; peaks at dawn. */
  birds: number;
  rainHiss: number;
  /** Probability weight of distant thunder. */
  thunder: number;
}

export function ambienceMix(a: AmbienceInput, out: AmbienceMix): AmbienceMix {
  const day = 1 - clamp01(a.night);
  const near = clamp01(a.nearGround);
  const rain = clamp01(a.rain);
  // Dawn chorus: birds sing most in the hour or two after sunrise.
  const dawn = smoothstep(0.22, 0.27, a.timeOfDay) * (1 - smoothstep(0.3, 0.38, a.timeOfDay));
  out.air = (0.035 + 0.05 * near) * (0.5 + 0.5 * day) * (1 - 0.6 * rain);
  out.crickets = 0.05 * Math.pow(clamp01(a.night), 1.5) * near * (1 - rain);
  out.birds = day * near * (1 - 0.85 * rain) * (0.35 + 0.65 * dawn);
  out.rainHiss = 0.075 * Math.pow(rain, 0.8) * (0.6 + 0.4 * near);
  out.thunder = smoothstep(0.55, 0.9, rain);
  return out;
}

export function emptyAmbienceMix(): AmbienceMix {
  return { air: 0, crickets: 0, birds: 0, rainHiss: 0, thunder: 0 };
}

// ---------------------------------------------------------------------------------------------
// Waterfalls
// ---------------------------------------------------------------------------------------------

/** Structurally a subset of the dressing's WaterfallPlan, so plans can be passed straight in. */
export interface FallSource {
  /** Where the water leaves the rim. */
  lip: Vec3Like;
  /** Horizontal outward direction at the lip. */
  outX: number;
  outZ: number;
  /** How far the ribbon falls (m). */
  drop: number;
  /** Fall half-width (m), bigger falls are louder. */
  width: number;
}

export interface FallHearing {
  /** Linear gain of the nearest audible fall, 0 if none. */
  gain: number;
  /** World point the roar comes from (on the fall's column). */
  x: number;
  y: number;
  z: number;
}

/**
 * The loudest waterfall from `p`: each fall is treated as a vertical column from the lip down
 * most of its drop (displaced outward, roughly where the water hangs), heard by inverse distance.
 */
export function loudestFall(p: Vec3Like, falls: readonly FallSource[], out: FallHearing): FallHearing {
  out.gain = 0;
  for (const f of falls) {
    const top = f.lip.y;
    const bottom = top - f.drop * 0.7;
    const y = Math.max(bottom, Math.min(top, p.y));
    // The ribbon drifts outward as it falls; ~6 m out by mid-drop is close enough for sound.
    const outD = 2 + 6 * clamp01((top - y) / Math.max(1, f.drop * 0.35));
    const x = f.lip.x + f.outX * outD;
    const z = f.lip.z + f.outZ * outD;
    const d = Math.hypot(p.x - x, p.y - y, p.z - z);
    const size = 0.6 + 0.4 * clamp01(f.width / 6);
    const g = size * (35 / Math.max(35, d)) * (1 - smoothstep(320, 520, d));
    if (g > out.gain) {
      out.gain = g;
      out.x = x;
      out.y = y;
      out.z = z;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Event scaling
// ---------------------------------------------------------------------------------------------

/** Reference breed mass (kg): a harrier-sized wyvern plays the wingbeat at its natural pitch. */
export const REF_MASS = 650;

/**
 * Wingbeat character from beat strength and breed mass: heavier wyverns beat lower and louder,
 * lighter ones higher and snappier.
 */
export function wingbeatParams(strength: number, mass: number): { gain: number; pitch: number; length: number } {
  const s = clamp01(strength);
  const m = Math.max(200, mass) / REF_MASS;
  return {
    gain: (0.25 + 0.75 * s) * Math.min(1.35, Math.pow(m, 0.5)),
    pitch: Math.pow(m, -0.45),
    length: 0.85 + 0.25 * Math.min(1.6, m),
  };
}

/** Touchdown thud weight (0..1) from sink speed (m/s). */
export function touchdownWeight(impact: number): number {
  return 0.25 + 0.75 * smoothstep(0.5, 6.5, impact);
}

/** Terrain hit loudness (0..1) from the velocity lost (m/s). */
export function impactWeight(impulse: number): number {
  return smoothstep(0.5, 14, impulse);
}
