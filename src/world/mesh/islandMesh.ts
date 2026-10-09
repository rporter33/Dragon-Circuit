// Island meshing. One closed, watertight surface per island and LOD, built as concentric rings
// that run from the top center outward, over a grassy brow, down a stratified cliff band and
// back in along the underside to the bottom tip:
//
//      top rings (polar, denser toward the rim)        brow (slight grassy overhang)
//   ●──○──○──○──○──○──○──○○○ ─╮                         lip underside (roots, moss)
//                             │ cliff band: strata ledges, recessed only (inside collision)
//                              ╲ underside rings (meridian arc length) on the analytic bottom,
//                               ╲  ledges only ever recessed into the rock, so you never fly
//                                ╲___ through anything you can see
//
// Every top vertex sits exactly on IslandShape.topHeight, so what you see is what you land on.
// Positions are local to (def.x, def.y, def.z); the World places the mesh there.
//
// Builders are generators that yield between rings so the World can time-slice them.

import type { IslandShape } from '../islandShape';
import { MeshBuilder, SLICE, type MeshData, type Ring } from './MeshBuilder';
import { IslandPainter, Region } from './islandPaint';
import { gullyAt, gullyDepth, gullyFade, strataRecess } from './strata';
import { smoothstep } from '../../core/math';

export interface IslandLodSpec {
  level: number;
  /** Tangential spacing along the rim and across the rim roll-off band (m). */
  rimSpacing: number;
  /** Radial and tangential spacing inside the rim band (m). */
  innerSpacing: number;
  /** Distance of the first ring inside the rim (m): a crisp edge. */
  rimFirst: number;
  /** Spacing along the underside meridian (m). */
  underSpacing: number;
  /** Vertical spacing of cliff rings (m); 0 = brow and foot only. */
  cliffSpacing: number;
  /** Carve sedimentary ledges into cliffs (needs ~1 m vertical resolution). */
  ledges: boolean;
  minRimSegments: number;
}

export const ISLAND_LODS: IslandLodSpec[] = [
  { level: 0, rimSpacing: 2, innerSpacing: 3, rimFirst: 0.45, underSpacing: 4.5, cliffSpacing: 0.9, ledges: true, minRimSegments: 64 },
  { level: 1, rimSpacing: 5.5, innerSpacing: 8, rimFirst: 1.6, underSpacing: 10, cliffSpacing: 3.2, ledges: false, minRimSegments: 40 },
  { level: 2, rimSpacing: 14, innerSpacing: 24, rimFirst: 5, underSpacing: 22, cliffSpacing: 0, ledges: false, minRimSegments: 28 },
];

/**
 * The shadow caster for an island drawn at level 0 (never drawn itself; see World): level 0's
 * exact top, rim and brow, so hills and terraces shadow themselves exactly as drawn (at a low
 * sun, any other surface bands across the slopes), over level 1's cliffs (no carved ledges) and
 * underside. About 60% of level 0's triangles.
 */
export const ISLAND_SHADOW_LOD: IslandLodSpec = {
  ...ISLAND_LODS[0],
  cliffSpacing: ISLAND_LODS[1].cliffSpacing,
  ledges: false,
  underSpacing: ISLAND_LODS[1].underSpacing,
};

/**
 * Switch distances (m from the island's bounds, before quality scaling) for each LOD of an
 * island of this radius.
 */
export function islandLodDistances(radius: number): number[] {
  return [0, 300 + radius * 0.6, 1100 + radius * 1.2];
}

/** How far the grassy brow overhangs the collision rim (m) and how far it droops. */
export const BROW_OUT = 0.4;
const BROW_DROP = 0.3;
/** The lip's underside: tucked back in under the brow. */
const LIP_IN = 0.45;
const LIP_DROP = 0.95;
/** The cliff face starts this far below the rim. */
const CLIFF_START = 1.5;


export interface IslandMeshResult {
  data: MeshData;
  /** Ring bookkeeping for tests: the top rim ring, the cliff foot ring (= first underside ring). */
  rimRing: Ring;
  footRing: Ring;
  topVertexCount: number;
  /**
   * Index count of the top, brow and cliff band; the underside follows. A renderer can draw
   * only one part when the island's own rock hides the other (see World).
   */
  splitIndex: number;
}

