// Procedural cloud textures, generated once at startup on the CPU (no images ship with the
// game). Both tile seamlessly.
//
//   Sea tile (RGBA8, tiling):
//     R  billow height: a union of soft domes at three scales — cauliflower cumulus tops
//     G  macro swell: smooth periodic fbm, sampled at a much larger scale for big rolling
//        troughs and crests
//     B,A  normal x/z of R at its intended world scale (SEA_TILE m, SEA_RANGE m tall)
//
//   Puff atlas (RGBA8, 2×2 variants): one soft cumulus puff per cell.
//     R,G  normal x/y in the billboard plane   B  thickness   A  coverage

import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, RepeatWrapping, ClampToEdgeWrapping, UnsignedByteType } from 'three';
import { mulberry32 } from '../core/rng';
import { clamp01, smoothstep } from '../core/math';

/** World size of one sea tile (m). */
export const SEA_TILE = 1500;
/** World size of the macro swell tile (m). */
export const SEA_MACRO_TILE = 13000;
/** Height from the deepest trough to the highest crest (m). */
export const SEA_RANGE = 150;
/** How much of the range the billows (R) contribute at full macro swell; the shader matches. */
export const SEA_BILLOW_WEIGHT = 0.72;

export interface SeaField {
  size: number;
  /** Billow height 0..1. */
  billow: Float32Array;
  /** Macro swell 0..1. */
  macro: Float32Array;
  /** Mean of the composite height the shader builds (0..1), for the far-field horizon. */
  mean01: number;
}

/** Smooth maximum: rounds the creases where two domes meet. */
function smax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

/**
 * Add one layer of periodic domes (jittered cell points with a rounded profile) to `out`.
 * Domes merge with a smooth max, so neighbours swell into each other like cumulus.
 */
function addDomes(out: Float32Array, size: number, cells: number, seed: number, weight: number, rMin = 0.8, rMax = 1.1): void {
  const rnd = mulberry32(seed);
  const n = cells * cells;
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const pr = new Float32Array(n);
  const pa = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    px[i] = 0.15 + 0.7 * rnd();
    py[i] = 0.15 + 0.7 * rnd();
    pr[i] = rMin + (rMax - rMin) * rnd();
    pa[i] = 0.55 + 0.45 * rnd();
  }
  for (let j = 0; j < size; j++) {
    const v = ((j + 0.5) / size) * cells;
    const cy = Math.floor(v);
    for (let i = 0; i < size; i++) {
      const u = ((i + 0.5) / size) * cells;
      const cx = Math.floor(u);
      let best = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const gy = cy + dy;
        const wy = ((gy % cells) + cells) % cells;
        for (let dx = -1; dx <= 1; dx++) {
          const gx = cx + dx;
          const wx = ((gx % cells) + cells) % cells;
          const k = wy * cells + wx;
          const ddx = gx + px[k] - u;
          const ddy = gy + py[k] - v;
          const r = pr[k];
          const q = (ddx * ddx + ddy * ddy) / (r * r);
          if (q >= 1) continue;
          // Round heads: a near-circular profile keeps slope across the whole dome.
          const h = pa[k] * Math.pow(1 - q, 0.55);
          best = smax(best, h, 0.28);
        }
      }
      out[j * size + i] += best * weight;
    }
  }
}

/** Periodic value-noise fbm in 0..1 (period = `cells` at the base octave). */
function addPeriodicFbm(out: Float32Array, size: number, cells: number, octaves: number, seed: number): void {
  for (let o = 0; o < octaves; o++) {
    const c = cells << o;
    const amp = Math.pow(0.5, o);
    const rnd = mulberry32(seed + o * 7919);
    const lattice = new Float32Array(c * c);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rnd();
    for (let j = 0; j < size; j++) {
      const v = (j / size) * c;
      const y0 = Math.floor(v);
      const fy = v - y0;
      const sy = fy * fy * (3 - 2 * fy);
      const ya = y0 % c;
      const yb = (y0 + 1) % c;
      for (let i = 0; i < size; i++) {
        const u = (i / size) * c;
        const x0 = Math.floor(u);
        const fx = u - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const xa = x0 % c;
        const xb = (x0 + 1) % c;
        const a = lattice[ya * c + xa];
        const b = lattice[ya * c + xb];
        const d = lattice[yb * c + xa];
        const e = lattice[yb * c + xb];
        out[j * size + i] += amp * (a + (b - a) * sx + (d - a) * sy + (a - b - d + e) * sx * sy);
      }
    }
  }
}

function normalize01(a: Float32Array): void {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < lo) lo = a[i];
    if (a[i] > hi) hi = a[i];
  }
  const k = 1 / Math.max(1e-6, hi - lo);
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - lo) * k;
}

