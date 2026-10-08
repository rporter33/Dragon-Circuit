// Ground-cover content of one square chunk of the world: grass tufts (and heather) plus flower
// clusters, scattered deterministically over every island top that crosses the chunk. Pure: runs
// in unit tests and produces identical output for identical inputs.
//
// Instances are emitted in "rank" order from a low-discrepancy sequence, so any prefix of the
// list is itself an even sample of the chunk. The renderer exploits that for distance LOD: far
// chunks draw only a prefix, and the shader thins instances smoothly by rank — no popping.

import { hashSeed, mulberry32 } from '../../../core/rng';
import { noise2 } from '../../../core/noise';
import { smoothstep } from '../../../core/math';
import type { Terrain } from '../../terrain';
import type { IslandShape } from '../../islandShape';
import type { ExclusionSet } from '../exclusions';
import { fieldStyle, hexBytes } from './fieldStyle';

export const CHUNK_SIZE = 32;
/** Height lattice spacing inside a chunk (m). */
const LATTICE = 2;
const LN = CHUNK_SIZE / LATTICE + 1;
/** Lattice with a one-sample border for normals. */
const LB = LN + 2;

/** Per-instance attribute arrays (struct-of-arrays, GPU-ready). */
export interface InstanceArrays {
  count: number;
  /** x, y, z, yaw */
  pos: Float32Array;
  /** height (m), width scale, rank 0..1, lean/seed 0..1 */
  shape: Float32Array;
  /** sRGB bytes: base r, g, b + terrain normal x (0..255 ↔ -1..1). Flowers: stem rgb + glow. */
  base: Uint8Array;
  /** sRGB bytes: tip r, g, b + terrain normal z. Flowers: petal rgb + kind. */
  tip: Uint8Array;
}

export interface FieldChunkData {
  cx: number;
  cz: number;
  tufts: InstanceArrays;
  flowers: InstanceArrays;
  minY: number;
  maxY: number;
}

export interface FieldParams {
  /** quality.grassDensity */
  density: number;
  /** quality.propDensity (scales flowers too) */
  flowerDensity: number;
}

export function allocInstances(capacity: number): InstanceArrays {
  return {
    count: 0,
    pos: new Float32Array(capacity * 4),
    shape: new Float32Array(capacity * 4),
    base: new Uint8Array(capacity * 4),
    tip: new Uint8Array(capacity * 4),
  };
}

/** Upper bound on tufts in one chunk at a given grass density (one island fully covering it). */
export function tuftCapacity(density: number): number {
  return Math.ceil(7.2 * density * CHUNK_SIZE * CHUNK_SIZE) + 16;
}

export function flowerCapacity(density: number): number {
  return Math.ceil(0.16 * density * CHUNK_SIZE * CHUNK_SIZE) + 16;
}

// R2 low-discrepancy sequence (Roberts 2018): any prefix covers the square evenly.
const G2 = 1.324717957244746;
const A1 = 1 / G2;
const A2 = 1 / (G2 * G2);

const heights = new Float64Array(LB * LB);

/** Fill the lattice for one island over the chunk; returns false if it misses entirely. */
function fillLattice(shape: IslandShape, x0: number, z0: number): void {
  for (let j = 0; j < LB; j++) {
    for (let i = 0; i < LB; i++) {
      const x = x0 + (i - 1) * LATTICE;
      const z = z0 + (j - 1) * LATTICE;
      heights[j * LB + i] = shape.topHeight(x, z);
    }
  }
}

interface Sample {
  y: number;
  nx: number;
  nz: number;
}
const sample: Sample = { y: 0, nx: 0, nz: 0 };

