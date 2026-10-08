// Rigid-body flight. (Baseline implementation; the flight module owner refines it but keeps the
// public surface: constructor(breed), state, setBreed, reset, step.)

import { Quaternion, Vector3 } from 'three';
import type { BreedStats, FlightEnvironment, FlightInput, FlightState } from '../core/types';
import type { GameEventBus } from '../core/events';
import { clamp, clamp01, damp } from '../core/math';

export const GRAVITY = 9.81;
export const AIR_DENSITY = 1.1;

export interface FlightStepResult {
  contact: boolean;
  contactNormal: Vector3;
  /** Speed lost into the surface this step (m/s). */
  impact: number;
}

const fwd = new Vector3();
const up = new Vector3();
const left = new Vector3();
const airVel = new Vector3();
const wind = new Vector3();
const force = new Vector3();
const tmp = new Vector3();
const push = new Vector3();
const normal = new Vector3();
const dq = new Quaternion();
const axis = new Vector3();

export function createFlightState(): FlightState {
  return {
    position: new Vector3(),
    velocity: new Vector3(),
    orientation: new Quaternion(),
    angularVelocity: new Vector3(),
    stamina: 1,
    winded: false,
    flapPhase: 0,
    flapStrength: 0,
    wingSpread: 1,
    flare: 0,
    stall: 0,
    airspeed: 0,
    angleOfAttack: 0,
    gLoad: 1,
    timeSinceContact: 99,
  };
}

export class FlightModel {
  breed: BreedStats;
  state: FlightState = createFlightState();
  private result: FlightStepResult = { contact: false, contactNormal: new Vector3(), impact: 0 };
  private flapping = false;

  constructor(breed: BreedStats) {
    this.breed = breed;
  }

  setBreed(breed: BreedStats): void {
    this.breed = breed;
  }

  reset(position: Vector3, orientation: Quaternion, velocity?: Vector3): void {
    const s = this.state;
    s.position.copy(position);
    s.orientation.copy(orientation);
    s.velocity.copy(velocity ?? new Vector3(0, 0, 20).applyQuaternion(orientation));
    s.angularVelocity.set(0, 0, 0);
    s.flapPhase = 0;
    s.flapStrength = 0;
    s.stall = 0;
    s.timeSinceContact = 99;
  }

