// Spire meshing: a surface of revolution following SpireShape.radiusAt (the same angular and
// banded noise the shape defines), with sedimentary ledges, a few wandering vertical cracks and a
// flat, beveled platform on top you can land on. Built top-down as rings, like the islands:
// top center -> platform -> bevel -> flanks -> pointed tip. Positions are local to (x, topY, z).

import { Color } from 'three';
import type { SpireShape } from '../islandShape';
import { smoothstep } from '../../core/math';
import { noise2, noise3 } from '../../core/noise';
import { mulberry32 } from '../../core/rng';
import { MeshBuilder, SLICE, type MeshData, type Ring } from './MeshBuilder';
import { strataRecess } from './strata';

export interface SpireLodSpec {
  level: number;
  /** Switch distance (m from the spire's bounds). */
  distance: number;
  /** Vertical ring spacing (m). */
  vertical: number;
  /** Target spacing around (m). */
  around: number;
  minSegments: number;
  ledges: boolean;
}

export const SPIRE_LODS: SpireLodSpec[] = [
  { level: 0, distance: 0, vertical: 2.6, around: 2.6, minSegments: 24, ledges: true },
  { level: 1, distance: 380, vertical: 8, around: 7, minSegments: 14, ledges: false },
  { level: 2, distance: 1500, vertical: 24, around: 18, minSegments: 9, ledges: false },
];

/** Bevel around the platform's edge (m). */
const BEVEL_IN = 0.6;
const BEVEL_DROP = 0.45;

const ROCK = new Color('#857c74');
const ROCK_WARM = new Color('#94785d');
const ROCK_COOL = new Color('#5d5a6a');
const GRASS = new Color('#7aa646');
const GRASS_DARK = new Color('#557f3a');
const STONE_EDGE = new Color('#9d9384');
const tmp = new Color();

const ceil4 = (v: number) => Math.max(4, Math.ceil(v / 4) * 4);

interface Crack {
  theta: number;
  phase: number;
  width: number;
  y0: number;
  y1: number;
}

