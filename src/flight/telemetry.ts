// Flight telemetry: scripted manoeuvres that measure how a breed actually flies. Used by the
// unit tests (to hold the handling targets) and by the tuning table in breeds.test.ts. Pure: no
// rendering, runs in node.

import { Euler, Quaternion, Vector3 } from 'three';
import type { BreedStats, FlightEnvironment, FlightInput, TerrainQuery } from '../core/types';
import { clamp, DEG } from '../core/math';
import { FlightModel } from './FlightModel';

export const SIM_DT = 1 / 120;

/** Terrain with nothing in it: open sky in every direction. */
export const OPEN_SKY: TerrainQuery = {
  groundAt: () => null,
  collideSphere: () => false,
  distance: () => 1e4,
  raycast: () => null,
};

/** Still air (or a steady wind) over the given terrain. */
export function stillAir(terrain: TerrainQuery = OPEN_SKY, wind = new Vector3()): FlightEnvironment {
  return { windAt: (_p, out) => out.copy(wind), terrain };
}

export function neutralInput(): FlightInput {
  return { pitch: 0, roll: 0, yaw: 0, flap: 0, tuck: 0, flare: 0 };
}

export function yawQuat(yaw: number, pitch = 0, roll = 0): Quaternion {
  // Euler order YXZ: heading, then pitch (positive x = nose down), then bank.
  return new Quaternion().setFromEuler(new Euler(pitch, yaw, roll, 'YXZ'));
}

/** A model flying level at `speed` at altitude `y`, heading +Z. */
export function launch(breed: BreedStats, speed: number, y = 3000, pitchDown = 0): FlightModel {
  const m = new FlightModel(breed);
  const q = yawQuat(0, pitchDown);
  m.reset(new Vector3(0, y, 0), q, new Vector3(0, 0, speed).applyQuaternion(q));
  return m;
}

const _v = new Vector3();
export function pathAngle(m: FlightModel): number {
  const v = m.state.velocity;
  return Math.atan2(v.y, Math.hypot(v.x, v.z));
}
export function bankAngle(m: FlightModel): number {
  const q = m.state.orientation;
  const left = _v.set(1, 0, 0).applyQuaternion(q);
  const ly = left.y;
  const upY = new Vector3(0, 1, 0).applyQuaternion(q).y;
  return Math.atan2(ly, upY);
}
export function horizontalSpeed(m: FlightModel): number {
  const v = m.state.velocity;
  return Math.hypot(v.x, v.z);
}

export interface GlideResult {
  speed: number;
  sink: number;
  ratio: number;
  /** Spread of the vertical speed over the averaging window (m/s): ~0 for a settled glide. */
  ripple: number;
}

/** Hold a constant pitch stick in still air and measure the settled glide. */
export function measureGlide(breed: BreedStats, pitch = 0, seconds = 70): GlideResult {
  const m = launch(breed, new FlightModel(breed).derived.vCruise);
  const env = stillAir();
  const input = neutralInput();
  input.pitch = pitch;
  const steps = Math.round(seconds / SIM_DT);
  const avgFrom = Math.round((seconds - 20) / SIM_DT);
  let h = 0;
  let sink = 0;
  let speed = 0;
  let n = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < steps; i++) {
    m.step(SIM_DT, input, env);
    if (i >= avgFrom) {
      h += horizontalSpeed(m);
      sink += -m.state.velocity.y;
      speed += m.state.airspeed;
      lo = Math.min(lo, m.state.velocity.y);
      hi = Math.max(hi, m.state.velocity.y);
      n++;
    }
  }
  return { speed: speed / n, sink: sink / n, ratio: h / Math.max(1e-6, sink), ripple: hi - lo };
}

/** Best glide over a sweep of constant pitch stick positions. */
export function measureBestGlide(breed: BreedStats): GlideResult & { pitch: number } {
  let best = { speed: 0, sink: 0, ratio: 0, ripple: 0, pitch: 0 };
  for (let p = -0.2; p <= 0.5001; p += 0.05) {
    const g = measureGlide(breed, p);
    // Only settled glides count (a held pull can end in a zoom-stall cycle).
    if (g.ripple < 0.5 && g.ratio > best.ratio) best = { ...g, pitch: p };
  }
  return best;
}

