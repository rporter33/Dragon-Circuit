// Arch and ring meshing: a tube swept along ArchShape's center curve, with world-space rocky
// displacement kept within ±1 m of the collision tube, crevices that split it into weathered
// blocks, and moss on the upward-facing stone. Ends are either buried in the island they stand
// on (the sweep continues a little into the ground) or broken: a jagged fracture that stays
// inside the collision cap, so you never clip visible rock. Positions are local to the center.

import { Color, Vector3 } from 'three';
import type { ArchShape } from '../islandShape';
import type { Terrain } from '../terrain';
import { clamp, smoothstep } from '../../core/math';
import { noise3 } from '../../core/noise';
import { MeshBuilder, type MeshData, type Ring } from './MeshBuilder';
import { hash11 } from './strata';

export interface ArchLodSpec {
  level: number;
  /** Switch distance (m from the arch's bounding sphere). */
  distance: number;
  /** Spacing along the arc (m). */
  along: number;
  /** Spacing around the tube (m). */
  around: number;
  minAround: number;
  maxAround: number;
  capRings: number;
}

export const ARCH_LODS: ArchLodSpec[] = [
  { level: 0, distance: 0, along: 1.6, around: 1.6, minAround: 20, maxAround: 72, capRings: 6 },
  { level: 1, distance: 400, along: 7, around: 6, minAround: 10, maxAround: 24, capRings: 3 },
  { level: 2, distance: 1500, along: 18, around: 15, minAround: 8, maxAround: 12, capRings: 2 },
];

/** Max rock displacement from the collision tube (m). */
export const ARCH_DISPLACE = 1;

const ROCK = new Color('#a39079');
const ROCK_OCHRE = new Color('#ad8f66');
const ROCK_PALE = new Color('#9a978f');
const LICHEN = new Color('#c08a3e');
const ROCK_UNDER = new Color('#6a6272');
const FRESH = new Color('#d1a77a');
const MOSS = new Color('#5f9140');
const MOSS_DARK = new Color('#3f6e35');
const tmp = new Color();

const ceil4 = (v: number) => Math.max(4, Math.ceil(v / 4) * 4);

type EndKind = 'buried' | 'broken';

