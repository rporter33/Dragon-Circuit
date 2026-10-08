// Fly a whole race with the autopilot and the real FlightModel, exactly as the game would time
// it: a rolling start ~140 m before the gate, the clock from the gate crossing, rings in order
// with the swept test. Used by the course tests (feasibility, medal sanity) and by the race
// showcase to record a ghost. Pure: runs in node.

import { Vector3 } from 'three';
import type { BreedStats, FlightEnvironment, FlightInput, TerrainQuery } from '../core/types';
import type { RaceDef } from '../game/contracts';
import type { ThermalDef } from '../world/layout';
import { FlightModel } from '../flight/FlightModel';
import { smoothstep } from '../core/math';
import { yawQuat } from '../flight/telemetry';
import { Autopilot, CoursePath, type PathNode } from './autopilot';
import { missRadiusFor, ringGeom, sweepRing, type RingGeom } from './ringMath';
import { gateRing, RACE_START } from './courseMath';

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

/** Where begin() puts the player: on the gate's axis, `leadDistance` before it. */
export function raceStartPosition(def: Pick<RaceDef, 'start'>, out: Vector3): Vector3 {
  const g = gateRing(def);
  return out.set(g.cx - g.nx * RACE_START.leadDistance, g.cy, g.cz - g.nz * RACE_START.leadDistance);
}

/** The autopilot's line for a course: the run-up, the gate, any via points, every ring. */
export function coursePath(def: RaceDef, via: readonly ViaPoint[] = []): { path: CoursePath; ringNode: number[] } {
  const gate = gateRing(def);
  const gateN = new Vector3(gate.nx, gate.ny, gate.nz);
  const nodes: PathNode[] = [
    { position: raceStartPosition(def, new Vector3()), tangent: gateN.clone() },
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
  m.reset(raceStartPosition(def, new Vector3()), yawQuat(Math.atan2(startDir.x, startDir.z)), startDir.clone().multiplyScalar(RACE_START.speed));
  m.setGrace(1);

  const rings: RingGeom[] = def.rings.map(ringGeom);
  const { path, ringNode } = coursePath(def, opts.via);
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
      const c = sweepRing(prev.x, prev.y, prev.z, p.x, p.y, p.z, gate);
      if (c?.kind === 'pass') {
        started = true;
        raceTime = (1 - c.t) * dt;
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