/** Tucked, nose straight down (an autopilot holds the path vertical); terminal airspeed. */
export function measureDive(breed: BreedStats, seconds = 45): number {
  const m = launch(breed, 20, 20000, 80 * DEG);
  const env = stillAir();
  const input = neutralInput();
  input.tuck = 1;
  let vmax = 0;
  for (let i = 0; i < seconds / SIM_DT; i++) {
    const gamma = pathAngle(m);
    // Hold the path at -85°: push when the path is shallower.
    input.pitch = clamp((-85 * DEG - gamma) * 3, -1, 1);
    m.step(SIM_DT, input, env);
    vmax = Math.max(vmax, m.state.airspeed);
  }
  return vmax;
}

export interface RollResult {
  /** Peak roll rate reached with full stick (rad/s). */
  peakRate: number;
  /** Seconds from full stick to 90° of bank. */
  timeTo90: number;
  /** Seconds to reach 90% of the peak rate (roll-in inertia). */
  spinUp: number;
  /** Seconds from releasing the stick at full rate until the roll stops (roll-out inertia). */
  rollOut: number;
}

export function measureRoll(breed: BreedStats): RollResult {
  const m = launch(breed, new FlightModel(breed).derived.vCruise);
  const env = stillAir();
  const input = neutralInput();
  // Settle first.
  for (let i = 0; i < 120; i++) m.step(SIM_DT, input, env);
  input.roll = 1;
  let peak = 0;
  let t90 = Infinity;
  let prevBank = bankAngle(m);
  const rates: number[] = [];
  for (let i = 0; i < 360; i++) {
    m.step(SIM_DT, input, env);
    const bank = bankAngle(m);
    // Rate the player sees: how fast the bank angle changes (unwrapped).
    let dBank = bank - prevBank;
    if (dBank > Math.PI) dBank -= 2 * Math.PI;
    if (dBank < -Math.PI) dBank += 2 * Math.PI;
    prevBank = bank;
    const rate = dBank / SIM_DT;
    rates.push(rate);
    peak = Math.max(peak, rate);
    if (t90 === Infinity && bank >= Math.PI / 2) t90 = (i + 1) * SIM_DT;
    // Past ~120° the nose falls through and bank is no longer meaningful.
    if (bank >= (2 * Math.PI) / 3 || bank < -0.1) break;
  }
  const idx = rates.findIndex((r) => r >= 0.9 * peak);
  // Roll-out: from a fresh cruise, full stick for 0.8 s, then let go.
  const m2 = launch(breed, m.derived.vCruise);
  for (let i = 0; i < 120; i++) m2.step(SIM_DT, neutralInput(), env);
  const hold = neutralInput();
  hold.roll = 1;
  for (let i = 0; i < 0.8 / SIM_DT; i++) m2.step(SIM_DT, hold, env);
  let out = 0;
  let pb = bankAngle(m2);
  for (let i = 0; i < 360; i++) {
    m2.step(SIM_DT, neutralInput(), env);
    const b = bankAngle(m2);
    if ((b - pb) / SIM_DT < 0.1) {
      out = (i + 1) * SIM_DT;
      break;
    }
    pb = b;
  }
  return { peakRate: peak, timeTo90: t90, spinUp: (idx + 1) * SIM_DT, rollOut: out };
}

export interface ClimbResult {
  /** Best steady climb rate while flapping at full strength (m/s). */
  climb: number;
  /** Airspeed of that climb. */
  speed: number;
  /** Stick position that gave it. */
  pitch: number;
}

/**
 * Sustained climb: flap at full with a constant stick (stamina pinned so the aerodynamics, not
 * the endurance, are measured) and average the settled vertical speed; best over a sweep.
 */
export function measureClimb(breed: BreedStats, seconds = 40): ClimbResult {
  let best: ClimbResult = { climb: -Infinity, speed: 0, pitch: 0 };
  for (let p = -0.1; p <= 0.7001; p += 0.1) {
    const m = launch(breed, new FlightModel(breed).derived.vCruise);
    const env = stillAir();
    const input = neutralInput();
    input.flap = 1;
    input.pitch = p;
    const from = Math.round((seconds - 20) / SIM_DT);
    let y0 = 0;
    let speed = 0;
    let n = 0;
    for (let i = 0; i < seconds / SIM_DT; i++) {
      m.state.stamina = 1;
      m.step(SIM_DT, input, env);
      if (i === from) y0 = m.state.position.y;
      if (i > from) {
        speed += m.state.airspeed;
        n++;
      }
    }
    const climb = (m.state.position.y - y0) / (n * SIM_DT);
    if (climb > best.climb) best = { climb, speed: speed / n, pitch: p };
  }
  return best;
}

