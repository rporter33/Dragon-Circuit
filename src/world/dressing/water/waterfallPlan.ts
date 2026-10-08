// Where each waterfall runs: a stream traced uphill from a low point on the rim (so, read the
// other way, it flows downhill to the lip), and the fall itself — a ballistic arc with air drag
// that clears the cliff and drops past the island's underside. Pure; unit-tested.

import { noise2 } from '../../../core/noise';
import { mulberry32 } from '../../../core/rng';
import type { IslandShape } from '../../islandShape';
import type { Terrain } from '../../terrain';
import type { ExclusionSet } from '../exclusions';

export interface StreamPoint {
  x: number;
  /** Water surface height. */
  y: number;
  z: number;
  /** Half-width of the stream here (m). */
  w: number;
}

export interface WaterfallPlan {
  islandId: number;
  /** Spring → lip, on the island top. */
  stream: StreamPoint[];
  /** Where the water leaves the rim. */
  lip: { x: number; y: number; z: number };
  /** Horizontal outward unit direction at the lip. */
  outX: number;
  outZ: number;
  /** Launch speed over the lip (m/s, horizontal). */
  speed: number;
  /** Fall half-width at the lip (m). */
  width: number;
  /** Total height the ribbon falls before it has dissolved into mist (m). */
  drop: number;
  /** Seconds of flight that cover `drop`. */
  duration: number;
  /** Lowest point of the island underside, for reference. */
  undersideY: number;
}

/** Linear-drag constant: terminal fall speed g/K ≈ 30 m/s (spray-laden water slows fast). */
export const FALL_DRAG = 0.33;
const G = 9.81;

/**
 * Position along the fall after `t` seconds (relative to the lip): horizontal distance outward
 * and vertical offset (negative = down). Exact solution of linear drag.
 */
export function fallOffset(speed: number, t: number): { out: number; down: number } {
  const k = FALL_DRAG;
  const e = Math.exp(-k * t);
  const vt = G / k;
  return { out: (speed / k) * (1 - e), down: vt * t - (vt / k) * (1 - e) };
}

/** Seconds needed to fall `drop` meters (Newton iterations on fallOffset). */
export function fallDuration(speed: number, drop: number): number {
  let t = Math.sqrt((2 * drop) / G);
  for (let i = 0; i < 30; i++) {
    const k = FALL_DRAG;
    const vt = G / k;
    const f = fallOffset(speed, t).down - drop;
    const df = vt * (1 - Math.exp(-k * t));
    t -= f / Math.max(df, 1e-3);
  }
  return t;
}

/** Deepest the stream's surface sits above the ground (where it pools behind a bump). */
export function maxPoolDepth(shape: IslandShape, plan: WaterfallPlan): number {
  let mx = 0;
  for (const q of plan.stream) mx = Math.max(mx, q.y - shape.topHeight(q.x, q.z));
  return mx;
}

function slopeGrad(shape: IslandShape, x: number, z: number): [number, number] {
  const e = 2;
  return [(shape.topHeight(x + e, z) - shape.topHeight(x - e, z)) / (2 * e), (shape.topHeight(x, z + e) - shape.topHeight(x, z - e)) / (2 * e)];
}

/** Plan every waterfall in the world. `avoid` keeps streams out of built-up areas. */
export function planWaterfalls(terrain: Terrain, avoid: ExclusionSet | null): WaterfallPlan[] {
  const out: WaterfallPlan[] = [];
  for (const shape of terrain.islands) {
    const def = shape.def;
    if (def.waterfalls <= 0) continue;
    const n = Math.round(def.waterfalls);
    const rnd = mulberry32(def.seed ^ 0xfa11);
    const meander = noise2(def.seed + 401);
    // Score rim angles: low rim = where water would naturally spill.
    const samples = 96;
    const scored: { a: number; y: number }[] = [];
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * Math.PI * 2;
      const R = shape.outlineRadius(a) * 0.9;
      const y = shape.topHeight(def.x + Math.cos(a) * R, def.z + Math.sin(a) * R);
      scored.push({ a, y: y + rnd() * def.hills * 0.15 });
    }
    scored.sort((p, q) => p.y - q.y);
    const chosen: number[] = [];
    const minSep = (Math.PI * 2) / (n * 1.7);
    const big = def.kind === 'cascade';
    // First pass prefers streams that never pool more than ~1.5 m deep; the second takes any.
    for (const strict of [true, false]) {
      for (const cand of scored) {
        if (chosen.length >= n) break;
        if (chosen.some((a) => Math.abs(Math.atan2(Math.sin(a - cand.a), Math.cos(a - cand.a))) < minSep)) continue;
        const plan = traceStream(shape, cand.a, big, meander, mulberry32(def.seed + Math.round(cand.a * 1000)), avoid);
        if (!plan) continue;
        if (strict && maxPoolDepth(shape, plan) > 1.5) continue;
        chosen.push(cand.a);
        out.push(plan);
      }
    }
  }
  return out;
}