export function* buildArchMesh(shape: ArchShape, spec: ArchLodSpec, terrain: Terrain): Generator<void, { data: MeshData }> {
  const d = shape.def;
  const R = d.radius;
  const tube = d.tube;
  const K = clamp(ceil4((2 * Math.PI * tube) / spec.around), spec.minAround, spec.maxAround);
  const n1 = noise3(d.seed + 11);
  const n2 = noise3(d.seed + 12);
  const b = new MeshBuilder(4096);
  // Per-vertex paint hints: 0 body, 1 fracture face, 2 buried foot; and the block index.
  const part: number[] = [];
  const block: number[] = [];

  const c = shape.center;
  const C = new Vector3();
  const Rv = new Vector3();
  const T = new Vector3();
  const P = new Vector3();
  const dir = new Vector3();
  const blockLen = tube * 2.2;
  // Flake-scar size: small enough for the scars' slopes to catch the light.
  const facet = Math.max(2.2, Math.min(4.5, tube * 0.25)) * (spec.level === 0 ? 1 : 1.8);

  /** Rock displacement (m) at a point on the undisplaced tube; |result| <= ARCH_DISPLACE. */
  const displace = (p: Vector3, arcLen: number): number => {
    // Flake scars: each Worley cell is a shallow dish with sharp ridges between, so the smooth
    // tube reads as chipped stone without leaving the collision budget.
    const f1 = worley3(p.x / facet, p.y / facet, p.z / facet, d.seed);
    const scar = 1.8 * f1 * f1 - 0.9;
    const lumps = 0.25 * n1(p.x * 0.05, p.y * 0.05, p.z * 0.05);
    // Joints between weathered blocks along the arc.
    const u = arcLen / blockLen + 0.35 * n2(p.x * 0.02, p.y * 0.02, p.z * 0.02);
    const fr = u - Math.floor(u);
    const edge = Math.min(fr, 1 - fr) * blockLen;
    const crevice = Math.exp(-((edge / 1.2) ** 2));
    return clamp(0.85 * scar + lumps - 1.2 * crevice, -ARCH_DISPLACE, ARCH_DISPLACE);
  };
  /** Which weathered block an arc length falls in (for per-block tint). */
  const blockOf = (p: Vector3, arcLen: number) => Math.floor(arcLen / blockLen + 0.35 * n2(p.x * 0.02, p.y * 0.02, p.z * 0.02));

  const frame = (a: number) => {
    C.copy(c).addScaledVector(shape.right, Math.cos(a) * R).addScaledVector(shape.up, Math.sin(a) * R);
    Rv.copy(shape.right).multiplyScalar(Math.cos(a)).addScaledVector(shape.up, Math.sin(a));
    T.copy(shape.right).multiplyScalar(-Math.sin(a)).addScaledVector(shape.up, Math.cos(a));
  };

  /**
   * A tube ring at arc angle a, its radius scaled by `scale`. With `jag`, each point is pushed
   * along the outward tangent (sign `outward`) by jag(phi), clamped inside the collision cap.
   */
  const tubeRing = (a: number, scale: number, tag: number, jag: ((phi: number) => number) | null = null, outward = 1): Ring => {
    frame(a);
    const start = b.vertexCount;
    for (let i = 0; i < K; i++) {
      const phi = (i / K) * Math.PI * 2;
      dir.copy(Rv).multiplyScalar(Math.cos(phi)).addScaledVector(shape.normal, Math.sin(phi));
      P.copy(C).addScaledVector(dir, tube);
      let r = (tube + displace(P, a * R)) * scale;
      let push = 0;
      if (jag) {
        push = jag(phi);
        const lim = tube * 0.98;
        const len = Math.hypot(r, push);
        if (len > lim) {
          r *= lim / len;
          push *= lim / len;
        }
      }
      P.copy(C).addScaledVector(dir, r).addScaledVector(T, push * outward);
      b.vertex(P.x - c.x, P.y - c.y, P.z - c.z);
      part.push(tag);
      block.push(blockOf(P, a * R));
    }
    return { start, count: K };
  };

  /** A single pole vertex `off` m beyond the arc point at a, along the outward tangent. */
  const pole = (a: number, off: number, tag: number): Ring => {
    frame(a);
    const v = b.vertex(C.x - c.x + T.x * off, C.y - c.y + T.y * off, C.z - c.z + T.z * off);
    part.push(tag);
    block.push(0);
    return { start: v, count: 1 };
  };

  // --- End treatment ------------------------------------------------------------------------------
  /** Standing on an island: how far past the end the sweep continues to be fully buried. */
  const endKind = (a: number, sign: number): { kind: EndKind; extend: number } => {
    frame(a);
    const island = terrain.islandAt(C.x, C.z);
    if (!island || island.topHeight(C.x, C.z) < C.y - tube) return { kind: 'broken', extend: 0 };
    let ext = 0;
    for (; ext < 0.5; ext += 0.01) {
      frame(a + sign * ext);
      if (C.y < island.topHeight(C.x, C.z) - tube - 2.5) break;
    }
    return { kind: 'buried', extend: ext };
  };

  let prev: Ring | null = null;
  const link = (r: Ring) => {
    if (prev) b.stitch(prev, r, true);
    prev = r;
  };

  /** Jagged fracture profile for a broken end: how far each point of the face juts out (m). */
  const jagFor = (aEnd: number, u: number) => (phi: number) => {
    frame(aEnd);
    dir.copy(Rv).multiplyScalar(Math.cos(phi)).addScaledVector(shape.normal, Math.sin(phi));
    P.copy(C).addScaledVector(dir, tube * (1 - u));
    const j = 0.5 + 0.5 * n2(P.x * 0.16, P.y * 0.16, P.z * 0.16);
    const j2 = 0.5 + 0.5 * n1(P.x * 0.5, P.y * 0.5, P.z * 0.5);
    return tube * (0.12 + 0.55 * u) * (0.35 + 0.65 * j) + tube * 0.12 * j2 * u;
  };
  const capRings = spec.capRings;
  const capScale = (u: number) => Math.sqrt(1 - u * u) * 0.98 + 0.02;

  let a0 = 0;
  let a1 = Math.PI * 2;
  let startEnd: { kind: EndKind; extend: number } | null = null;
  let endEnd: { kind: EndKind; extend: number } | null = null;
  if (!shape.full) {
    startEnd = endKind(d.arcStart, -1);
    endEnd = endKind(d.arcEnd, 1);
    a0 = d.arcStart - startEnd.extend;
    a1 = d.arcEnd + endEnd.extend;
    // Start: a pole, then (for a broken end) fracture rings growing toward the body.
    if (startEnd.kind === 'broken') {
      link(pole(a0, -tube * 0.5, 1));
      for (let j = capRings - 1; j >= 1; j--) link(tubeRing(a0, capScale(j / capRings), 1, jagFor(a0, j / capRings), -1));
    } else {
      link(pole(a0, -tube * 0.4, 2));
    }
  }

  // --- Body ---------------------------------------------------------------------------------------
  const M = Math.max(shape.full ? 24 : 4, Math.ceil(((a1 - a0) * R) / spec.along));
  let firstRing: Ring | null = null;
  for (let m = 0; m < (shape.full ? M : M + 1); m++) {
    const a = a0 + ((a1 - a0) * m) / M;
    const buried = !shape.full && (a < d.arcStart - 1e-6 || a > d.arcEnd + 1e-6);
    const ring = tubeRing(a, 1, buried ? 2 : 0);
    firstRing ??= ring;
    link(ring);
    if (m % 16 === 15) yield;
  }

  if (shape.full) {
    // Close the torus.
    b.stitch(prev!, firstRing!, true);
  } else if (endEnd!.kind === 'broken') {
    for (let j = 1; j < capRings; j++) link(tubeRing(a1, capScale(j / capRings), 1, jagFor(a1, j / capRings), 1));
    link(pole(a1, tube * 0.5, 1));
  } else {
    link(pole(a1, tube * 0.4, 2));
  }

  // --- Paint --------------------------------------------------------------------------------------
  const normals = b.computeNormals();
  const pale = d.landmark === 'eye';
  for (let i = 0; i < b.vertexCount; i++) {
    const x = b.x(i) + c.x;
    const y = b.y(i) + c.y;
    const z = b.z(i) + c.z;
    const ny = normals[i * 3 + 1];
    const n = 0.5 + 0.5 * n1(x * 0.02, y * 0.02, z * 0.02);
    tmp.copy(pale ? ROCK_PALE : ROCK).lerp(ROCK_OCHRE, smoothstep(0.45, 0.8, n) * (pale ? 0.3 : 0.6));
    // Each weathered block has its own cast.
    const bh = hash11(block[i] * 12.9898 + d.seed * 0.001);
    tmp.multiplyScalar(0.88 + 0.22 * bh);
    tmp.lerp(ROCK_UNDER, smoothstep(-0.2, -0.85, ny) * 0.55);
    // Moss in crisp patches on what faces the sky; orange lichen freckles the Eye's grey stone.
    let moss = smoothstep(0.2, 0.6, ny) * smoothstep(0.42, 0.6, 0.5 + 0.5 * n2(x * 0.07, y * 0.07, z * 0.07));
    if (pale) tmp.lerp(LICHEN, smoothstep(0.72, 0.8, 0.5 + 0.5 * n1(x * 0.23 + 4, y * 0.23, z * 0.23)) * 0.45);
    if (part[i] === 1) {
      tmp.lerp(FRESH, 0.55);
      moss *= 0.2;
    }
    if (part[i] === 2) moss = Math.max(moss, 0.5);
    tmp.lerp(MOSS, moss * 0.85).lerp(MOSS_DARK, moss * 0.25 * n);
    b.setColor(i, tmp.r, tmp.g, tmp.b);
    const hang = smoothstep(-0.05, -0.45, ny) * 0.75;
    b.setSurf(i, part[i] === 1 ? 0.3 : 0.5, moss * 0.8, 0, hang);
  }
  return { data: b.finish(normals) };
}

/** 3D integer-lattice hash in [0, 1). */
function hash3i(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x85ebca77) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Distance to the nearest jittered lattice point (3D Worley F1), roughly 0..1. */
export function worley3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let best = 9;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx;
        const cy = iy + dy;
        const cz = iz + dz;
        const px = cx + hash3i(cx, cy, cz, seed);
        const py = cy + hash3i(cx, cy, cz, seed + 1);
        const pz = cz + hash3i(cx, cy, cz, seed + 2);
        const d2 = (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2;
        if (d2 < best) best = d2;
      }
    }
  }
  return Math.min(1, Math.sqrt(best));
}