/** Per-LOD spacing, shrunk for small islands so islets still get a proper shape. */
function scaledSpec(spec: IslandLodSpec, radius: number): IslandLodSpec {
  const k = Math.min(1, radius / 60);
  const f = 0.55 + 0.45 * k;
  return {
    ...spec,
    rimSpacing: spec.rimSpacing * f,
    innerSpacing: spec.innerSpacing * f,
    underSpacing: spec.underSpacing * f,
  };
}

const ceil4 = (v: number) => Math.max(4, Math.ceil(v / 4) * 4);

/**
 * Radial schedule for the top: distances from the rim (m, at the mean radius), starting at 0 (the
 * rim itself) and growing inward. Fine at the edge, coarser inside.
 */
export function topRingDistances(spec: IslandLodSpec, meanRadius: number): number[] {
  const out = [0];
  const rimZone = meanRadius * 0.16;
  let d = 0;
  let step = spec.rimFirst;
  for (;;) {
    const maxStep = d < rimZone ? spec.rimSpacing : spec.innerSpacing;
    step = Math.min(maxStep, step);
    d += step;
    if (d > meanRadius - Math.max(spec.innerSpacing * 0.8, 1.2)) break;
    out.push(d);
    step *= 1.55;
  }
  return out;
}

/**
 * Underside meridian: radial fraction s of each ring (1 at the rim, decreasing toward the
 * center), placed at even arc length along the mean profile so steep and flat parts get the
 * same density.
 */
export function undersideRings(spec: IslandLodSpec, shape: IslandShape): { s: number; steep: number }[] {
  const d = shape.def;
  const R = d.radius;
  const D = d.depth - d.lip;
  // Sample the mean profile (stal = 1) densely near the rim where it is vertical.
  const SAMPLES = 400;
  const ss: number[] = [];
  const ls: number[] = [];
  let len = 0;
  let px = R;
  let py = 0;
  for (let k = 0; k <= SAMPLES; k++) {
    const u = k / SAMPLES;
    const s = 1 - u * u; // dense near s = 1
    const x = s * R;
    const y = D * Math.pow(Math.max(0, 1 - s * s), shape.coneExponent);
    len += Math.hypot(x - px, y - py);
    px = x;
    py = y;
    ss.push(s);
    ls.push(len);
  }
  const total = len;
  const rings: { s: number; steep: number }[] = [];
  let L = 0;
  let step = spec.underSpacing * 0.3;
  let k = 0;
  for (;;) {
    step = Math.min(spec.underSpacing, step);
    L += step;
    step *= 1.5;
    if (L > total - spec.underSpacing * 0.6) break;
    while (k < SAMPLES && ls[k + 1] < L) k++;
    const t = (L - ls[k]) / Math.max(1e-6, ls[k + 1] - ls[k]);
    const s = ss[k] + (ss[k + 1] - ss[k]) * t;
    // Steepness of the profile here: 1 = vertical wall, 0 = flat ceiling.
    const s2 = Math.max(0, s - 0.002);
    const e = shape.coneExponent;
    const dy = D * (Math.pow(Math.max(0, 1 - s2 * s2), e) - Math.pow(Math.max(0, 1 - s * s), e));
    const dx = (s - s2) * R;
    const steep = Math.abs(dy) / Math.max(1e-6, Math.hypot(dx, dy));
    rings.push({ s, steep });
  }
  return rings;
}

/** Cached outline radii for a ring of n evenly spaced angles. */
class OutlineCache {
  private cache = new Map<number, Float64Array>();
  constructor(private shape: IslandShape) {}
  get(n: number): Float64Array {
    let r = this.cache.get(n);
    if (!r) {
      r = new Float64Array(n * 3);
      for (let i = 0; i < n; i++) {
        const th = (i / n) * Math.PI * 2;
        r[i * 3] = this.shape.outlineRadius(th);
        r[i * 3 + 1] = Math.cos(th);
        r[i * 3 + 2] = Math.sin(th);
      }
      this.cache.set(n, r);
    }
    return r;
  }
}

/**
 * Builds one LOD of an island. Yields after each ring (and during painting) so callers can
 * spread the work over frames; drive it to completion with `runToEnd`.
 */