function traceStream(
  shape: IslandShape,
  angle: number,
  big: boolean,
  meander: (x: number, y: number) => number,
  rnd: () => number,
  avoid: ExclusionSet | null,
): WaterfallPlan | null {
  const def = shape.def;
  const outX = Math.cos(angle);
  const outZ = Math.sin(angle);
  const R = shape.outlineRadius(angle);
  // Walk inward and uphill from just inside the rim.
  const step = 3;
  const maxLen = Math.min(big ? 150 : 90, R * 0.75);
  let x = def.x + outX * R * 0.985;
  let z = def.z + outZ * R * 0.985;
  const pts: { x: number; z: number }[] = [{ x: def.x + outX * R * 0.997, z: def.z + outZ * R * 0.997 }, { x, z }];
  let len = 0;
  while (len < maxLen) {
    const [gx, gz] = slopeGrad(shape, x, z);
    const gl = Math.hypot(gx, gz);
    // Inward pull + uphill + a gentle meander across the flow.
    const ix = def.x - x;
    const iz = def.z - z;
    const il = Math.hypot(ix, iz) || 1;
    let dx = (ix / il) * 0.7 + (gl > 1e-4 ? (gx / gl) * Math.min(1, gl * 6) : 0);
    let dz = (iz / il) * 0.7 + (gl > 1e-4 ? (gz / gl) * Math.min(1, gl * 6) : 0);
    const m = meander(x * 0.02, z * 0.02) * 0.55;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    const px = -dz;
    const pz = dx;
    dx += px * m;
    dz += pz * m;
    const dl2 = Math.hypot(dx, dz) || 1;
    let nx = x + (dx / dl2) * step;
    let nz = z + (dz / dl2) * step;
    // Traced uphill, so read downstream the water always descends: if the meander would step
    // downhill, follow the slope instead.
    const here = shape.topHeight(x, z);
    if (shape.topHeight(nx, nz) < here - 0.02 && gl > 1e-3) {
      nx = x + (gx / gl) * step;
      nz = z + (gz / gl) * step;
    }
    x = nx;
    z = nz;
    len += step;
    if (shape.normRadius(x, z) < 0.3) break;
    pts.push({ x, z });
  }
  if (pts.length < 6) return null;
  pts.reverse();
  if (avoid) {
    for (const p of pts) if (avoid.blocked(p.x, p.z, 4)) return null;
  }
  const baseW = big ? 4.5 + rnd() * 2.2 : 2.1 + rnd() * 0.9;
  // Water surface: hugs the ground going down, and never runs uphill: walking up from the lip,
  // the level only rises, so where the ground dips behind a bump the water pools instead.
  const ys = pts.map((p) => shape.topHeight(p.x, p.z) + 0.22);
  for (let i = ys.length - 2; i >= 0; i--) ys[i] = Math.max(ys[i], ys[i + 1]);
  const stream: StreamPoint[] = [];
  pts.forEach((p, i) => {
    const t = i / (pts.length - 1);
    const y = ys[i];
    // Narrow at the spring, widest mid-run, pinched a little where it pours over the lip.
    const w = baseW * (0.55 + 0.45 * Math.min(1, t * 3)) * (t > 0.92 ? 0.9 : 1);
    stream.push({ x: p.x, y, z: p.z, w });
  });
  const lipP = stream[stream.length - 1];
  const undersideY = def.y - def.depth * 1.25;
  // Fall past the underside and on into mist, but stay above the cloud sea.
  const drop = Math.max(60, Math.min(lipP.y - 18, lipP.y - undersideY + 140 + def.depth * 0.4));
  const speed = big ? 6.5 : 4.5;
  return {
    islandId: def.id,
    stream,
    lip: { x: lipP.x, y: lipP.y, z: lipP.z },
    outX,
    outZ,
    speed,
    width: lipP.w,
    drop,
    duration: fallDuration(speed, drop),
    undersideY,
  };
}