/** Bilinear height + lattice-gradient normal at a point inside the chunk. */
function sampleLattice(x0: number, z0: number, x: number, z: number): Sample {
  const fx = (x - x0) / LATTICE + 1;
  const fz = (z - z0) / LATTICE + 1;
  let i = Math.floor(fx);
  let j = Math.floor(fz);
  i = i < 1 ? 1 : i > LB - 3 ? LB - 3 : i;
  j = j < 1 ? 1 : j > LB - 3 ? LB - 3 : j;
  const tx = fx - i;
  const tz = fz - j;
  const h00 = heights[j * LB + i];
  const h10 = heights[j * LB + i + 1];
  const h01 = heights[(j + 1) * LB + i];
  const h11 = heights[(j + 1) * LB + i + 1];
  sample.y = (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  // Central differences around the nearest lattice node.
  const ni = Math.round(fx);
  const nj = Math.round(fz);
  const ci = ni < 1 ? 1 : ni > LB - 2 ? LB - 2 : ni;
  const cj = nj < 1 ? 1 : nj > LB - 2 ? LB - 2 : nj;
  const dx = (heights[cj * LB + ci + 1] - heights[cj * LB + ci - 1]) / (2 * LATTICE);
  const dz = (heights[(cj + 1) * LB + ci] - heights[(cj - 1) * LB + ci]) / (2 * LATTICE);
  const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
  sample.nx = -dx * inv;
  sample.nz = -dz * inv;
  return sample;
}

const toByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/**
 * Generate one chunk. `out` arrays are reused when given (and must have enough capacity).
 */
export function generateFieldChunk(
  terrain: Terrain,
  exclusions: ExclusionSet | null,
  cx: number,
  cz: number,
  params: FieldParams,
  out?: FieldChunkData,
): FieldChunkData {
  const tufts = out?.tufts ?? allocInstances(tuftCapacity(params.density));
  const flowers = out?.flowers ?? allocInstances(flowerCapacity(params.flowerDensity));
  tufts.count = 0;
  flowers.count = 0;
  const data: FieldChunkData = out ?? { cx, cz, tufts, flowers, minY: Infinity, maxY: -Infinity };
  data.cx = cx;
  data.cz = cz;
  data.minY = Infinity;
  data.maxY = -Infinity;
  const S = CHUNK_SIZE;
  const x0 = cx * S;
  const z0 = cz * S;
  const tCap = tufts.pos.length / 4;
  const fCap = flowers.pos.length / 4;

  // Islands crossing this chunk (copy: candidates() reuses its array).
  const islands: IslandShape[] = [];
  for (const s of terrain.candidates(x0 + S / 2, z0 + S / 2, S * 0.75)) {
    if (s.type !== 'island') continue;
    const sh = s.shape;
    const d = sh.def;
    const nx = Math.max(x0, Math.min(d.x, x0 + S));
    const nz = Math.max(z0, Math.min(d.z, z0 + S));
    if (Math.hypot(nx - d.x, nz - d.z) > sh.maxRadius) continue;
    islands.push(sh);
  }
  if (islands.length === 0) return data;

  for (const shape of islands) {
    const def = shape.def;
    const style = fieldStyle(def);
    const rnd = mulberry32(hashSeed(cx, cz, def.id, 17));
    fillLattice(shape, x0, z0);
    const patchN = noise2(def.seed + 211);
    const heatherN = noise2(def.seed + 223);
    const flowerN = noise2(def.seed + 227);
    const baseB = hexBytes(style.base);
    const tipB = hexBytes(style.tip);
    const dryB = hexBytes(style.tipDry);
    const hBaseB = hexBytes(style.heatherBase);
    const hTipB = hexBytes(style.heatherTip);
    const plazaS = def.kind === 'roost' || def.kind === 'ruin' ? def.flatCenter * 0.55 : -1;

    // --- grass tufts ---------------------------------------------------------------------------
    const n = Math.round(style.density * def.grass * params.density * S * S);
    const o1 = rnd();
    const o2 = rnd();
    for (let i = 0; i < n && tufts.count < tCap; i++) {
      const jx = (rnd() - 0.5) * 0.7;
      const jz = (rnd() - 0.5) * 0.7;
      const x = x0 + ((o1 + i * A1) % 1) * S + jx;
      const z = z0 + ((o2 + i * A2) % 1) * S + jz;
      const s = shape.normRadius(x, z);
      if (s > 0.985) continue;
      const smp = sampleLattice(x0, z0, x, z);
      const ny = Math.sqrt(Math.max(0, 1 - smp.nx * smp.nx - smp.nz * smp.nz));
      if (shape.surfaceAt(x, z, ny) !== 'grass') continue;
      const ex = exclusions ? exclusions.distance(x, z, true) : Infinity;
      if (ex < 0.2) continue;

      const patch = 0.5 + 0.5 * patchN(x * 0.045, z * 0.045);
      const fine = 0.5 + 0.5 * patchN(x * 0.21 + 40, z * 0.21 - 17);
      let h = style.height * (0.55 + 0.75 * patch) * (0.8 + 0.4 * fine);
      h *= 1 - 0.65 * smoothstep(0.86, 0.985, s); // short turf at the cliff edge
      h *= smoothstep(0.65, 0.95, ny); // thin on steep slopes
      if (plazaS > 0) h *= 0.35 + 0.65 * smoothstep(plazaS, plazaS + 0.06, s); // trodden near paving
      if (ex < 3) h *= 0.35 + 0.65 * smoothstep(0.2, 3, ex);
      if (h < 0.06) continue;

      const heather = style.heather > 0 && heatherN(x * 0.03, z * 0.03) + (rnd() - 0.5) * 0.35 > 1 - 2 * style.heather;
      const k = tufts.count;
      const p4 = k * 4;
      tufts.pos[p4] = x;
      tufts.pos[p4 + 1] = smp.y;
      tufts.pos[p4 + 2] = z;
      tufts.pos[p4 + 3] = rnd() * Math.PI * 2;
      tufts.shape[p4] = heather ? h * 0.7 + 0.12 : h;
      tufts.shape[p4 + 1] = heather ? 1.7 + rnd() * 0.5 : 0.8 + rnd() * 0.45;
      tufts.shape[p4 + 2] = i / n;
      tufts.shape[p4 + 3] = rnd();
      const nxB = toByte((smp.nx * 0.5 + 0.5) * 255);
      const nzB = toByte((smp.nz * 0.5 + 0.5) * 255);
      const vary = 0.88 + rnd() * 0.24; // per-tuft brightness
      if (heather) {
        const pink = rnd() * 0.25;
        tufts.base[p4] = toByte(hBaseB[0] * vary);
        tufts.base[p4 + 1] = toByte(hBaseB[1] * vary);
        tufts.base[p4 + 2] = toByte(hBaseB[2] * vary);
        tufts.tip[p4] = toByte((hTipB[0] + 40 * pink) * vary);
        tufts.tip[p4 + 1] = toByte((hTipB[1] + 10 * pink) * vary);
        tufts.tip[p4 + 2] = toByte((hTipB[2] - 10 * pink) * vary);
      } else {
        const dry = smoothstep(0.55, 0.9, patch) * 0.7 + (rnd() - 0.5) * 0.25;
        const d = Math.max(0, Math.min(1, dry));
        tufts.base[p4] = toByte(baseB[0] * vary);
        tufts.base[p4 + 1] = toByte(baseB[1] * vary);
        tufts.base[p4 + 2] = toByte(baseB[2] * vary);
        tufts.tip[p4] = toByte((tipB[0] + (dryB[0] - tipB[0]) * d) * vary);
        tufts.tip[p4 + 1] = toByte((tipB[1] + (dryB[1] - tipB[1]) * d) * vary);
        tufts.tip[p4 + 2] = toByte((tipB[2] + (dryB[2] - tipB[2]) * d) * vary);
      }
      tufts.base[p4 + 3] = nxB;
      tufts.tip[p4 + 3] = nzB;
      tufts.count++;
      if (smp.y < data.minY) data.minY = smp.y;
      if (smp.y + h > data.maxY) data.maxY = smp.y + h;
    }

    // --- flower clusters (in drifts) -----------------------------------------------------------
    const nf = Math.round(style.flowerDensity * def.grass * params.flowerDensity * S * S * 2.2);
    const f1 = rnd();
    const f2 = rnd();
    const petals = style.flowers.map(hexBytes);
    for (let i = 0; i < nf && flowers.count < fCap; i++) {
      const x = x0 + ((f1 + i * A1) % 1) * S + (rnd() - 0.5) * 1.5;
      const z = z0 + ((f2 + i * A2) % 1) * S + (rnd() - 0.5) * 1.5;
      // Drifts: flowers cluster where a low-frequency noise is high.
      const drift = flowerN(x * 0.025, z * 0.025) * 0.75 + flowerN(x * 0.09 + 13, z * 0.09) * 0.25;
      if (drift < 0.1 + rnd() * 0.35) continue;
      const s = shape.normRadius(x, z);
      if (s > 0.95) continue;
      const smp = sampleLattice(x0, z0, x, z);
      const ny = Math.sqrt(Math.max(0, 1 - smp.nx * smp.nx - smp.nz * smp.nz));
      if (ny < 0.8 || shape.surfaceAt(x, z, ny) !== 'grass') continue;
      if (exclusions && exclusions.distance(x, z, true) < 1) continue;
      const k = flowers.count;
      const p4 = k * 4;
      flowers.pos[p4] = x;
      flowers.pos[p4 + 1] = smp.y;
      flowers.pos[p4 + 2] = z;
      flowers.pos[p4 + 3] = rnd() * Math.PI * 2;
      flowers.shape[p4] = style.height * (0.75 + rnd() * 0.6) + 0.15;
      flowers.shape[p4 + 1] = 0.8 + rnd() * 0.5;
      flowers.shape[p4 + 2] = i / nf;
      flowers.shape[p4 + 3] = rnd();
      // One color per cluster, chosen by the drift so neighbors match (painted drifts).
      const ci = Math.floor((0.5 + 0.5 * flowerN(x * 0.012 - 7, z * 0.012 + 3)) * petals.length * 0.999 + rnd() * 0.6) % petals.length;
      const pc = petals[ci];
      const glow = rnd() < style.flowerGlow ? 255 : 0;
      flowers.base[p4] = toByte(baseB[0] * 1.15);
      flowers.base[p4 + 1] = toByte(baseB[1] * 1.15);
      flowers.base[p4 + 2] = toByte(baseB[2] * 1.15);
      flowers.base[p4 + 3] = glow;
      flowers.tip[p4] = pc[0];
      flowers.tip[p4 + 1] = pc[1];
      flowers.tip[p4 + 2] = pc[2];
      flowers.tip[p4 + 3] = toByte(rnd() * 255);
      flowers.count++;
    }
  }

  // Several islands in one chunk: re-sort by rank so prefixes stay even samples.
  if (islands.length > 1) {
    sortByRank(tufts);
    sortByRank(flowers);
  }
  return data;
}

function sortByRank(a: InstanceArrays): void {
  const n = a.count;
  if (n < 2) return;
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => a.shape[i * 4 + 2] - a.shape[j * 4 + 2]);
  const pos = a.pos.slice(0, n * 4);
  const shape = a.shape.slice(0, n * 4);
  const base = a.base.slice(0, n * 4);
  const tip = a.tip.slice(0, n * 4);
  for (let k = 0; k < n; k++) {
    const s = order[k] * 4;
    const d = k * 4;
    for (let c = 0; c < 4; c++) {
      a.pos[d + c] = pos[s + c];
      a.shape[d + c] = shape[s + c];
      a.base[d + c] = base[s + c];
      a.tip[d + c] = tip[s + c];
    }
  }
}

/**
 * How many instances (a rank prefix) a chunk needs when its nearest point is `dist` away.
 * Mirrors the shader's thinning curve (keepFraction) with a margin.
 */
export function keepFraction(dist: number): number {
  const d = Math.max(dist, 1);
  return Math.min(1, Math.max(0.07, Math.pow(16 / d, 1.15)));
}

export function prefixCount(a: InstanceArrays, keep: number): number {
  // Ranks are ascending; binary search the first rank past the shader's fade-out band.
  const limit = Math.min(1, keep * 1.25 + 0.01);
  let lo = 0;
  let hi = a.count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a.shape[mid * 4 + 2] <= limit) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
