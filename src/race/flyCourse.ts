// Fly a whole race with the autopilot and the real FlightModel, exactly as the game would time
// it: a rolling start ~140 m before the gate, the clock from the gate crossing, rings in order
// with the swept test. Used by the course tests (feasibility, medal sanity) and by the race
// showcase to record a ghost. Also where the rolling start itself is decided (raceStartPosition):
// high enough that each breed's hands-off glide sinks through the opening, clear of terrain,
// trees and buildings. Pure: runs in node.

import { Vector3 } from 'three';
import type { BreedStats, FlightEnvironment, FlightInput, TerrainQuery } from '../core/types';
import type { RaceDef } from '../game/contracts';
import type { ThermalDef } from '../world/layout';
import { FlightModel } from '../flight/FlightModel';
import { smoothstep } from '../core/math';
import { OPEN_SKY, stillAir, yawQuat } from '../flight/telemetry';
import { Autopilot, CoursePath, type PathNode } from './autopilot';
import { missRadiusFor, ringGeom, sweepGate, sweepRing, type RingGeom } from './ringMath';
import { GATE_HALF_HEIGHT, GATE_HALF_WIDTH, gateRing, RACE_START } from './courseMath';

/** A point the line passes through before ring `before` (a thermal to climb in, for sprints). */
export interface ViaPoint {
  before: number;
  point: readonly [number, number, number];
  climbTo?: number;
}

export interface FlyOptions {
  breed: BreedStats;
  env: FlightEnvironment;
  via?: readonly ViaPoint[];
  /** Give up after this long (s). */
  maxSeconds?: number;
  dt?: number;
  /** Called every step (e.g. to record a ghost); raceTime is null before the gate. */
  onStep?: (model: FlightModel, raceTime: number | null, input: FlightInput) => void;
  /** Called at every ring crossing (pass or miss) with where the plane was crossed. */
  onRing?: (index: number, kind: 'pass' | 'miss', dist: number, model: FlightModel) => void;
  /** Called on every terrain contact harder than 2.5 m/s. */
  onHit?: (impact: number, model: FlightModel) => void;
}

export interface FlyResult {
  finished: boolean;
  /** Race time (ms), gate to last ring. */
  timeMs: number;
  /** Race time at each ring (ms). */
  splits: number[];
  /** Rings missed (crossed the plane outside the hole) along the way. */
  misses: number;
  /** Terrain contacts and the hardest one (m/s lost). */
  hits: number;
  maxImpact: number;
  /** Lowest airspeed and deepest stall seen, for sanity. */
  minAirspeed: number;
  maxStall: number;
  /** Index of the ring it was heading for when it gave up. */
  stuckAt: number;
}

