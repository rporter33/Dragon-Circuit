// Shared base geometry for ground cover: one grass tuft (several curved blades) and one flower
// cluster. Each chunk draws thousands of instances of these; all bending, wind and LOD happen in
// the vertex shader (fieldMaterial.ts).

import { BufferAttribute, BufferGeometry } from 'three';
import { mulberry32 } from '../../../core/rng';

const BLADES = 5;
const SEGMENTS = 3;
const FILLERS = 3;

/**
 * Tuft vertex layout:
 *   position = (root offset x, height fraction t, root offset z)   (meters at width scale 1)
 *   aBlade   = (side -1..1 across the blade, blade height factor, blade yaw, root width (m))
 */
export function tuftGeometry(): BufferGeometry {
  const rnd = mulberry32(0x9a55);
  const pos: number[] = [];
  const blade: number[] = [];
  const idx: number[] = [];
  const addBlade = (a: number, r: number, hf: number, w: number, segs: number) => {
    const rx = Math.cos(a) * r;
    const rz = Math.sin(a) * r;
    const yaw = a + Math.PI / 2 + (rnd() - 0.5) * 0.9;
    const base = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      if (s < segs) {
        pos.push(rx, t, rz, rx, t, rz);
        blade.push(-1, hf, yaw, w, 1, hf, yaw, w);
      } else {
        pos.push(rx, t, rz);
        blade.push(0, hf, yaw, w);
      }
    }
    for (let s = 0; s < segs - 1; s++) {
      const i = base + s * 2;
      idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
    const last = base + (segs - 1) * 2;
    idx.push(last, last + 1, last + 2);
  };
  for (let b = 0; b < BLADES; b++) {
    const a = (b / BLADES) * Math.PI * 2 + rnd() * 0.6;
    const r = 0.03 + rnd() * 0.15;
    // Taller blades in the middle of the tuft.
    addBlade(a, r, 0.55 + 0.45 * (1 - r / 0.18) * (0.7 + rnd() * 0.3), 0.04 + rnd() * 0.03, SEGMENTS);
  }
  // Short, wide filler blades splayed outward cover the ground between tufts.
  for (let b = 0; b < FILLERS; b++) {
    const a = (b / FILLERS) * Math.PI * 2 + rnd() * 1.2;
    addBlade(a, 0.12 + rnd() * 0.1, 0.32 + rnd() * 0.12, 0.07 + rnd() * 0.03, 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aBlade', new BufferAttribute(new Float32Array(blade), 4));
  g.setIndex(idx);
  return g;
}

/**
 * Flower cluster vertex layout:
 *   position = (x, y, z) with y in "stem heights" (1 = top of the stem), x/z in meters
 *   aFl      = (part: 0 stem / 1 petal / 2 heart, sway weight 0..1, petal radial 0..1, flower seed)
 *   normal   = lighting normal (petals face up and slightly out)
 */
export function flowerGeometry(): BufferGeometry {
  const rnd = mulberry32(0xf10e);
  const pos: number[] = [];
  const nrm: number[] = [];
  const fl: number[] = [];
  const idx: number[] = [];
  const FLOWERS = 5;
  for (let f = 0; f < FLOWERS; f++) {
    const a = (f / FLOWERS) * Math.PI * 2 + rnd() * 1.2;
    const r = f === 0 ? 0 : 0.1 + rnd() * 0.2;
    const fx = Math.cos(a) * r;
    const fz = Math.sin(a) * r;
    const hf = f === 0 ? 1 : 0.62 + rnd() * 0.3;
    const seed = rnd();
    // Stem: a thin two-segment strip bowing slightly outward.
    const sw = 0.012;
    const base = pos.length / 3;
    for (let s = 0; s <= 2; s++) {
      const t = s / 2;
      const bow = t * t * 0.06;
      const x = fx + Math.cos(a) * bow;
      const z = fz + Math.sin(a) * bow;
      pos.push(x - sw * Math.sin(a), t * hf, z + sw * Math.cos(a), x + sw * Math.sin(a), t * hf, z - sw * Math.cos(a));
      nrm.push(0, 1, 0, 0, 1, 0);
      fl.push(0, t * hf, 0, seed, 0, t * hf, 0, seed);
    }
    for (let s = 0; s < 2; s++) {
      const i = base + s * 2;
      idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
    // Head: a 5-lobed dab tilted outward, with a raised heart.
    const hx = fx + Math.cos(a) * 0.06;
    const hz = fz + Math.sin(a) * 0.06;
    const hy = hf;
    const tilt = 0.35 + rnd() * 0.3;
    const tx = Math.cos(a) * tilt;
    const tz = Math.sin(a) * tilt;
    const ny = 1;
    const nl = Math.hypot(tx, ny, tz);
    const R = 0.1 + rnd() * 0.045;
    const lobes = 5;
    const ring = lobes * 2;
    const c0 = pos.length / 3;
    pos.push(hx, hy + 0.012 / 1, hz);
    nrm.push(tx / nl, ny / nl, tz / nl);
    fl.push(2, hy, 0, seed);
    const spin = rnd() * Math.PI;
    for (let k = 0; k < ring; k++) {
      const th = spin + (k / ring) * Math.PI * 2;
      const rr = k % 2 === 0 ? R : R * 0.55;
      const lx = Math.cos(th) * rr;
      const lz = Math.sin(th) * rr;
      // Tilt the disc: lift the side facing inward, drop the outward side.
      const ly = -(lx * tx + lz * tz) * 0.9;
      pos.push(hx + lx, hy + ly, hz + lz);
      nrm.push(tx / nl, ny / nl, tz / nl);
      fl.push(1, hy, rr / R, seed);
    }
    for (let k = 0; k < ring; k++) idx.push(c0, c0 + 1 + ((k + 1) % ring), c0 + 1 + k);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('aFl', new BufferAttribute(new Float32Array(fl), 4));
  g.setIndex(idx);
  return g;
}
