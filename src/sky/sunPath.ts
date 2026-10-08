// Where the sun and moon are. Pure math so the day/night logic is unit-tested and the sky,
// lighting and anything else that wants "is it dark yet" agree on one answer.
//
// The sky turns on a simple celestial model: bodies ride circles tilted by a fixed latitude, so
// the sun rises in the east (+X), culminates over the south (-Z, the direction the Roost's launch
// deck faces) and sets in the west (-X). Time of day t: 0 midnight, 0.25 sunrise, 0.5 noon,
// 0.75 sunset.

import { Vector3 } from 'three';
import { DEG, TAU, clamp01, smoothstep } from '../core/math';

/** Observer latitude: the noon sun stands 90° − 34° = 56° high, so noon still casts shape. */
export const LATITUDE = 34 * DEG;
/**
 * The moon rides a higher circle than the sun (a summer full moon), so it is up from just before
 * sunset to just after sunrise and never exactly opposite the sun — dusk light never has to pick
 * between two directions 180° apart.
 */
const MOON_DECLINATION = 8 * DEG;

/**
 * Direction toward a body at hour angle `hour` (0 = due south and highest, radians) and
 * declination `decl`. World frame: east +X, up +Y, north +Z (south −Z).
 */
export function celestialDirection(hour: number, decl: number, out: Vector3): Vector3 {
  const sl = Math.sin(LATITUDE);
  const cl = Math.cos(LATITUDE);
  const sd = Math.sin(decl);
  const cd = Math.cos(decl);
  const ch = Math.cos(hour);
  const east = -cd * Math.sin(hour);
  const north = cl * sd - sl * cd * ch;
  const up = sl * sd + cl * cd * ch;
  return out.set(east, up, north).normalize();
}

/** Hour angle of the sun at time of day t. */
export function sunHourAngle(t: number): number {
  return (t - 0.5) * TAU;
}

export function sunDirection(t: number, out: Vector3): Vector3 {
  return celestialDirection(sunHourAngle(t), 0, out);
}

export function moonDirection(t: number, out: Vector3): Vector3 {
  return celestialDirection(sunHourAngle(t) + Math.PI, MOON_DECLINATION, out);
}

/**
 * 0 = the sun is the key light, 1 = the moon is. The handover happens in the blue hour, when
 * the palette has already dimmed the key light to almost nothing, so the swing is invisible.
 */
export function moonKeyWeight(sunY: number): number {
  return smoothstep(-0.01, -0.15, sunY);
}

/** 0 day … 1 night, from the sun's height. Emissives (lanterns, glowcaps) follow this. */
export function nightAmount(sunY: number): number {
  return smoothstep(0.06, -0.16, sunY);
}

/** Below this elevation (sin) the key light is lifted so it never shines up from under the world. */
const MIN_KEY_Y = 0.07;

/**
 * Direction of the key light that shades the world: the sun by day, the moon by night, passing
 * over the zenith during the handover. Never lower than a few degrees above the horizon.
 */
export function keyLightDirection(sun: Vector3, moon: Vector3, out: Vector3): Vector3 {
  const w = moonKeyWeight(sun.y);
  // Blend the two (elevation-lifted) directions; the bump toward the zenith keeps the blend away
  // from the degenerate midpoint of two nearly opposite vectors.
  const lift = Math.sin(Math.PI * w) * 0.9;
  out.set(
    sun.x * (1 - w) + moon.x * w,
    Math.max(sun.y, MIN_KEY_Y) * (1 - w) + Math.max(moon.y, MIN_KEY_Y) * w + lift,
    sun.z * (1 - w) + moon.z * w,
  );
  if (out.lengthSq() < 1e-8) out.set(0, 1, 0);
  out.normalize();
  if (out.y < MIN_KEY_Y) {
    // Re-normalize the horizontal part so the vector keeps unit length at the minimum height.
    const h = Math.hypot(out.x, out.z) || 1;
    const k = Math.sqrt(1 - MIN_KEY_Y * MIN_KEY_Y) / h;
    out.set(out.x * k, MIN_KEY_Y, out.z * k);
  }
  return out;
}

/**
 * How much the key light should be trusted to cast shadows: fades as the light body nears the
 * horizon (long, smeared shadows look wrong) and through the sun/moon handover.
 */
export function shadowStrength(sun: Vector3, moon: Vector3): number {
  const w = moonKeyWeight(sun.y);
  const sunPart = smoothstep(0.0, 0.14, sun.y) * (1 - w);
  const moonPart = smoothstep(0.03, 0.2, moon.y) * w;
  // Shadows fade out while the key light swings over from sun to moon.
  return clamp01((sunPart + moonPart) * (1 - 0.9 * Math.sin(Math.PI * w)));
}
