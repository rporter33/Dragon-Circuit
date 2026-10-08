// Roots, vines and moss hanging from island undersides. Rootfall is the showpiece: thick roots
// dropping ~50–130 m into open sky (a race threads them). Other forest-like islands get shorter
// fringes. Pure data so races/tests can query clearance against the strands.

import { mulberry32 } from '../../../core/rng';
import { noise2 } from '../../../core/noise';
import type { IslandShape } from '../../islandShape';
import type { Terrain } from '../../terrain';

export type StrandKind = 'root' | 'vine' | 'glow';

export interface Strand {
  islandId: number;
  kind: StrandKind;
  /** Attachment (inside the rock) → tip, world space. */
  points: { x: number; y: number; z: number }[];
  /** Radius at the attachment and at the tip (m). */
  r0: number;
  r1: number;
}

export interface MossCurtain {
  islandId: number;
  /** Top-center attachment (world), facing direction (outward, horizontal unit). */
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
  width: number;
  length: number;
  seed: number;
}

export interface RootPlan {
  strands: Strand[];
  curtains: MossCurtain[];
}

interface IslandRecipe {
  roots: number;
  /** Length range (m). */
  rootLen: [number, number];
  rootR: [number, number];
  vines: number;
  vineLen: [number, number];
  curtains: number;
  glow: number;
  /** Normalized radius band roots hang from. */
  band: [number, number];
}

function recipe(shape: IslandShape): IslandRecipe | null {
  const d = shape.def;
  if (d.landmark === 'rootfall') {
    return { roots: 140, rootLen: [40, 140], rootR: [1.5, 3.8], vines: 140, vineLen: [15, 80], curtains: 70, glow: 0, band: [0.55, 0.95] };
  }
  const area = (d.radius / 100) ** 2;
  switch (d.kind) {
    case 'forest':
      return { roots: Math.round(22 * area * d.trees + 6), rootLen: [10, 38], rootR: [0.5, 1.3], vines: Math.round(26 * area + 6), vineLen: [8, 30], curtains: Math.round(10 * area + 3), glow: 0, band: [0.35, 0.93] };
    case 'grove':
      return { roots: Math.round(16 * area + 6), rootLen: [10, 40], rootR: [0.5, 1.2], vines: Math.round(12 * area + 4), vineLen: [8, 30], curtains: Math.round(6 * area + 2), glow: Math.round(30 * area + 10), band: [0.35, 0.93] };
    case 'cascade':
      return { roots: 26, rootLen: [12, 40], rootR: [0.6, 1.5], vines: 30, vineLen: [10, 36], curtains: 14, glow: 0, band: [0.45, 0.93] };
    case 'meadow':
    case 'ruin':
      return d.radius > 60 ? { roots: Math.round(8 * area + 3), rootLen: [6, 18], rootR: [0.35, 0.8], vines: Math.round(10 * area + 3), vineLen: [5, 16], curtains: Math.round(4 * area + 1), glow: 0, band: [0.6, 0.93] } : null;
    default:
      return null;
  }
}

function hang(
  shape: IslandShape,
  rnd: () => number,
  wob: (x: number, y: number) => number,
  ax: number,
  az: number,
  len: number,
  embed: number,
): { x: number; y: number; z: number }[] {
  const d = shape.def;
  const top = shape.bottomHeight(ax, az) + embed;
  const ox = ax - d.x;
  const oz = az - d.z;
  const ol = Math.hypot(ox, oz) || 1;
  // Drift outward a little as it falls (roots reach for light), plus a slow lean and wiggle.
  const outX = ox / ol;
  const outZ = oz / ol;
  const leanA = rnd() * Math.PI * 2;
  const lean = 0.03 + rnd() * 0.08;
  const n = Math.max(6, Math.round(len / 3.5));
  const pts: { x: number; y: number; z: number }[] = [];
  let x = ax;
  let y = top;
  let z = az;
  const step = len / n;
  const seed = rnd() * 100;
  for (let i = 0; i <= n; i++) {
    pts.push({ x, y, z });
    const t = i / n;
    const w1 = wob(seed + t * 2.2, 0.3);
    const w2 = wob(0.7, seed + t * 2.2);
    // Gravity wins: mostly straight down with a slow sway, a lean and a slight outward reach.
    const dx = outX * 0.06 + Math.cos(leanA) * lean + w1 * 0.16;
    const dz = outZ * 0.06 + Math.sin(leanA) * lean + w2 * 0.16;
    const dy = -1;
    const l = Math.hypot(dx, dy, dz);
    x += (dx / l) * step;
    y += (dy / l) * step;
    z += (dz / l) * step;
  }
  return pts;
}