export interface CirclingResult {
  /** Settled sink rate while circling (m/s, positive down). */
  sink: number;
  /** Airspeed held (m/s). */
  speed: number;
  /** Radius of the circle flown (m). */
  radius: number;
}

/**
 * Thermalling: circle at `bankDeg` of bank and the race autopilot's circling speed (1.25 × stall,
 * raised for the load factor of the bank) in still air, wings spread, no flapping, and measure
 * the sink. A thermal rising at w lifts the wyvern at w − sink. With the stick held the phugoid
 * damper is off, so the path swings gently around the circle: the sink is averaged over a long
 * window (many phugoid periods) after a settling time.
 */
export function measureCircling(breed: BreedStats, bankDeg = 35, settle = 20, seconds = 60): CirclingResult {
  const d = new FlightModel(breed).derived;
  const bank = bankDeg * DEG;
  const vTarget = (1.25 * d.vStall) / Math.sqrt(Math.cos(bank));
  const m = launch(breed, vTarget);
  const env = stillAir();
  const input = neutralInput();
  const from = Math.round(settle / SIM_DT);
  const steps = Math.round((settle + seconds) / SIM_DT);
  let y0 = 0;
  let speed = 0;
  let n = 0;
  let iv = 0;
  let prevGamma = 0;
  for (let i = 0; i < steps; i++) {
    // Hold the bank (positive = right) with the stick, and the speed with the pitch (damping the
    // flight path's rate so the hold doesn't pump the phugoid).
    input.roll = clamp(2 * (bank - bankAngle(m)) - 0.6 * m.state.angularVelocity.z, -1, 1);
    const ev = m.state.airspeed - vTarget;
    iv = clamp(iv + ev * SIM_DT, -20, 20);
    const gamma = pathAngle(m);
    const gammaRate = i === 0 ? 0 : (gamma - prevGamma) / SIM_DT;
    prevGamma = gamma;
    input.pitch = clamp(0.06 * ev + 0.01 * iv - 1.2 * gammaRate + 0.38 * (1 / Math.cos(bank) - 1), -1, 1);
    m.step(SIM_DT, input, env);
    if (i === from) y0 = m.state.position.y;
    if (i > from) {
      speed += m.state.airspeed;
      n++;
    }
  }
  const v = speed / n;
  return { sink: (y0 - m.state.position.y) / (n * SIM_DT), speed: v, radius: (v * v) / (9.81 * Math.tan(bank)) };
}

/** Seconds of continuous full-strength flapping from a full meter until it is empty. */
export function measureEndurance(breed: BreedStats, capacity = 1): number {
  const m = launch(breed, new FlightModel(breed).derived.vCruise);
  m.capacity = capacity;
  const env = stillAir();
  const input = neutralInput();
  input.flap = 1;
  let t = 0;
  while (m.state.stamina > 1e-4 && t < 120) {
    m.step(SIM_DT, input, env);
    t += SIM_DT;
  }
  return t;
}

/** Level flight while flapping at full: an autopilot holds altitude; settled airspeed. */
export function measureLevelFlapSpeed(breed: BreedStats): number {
  const m = launch(breed, new FlightModel(breed).derived.vCruise);
  m.state.stamina = 1;
  const env = stillAir();
  const input = neutralInput();
  input.flap = 1;
  const y0 = m.state.position.y;
  let speed = 0;
  let n = 0;
  for (let i = 0; i < 25 / SIM_DT; i++) {
    m.state.stamina = 1; // measure the aerodynamics, not the endurance
    const dy = m.state.position.y - y0;
    input.pitch = clamp(-dy * 0.08 - m.state.velocity.y * 0.15, -1, 1);
    m.step(SIM_DT, input, env);
    if (i * SIM_DT > 15) {
      speed += m.state.airspeed;
      n++;
    }
  }
  return speed / n;
}

/** Slow down holding altitude until the stall breaks; airspeed at stallStart (NaN: it never stalled). */
export function measureStallSpeed(breed: BreedStats): number {
  const m = launch(breed, new FlightModel(breed).derived.vCruise);
  const env = stillAir();
  const input = neutralInput();
  const y0 = m.state.position.y;
  for (let i = 0; i < 40 / SIM_DT; i++) {
    const dy = m.state.position.y - y0;
    input.pitch = clamp(-dy * 0.2 - m.state.velocity.y * 0.4, -1, 1);
    m.step(SIM_DT, input, env);
    if (m.state.stall > 0.5) return m.state.airspeed;
  }
  return NaN;
}

