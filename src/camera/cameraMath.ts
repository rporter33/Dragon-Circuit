// Pure camera maths, unit-tested: boom pull-in against terrain, auto-follow, speed FOV,
// critically damped offset decay, framing distances and lens shift.

import { angleDelta, clamp, damp, smoothstep } from '../core/math';

export const BOOM = {
  /** How fast the boom shortens toward a nearer obstacle (1/s). */
  pullIn: 14,
  /** How fast it lengthens back once clear (1/s). Slow, so it never pumps in and out. */
  easeOut: 1.8,
};

/**
 * One step of the camera boom (distance from the pivot to the camera) against terrain.
 *  - `hardLimit`: the camera would be inside rock beyond this; the result never exceeds it
 *    (the boom snaps in — clipping is worse than a quick move).
 *  - `softLimit`: something blocks the view beyond this but the camera itself is clear; the
 *    boom eases in toward it instead of snapping (thin spires flicking past shouldn't pop).
 *  - otherwise it eases back out to `desired`.
 */
export function boomStep(
  current: number,
  desired: number,
  hardLimit: number,
  softLimit: number,
  dt: number,
  pullIn = BOOM.pullIn,
  easeOut = BOOM.easeOut,
): number {
  if (!(current >= 0)) current = desired;
  const goal = Math.min(desired, softLimit, hardLimit);
  let next = damp(current, goal, goal < current ? pullIn : easeOut, dt);
  if (next > hardLimit) next = hardLimit;
  return Math.max(0, next);
}

/**
 * Third-person auto-follow: turn the camera's facing yaw gently toward the direction of travel.
 * Uses sin(angle), so strafing turns the camera most, while running straight at the camera
 * (angle ≈ π) leaves it alone instead of whipping it round.
 */
export function autoFollowYaw(camYaw: number, moveYaw: number, rate: number, dt: number): number {
  return camYaw + Math.sin(angleDelta(camYaw, moveYaw)) * rate * dt;
}

/** Degrees added to the base FOV for airspeed and a tucked dive: 0 slow, +18 at ~80 m/s tucked. */
export function speedFovKick(airspeed: number, tuck: number): number {
  return 16 * smoothstep(22, 80, airspeed) + 2 * clamp(tuck, 0, 1) * smoothstep(15, 60, airspeed);
}

/** State of a critically damped spring decaying toward zero. */
export interface SpringState {
  x: number;
  v: number;
}

/**
 * Exact step of a critically damped spring toward 0 (no overshoot). With v = 0 it starts
 * gently and settles in roughly 4.7/omega seconds — an ease-in-out for transition offsets.
 */
export function springDecay(s: SpringState, omega: number, dt: number): void {
  if (!(dt > 0)) return;
  const e = Math.exp(-omega * dt);
  const k = (s.v + omega * s.x) * dt;
  s.x = (s.x + k) * e;
  s.v = (s.v - omega * k) * e;
}

/**
 * Distance at which a sphere of `radius` fills the available frame. `frameW`/`frameH` are the
 * fractions of the half-width / half-height the subject may use (e.g. 0.6 when a UI panel
 * covers the left 40% and the optical centre is shifted into the remaining 60%).
 */
export function fitDistance(radius: number, vfovDeg: number, aspect: number, frameW: number, frameH: number): number {
  const tv = Math.tan((vfovDeg * Math.PI) / 360);
  const half = Math.atan(Math.min(tv * frameH, tv * aspect * frameW));
  return radius / Math.sin(Math.max(1e-3, half));
}

/**
 * PerspectiveCamera.filmOffset that moves the optical centre to screen x = 0.5 + shift
 * (fraction of the width). Lens shift keeps perspective natural (no off-axis aiming), so a
 * subject framed on the axis simply appears off-centre. Matches three.js updateProjectionMatrix.
 */
export function filmOffsetForShift(shift: number, vfovDeg: number, aspect: number, filmGauge = 35): number {
  const filmWidth = filmGauge * Math.min(aspect, 1);
  return -shift * 2 * Math.tan((vfovDeg * Math.PI) / 360) * aspect * filmWidth;
}

/** Ease a look offset back to 0 once the player has left the stick alone for `delay` seconds. */
export function lookReturn(offset: number, idle: number, delay: number, rate: number, dt: number): number {
  return idle > delay ? damp(offset, 0, rate, dt) : offset;
}

/**
 * One step of an UNDERdamped spring toward 0 (ζ < 1 rings once: a dip, then a small lift past
 * rest). Sub-stepped semi-implicit Euler, stable for any frame time. In place.
 */
export function springStep(s: SpringState, omega: number, zeta: number, dt: number): void {
  if (!(dt > 0)) return;
  const n = Math.max(1, Math.ceil(dt * 240));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (-omega * omega * s.x - 2 * zeta * omega * s.v) * h;
    s.x += s.v * h;
  }
}

/**
 * The wingbeat heave for a breed: how far (m, per metre of camera distance) and how slowly the
 * camera dips under a full downstroke. Heavier bodies heave further and slower; the spring rings
 * once, so the dip is followed by a small lift — a big body carried on each beat.
 */
export function heaveFor(mass: number): { amplitude: number; omega: number; zeta: number } {
  const m = Math.max(100, mass) / 650;
  return {
    amplitude: 0.021 * Math.sqrt(m),
    omega: 2 * Math.PI * 1.45 / Math.sqrt(m),
    zeta: 0.42,
  };
}