export function planRoots(terrain: Terrain, density = 1): RootPlan {
  const strands: Strand[] = [];
  const curtains: MossCurtain[] = [];
  for (const shape of terrain.islands) {
    const rec = recipe(shape);
    if (!rec) continue;
    const d = shape.def;
    const rnd = mulberry32(d.seed ^ 0x2007);
    const wob = noise2(d.seed + 509);
    const pick = (band: [number, number]) => {
      const a = rnd() * Math.PI * 2;
      const s = Math.sqrt(band[0] ** 2 + rnd() * (band[1] ** 2 - band[0] ** 2));
      const R = shape.outlineRadius(a) * s;
      return { x: d.x + Math.cos(a) * R, z: d.z + Math.sin(a) * R, a };
    };
    const nRoots = Math.round(rec.roots * density);
    for (let i = 0; i < nRoots; i++) {
      // Most roots hang from the outer flanks where they swing free of the tapering underside;
      // on Rootfall a fifth hang from the deepest point, straight down into open sky.
      const fromTip = d.landmark === 'rootfall' && i % 5 === 0;
      const p = pick(fromTip ? [0, 0.3] : rec.band);
      // Longer roots hang from further in (where the island is deepest is the middle; long roots
      // at the edge would graze the cliff).
      const len = fromTip ? rec.rootLen[1] * (0.55 + 0.45 * rnd()) : rec.rootLen[0] + Math.pow(rnd(), 1.3) * (rec.rootLen[1] - rec.rootLen[0]);
      const r0 = rec.rootR[0] + rnd() * (rec.rootR[1] - rec.rootR[0]);
      const pts = hang(shape, rnd, wob, p.x, p.z, len, r0 * 2 + 1.5);
      strands.push({ islandId: d.id, kind: 'root', points: pts, r0, r1: Math.max(0.08, r0 * 0.06) });
      // Forks: one or two thinner roots branching partway down.
      const forks = rnd() < 0.7 ? 1 + (rnd() < 0.35 ? 1 : 0) : 0;
      for (let f = 0; f < forks; f++) {
        const at = Math.floor(pts.length * (0.2 + rnd() * 0.4));
        const base = pts[at];
        const fl = len * (0.25 + rnd() * 0.35);
        const fa = rnd() * Math.PI * 2;
        const fpts = [base];
        const n = Math.max(4, Math.round(fl / 3.5));
        let { x, y, z } = base;
        for (let k = 1; k <= n; k++) {
          const t = k / n;
          const spread = (1 - t) * 0.9 + 0.15;
          x += Math.cos(fa) * spread * (fl / n);
          z += Math.sin(fa) * spread * (fl / n);
          y -= (fl / n) * (0.55 + t * 0.5);
          fpts.push({ x, y, z });
        }
        const tAt = at / (pts.length - 1);
        const rAt = r0 + (Math.max(0.08, r0 * 0.06) - r0) * Math.pow(tAt, 0.8);
        strands.push({ islandId: d.id, kind: 'root', points: fpts, r0: rAt * 0.6, r1: 0.06 });
      }
    }
    const nVines = Math.round(rec.vines * density);
    for (let i = 0; i < nVines; i++) {
      const p = pick([Math.max(0.5, rec.band[0]), 0.99]);
      const len = rec.vineLen[0] + rnd() * (rec.vineLen[1] - rec.vineLen[0]);
      strands.push({ islandId: d.id, kind: 'vine', points: hang(shape, rnd, wob, p.x, p.z, len, 0.8), r0: 0.16, r1: 0.06 });
    }
    for (let i = 0; i < Math.round(rec.glow * density); i++) {
      const p = pick([0.3, 0.97]);
      const len = 6 + rnd() * 26;
      strands.push({ islandId: d.id, kind: 'glow', points: hang(shape, rnd, wob, p.x, p.z, len, 0.6), r0: 0.12, r1: 0.05 });
    }
    // Moss curtains hang from near the rim where the underside meets the cliff.
    for (let i = 0; i < Math.round(rec.curtains * density); i++) {
      const p = pick([0.8, 0.96]);
      const nx = Math.cos(p.a);
      const nz = Math.sin(p.a);
      curtains.push({
        islandId: d.id,
        x: p.x,
        y: shape.bottomHeight(p.x, p.z) + 1.2,
        z: p.z,
        nx,
        nz,
        width: 3 + rnd() * (d.landmark === 'rootfall' ? 8 : 5),
        length: 5 + rnd() * (d.landmark === 'rootfall' ? 26 : 12),
        seed: Math.floor(rnd() * 1e6),
      });
    }
  }
  return { strands, curtains };
}

/**
 * Distance from a point to the nearest hanging strand's surface (approximate: per segment,
 * using the segment's larger radius). For course design / tests: rings should keep clear.
 */
export function strandClearance(plan: RootPlan, x: number, y: number, z: number, islandId?: number): number {
  let best = Infinity;
  for (const s of plan.strands) {
    if (islandId !== undefined && s.islandId !== islandId) continue;
    const n = s.points.length;
    for (let i = 0; i < n - 1; i++) {
      const a = s.points[i];
      const b = s.points[i + 1];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const abz = b.z - a.z;
      const l2 = abx * abx + aby * aby + abz * abz;
      let t = l2 > 0 ? ((x - a.x) * abx + (y - a.y) * aby + (z - a.z) * abz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - (a.x + abx * t);
      const dy = y - (a.y + aby * t);
      const dz = z - (a.z + abz * t);
      const r = s.r0 + (s.r1 - s.r0) * Math.pow((i + t) / (n - 1), 0.8);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
      if (d < best) best = d;
    }
  }
  return best;
}