/** Steady wind plus the layout's thermals: the baseline weather's wind field. */
export function thermalAir(thermals: readonly ThermalDef[], terrain: TerrainQuery, wind = new Vector3()): FlightEnvironment {
  return {
    terrain,
    windAt(p, out) {
      out.copy(wind);
      for (const t of thermals) {
        const d = Math.hypot(p.x - t.x, p.z - t.z);
        if (d > t.radius * 1.6) continue;
        const core = 1 - smoothstep(t.radius * 0.4, t.radius * 1.6, d);
        const vert = smoothstep(t.baseY, t.baseY + 40, p.y) * (1 - smoothstep(t.topY - 80, t.topY, p.y));
        out.y += t.strength * core * vert;
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The rolling start
// ---------------------------------------------------------------------------------------------

/** Distances (m) sampled by handsOffDrop's table, and the longest. */
const DROP_STEP = 10;
const DROP_RANGE = 260;
const dropTables = new WeakMap<BreedStats, Float32Array>();

/**
 * Height (m) a breed loses gliding hands-off in still air from the rolling-start speed over
 * `distance` m of ground: the real flight model flown once per breed (~1200 steps, cached), so it
 * follows any retune of the breeds or the model. Negative if the breed climbs (it trades the
 * extra speed for height).
 */
export function handsOffDrop(breed: BreedStats, distance: number): number {
  let table = dropTables.get(breed);
  if (!table) {
    table = new Float32Array(Math.floor(DROP_RANGE / DROP_STEP) + 1);
    const m = new FlightModel(breed);
    const y0 = 3000;
    m.reset(new Vector3(0, y0, 0), yawQuat(0), new Vector3(0, 0, RACE_START.speed));
    m.setGrace(1);
    const env = stillAir(OPEN_SKY);
    const input: FlightInput = { pitch: 0, roll: 0, yaw: 0, flap: 0, tuck: 0, flare: 0 };
    let k = 1;
    let prevZ = 0;
    let prevY = y0;
    for (let i = 0; i < 120 * 60 && k < table.length; i++) {
      m.step(1 / 120, input, env);
      const p = m.state.position;
      const ground = Math.hypot(p.x, p.z);
      while (k < table.length && ground >= k * DROP_STEP) {
        const t = (k * DROP_STEP - prevZ) / Math.max(1e-6, ground - prevZ);
        table[k] = y0 - (prevY + (p.y - prevY) * t);
        k++;
      }
      prevZ = ground;
      prevY = p.y;
    }
    // A model that stalls out before the range ends: keep the last slope.
    for (; k < table.length; k++) table[k] = table[k - 1] + (table[k - 1] - (table[k - 2] ?? 0));
    dropTables.set(breed, table);
  }
  const f = Math.min(DROP_RANGE, Math.max(0, distance)) / DROP_STEP;
  const i = Math.min(table.length - 2, Math.floor(f));
  return table[i] + (table[i + 1] - table[i]) * (f - i);
}

/**
 * Margins for the rolling start: aim the hands-off glide this far above the gate's center, and
 * allow for this much more sink than still air (gusts, sink near islands, a nervous rider). Both
 * err high: diving into the opening is easy, climbing back up to it on a heavy breed is not.
 */
export const START_AIM_ABOVE = 4;
export const START_SINK_MARGIN = 1.25;
/**
 * Open air wanted around the start point and along the run-up (m). Terrain.distance is a lower
 * bound that never reports more than 24 m once structure colliders are registered (it only
 * searches that far for them), so asking for more could never be satisfied in the game: 20 m is
 * two half-wingspans of the biggest breed (the galewing's 20.5 m).
 */
export const START_CLEARANCE = 20;
export const RUNUP_CLEARANCE = 12;
/** Run-up lengths tried, preferred first. */
const START_LEADS: readonly number[] = [RACE_START.leadDistance, 160, 120, 180, 100, 200, 80];

export interface StartOptions {
  /** The breed flying it: the start rises by what it sinks on the way in. */
  breed?: BreedStats;
  /** Rock, trees and buildings to keep clear of (TerrainQuery.distance). */
  terrain?: Pick<TerrainQuery, 'distance'>;
}

const _s = new Vector3();

function startAt(def: Pick<RaceDef, 'start'>, lead: number, breed: BreedStats | undefined, out: Vector3): Vector3 {
  const g = gateRing(def);
  const rise = breed ? handsOffDrop(breed, lead) * START_SINK_MARGIN + START_AIM_ABOVE : RACE_START.rise;
  return out.set(g.cx - g.nx * lead, g.cy + Math.max(0, rise), g.cz - g.nz * lead);
}

/** Smallest clearance at the start and along the run-up to the gate (m). */
function runupClearance(def: Pick<RaceDef, 'start'>, start: Vector3, terrain: Pick<TerrainQuery, 'distance'>): number {
  const g = gateRing(def);
  let min = terrain.distance(start) - (START_CLEARANCE - RUNUP_CLEARANCE);
  const L = Math.hypot(g.cx - start.x, g.cy - start.y, g.cz - start.z);
  const n = Math.max(1, Math.ceil(L / 10));
  // Up to 25 m short of the gate (its own pillars stand beside the opening).
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if ((1 - t) * L < 25) break;
    _s.set(start.x + (g.cx - start.x) * t, start.y + (g.cy - start.y) * t, start.z + (g.cz - start.z) * t);
    min = Math.min(min, terrain.distance(_s));
  }
  return min;
}

/**
 * Where begin() puts the player: on the gate's axis, about RACE_START.leadDistance before it,
 * high enough that the breed's hands-off glide sinks through the opening a little above center.
 * With terrain, the run-up is kept clear of rock, trees and buildings: the preferred lead if it is
 * clear, else the first clear one, else the clearest one raised until it is clear.
 */
export function raceStartPosition(def: Pick<RaceDef, 'start'>, out: Vector3, opts: StartOptions = {}): Vector3 {
  const terrain = opts.terrain;
  if (!terrain) return startAt(def, RACE_START.leadDistance, opts.breed, out);
  let best = -Infinity;
  let bestLead: number = RACE_START.leadDistance;
  for (const lead of START_LEADS) {
    startAt(def, lead, opts.breed, out);
    const c = runupClearance(def, out, terrain);
    if (c >= RUNUP_CLEARANCE) return out;
    if (c > best) {
      best = c;
      bestLead = lead;
    }
  }
  startAt(def, bestLead, opts.breed, out);
  const base = out.y;
  for (let up = 5; up <= 60; up += 5) {
    out.y = base + up;
    if (runupClearance(def, out, terrain) >= RUNUP_CLEARANCE) return out;
  }
  out.y = base;
  return out;
}

/** The autopilot's line for a course: the run-up, the gate, any via points, every ring. */
export function coursePath(def: RaceDef, via: readonly ViaPoint[] = [], start?: StartOptions): { path: CoursePath; ringNode: number[] } {
  const gate = gateRing(def);
  const gateN = new Vector3(gate.nx, gate.ny, gate.nz);
  const nodes: PathNode[] = [
    { position: raceStartPosition(def, new Vector3(), start), tangent: gateN.clone() },
    { position: new Vector3(gate.cx, gate.cy, gate.cz), tangent: gateN.clone() },
  ];
  const ringNode: number[] = [];
  def.rings.forEach((r, i) => {
    const target = new Vector3(...r.position);
    for (const v of via) {
      if (v.before !== i) continue;
      const prev = nodes[nodes.length - 1].position;
      // A thermal node sits at the altitude to climb to: the pilot reaches it below the line,
      // circles up, and carries on along the line from there.
      const pos = new Vector3(v.point[0], v.climbTo ?? v.point[1], v.point[2]);
      nodes.push({ position: pos, tangent: target.clone().sub(prev).setY(0).normalize(), climbTo: v.climbTo });
    }
    const g = ringGeom(r);
    ringNode.push(nodes.length);
    nodes.push({ position: target, tangent: new Vector3(g.nx, g.ny, g.nz) });
  });
  return { path: new CoursePath(nodes), ringNode };
}

export function flyCourse(def: RaceDef, opts: FlyOptions): FlyResult {
  const dt = opts.dt ?? 1 / 120;
  const maxSeconds = opts.maxSeconds ?? 400;
  const m = new FlightModel(opts.breed);
  const gate = gateRing(def);
  const startDir = new Vector3(gate.nx, 0, gate.nz).normalize();
  const startOpts: StartOptions = { breed: opts.breed, terrain: opts.env.terrain };
  m.reset(raceStartPosition(def, new Vector3(), startOpts), yawQuat(Math.atan2(startDir.x, startDir.z)), startDir.clone().multiplyScalar(RACE_START.speed));
  m.setGrace(1);

  const rings: RingGeom[] = def.rings.map(ringGeom);
  const { path, ringNode } = coursePath(def, opts.via, startOpts);
  const pilot = new Autopilot(path);
  const input: FlightInput = { pitch: 0, roll: 0, yaw: 0, flap: 0, tuck: 0, flare: 0 };
  const prev = new Vector3();

  const res: FlyResult = { finished: false, timeMs: 0, splits: [], misses: 0, hits: 0, maxImpact: 0, minAirspeed: Infinity, maxStall: 0, stuckAt: -1 };
  let started = false;
  let raceTime = 0;
  let next = 0;
  let total = 0;
  let stuck = 0;
  while (total < maxSeconds) {
    pilot.steer(m.state, m.derived, opts.breed.maxRollRate, dt, input);
    prev.copy(m.state.position);
    const r = m.step(dt, input, opts.env);
    total += dt;
    if (r.impact > 2.5) {
      opts.onHit?.(r.impact, m);
      res.hits++;
      res.maxImpact = Math.max(res.maxImpact, r.impact);
    }
    const p = m.state.position;
    // Down on an island or wedged against rock: give up rather than grind for minutes.
    stuck = m.state.airspeed < 4 ? stuck + dt : 0;
    if (stuck > 3) break;
    if (!started) {
      const c = sweepGate(prev.x, prev.y, prev.z, p.x, p.y, p.z, gate, GATE_HALF_WIDTH, GATE_HALF_HEIGHT);
      if (c !== null) {
        started = true;
        raceTime = (1 - c) * dt;
        pilot.holdAt(path.nodeS[ringNode[0]]);
      } else if (total > 30) break;
    } else {
      res.minAirspeed = Math.min(res.minAirspeed, m.state.airspeed);
      res.maxStall = Math.max(res.maxStall, m.state.stall);
      const ring = rings[next];
      const c = sweepRing(prev.x, prev.y, prev.z, p.x, p.y, p.z, ring, missRadiusFor(ring.radius));
      if (c) opts.onRing?.(next, c.kind, c.dist, m);
      if (c?.kind === 'pass') {
        res.splits.push((raceTime + c.t * dt) * 1000);
        next++;
        if (next < rings.length) pilot.holdAt(path.nodeS[ringNode[next]]);
        if (next >= rings.length) {
          res.finished = true;
          res.timeMs = res.splits[res.splits.length - 1];
          opts.onStep?.(m, raceTime + dt, input);
          return res;
        }
      } else if (c?.kind === 'miss') {
        res.misses++;
        // Go round and fly the approach again.
        pilot.goAround(path.nodeS[ringNode[next]]);
      }
      raceTime += dt;
    }
    opts.onStep?.(m, started ? raceTime : null, input);
  }
  res.stuckAt = next;
  res.timeMs = raceTime * 1000;
  return res;
}
