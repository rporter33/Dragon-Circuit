// Pure helpers behind the effects: how strong each effect is for a given flight state, dust
// palettes per surface, ring-plane bases, the wrap math the streak shaders use. No three.js
// scene objects here, so the tuning is unit-tested.

import { clamp01, smoothstep } from '../core/math';
import type { SurfaceKind } from '../core/types';

/** Airspeed (m/s) where speed lines start to appear. */
export const SPEED_LINES_FROM = 40;

/** Grade speed blur (0..1) from airspeed and tuck. Zero on the ground and with reduced motion. */
export function speedBlurTarget(airspeed: number, tuck: number, flying: boolean, reducedMotion: boolean): number {
  if (!flying || reducedMotion) return 0;
  return smoothstep(42, 85, airspeed) * (0.55 + 0.45 * clamp01(tuck)) * 0.85;
}

/** Speed line opacity (0..1). */
export function speedLineAmount(airspeed: number, flying: boolean): number {
  if (!flying) return 0;
  return smoothstep(SPEED_LINES_FROM, SPEED_LINES_FROM + 32, airspeed);
}

/** Cloud wisps streaking past: high speed, more of them low over the cloud sea or in mist. */
export function wispAmount(airspeed: number, altitude: number, mist: number, flying: boolean): number {
  if (!flying) return 0;
  const speed = smoothstep(44, 78, airspeed);
  const low = 1 - smoothstep(120, 420, altitude);
  return speed * clamp01(0.35 + 0.65 * Math.max(low, clamp01(mist)));
}

/** Wingtip vortex visibility (0..1): at speed, or when pulling hard. */
export function trailIntensity(airspeed: number, gLoad: number, flying: boolean): number {
  if (!flying) return 0;
  const speed = smoothstep(30, 62, airspeed);
  const pull = smoothstep(1.9, 3.4, gLoad) * smoothstep(12, 22, airspeed);
  return clamp01(Math.max(speed * 0.85, pull));
}

/**
 * Wingtip vortices a wingbeat sheds (0..1): a burst over the end of the downstroke, where the
 * tips sweep fastest (flap phase 0.6..1.1 of the downstroke's share of the cycle, so it follows
 * the breed's stroke timing), scaled by the beat's strength and the animal's mass (a heavy breed
 * moves more air). Below ~10 m/s (hover, takeoff) the downwash goes into dust and spray instead.
 */
export function flapTrailBurst(flapPhase: number, flapStrength: number, downFrac: number, massFactor: number, airspeed: number): number {
  if (!(flapStrength > 0)) return 0;
  const p = flapPhase / Math.max(0.2, downFrac);
  const env = smoothstep(0.6, 0.8, p) * (1 - smoothstep(0.95, 1.1, p));
  return clamp01(env * clamp01(flapStrength) * massFactor * smoothstep(10, 16, airspeed));
}

/** The floor the tip vortices keep while the wings work at speed, so each beat leaves a thread. */
export function flapTrailFloor(flapStrength: number, airspeed: number): number {
  return 0.2 * smoothstep(0.05, 0.25, flapStrength) * smoothstep(13, 17, airspeed);
}

/** Wing-loading factor of a breed for its air effects: sqrt of its mass against the harrier's. */
export function breedMassFactor(mass: number): number {
  return Math.min(1.25, Math.max(0.8, Math.sqrt(Math.max(0, mass) / 650)));
}

/**
 * A wingbeat's downwash on the cloud sea (0..1): full within about a span and a quarter of the
 * billows, gone past 3 spans (the cloud floor keeps a flier 10-25 m over the tops, so the jet of
 * a big wing is given a generous reach).
 */
export function seaDownwashAmount(heightAboveSea: number, wingspan: number, strength: number): number {
  if (!Number.isFinite(heightAboveSea) || heightAboveSea < -2) return 0;
  return clamp01(strength) * (1 - smoothstep(1.25 * wingspan, 3 * wingspan, heightAboveSea));
}

