// Course geometry helpers and the medal model.
//
// Medal times come from a speed model, not from guesswork. Each tier is an average airspeed
// over the course line (gold 34 m/s, silver 29, bronze 24 — cruise is 22–27 m/s), adjusted for
// the height the line asks for. Holding a tier's pace costs height: sink at that speed minus
// what sustainable flapping (about 60% of the time, stamina-limited) gives back — measured with
// src/flight/telemetry.ts: the harrier sinks 4.8 m/s at 34 m/s and holds ~29 m/s level on
// flaps alone. Descents bank height (as speed) that later climbs and the pace can spend; what
// the line can't pay for is climbed at the tier's rate (flapping, or thermals on legs that
// climb in one). The course tests then fly every course with the autopilot and the real
// flight model to prove the times are achievable.

import type { Medal } from '../core/types';
import type { RaceDef } from '../game/contracts';
import type { RingGeom } from './ringMath';

/**
 * Rolling start: begin() places the player this far before the gate (and a little above its
 * center, so a hands-off glide sinks through the middle), flying at this speed.
 */
export const RACE_START = { leadDistance: 140, speed: 28, rise: 6 } as const;

/** Clearance kept around a gate's center (validation) — the opening is wider (below). */
export const GATE_RADIUS = 13;
/** The gate's opening (m): crossing within it starts the clock; pillars stand just outside. */
export const GATE_HALF_WIDTH = 16;
export const GATE_HALF_HEIGHT = 15;

export interface PaceModel {
  /** Average airspeed over the course line (m/s). */
  speed: number;
  /** Height per second that holding this pace costs beyond sustainable flapping (m/s). */
  sink: number;
  /** Climb rate for height the line can't pay for (m/s). */
  climb: number;
  /** Climb rate in a thermal (m/s). */
  thermal: number;
}

/** Average airspeed of each tier on a line that pays for itself (m/s). */
export const MEDAL_PACE = { gold: 34, silver: 29, bronze: 24 } as const;

/**
 * Harrier sink rate at each airspeed (m/s, measured: telemetry glide polar) minus the ~4.2 m/s
 * that flapping about 60% of the time (the stamina-sustainable duty: a 13.5 s pool refilling at
 * 12%/s) gives back.
 */
const POLAR: [number, number][] = [
  [20, 2.45],
  [22, 2.55],
  [26, 3.0],
  [30, 3.76],
  [34, 4.8],
  [40, 7.07],
];
const FLAP_GAIN = 4.2;

export function netSink(v: number): number {
  if (v <= POLAR[0][0]) return POLAR[0][1] - FLAP_GAIN;
  for (let i = 1; i < POLAR.length; i++) {
    const [v1, s1] = POLAR[i];
    const [v0, s0] = POLAR[i - 1];
    if (v <= v1) return s0 + ((s1 - s0) * (v - v0)) / (v1 - v0) - FLAP_GAIN;
  }
  return POLAR[POLAR.length - 1][1] - FLAP_GAIN;
}

/**
 * Climb rates for a skilled rider: flapping alone, and circling in a thermal (m/s). The thermals'
 * cores are wider than any wyvern's circling turn: a harrier climbs 4–8 m/s in them (telemetry).
 */
const CLIMB_RATE = 2.6;
const THERMAL_RATE = 5.5;

/** Height-equivalent of the speed carried through the gate (m) and the most that can be banked. */
const ENERGY_START = 20;
const ENERGY_MAX = 45;
/** Fraction of a descent kept as usable energy (the rest goes to drag). */
const DESCENT_KEEP = 0.6;

export type MedalTier = keyof typeof MEDAL_PACE;

/** A point on the course line; `thermal` marks a leg that ends climbing in a thermal. */
export type LinePoint = readonly [number, number, number] | { p: readonly [number, number, number]; thermal: true };

function pointOf(lp: LinePoint): readonly [number, number, number] {
  return 'p' in lp ? lp.p : lp;
}

