import { Vector3 } from 'three';
import { SkyLance } from './SkyLance';
import type { SweepWorld } from './sweep';
import { LANCE as T } from './tuning';
export interface TargetPreview {
  state: 'reachable' | 'blocked' | 'out-of-range';
  point: Vector3;
  distance: number;
  anchorId: string | null;
}
/** Presentation-only forecast, using the real fixed-step projectile and first-solid validation.
 * Assumes the current harness position; future steering/motion can change actual reachability.
 * At most 240 projectile steps; never mutates the live equipment or rider. */
export function predictTarget(world: SweepWorld, origin: Vector3, aim: Vector3, velocity: Vector3): TargetPreview {
  const probe = new SkyLance(world);
  if (!probe.throw(origin,aim,velocity)) return {state:'blocked',point:origin.clone(),distance:0,anchorId:null};
  for (let i=0;i<Math.ceil(T.maxFlight*120)&&probe.state==='projectile';i++) probe.step(1/120,origin);
  return {
    state: probe.rope ? 'reachable' : probe.reason === 'Missed' || (probe.reason === 'Out of tether range' && probe.position.distanceTo(origin) >= T.minLength) ? 'out-of-range' : 'blocked',
    point: probe.position.clone(),distance:probe.position.distanceTo(origin),anchorId:probe.anchorId,
  };
}