/** Ground-effect dust from a wingbeat: strong close to the ground, nothing above ~2.5 spans. */
export function flapDustAmount(heightAboveGround: number, wingspan: number, strength: number): number {
  if (!Number.isFinite(heightAboveGround) || heightAboveGround < -1) return 0;
  return clamp01(strength) * (1 - smoothstep(0.35 * wingspan, 1.6 * wingspan, heightAboveGround));
}

/** Particle count for an effect, scaled by the quality profile (at least `min` if base > 0). */
export function scaledCount(base: number, particles: number, min = 1): number {
  if (base <= 0 || particles <= 0) return 0;
  return Math.max(min, Math.round(base * particles));
}

export type Rgb = [number, number, number];

/** Dust colors per surface (linear-ish sRGB values; two tones to mix between). */
export const SURFACE_DUST: Record<SurfaceKind, { a: Rgb; b: Rgb; bits: Rgb }> = {
  grass: { a: [0.78, 0.76, 0.6], b: [0.62, 0.66, 0.46], bits: [0.36, 0.55, 0.22] },
  dirt: { a: [0.66, 0.54, 0.4], b: [0.52, 0.42, 0.32], bits: [0.38, 0.29, 0.2] },
  rock: { a: [0.7, 0.68, 0.64], b: [0.56, 0.55, 0.53], bits: [0.42, 0.41, 0.4] },
  stone: { a: [0.8, 0.78, 0.74], b: [0.66, 0.64, 0.6], bits: [0.5, 0.48, 0.45] },
  sand: { a: [0.88, 0.8, 0.62], b: [0.78, 0.68, 0.5], bits: [0.7, 0.6, 0.42] },
  wood: { a: [0.8, 0.74, 0.62], b: [0.68, 0.6, 0.48], bits: [0.55, 0.4, 0.25] },
};

/**
 * Two unit vectors spanning the plane perpendicular to (nx, ny, nz). Writes [ux,uy,uz,vx,vy,vz].
 * Stable for any normal (picks the least-aligned helper axis).
 */
export function planeBasis(nx: number, ny: number, nz: number, out: Float32Array | number[]): void {
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  // Helper axis: whichever world axis is least parallel to n.
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  let hx = 0;
  let hy = 0;
  let hz = 0;
  if (ax <= ay && ax <= az) hx = 1;
  else if (ay <= az) hy = 1;
  else hz = 1;
  // u = normalize(h × n), v = n × u
  let ux = hy * nz - hz * ny;
  let uy = hz * nx - hx * nz;
  let uz = hx * ny - hy * nx;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  out[0] = ux;
  out[1] = uy;
  out[2] = uz;
  out[3] = ny * uz - nz * uy;
  out[4] = nz * ux - nx * uz;
  out[5] = nx * uy - ny * ux;
}

/**
 * The streak shaders keep a fixed population of air-borne streaks around the camera by wrapping
 * each streak's position into a box that travels with the camera: local = mod(seed·box − travel,
 * box) − box/2. Mirrored here for tests (GLSL mod: x − y·floor(x/y)).
 */
export function wrapLocal(seed01: number, travel: number, box: number): number {
  const x = seed01 * box - travel;
  return x - box * Math.floor(x / box) - box / 2;
}

/** Exponential decay of a flash value toward 0 (rate per second). */
export function decay(v: number, rate: number, dt: number): number {
  return v * Math.exp(-rate * dt);
}

/** Breath puffs: true if the point is on/above cold ground (Highmoor's moor). */
export function isColdAir(x: number, y: number, z: number, moor: { x: number; y: number; z: number; radius: number } | null): boolean {
  if (!moor) return false;
  const d = Math.hypot(x - moor.x, z - moor.z);
  return d < moor.radius * 1.25 && y > moor.y - 40 && y < moor.y + 160;
}