export function* buildSpireMesh(shape: SpireShape, spec: SpireLodSpec): Generator<void, { data: MeshData }> {
  const d = shape.def;
  const N = Math.min(192, Math.max(spec.minSegments, ceil4((2 * Math.PI * d.bellyRadius * 1.15) / spec.around)));
  const b = new MeshBuilder(4096);
  const rng = mulberry32(d.seed + 77);
  const cracks: Crack[] = [];
  const nCracks = 3 + Math.floor(rng() * 3);
  for (let k = 0; k < nCracks; k++) {
    const y0 = d.tipY + (d.topY - d.tipY) * (0.08 + rng() * 0.4);
    cracks.push({ theta: rng() * Math.PI * 2, phase: rng() * 10, width: 0.045 + rng() * 0.04, y0, y1: Math.min(d.topY - 3, y0 + (d.topY - d.tipY) * (0.3 + rng() * 0.5)) });
  }
  const mossN = noise2(d.seed + 5);
  // Vertical flutes: ridged noise sampled around a circle (seamless) and stretched along y.
  const fluteN = noise3(d.seed + 6);
  const fluteF = Math.max(4, d.bellyRadius / 6);
  // Per vertex: 0 = platform, 1 = flank; and how deep in a crack it sits (0..1).
  const kind: number[] = [];
  const crackAmt: number[] = [];
  /** How deep in a flute groove (0..1); grooves weather darker. */
  const grooveAmt: number[] = [];

  const ringCount = (r: number) => Math.min(N, Math.max(6, ceil4((2 * Math.PI * r * 1.1) / spec.around)));
  /** A ring of n vertices at height y (world) with radius radial(theta). */
  const angleRing = (n: number, y: number, radial: (theta: number) => number, k: number): Ring => {
    const start = b.vertexCount;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2;
      const r = radial(th);
      b.vertex(Math.cos(th) * r, y - d.topY, Math.sin(th) * r);
      kind.push(k);
      crackAmt.push(0);
      grooveAmt.push(0);
    }
    return { start, count: n };
  };

  // --- Platform ---------------------------------------------------------------------------------
  const topR = (th: number) => shape.radiusAt(d.topY - 0.01, th);
  const center = b.vertex(0, 0, 0);
  kind.push(0);
  crackAmt.push(0);
  grooveAmt.push(0);
  let prev: Ring = { start: center, count: 1 };
  for (const t of [0.35, 0.7, 1]) {
    const ring = angleRing(ringCount(d.topRadius * t), d.topY, (th) => (topR(th) - BEVEL_IN) * t, 0);
    b.stitch(prev, ring);
    prev = ring;
  }
  // Bevel down to the rim of the flanks.
  {
    const ring = angleRing(Math.max(ringCount(d.topRadius * 1.2), prev.count), d.topY - BEVEL_DROP, topR, 1);
    b.stitch(prev, ring);
    prev = ring;
  }

  // --- Flanks -----------------------------------------------------------------------------------
  const flankTop = d.topY - BEVEL_DROP;
  const height = flankTop - d.tipY;
  const rings = Math.max(4, Math.round(height / spec.vertical));
  // Ring counts grow toward the belly and shrink to the tip: zipper handles any change.
  for (let k = 1; k < rings; k++) {
    const y = flankTop - (height * k) / rings;
    const base = shape.baseRadiusAt(y);
    const n = ringCount(base);
    const start = b.vertexCount;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2;
      let r = shape.radiusAt(y, th);
      // Ledges, scaled down on thin parts so needles keep their line.
      if (spec.ledges) r -= (0.1 + strataRecess(d.x + Math.cos(th) * r, y, d.z + Math.sin(th) * r)) * 0.6 * smoothstep(3, 14, base);
      // Weathered flutes running down the needle.
      const fl = 1 - Math.abs(fluteN(Math.cos(th) * fluteF, Math.sin(th) * fluteF, y * 0.012));
      const groove = 1 - fl * fl;
      if (spec.level < 2) r -= Math.min(3.5, base * 0.1) * groove;
      // Cracks.
      let c = 0;
      for (const cr of cracks) {
        if (y < cr.y0 || y > cr.y1) continue;
        const fade = smoothstep(cr.y0, cr.y0 + 12, y) * smoothstep(cr.y1, cr.y1 - 12, y);
        const ct = cr.theta + 0.12 * Math.sin(y * 0.021 + cr.phase) + 0.05 * Math.sin(y * 0.07 + cr.phase * 2);
        let dt = Math.abs(th - ct) % (Math.PI * 2);
        if (dt > Math.PI) dt = Math.PI * 2 - dt;
        c = Math.max(c, fade * Math.exp(-((dt / cr.width) ** 2)));
      }
      if (spec.level < 2) r -= c * Math.min(1.6, base * 0.07);
      r = Math.max(0.05, r);
      b.vertex(Math.cos(th) * r, y - d.topY, Math.sin(th) * r);
      kind.push(1);
      crackAmt.push(c);
      grooveAmt.push(groove);
    }
    const ring = { start, count: n };
    b.stitch(prev, ring);
    prev = ring;
    if (k % 4 === 0) yield;
  }
  const tip = b.vertex(0, d.tipY - d.topY, 0);
  kind.push(1);
  crackAmt.push(0);
  grooveAmt.push(0);
  b.stitch(prev, { start: tip, count: 1 });

  // --- Paint --------------------------------------------------------------------------------------
  const normals = yield* b.normalsSliced();
  for (let i = 0; i < b.vertexCount; i++) {
    if (i % (SLICE / 4) === SLICE / 4 - 1) yield;
    const x = b.x(i) + d.x;
    const y = b.y(i) + d.topY;
    const z = b.z(i) + d.z;
    if (kind[i] === 0) {
      // Platform: turf in the middle, worn stone toward the edge.
      const r = Math.hypot(b.x(i), b.z(i)) / Math.max(1, d.topRadius);
      const n = mossN(x * 0.15, z * 0.15) * 0.5 + 0.5;
      tmp.copy(GRASS).lerp(GRASS_DARK, n * 0.5);
      const edge = smoothstep(0.55, 0.85, r);
      tmp.lerp(STONE_EDGE, edge);
      b.setColor(i, tmp.r, tmp.g, tmp.b);
      b.setSurf(i, edge * 0.6, 1 - edge, 0, 0);
      continue;
    }
    const below = d.topY - y;
    const along = (y - d.tipY) / (d.topY - d.tipY);
    // Grey needle rock, warm iron-stained streaks, cooling toward the hanging tip.
    const warm = smoothstep(0.35, 0.7, mossN(x * 0.01 + y * 0.004, z * 0.01 - y * 0.003) * 0.5 + 0.5);
    tmp.copy(ROCK).lerp(ROCK_WARM, warm * 0.7).lerp(ROCK_COOL, smoothstep(0.55, 0.0, along) * 0.8);
    const c = crackAmt[i];
    tmp.multiplyScalar((1 - 0.45 * c) * (1 - 0.28 * grooveAmt[i]));
    // Moss gathers on ledges that face up and in streaks below the platform.
    const up = normals[i * 3 + 1];
    const ledgeMoss = smoothstep(0.35, 0.7, up) * smoothstep(0.1, 0.5, mossN(x * 0.05, y * 0.05 + z * 0.05));
    tmp.lerp(GRASS_DARK, ledgeMoss * 0.6);
    b.setColor(i, tmp.r, tmp.g, tmp.b);
    b.setSurf(i, 0.45, 0, 0, (1 - smoothstep(1, 16, below)) * 0.9);
  }
  return { data: b.finish(normals) };
}
