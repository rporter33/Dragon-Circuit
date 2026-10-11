import type { Vector3 } from 'three';
import { LANCE as T } from './tuning';
/** Rider-only aerodynamic descent limits, never applied to an attached swing. */
export function fallSpeed(tilt: number): number {
  const t = Math.max(-1, Math.min(1, tilt));
  return T.neutralFallSpeed + t * (t < 0 ? T.neutralFallSpeed - T.brakeFallSpeed : T.diveFallSpeed - T.neutralFallSpeed);
}
/** Applied after gravity. Implicit quadratic vertical drag approaches terminal speed without
 * snapping inherited release velocity. Horizontal resistance remains weak and independent.
 * Both terms dissipate kinetic energy; neither steers, pumps or supplies thrust. */
export function freefallDrag(velocity: Vector3, dt: number, horizontalDrag: number, terminalSpeed: number): void {
  const horizontal = 1 / (1 + horizontalDrag * Math.hypot(velocity.x, velocity.z) * dt);
  velocity.x *= horizontal; velocity.z *= horizontal;
  const speed = Math.abs(velocity.y), k = T.gravity / (terminalSpeed * terminalSpeed);
  // Strong descent braking must not erase the upward momentum of a swing release or boost.
  if (velocity.y < 0) velocity.y *= 2 / (1 + Math.sqrt(1 + 4 * k * dt * speed));
  else velocity.y /= 1 + T.diveDrag * speed * dt;
}
