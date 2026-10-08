// Small scalar helpers shared by every module. No three.js import here so pure logic stays cheap.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (b === a ? 0 : (v - a) / (b - a));
export const remap = (v: number, a0: number, a1: number, b0: number, b1: number): number =>
  lerp(b0, b1, clamp01(invLerp(a0, a1, v)));

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/**
 * Frame-rate independent exponential approach. `rate` is roughly "fraction per second" in feel:
 * after 1/rate seconds the gap has closed by ~63%.
 */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Shortest signed difference from angle a to angle b. */
export const angleDelta = (a: number, b: number): number => wrapAngle(b - a);

/** Symmetric deadzone with rescale so output still reaches ±1. */
export function deadzone(v: number, dz: number): number {
  const a = Math.abs(v);
  if (a <= dz) return 0;
  return Math.sign(v) * clamp01((a - dz) / (1 - dz));
}

/** Expo-style response curve: k=0 linear, k=1 fully cubic. Keeps fine control near center. */
export function responseCurve(v: number, k: number): number {
  return (1 - k) * v + k * v * v * v;
}

/** Critically-damped spring step (scalar). Returns [newValue, newVelocity]. */
export function springStep(
  x: number,
  v: number,
  target: number,
  omega: number,
  dt: number,
): [number, number] {
  // Exact solution of a critically damped spring for one step.
  const f = 1 + 2 * dt * omega;
  const oo = omega * omega;
  const hoo = dt * oo;
  const hhoo = dt * hoo;
  const detInv = 1 / (f + hhoo);
  const detX = f * x + dt * v + hhoo * target;
  const detV = v + hoo * (target - x);
  return [detX * detInv, detV * detInv];
}

export function formatTime(ms: number): string {
  if (!Number.isFinite(ms)) return '--:--.--';
  const neg = ms < 0;
  ms = Math.abs(ms);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${neg ? '-' : ''}${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