/** The composite height (0..1) the sea shader builds from a billow and a macro sample. */
export function seaComposite(billow: number, macro: number): number {
  // Big swells both lift the layer and grow its billows, so calm flats alternate with towering crests.
  return macro * (1 - SEA_BILLOW_WEIGHT) + billow * SEA_BILLOW_WEIGHT * (0.55 + 0.45 * macro);
}

export function generateSeaField(size = 512, seed = 0xc10d5): SeaField {
  // Cumulus heads, then bulges that ride on them (cauliflower): smaller domes grow mostly where
  // the bigger forms already are, so valleys stay smooth and crests stay busy.
  const n = size * size;
  const big = new Float32Array(n);
  const med = new Float32Array(n);
  const small = new Float32Array(n);
  addDomes(big, size, 6, seed + 1, 1, 0.72, 1.02);
  addDomes(med, size, 15, seed + 2, 1, 0.75, 1.05);
  addDomes(small, size, 38, seed + 3, 1, 0.8, 1.1);
  const billow = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const b = big[i];
    const m = med[i] * (0.25 + 0.75 * b);
    billow[i] = b * 0.6 + m * 0.3 + small[i] * 0.1 * (0.2 + 0.8 * Math.min(1, b + m * 0.5));
  }
  normalize01(billow);
  // Lift the troughs a little: a cloud sea has few deep holes.
  for (let i = 0; i < billow.length; i++) billow[i] = Math.pow(billow[i], 0.8);

  const macro = new Float32Array(size * size);
  addPeriodicFbm(macro, size, 3, 4, seed + 11);
  normalize01(macro);
  for (let i = 0; i < macro.length; i++) macro[i] = smoothstep(0.08, 0.92, macro[i]);

  let mean = 0;
  for (let i = 0; i < billow.length; i++) mean += seaComposite(billow[i], macro[i]);
  return { size, billow, macro, mean01: mean / billow.length };
}

/**
 * CPU twin of the sea shader's surface: the height (0..1 within the layer) under world (x, z)
 * for the current wind drift. Bilinear on the full-resolution field.
 */
export function seaHeight01(field: SeaField, x: number, z: number, driftX: number, driftZ: number): number {
  const b = sampleWrapped(field.billow, field.size, (x - driftX) / SEA_TILE, (z - driftZ) / SEA_TILE);
  const m = sampleWrapped(field.macro, field.size, (x - driftX * MACRO_DRIFT) / SEA_MACRO_TILE, (z - driftZ * MACRO_DRIFT) / SEA_MACRO_TILE);
  return seaComposite(b, m);
}

/** The swell travels slower than the billows riding it, so the sea reshapes as it flows. */
export const MACRO_DRIFT = 0.55;

function sampleWrapped(a: Float32Array, size: number, u: number, v: number): number {
  // Texel centers sit at (i + 0.5) / size, like the GPU's.
  const fx = (u - Math.floor(u)) * size - 0.5;
  const fy = (v - Math.floor(v)) * size - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const xa = ((x0 % size) + size) % size;
  const xb = (xa + 1) % size;
  const ya = ((y0 % size) + size) % size;
  const yb = (ya + 1) % size;
  const p = a[ya * size + xa];
  const q = a[ya * size + xb];
  const r = a[yb * size + xa];
  const t = a[yb * size + xb];
  return p + (q - p) * tx + (r - p) * ty + (p - q - r + t) * tx * ty;
}

/** Separable wrapped box blur (radius r), used to soften normals: clouds have no sharp creases. */
function blurWrapped(src: Float32Array, size: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const k = 1 / (2 * r + 1);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += src[j * size + ((i + d + size) % size)];
      tmp[j * size + i] = s * k;
    }
  }
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += tmp[((j + d + size) % size) * size + i];
      out[j * size + i] = s * k;
    }
  }
  return out;
}

