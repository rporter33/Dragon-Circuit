// A simple autopilot that flies the real FlightModel along a race course. Tests use it to prove
// every course can be flown and that the medal times are honest; the race showcase uses it to
// stage ghosts and ring sequences.
//
// It flies the way a decent player would: a smooth line through every ring along the ring's
// facing (a Hermite path), tracked by pure pursuit of a point a second or so ahead, banking to
// turn, flapping to hold pace within the stamina budget, braking for bends it's too fast for,
// tucking into long dives and circling in thermals where the route says to climb. It makes no
// attempt at a perfect line, so a skilled player should beat it.

import { Vector3 } from 'three';
import type { FlightInput, FlightState } from '../core/types';
import type { FlightDerived } from '../flight/FlightModel';
import { clamp, clamp01, DEG, wrapAngle } from '../core/math';

export interface PathNode {
  position: Vector3;
  /** Direction of travel through the node (unit). */
  tangent: Vector3;
  /** Circle here (a thermal) until this altitude before moving on. */
  climbTo?: number;
}

/** A smooth path through nodes (cubic Hermite), sampled into a polyline with arc length. */
export class CoursePath {
  readonly nodes: PathNode[];
  /** Arc length at each node. */
  readonly nodeS: number[] = [];
  private px: number[] = [];
  private py: number[] = [];
  private pz: number[] = [];
  private s: number[] = [];

  constructor(nodes: PathNode[], spacing = 2) {
    this.nodes = nodes;
    const a = new Vector3();
    const p = new Vector3();
    let total = 0;
    for (let i = 0; i < nodes.length; i++) {
      this.nodeS.push(total);
      if (i === nodes.length - 1) {
        this.push(nodes[i].position, total);
        // Run on past the last node so pursuit has somewhere to look.
        for (let k = 1; k <= 40; k++) this.push(p.copy(nodes[i].position).addScaledVector(nodes[i].tangent, k * 5), total + k * 5);
        break;
      }
      const P0 = nodes[i].position;
      const P1 = nodes[i + 1].position;
      const len = P0.distanceTo(P1);
      const m0 = nodes[i].tangent.clone().multiplyScalar(len);
      const m1 = nodes[i + 1].tangent.clone().multiplyScalar(len);
      const n = Math.max(2, Math.ceil(len / spacing));
      a.copy(P0);
      for (let k = 0; k < n; k++) {
        const u = k / n;
        const u2 = u * u;
        const u3 = u2 * u;
        p.copy(P0)
          .multiplyScalar(2 * u3 - 3 * u2 + 1)
          .addScaledVector(m0, u3 - 2 * u2 + u)
          .addScaledVector(P1, -2 * u3 + 3 * u2)
          .addScaledVector(m1, u3 - u2);
        total += p.distanceTo(a);
        this.push(p, total);
        a.copy(p);
      }
      total += a.distanceTo(P1);
    }
  }

  private push(p: Vector3, s: number): void {
    this.px.push(p.x);
    this.py.push(p.y);
    this.pz.push(p.z);
    this.s.push(s);
  }

  get length(): number {
    return this.s[this.s.length - 1];
  }