/** Seconds to fly a course line at a given pace. */
export function paceSeconds(line: readonly LinePoint[], m: PaceModel): number {
  let energy = ENERGY_START;
  let t = 0;
  for (let i = 1; i < line.length; i++) {
    const a = pointOf(line[i - 1]);
    const b = pointOf(line[i]);
    const lp = line[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const legT = len / m.speed;
    t += legT;
    // A leg into a thermal still has to be glided there; it ends climbing at the thermal rate.
    const thermal = typeof lp === 'object' && 'thermal' in lp;
    const need = b[1] - a[1] + legT * m.sink;
    if (need < 0) {
      energy = Math.min(ENERGY_MAX, energy - need * DESCENT_KEEP);
      continue;
    }
    const use = Math.min(energy, need);
    energy -= use;
    t += (need - use) / (thermal ? m.thermal : m.climb);
  }
  return t;
}

/** Fastest average a line can pay for: a long dive (energy from height) can beat the gold pace. */
const MAX_PACE = 42;

/**
 * The gold time: the best pace the line can pay for. On a level line that's around the gold
 * pace; a line that climbs makes a slower, cheaper pace finish sooner, and one that dives can
 * be flown faster. Silver and bronze keep the tiers' pace ratios to gold.
 */
export function goldSeconds(line: readonly LinePoint[]): number {
  let best = Infinity;
  for (let v = 20; v <= MAX_PACE + 1e-9; v += 0.5) {
    best = Math.min(best, paceSeconds(line, { speed: v, sink: netSink(v), climb: CLIMB_RATE, thermal: THERMAL_RATE }));
  }
  return best;
}

/** The start gate as a ring (horizontal normal along its yaw). */
export function gateRing(def: Pick<RaceDef, 'start'>): RingGeom {
  const [x, y, z] = def.start.position;
  return { cx: x, cy: y, cz: z, nx: Math.sin(def.start.yaw), ny: 0, nz: Math.cos(def.start.yaw), radius: GATE_RADIUS };
}

/** The course line: gate, then each ring (and any `via` points before a ring, for sprints). */
export function coursePoints(def: Pick<RaceDef, 'start' | 'rings'>, via: { before: number; point: [number, number, number]; climbTo?: number }[] = []): LinePoint[] {
  const pts: LinePoint[] = [def.start.position];
  def.rings.forEach((r, i) => {
    for (const v of via) if (v.before === i) pts.push(v.climbTo !== undefined ? { p: v.point, thermal: true } : v.point);
    pts.push(r.position);
  });
  return pts;
}

export function polylineLength(pts: readonly LinePoint[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pointOf(pts[i - 1]);
    const b = pointOf(pts[i]);
    L += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return L;
}

/** Medal times (ms) for a course line, each rounded up to the half second. */
export function medalTimes(line: readonly LinePoint[]): RaceDef['medals'] {
  const gold = goldSeconds(line);
  const round = (sec: number) => Math.ceil(sec * 2) * 500;
  return {
    gold: round(gold),
    silver: round((gold * MEDAL_PACE.gold) / MEDAL_PACE.silver),
    bronze: round((gold * MEDAL_PACE.gold) / MEDAL_PACE.bronze),
  };
}

/** The medal a time earns. */
export function medalFor(timeMs: number, medals: RaceDef['medals']): Medal {
  if (timeMs <= medals.gold) return 'gold';
  if (timeMs <= medals.silver) return 'silver';
  if (timeMs <= medals.bronze) return 'bronze';
  return 'none';
}

/** Unit direction from a to b. */
export function dir(a: readonly number[], b: readonly number[]): [number, number, number] {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
}

/**
 * Ring normals that follow the line: each ring faces the average of the incoming and outgoing
 * directions (the last faces along the incoming one), so a smooth line passes square through.
 */
export function flowNormals(points: readonly (readonly [number, number, number])[], start: readonly [number, number, number]): [number, number, number][] {
  return points.map((p, i) => {
    const prev = i === 0 ? start : points[i - 1];
    const a = dir(prev, p);
    if (i === points.length - 1) return a;
    const b = dir(p, points[i + 1]);
    const s: [number, number, number] = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const l = Math.hypot(...s) || 1;
    return [s[0] / l, s[1] / l, s[2] / l];
  });
}