export function* buildIslandMesh(shape: IslandShape, lodSpec: IslandLodSpec): Generator<void, IslandMeshResult> {
  const d = shape.def;
  const spec = scaledSpec(lodSpec, d.radius);
  const cx = d.x;
  const cy = d.y;
  const cz = d.z;
  const Rmax = shape.maxRadius;
  const N = Math.min(1024, Math.max(spec.minRimSegments, ceil4((2 * Math.PI * Rmax) / spec.rimSpacing)));
  const outline = new OutlineCache(shape);

  const estVerts = Math.ceil((Math.PI * Rmax * Rmax) / (spec.innerSpacing * spec.innerSpacing) * 1.6 + N * 30);
  const b = new MeshBuilder(estVerts);
  // Per-vertex bookkeeping for the paint pass.
  let region = new Uint8Array(estVerts);
  let aux = new Float32Array(estVerts);
  const mark = (i: number, r: Region, a: number) => {
    if (i >= region.length) {
      const nr = new Uint8Array(region.length * 2);
      nr.set(region);
      region = nr;
      const na = new Float32Array(aux.length * 2);
      na.set(aux);
      aux = na;
    }
    region[i] = r;
    aux[i] = a;
  };

  // --- Top ------------------------------------------------------------------------------------
  const dists = topRingDistances(spec, d.radius);
  const rimZone = d.radius * 0.16;
  // Build center-out: a pole, then rings from the innermost to the rim.
  const center = b.vertex(0, shape.topHeight(cx, cz) - cy, 0);
  mark(center, Region.Top, 0);
  let prev: Ring = { start: center, count: 1 };
  let prevCount = N;
  const counts: number[] = [];
  // Segment counts are decided rim-inward (monotone non-increasing toward the center).
  for (const dist of dists) {
    const t = 1 - dist / d.radius;
    const seg = dist < rimZone ? spec.rimSpacing : spec.innerSpacing;
    // The rim ring always has the full count: the brow and cliff rings above it share it.
    const n = dist === 0 ? N : Math.min(prevCount, Math.max(6, ceil4((2 * Math.PI * t * Rmax) / seg)));
    counts.push(n);
    prevCount = n;
  }
  for (let k = dists.length - 1; k >= 0; k--) {
    const t = 1 - dists[k] / d.radius;
    const n = counts[k];
    const ol = outline.get(n);
    const start = b.vertexCount;
    for (let i = 0; i < n; i++) {
      const R = ol[i * 3] * t;
      const x = cx + ol[i * 3 + 1] * R;
      const z = cz + ol[i * 3 + 2] * R;
      const v = b.vertex(x - cx, shape.topHeight(x, z) - cy, z - cz);
      mark(v, Region.Top, t);
    }
    const ring = { start, count: n };
    b.stitch(prev, ring);
    prev = ring;
    yield;
  }
  const topVertexCount = b.vertexCount;
  const rimRing = prev;

  // --- Brow, lip and cliff band ------------------------------------------------------------------
  {
    const ol = outline.get(N);
    const rimY = new Float64Array(N);
    for (let i = 0; i < N; i++) rimY[i] = b.y(rimRing.start + i);
    // The foot follows the analytic underside rim (ragged on filler islands, tilted with them).
    const footYs = new Float64Array(N);
    for (let i = 0; i < N; i++) footYs[i] = shape.rimBottomAt((i / N) * Math.PI * 2) - cy;
    const footAt = (i: number) => footYs[i];
    /** Adds a full-resolution ring at radial offset dr(i, y) from the outline and height y(i). */
    const ring = (yAt: (i: number) => number, dr: (i: number, y: number) => number, r: Region) => {
      const start = b.vertexCount;
      for (let i = 0; i < N; i++) {
        const y = yAt(i);
        const R = ol[i * 3] + dr(i, y);
        const v = b.vertex(ol[i * 3 + 1] * R, y, ol[i * 3 + 2] * R);
        mark(v, r, rimY[i] - y);
      }
      const rr = { start, count: N };
      b.stitch(prev, rr);
      prev = rr;
    };
    // Erosion gullies and buttresses running down the cliff (recessed only, so always inside
    // the collision rim): they break the band into a natural face instead of a smooth barrel.
    const gDepth = gullyDepth(d.radius);
    const gully = new Float64Array(N);
    for (let i = 0; i < N; i++) gully[i] = gullyAt(ol[i * 3 + 1], ol[i * 3 + 2], ol[i * 3], d.seed) * gDepth;
    /** Strata recess plus gullies of the cliff face at ring vertex i, local height y. */
    const ledge = (i: number, y: number) => {
      // Gullies start just under the lip and deepen over the first few meters.
      const g = gully[i] * smoothstep(LIP_DROP, LIP_DROP + 3, rimY[i] - y);
      if (!spec.ledges) return 0.45 + g * 0.8;
      const r = ol[i * 3];
      return 0.1 + Math.max(strataRecess(cx + ol[i * 3 + 1] * r, y + cy, cz + ol[i * 3 + 2] * r), g);
    };
    ring((i) => rimY[i] - BROW_DROP, () => BROW_OUT, Region.Brow);
    const detailed = spec.cliffSpacing > 0;
    if (detailed) ring((i) => rimY[i] - LIP_DROP, () => -LIP_IN, Region.Lip);
    // Cliff face from just under the lip down to the foot (which is the underside's rim ring).
    let meanH = 0;
    for (let i = 0; i < N; i++) meanH += rimY[i] - footYs[i];
    meanH /= N;
    const top0 = detailed ? CLIFF_START : BROW_DROP;
    const K = detailed ? Math.max(2, Math.round((meanH - CLIFF_START) / spec.cliffSpacing)) : 1;
    for (let k = 1; k <= K; k++) {
      const f = k / K;
      ring(
        (i) => (k === K ? footAt(i) : rimY[i] - top0 + (footAt(i) - rimY[i] + top0) * f),
        (i, y) => -ledge(i, y),
        Region.Cliff,
      );
      if (k % 2 === 0) yield;
    }
  }
  const footRing = prev;
  const splitIndex = b.indexCount;
  yield;

  // --- Underside --------------------------------------------------------------------------------
  const rings = undersideRings(spec, shape);
  let count = N;
  for (const { s, steep } of rings) {
    const n = Math.min(count, Math.max(6, ceil4((2 * Math.PI * s * Rmax) / spec.underSpacing)));
    count = n;
    const ol = outline.get(n);
    const start = b.vertexCount;
    for (let i = 0; i < n; i++) {
      const R = ol[i * 3] * s;
      const cs = ol[i * 3 + 1];
      const sn = ol[i * 3 + 2];
      const x = cx + cs * R;
      const z = cz + sn * R;
      const yb = shape.bottomHeight(x, z);
      const depth = shape.rimBottomAt((i / n) * Math.PI * 2) - yb;
      const y = yb;
      // Strata ledges (and the cliff's gullies, fading out) on the steep upper underside, fading
      // out where it flattens into a ceiling.
      const g = gullyAt(cs, sn, ol[i * 3], d.seed) * gullyDepth(d.radius) * gullyFade(depth, d.depth);
      let inset = (spec.ledges ? 0.1 + Math.max(strataRecess(x, y, z), g) : 0.45 + g * 0.8) * steep * steep;
      if (inset < 0.01) inset = 0;
      const rr = Math.max(0, R - inset);
      // Where the crags make the bottom bulge outward, insetting could poke below the analytic
      // surface; never let visible rock hang below what you collide with.
      const yi = inset > 0 ? Math.max(y, shape.bottomHeight(cx + cs * rr, cz + sn * rr)) : y;
      const v = b.vertex(cs * rr, yi - cy, sn * rr);
      mark(v, Region.Under, depth);
    }
    const ring = { start, count: n };
    b.stitch(prev, ring);
    prev = ring;
    yield;
  }
  // Bottom tip.
  const tipY = shape.bottomHeight(cx, cz);
  const tip = b.vertex(0, tipY - cy, 0);
  mark(tip, Region.Under, cy - d.lip - tipY);
  b.stitch(prev, { start: tip, count: 1 });

  // --- Paint ------------------------------------------------------------------------------------
  const normals = yield* b.normalsSliced();
  const painter = new IslandPainter(shape);
  for (let i = 0; i < b.vertexCount; i++) {
    painter.paint(b, i, region[i] as Region, aux[i], normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
    if (i % (SLICE / 4) === SLICE / 4 - 1) yield;
  }
  return { data: b.finish(normals), rimRing, footRing, topVertexCount, splitIndex };
}

/** Drives a builder generator to completion synchronously. */
export function runToEnd<T>(gen: Generator<void, T>): T {
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
  }
}