export interface MushResult {
  /** Lowest airspeed reached while trying to hold altitude with the stick (m/s). */
  minSpeed: number;
  /** Settled airspeed and sink over the last 10 s. */
  speed: number;
  sink: number;
  /** Deepest stall seen (0..1); a mush stays well under 0.5. */
  maxStall: number;
}

/**
 * Slow flight: try to hold altitude with the stick (hauling back as the speed bleeds away) for
 * 40 s. With the soft stall protection it settles into a slow, sinking mush instead of stalling.
 */
export function measureMush(breed: BreedStats): MushResult {
  const m = launch(breed, new FlightModel(breed).derived.vCruise);
  const env = stillAir();
  const input = neutralInput();
  const y0 = m.state.position.y;
  let minSpeed = Infinity;
  let maxStall = 0;
  let speed = 0;
  let sink = 0;
  let n = 0;
  for (let i = 0; i < 40 / SIM_DT; i++) {
    const dy = m.state.position.y - y0;
    input.pitch = clamp(-dy * 0.2 - m.state.velocity.y * 0.4, -1, 1);
    m.step(SIM_DT, input, env);
    minSpeed = Math.min(minSpeed, m.state.airspeed);
    maxStall = Math.max(maxStall, m.state.stall);
    if (i * SIM_DT > 30) {
      speed += m.state.airspeed;
      sink -= m.state.velocity.y;
      n++;
    }
  }
  return { minSpeed, speed: speed / n, sink: sink / n, maxStall };
}

export interface TailSlideResult {
  /** The zoom ran out of air and the wing let go. */
  stalled: boolean;
  /** Seconds from the stall break until back on a normal glide, hands off. */
  seconds: number;
  /** Height lost from the stall break until back on a normal glide (m). */
  lost: number;
  /** Bank at the moment the hands-off recovery began, signed (rad): which wing dropped. */
  bankAtRelease: number;
}

/**
 * The one sure way to stall: point straight up at `speed`, unload the wing (a little forward
 * stick) and coast up until the air runs out — a tail slide — then let go. Measures how long and
 * how much height the hands-off recovery takes.
 */
export function measureTailSlide(breed: BreedStats, speed = 35): TailSlideResult {
  const m = launch(breed, speed, 3000, -88 * DEG);
  const env = stillAir();
  const input = neutralInput();
  input.pitch = -0.35;
  let t = 0;
  while (m.state.stall < 0.5 && t < 20) {
    m.step(SIM_DT, input, env);
    t += SIM_DT;
  }
  const stalled = m.state.stall >= 0.5;
  // Hold it a moment longer (the wing lets go), then hands off.
  for (let i = 0; i < 0.5 / SIM_DT; i++) m.step(SIM_DT, input, env);
  const bankAtRelease = bankAngle(m);
  const y0 = m.state.position.y;
  input.pitch = 0;
  let tr = 0;
  let unstalled = false;
  while (tr < 30) {
    m.step(SIM_DT, input, env);
    tr += SIM_DT;
    if (m.state.stall < 0.05) unstalled = true;
    if (unstalled && pathAngle(m) > -8 * DEG && m.state.angularVelocity.x <= 0.02) break;
  }
  return { stalled, seconds: tr, lost: y0 - m.state.position.y, bankAtRelease };
}

/** Flare from `from` m/s in level flight: seconds until ground speed drops below `to`. */
export function measureFlare(breed: BreedStats, from = 30, to = 12): { seconds: number; heightGain: number } {
  const m = launch(breed, from);
  const env = stillAir();
  const input = neutralInput();
  input.flare = 1;
  const y0 = m.state.position.y;
  let maxY = y0;
  for (let i = 0; i < 8 / SIM_DT; i++) {
    m.step(SIM_DT, input, env);
    maxY = Math.max(maxY, m.state.position.y);
    if (horizontalSpeed(m) < to) return { seconds: (i + 1) * SIM_DT, heightGain: maxY - y0 };
  }
  return { seconds: Infinity, heightGain: maxY - y0 };
}

/** Specific energy: height + v²/2g (m). */
export function energyHeight(m: FlightModel): number {
  const v = m.state.velocity;
  return m.state.position.y + v.lengthSq() / (2 * 9.81);
}