export function seaTexture(field: SeaField): DataTexture {
  const { size, macro } = field;
  const billow = field.billow;
  const soft = blurWrapped(billow, size, 2);
  const data = new Uint8Array(size * size * 4);
  // World-space slope of the billow term at average swell.
  const slopeScale = (SEA_RANGE * SEA_BILLOW_WEIGHT * 0.78 * size) / (2 * SEA_TILE);
  for (let j = 0; j < size; j++) {
    const jm = ((j - 1 + size) % size) * size;
    const jp = ((j + 1) % size) * size;
    for (let i = 0; i < size; i++) {
      const im = (i - 1 + size) % size;
      const ip = (i + 1) % size;
      const idx = j * size + i;
      const sx = (soft[j * size + ip] - soft[j * size + im]) * slopeScale;
      const sz = (soft[jp + i] - soft[jm + i]) * slopeScale;
      const inv = 1 / Math.sqrt(sx * sx + 1 + sz * sz);
      data[idx * 4] = Math.round(clamp01(billow[idx]) * 255);
      data[idx * 4 + 1] = Math.round(clamp01(macro[idx]) * 255);
      data[idx * 4 + 2] = Math.round((0.5 - 0.5 * sx * inv) * 255);
      data[idx * 4 + 3] = Math.round((0.5 - 0.5 * sz * inv) * 255);
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------------------------
// Puffs
// ---------------------------------------------------------------------------------------------

export const PUFF_VARIANTS = 4;

/** 2×2 atlas of soft cumulus puffs, `cell` pixels per variant. */
export function puffAtlas(cell = 128, seed = 0x9f0ff): DataTexture {
  const size = cell * 2;
  const data = new Uint8Array(size * size * 4);
  const h = new Float32Array(cell * cell);
  const rnd = mulberry32(seed);
  for (let v = 0; v < PUFF_VARIANTS; v++) {
    // A cluster of lobes: one big body plus smaller bulges, biased upward like a cumulus crown.
    const lobes: [number, number, number][] = [[0, -0.05, 0.5]];
    const count = 6 + Math.floor(rnd() * 4);
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2;
      const d = 0.18 + rnd() * 0.24;
      const r = 0.18 + rnd() * 0.17;
      lobes.push([Math.cos(a) * d, Math.sin(a) * d * 0.8 + 0.06, r]);
    }
    const noiseSeed = mulberry32(seed + 31 * (v + 1));
    const grid = new Float32Array(17 * 17);
    for (let i = 0; i < grid.length; i++) grid[i] = noiseSeed();
    const vnoise = (x: number, y: number) => {
      const gx = (x * 0.5 + 0.5) * 16;
      const gy = (y * 0.5 + 0.5) * 16;
      const x0 = Math.max(0, Math.min(15, Math.floor(gx)));
      const y0 = Math.max(0, Math.min(15, Math.floor(gy)));
      const fx = smoothstep(0, 1, gx - x0);
      const fy = smoothstep(0, 1, gy - y0);
      const a = grid[y0 * 17 + x0];
      const b = grid[y0 * 17 + x0 + 1];
      const c = grid[(y0 + 1) * 17 + x0];
      const d = grid[(y0 + 1) * 17 + x0 + 1];
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    };
    for (let j = 0; j < cell; j++) {
      for (let i = 0; i < cell; i++) {
        // Billboard coords in -1..1 with a margin so mips never bleed between cells.
        const x = ((i + 0.5) / cell) * 2.2 - 1.1;
        const y = ((j + 0.5) / cell) * 2.2 - 1.1;
        let best = 0;
        for (const [lx, ly, lr] of lobes) {
          const q = ((x - lx) * (x - lx) + (y - ly) * (y - ly)) / (lr * lr);
          // Bell-shaped lobes: soft shoulders, no hard ball outlines.
          if (q < 1) best = smax(best, Math.pow(1 - q, 1.3) * lr * 2.2, 0.2);
        }
        h[j * cell + i] = best;
      }
    }
    const ox = (v % 2) * cell;
    const oy = Math.floor(v / 2) * cell;
    for (let j = 0; j < cell; j++) {
      for (let i = 0; i < cell; i++) {
        const x = ((i + 0.5) / cell) * 2.2 - 1.1;
        const y = ((j + 0.5) / cell) * 2.2 - 1.1;
        const c = h[j * cell + i];
        const hx = (h[j * cell + Math.min(cell - 1, i + 1)] - h[j * cell + Math.max(0, i - 1)]) * (cell / 4.4);
        const hy = (h[Math.min(cell - 1, j + 1) * cell + i] - h[Math.max(0, j - 1) * cell + i]) * (cell / 4.4);
        // Normal of the height field seen face-on; strength tuned so lobes read as round.
        let nx = -hx * 0.75;
        let ny = -hy * 0.75;
        const len = Math.hypot(nx, ny, 1);
        nx /= len;
        ny /= len;
        // Ragged, wispy rim: erode the edge with noise.
        const n = vnoise(x, y) * 0.65 + vnoise(x * 2.3 + 0.7, y * 2.3 - 0.4) * 0.35;
        const edge = c - (n - 0.5) * 0.28;
        const alpha = smoothstep(0.0, 0.26, edge) * (1 - smoothstep(0.88, 1.08, Math.hypot(x, y)));
        const k = ((oy + j) * size + ox + i) * 4;
        data[k] = Math.round((nx * 0.5 + 0.5) * 255);
        data[k + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        data[k + 2] = Math.round(clamp01(c / 0.9) * 255);
        data[k + 3] = Math.round(clamp01(alpha) * 255);
      }
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