  step(dt: number, input: FlightInput, env: FlightEnvironment, events?: GameEventBus): FlightStepResult {
    const b = this.breed;
    const s = this.state;
    fwd.set(0, 0, 1).applyQuaternion(s.orientation);
    up.set(0, 1, 0).applyQuaternion(s.orientation);
    left.set(1, 0, 0).applyQuaternion(s.orientation);

    env.windAt(s.position, wind);
    airVel.copy(s.velocity).sub(wind);
    const V = airVel.length();
    s.airspeed = V;

    // Wing configuration.
    s.wingSpread = damp(s.wingSpread, 1 - 0.72 * input.tuck, 6, dt);
    s.flare = damp(s.flare, input.flare, 5, dt);
    const area = b.wingArea * (0.25 + 0.75 * s.wingSpread);

    // Angle of attack in the body's symmetry plane.
    const vf = airVel.dot(fwd);
    const vu = airVel.dot(up);
    const alpha = Math.atan2(-vu, Math.max(1e-3, vf)) + s.flare * 0.25;
    s.angleOfAttack = alpha;
    const stallT = clamp01((Math.abs(alpha) - b.stallAngle) / (8 * Math.PI / 180));
    s.stall = damp(s.stall, stallT, 8, dt);
    let cl = clamp(b.liftSlope * alpha, -b.clMax, b.clMax) * (1 - 0.65 * s.stall);
    const q = 0.5 * AIR_DENSITY * V * V;

    force.set(0, -GRAVITY * b.mass, 0);
    if (V > 0.5) {
      // Lift: perpendicular to the airflow, in the plane of airflow and the wing's up axis.
      tmp.copy(airVel).multiplyScalar(1 / V);
      const liftDir = up.clone().addScaledVector(tmp, -up.dot(tmp)).normalize();
      force.addScaledVector(liftDir, q * area * cl);
      const cd = b.cd0 * (0.6 + 0.4 * s.wingSpread) + b.inducedK * cl * cl + s.flare * 0.55 + s.stall * 0.3;
      const bodyDragArea = 1.1;
      force.addScaledVector(tmp, -(q * area * cd + q * bodyDragArea * 0.5));
    }

    // Flapping.
    const wantsFlap = input.flap > 0.1 && !s.winded;
    if (input.flap > 0.1 && s.winded) events?.emit('flapRefused', {});
    if (wantsFlap || (this.flapping && s.flapPhase < 0.999)) {
      const prev = s.flapPhase;
      s.flapPhase += b.flapRate * dt;
      if (prev < 0.5 && s.flapPhase >= 0.5) events?.emit('flap', { strength: s.flapStrength, position: s.position });
      if (s.flapPhase >= 1) {
        s.flapPhase = wantsFlap ? s.flapPhase - 1 : 0;
        this.flapping = wantsFlap;
      } else this.flapping = true;
      const stroke = s.flapPhase < 0.5 ? Math.sin(s.flapPhase * Math.PI * 2) : -0.15 * Math.sin((s.flapPhase - 0.5) * Math.PI * 2);
      const power = Math.max(input.flap, 0.6);
      force.addScaledVector(fwd, b.flapThrust * stroke * power * 1.6);
      force.addScaledVector(up, b.flapLift * stroke * power * 1.6);
      s.stamina -= dt / b.staminaSeconds;
      s.flapStrength = damp(s.flapStrength, power, 6, dt);
    } else {
      s.flapStrength = damp(s.flapStrength, 0, 3, dt);
      s.stamina += b.staminaRegen * dt;
    }
    s.stamina = clamp01(s.stamina);
    if (s.stamina <= 0) s.winded = true;
    if (s.winded && s.stamina > 0.35) s.winded = false;

    // Linear integration.
    s.velocity.addScaledVector(force, dt / b.mass);
    s.gLoad = force.clone().add(tmp.set(0, GRAVITY * b.mass, 0)).dot(up) / (b.mass * GRAVITY);
    s.position.addScaledVector(s.velocity, dt);

    // Rotation: control torques scale with dynamic pressure, aerodynamic stability turns the
    // nose into the airflow.
    const authority = clamp(V / 22, 0.15, 1.6) * (0.4 + 0.6 * s.wingSpread);
    const w = s.angularVelocity;
    w.x += (-input.pitch * b.pitchAuthority * authority) * dt;
    w.z += (input.roll * b.rollAuthority * authority) * dt;
    w.y += (-input.yaw * b.yawAuthority * authority) * dt;
    if (V > 2) {
      // Weathervane: torque toward the velocity vector.
      const sideslip = airVel.dot(left) / V;
      w.y += sideslip * 2.2 * authority * dt * 6;
      w.x -= (vu / V) * 1.8 * authority * dt * 6;
    }
    // Stall drops the nose.
    w.x += s.stall * 2.5 * dt;
    w.multiplyScalar(Math.exp(-b.angularDamping * dt));
    w.z = clamp(w.z, -b.maxRollRate, b.maxRollRate);
    const angle = w.length() * dt;
    if (angle > 1e-6) {
      axis.copy(w).normalize();
      dq.setFromAxisAngle(axis, angle);
      s.orientation.multiply(dq).normalize();
    }

    // Terrain contact.
    const r = this.result;
    r.contact = false;
    r.impact = 0;
    s.timeSinceContact += dt;
    if (env.terrain.collideSphere(s.position, 2.4, push, normal)) {
      s.position.add(push);
      const vn = s.velocity.dot(normal);
      if (vn < 0) {
        s.velocity.addScaledVector(normal, -vn * 1.25);
        r.impact = -vn;
      }
      s.velocity.multiplyScalar(0.985);
      r.contact = true;
      r.contactNormal.copy(normal);
      s.timeSinceContact = 0;
    }
    return r;
  }
}