  private index(s: number): number {
    // Binary search for the last sample at or before s.
    let lo = 0;
    let hi = this.s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.s[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  pointAt(s: number, out: Vector3): Vector3 {
    const i = this.index(Math.max(0, s));
    const j = Math.min(i + 1, this.s.length - 1);
    const span = this.s[j] - this.s[i];
    const u = span > 1e-6 ? clamp01((s - this.s[i]) / span) : 0;
    return out.set(this.px[i] + (this.px[j] - this.px[i]) * u, this.py[i] + (this.py[j] - this.py[i]) * u, this.pz[i] + (this.pz[j] - this.pz[i]) * u);
  }

  /**
   * Arc length of the closest sample to p within [s0, s1], measured mostly horizontally: a rider
   * far below a climbing line is still "at" the part of the line above them.
   */
  closest(p: Vector3, s0: number, s1: number): number {
    const i0 = this.index(Math.max(0, s0));
    const i1 = this.index(Math.max(0, s1));
    let best = Infinity;
    let bestS = this.s[i0];
    for (let i = i0; i <= i1; i++) {
      const d = (this.px[i] - p.x) ** 2 + 0.06 * (this.py[i] - p.y) ** 2 + (this.pz[i] - p.z) ** 2;
      if (d < best) {
        best = d;
        bestS = this.s[i];
      }
    }
    return bestS;
  }

  /** Largest horizontal curvature (1/m) of the path between s0 and s1. */
  maxCurvature(s0: number, s1: number, step = 12): number {
    let k = 0;
    for (let s = s0; s < s1; s += step) {
      this.pointAt(s, _a);
      this.pointAt(s + step, _b);
      this.pointAt(s + 2 * step, _c);
      const h1 = Math.atan2(_b.x - _a.x, _b.z - _a.z);
      const h2 = Math.atan2(_c.x - _b.x, _c.z - _b.z);
      const d = Math.hypot(_c.x - _b.x, _c.z - _b.z);
      if (d > 1e-3) k = Math.max(k, Math.abs(wrapAngle(h2 - h1)) / d);
    }
    return k;
  }
}

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();

export interface AutopilotTuning {
  /** Steepest bank it will hold (rad). */
  maxBank: number;
  /** Pursuit look-ahead: seconds of flight, clamped to [min, max] meters. */
  lookAheadTime: number;
  lookAheadMin: number;
  lookAheadMax: number;
  /** Dive with folded wings when the line is this steep (rad, negative). */
  tuckBelow: number;
  /** Orbit radius when circling in a thermal (m). */
  orbitRadius: number;
  /** Flap to hold at least this airspeed (m/s). */
  paceSpeed: number;
}

export const AUTOPILOT_DEFAULTS: AutopilotTuning = {
  maxBank: 62 * DEG,
  lookAheadTime: 2.0,
  lookAheadMin: 35,
  lookAheadMax: 100,
  tuckBelow: -22 * DEG,
  orbitRadius: 26,
  paceSpeed: 40,
};

const _left = new Vector3();
const _up = new Vector3();
const _carrot = new Vector3();

export class Autopilot {
  tuning: AutopilotTuning;
  /** Progress along the path (m). */
  s = 0;
  private gammaInt = 0;
  private resting = false;
  private prevGamma: number | null = null;
  /** Index of the climb node being circled at (or -1), and the ones already climbed. */
  private circlingNode = -1;
  private climbed = new Set<number>();
  /** Height progress check while circling: give up on a thermal that has stopped working. */
  private circleCheckT = 0;
  private circleCheckY = 0;

  constructor(
    readonly path: CoursePath,
    tuning: Partial<AutopilotTuning> = {},
  ) {
    this.tuning = { ...AUTOPILOT_DEFAULTS, ...tuning };
  }

  /** Progress can't run past this (the next ring not yet flown through, plus a little). */
  private maxS = Infinity;
  /** While going round after a miss: the point on the line to come back to. */
  private recoverS: number | null = null;

  /** Hold progress at the next ring (at arc length `s`) until it's flown through. */
  holdAt(s: number): void {
    this.maxS = s + 20;
  }

  /** A missed ring at arc length `ringS`: loop back to well before it and fly the approach again. */
  goAround(ringS: number): void {
    this.recoverS = Math.max(0, ringS - 170);
    this.maxS = ringS + 20;
    this.gammaInt = 0;
  }

  get circling(): boolean {
    return this.circlingNode >= 0;
  }

  private updateClimb(p: Vector3): void {
    const path = this.path;
    if (this.circlingNode >= 0) {
      const i = this.circlingNode;
      this.circleCheckT += 1 / 120;
      if (this.circleCheckT > 20) {
        // Under 10 m in 20 s: this lift is spent (near the column's top); move on.
        if (p.y - this.circleCheckY < 10) this.circleCheckY = -Infinity;
        else this.circleCheckY = p.y;
        this.circleCheckT = 0;
      }
      if (p.y >= (path.nodes[i].climbTo ?? 0) || this.circleCheckY === -Infinity) {
        this.climbed.add(i);
        this.circlingNode = -1;
        this.s = path.nodeS[i];
      }
      return;
    }
    for (let i = 0; i < path.nodes.length; i++) {
      const n = path.nodes[i];
      if (n.climbTo === undefined || this.climbed.has(i)) continue;
      if (this.s >= path.nodeS[i] - 30 && Math.hypot(p.x - n.position.x, p.z - n.position.z) < 120) {
        if (p.y < n.climbTo) {
          this.circlingNode = i;
          this.circleCheckT = 0;
          this.circleCheckY = p.y;
        } else this.climbed.add(i);
      }
    }
  }

  /** Inputs for one step. `maxRollRate` is the breed's (stick = fraction of it). */
  steer(state: FlightState, derived: FlightDerived, maxRollRate: number, dt: number, out: FlightInput): FlightInput {
    const T = this.tuning;
    const path = this.path;
    const p = state.position;
    const v = state.velocity;
    const V = Math.max(1, v.length());
    const heading = Math.atan2(v.x, v.z);
    const gamma = Math.atan2(v.y, Math.hypot(v.x, v.z));
    _left.set(1, 0, 0).applyQuaternion(state.orientation);
    _up.set(0, 1, 0).applyQuaternion(state.orientation);
    const bank = Math.atan2(_left.y, _up.y);

    if (this.recoverS !== null) {
      path.pointAt(this.recoverS, _carrot);
      if (Math.hypot(_carrot.x - p.x, _carrot.z - p.z) < 45) {
        this.s = this.recoverS;
        this.recoverS = null;
      }
    }
    if (this.circlingNode < 0 && this.recoverS === null) this.s = path.closest(p, this.s - 15, Math.min(this.s + 90, this.maxS));
    this.updateClimb(p);
    const circling = this.circlingNode >= 0;

    let turnRate: number;
    let gammaCmd = 0;
    let vLimit = Infinity;
    if (circling) {
      // Orbit the thermal core in a left-hand turn (heading increasing), pulled in toward the
      // orbit radius: the tangent of that orbit at radial direction u is (u.z, −u.x).
      const c = path.nodes[this.circlingNode].position;
      const rx = p.x - c.x;
      const rz = p.z - c.z;
      const r = Math.max(1e-3, Math.hypot(rx, rz));
      const tangent = Math.atan2(rz / r, -rx / r);
      const desired = tangent + clamp((r - T.orbitRadius) * 0.03, -0.9, 0.9);
      turnRate = clamp(wrapAngle(desired - heading) * 1.6 + V / Math.max(T.orbitRadius, r), -1.2, 1.2);
    } else {
      // Pure pursuit of a carrot on the line ahead (or of the point to come back to).
      const L = clamp(V * T.lookAheadTime, T.lookAheadMin, T.lookAheadMax);
      if (this.recoverS !== null) path.pointAt(this.recoverS, _carrot);
      else path.pointAt(this.s + L, _carrot);
      const dx = _carrot.x - p.x;
      const dz = _carrot.z - p.z;
      const dh = Math.max(1, Math.hypot(dx, dz));
      const err = wrapAngle(Math.atan2(dx, dz) - heading);
      turnRate = (2 * V * Math.sin(err)) / Math.max(dh, L * 0.5);
      // Climb only as steeply as the energy allows; dive as steeply as is useful.
      const canFlap = !this.resting && !state.winded && state.stamina > 0.25;
      const surplus = clamp01((V - 0.95 * derived.vCruise) / (0.8 * derived.vCruise));
      const climbable = 3 * DEG + 30 * DEG * surplus + (canFlap ? 6 * DEG : 0);
      gammaCmd = clamp(Math.atan2(_carrot.y - p.y, dh), -50 * DEG, climbable);
      // Slow down for the tightest bend in the next few seconds.
      const k = path.maxCurvature(this.s, this.s + Math.max(60, V * 3.5));
      if (k > 1e-4) vLimit = Math.sqrt((9.81 * Math.tan(T.maxBank * 0.8)) / k);
    }
    const maxTurn = (9.81 * Math.tan(T.maxBank)) / V;
    turnRate = clamp(turnRate, -maxTurn, maxTurn);

    // Lateral: coordinated bank for the turn rate (positive bank = right; right turns lower the
    // heading), leading the bank by the roll rate so heavy breeds don't overshoot and wallow.
    const bankCmd = clamp(-Math.atan((turnRate * V) / 9.81), -T.maxBank, T.maxBank);
    const bankLead = bank + state.angularVelocity.z * 0.45;
    out.roll = clamp((2.0 * (bankCmd - bankLead)) / maxRollRate, -1, 1);
    out.yaw = 0;

    // Longitudinal.
    const loadFF = 0.38 * (1 / Math.max(0.35, Math.cos(bank)) - 1);
    if (circling) {
      // Hold a slow, efficient airspeed and let the rising air do the climbing.
      // Rising air swings the angle of attack, so damp the flight-path rate as well.
      const vTarget = (1.25 * derived.vStall) / Math.sqrt(Math.max(0.35, Math.cos(bank)));
      const gammaRate = this.prevGamma === null ? 0 : (gamma - this.prevGamma) / dt;
      out.pitch = clamp(0.14 * (state.airspeed - vTarget) + loadFF - 0.5 * gammaRate - 1.5 * Math.max(0, gamma - 0.3), -0.6, 0.85);
      this.gammaInt = 0;
    } else {
      const err = gammaCmd - gamma;
      this.gammaInt = clamp(this.gammaInt + err * dt, -0.6, 0.6);
      const gammaRate = this.prevGamma === null ? 0 : (gamma - this.prevGamma) / dt;
      out.pitch = clamp(2.2 * err + 0.6 * this.gammaInt - 0.5 * gammaRate + loadFF, -1, 0.9);
    }
    this.prevGamma = gamma;
    const slow = state.airspeed < 1.2 * derived.vStall;
    if (state.stall > 0.05 || slow) out.pitch = Math.min(out.pitch, slow ? -0.1 : 0);

    // Flap: racing pace. Beat whenever stamina allows and there's speed to gain (or height to
    // find), rest when tired (with hysteresis); the sustainable duty is about half the time.
    if (state.winded || state.stamina < 0.12) this.resting = true;
    else if (state.stamina > 0.45) this.resting = false;
    const wantSpeed = state.airspeed < Math.min(T.paceSpeed, vLimit);
    const needClimb = gammaCmd > gamma - 2 * DEG && gammaCmd > -4 * DEG;
    // Circling, the thermal does the work: beats only keep the speed up.
    out.flap = circling ? (state.airspeed < 1.1 * derived.vStall && !state.winded ? 1 : 0) : (!this.resting && (wantSpeed || needClimb)) || (slow && !state.winded) ? 1 : 0;

    // Tuck into steep dives while no bend is coming. (No air-braking: a flare's extra lift would
    // throw the line upward; easing off the flaps is how it slows for bends.)
    out.tuck = !circling && gammaCmd < T.tuckBelow && state.airspeed < Math.min(80, vLimit - 5) && Math.abs(bankCmd - bank) < 0.35 ? 1 : 0;
    out.flare = 0;
    return out;
  }
}
