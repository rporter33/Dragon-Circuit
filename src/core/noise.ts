import { createNoise2D, createNoise3D } from 'simplex-noise';
import { mulberry32 } from './rng';

export type Noise2 = (x: number, y: number) => number;
export type Noise3 = (x: number, y: number, z: number) => number;

const cache2 = new Map<number, Noise2>();
const cache3 = new Map<number, Noise3>();

/** Seeded 2D simplex in [-1, 1]. Instances are cached per seed. */
export function noise2(seed: number): Noise2 {
  let n = cache2.get(seed);
  if (!n) {
    n = createNoise2D(mulberry32(seed));
    cache2.set(seed, n);
  }
  return n;
}

/** Seeded 3D simplex in [-1, 1]. Instances are cached per seed. */
export function noise3(seed: number): Noise3 {
  let n = cache3.get(seed);
  if (!n) {
    n = createNoise3D(mulberry32(seed));
    cache3.set(seed, n);
  }
  return n;
}

/** Fractal sum of 2D simplex. Output roughly in [-1, 1]. */
export function fbm2(n: Noise2, x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * n(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged fbm in [0, 1]: sharp crests, good for rocky ridges and strata. */
export function ridged2(n: Noise2, x: number, y: number, octaves = 4): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const v = 1 - Math.abs(n(x * freq, y * freq));
    sum += amp * v * v;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/**
 * Smooth periodic 1D noise over an angle, built from a few seeded sines. Used for island
 * outlines so the boundary closes seamlessly at theta = 2π.
 */
export function periodicNoise(seed: number, harmonics = 5): (theta: number) => number {
  const rnd = mulberry32(seed);
  const amps: number[] = [];
  const phases: number[] = [];
  let norm = 0;
  for (let k = 1; k <= harmonics; k++) {
    const a = (rnd() * 0.6 + 0.4) / k;
    amps.push(a);
    phases.push(rnd() * Math.PI * 2);
    norm += a;
  }
  return (theta: number) => {
    let s = 0;
    for (let k = 0; k < harmonics; k++) s += amps[k] * Math.sin((k + 1) * theta + phases[k]);
    return s / norm;
  };
}
