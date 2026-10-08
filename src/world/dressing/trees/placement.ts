// Where every tree, bush, rock, log and fern goes. Deterministic per island seed; respects the
// terrain (grass for plants, steepness, the rim) and the keep-out zones of structures and streams.
// Pure: no three.js scene objects, runs in unit tests.

import { mulberry32 } from '../../../core/rng';
import { noise2 } from '../../../core/noise';
import { smoothstep } from '../../../core/math';
import type { IslandShape } from '../../islandShape';
import type { IslandDef } from '../../layout';
import type { ExclusionSet } from '../exclusions';
import type { SpeciesId } from './species';
import { SPECIES } from './species';

export interface PropInstance {
  species: SpeciesId;
  islandId: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  /** Height stretch on top of `scale`. */
  scaleY: number;
  /** Small lean (radians) about local X and Z. */
  leanX: number;
  leanZ: number;
  /** Color multiplier (linear). */
  tint: [number, number, number];
}

interface Recipe {
  /** Trees per m² at trees-hint 1. */
  treeDensity: number;
  trees: [SpeciesId, number][];
  /** Scale range for trees. */
  treeScale: [number, number];
  /** Normalized radius band trees may grow in. */
  band: [number, number];
  bushes: number;
  boulders: number;
  logs: number;
  shrooms: number;
  ferns: number;
  /** Bigger boulders (plateaus/rocky) */
  boulderScale: [number, number];
}

const TREE_SPACING = 1 / 60;

export function recipeFor(def: IslandDef): Recipe {
  const base: Recipe = {
    treeDensity: TREE_SPACING,
    trees: [['broadleaf', 1]],
    treeScale: [0.8, 1.25],
    band: [0, 0.94],
    bushes: 0.004,
    boulders: 0.0012,
    logs: 0,
    shrooms: 0,
    ferns: 0,
    boulderScale: [0.6, 1.8],
  };
  switch (def.kind) {
    case 'roost':
      // Trees ring the open plaza; the middle stays clear for the stable and spawn.
      return { ...base, trees: [['broadleaf', 0.55], ['blossom', 0.3], ['conifer', 0.15]], band: [0.52, 0.93], bushes: 0.003, boulders: 0.0006 };
    case 'meadow':
      return def.landmark === 'gullrest'
        ? { ...base, trees: [['blossom', 0.8], ['broadleaf', 0.2]], band: [0.1, 0.92], bushes: 0.003 }
        : { ...base, trees: [['broadleaf', 0.75], ['blossom', 0.25]], bushes: 0.004 };
    case 'forest':
      return def.landmark === 'rootfall'
        ? { ...base, treeDensity: 1 / 55, trees: [['giant', 0.3], ['broadleaf', 0.4], ['conifer', 0.3]], treeScale: [0.85, 1.3], bushes: 0.006, logs: 0.0009, shrooms: 0.0012, ferns: 0.02 }
        : { ...base, treeDensity: 1 / 45, trees: [['broadleaf', 0.55], ['conifer', 0.45]], bushes: 0.006, logs: 0.0007, shrooms: 0.0006, ferns: 0.016 };
    case 'rocky':
      return { ...base, treeDensity: 1 / 90, trees: [['windbent', 0.7], ['conifer', 0.3]], treeScale: [0.7, 1.15], bushes: 0.003, boulders: 0.005, boulderScale: [0.7, 3] };
    case 'plateau':
      return { ...base, treeDensity: 1 / 110, trees: [['windbent', 1]], treeScale: [0.75, 1.3], bushes: 0.0015, boulders: 0.003, boulderScale: [0.8, 3.4] };
    case 'ruin':
      return { ...base, trees: [['broadleaf', 0.7], ['conifer', 0.3]], band: [0.5, 0.93], bushes: 0.004, boulders: 0.0015 };
    case 'cascade':
      return { ...base, trees: [['broadleaf', 0.5], ['conifer', 0.4], ['blossom', 0.1]], bushes: 0.005, logs: 0.0004, ferns: 0.01, boulders: 0.0015 };
    case 'grove':
      return { ...base, treeDensity: 1 / 120, trees: [['glowcap', 0.7], ['conifer', 0.18], ['broadleaf', 0.12]], treeScale: [0.6, 1.35], bushes: 0.003, shrooms: 0.004, ferns: 0.012 };
    case 'islet':
      return { ...base, trees: [['windbent', 0.6], ['broadleaf', 0.4]], band: [0, 0.85], bushes: 0.004, boulders: 0.003, boulderScale: [0.6, 2.2] };
  }
}

function pickWeighted(list: [SpeciesId, number][], r: number): SpeciesId {
  let total = 0;
  for (const [, w] of list) total += w;
  let acc = 0;
  for (const [id, w] of list) {
    acc += w / total;
    if (r <= acc) return id;
  }
  return list[list.length - 1][0];
}

/** Simple spatial hash for minimum-distance rejection. */
class SpacingGrid {
  private cells = new Map<number, { x: number; z: number; r: number }[]>();
  constructor(private cell: number) {}
  private k(cx: number, cz: number) {
    return (cx + 32768) * 65536 + (cz + 32768);
  }
  fits(x: number, z: number, r: number): boolean {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const list = this.cells.get(this.k(cx + i, cz + j));
        if (!list) continue;
        for (const o of list) if (Math.hypot(o.x - x, o.z - z) < o.r + r) return false;
      }
    }
    return true;
  }
  add(x: number, z: number, r: number): void {
    const k = this.k(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let list = this.cells.get(k);
    if (!list) this.cells.set(k, (list = []));
    list.push({ x, z, r });
  }
}

export interface ScatterOptions {
  /** quality.propDensity */
  density: number;
}

/**
 * Scatter one island. `extraTrees` lets callers force-plant specific trees first (e.g. a tree by
 * the stable) — they're respected by spacing.
 */
export function scatterIsland(shape: IslandShape, exclusions: ExclusionSet | null, opts: ScatterOptions): PropInstance[] {
  const def = shape.def;
  const recipe = recipeFor(def);
  const rnd = mulberry32(def.seed ^ 0x7ee5);
  const forestN = noise2(def.seed + 301);
  const out: PropInstance[] = [];
  const area = Math.PI * def.radius * def.radius;
  const big = new SpacingGrid(16);
  const small = new SpacingGrid(6);
  // Trees thin less with quality than ground clutter does; forests must stay forests.
  const treeQ = 0.6 + 0.4 * Math.min(1.3, opts.density);
  const n = new Float64Array(3);

  const sampleGround = (x: number, z: number): { y: number; ny: number; s: number } | null => {
    const s = shape.normRadius(x, z);
    if (s > 0.995) return null;
    const y = shape.topHeight(x, z);
    const e = 1;
    const hx = shape.topHeight(x + e, z) - shape.topHeight(x - e, z);
    const hz = shape.topHeight(x, z + e) - shape.topHeight(x, z - e);
    n[0] = -hx;
    n[1] = 2 * e;
    n[2] = -hz;
    const ny = n[1] / Math.hypot(n[0], n[1], n[2]);
    return { y, ny, s };
  };

  const tint = (hue: number, spread: number): [number, number, number] => {
    const v = 0.88 + rnd() * 0.24;
    const h = (rnd() - 0.5) * spread + hue;
    // Warm/cool shift: positive warms (more red, less blue).
    return [v * (1 + h * 0.6), v * (1 + h * 0.15), v * (1 - h * 0.7)];
  };

  // --- Trees ----------------------------------------------------------------------------------
  const treeTarget = Math.round(area * recipe.treeDensity * def.trees * treeQ);
  let attempts = 0;
  let planted = 0;
  while (planted < treeTarget && attempts < treeTarget * 12 + 40) {
    attempts++;
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(recipe.band[0] ** 2 + rnd() * (recipe.band[1] ** 2 - recipe.band[0] ** 2));
    const R = shape.outlineRadius(a) * rr;
    const x = def.x + Math.cos(a) * R;
    const z = def.z + Math.sin(a) * R;
    // Groves and clearings: trees prefer where the forest noise is high.
    const f = 0.5 + 0.5 * (forestN(x * 0.012, z * 0.012) * 0.7 + forestN(x * 0.04, z * 0.04) * 0.3);
    if (rnd() > smoothstep(0.2, 0.75, f) * 1.15) continue;
    const g = sampleGround(x, z);
    if (!g || g.ny < 0.8) continue;
    if (shape.surfaceAt(x, z, g.ny) !== 'grass') continue;
    const species = pickWeighted(recipe.trees, rnd());
    const spec = SPECIES[species];
    const scale = recipe.treeScale[0] + rnd() * (recipe.treeScale[1] - recipe.treeScale[0]);
    const spacing = (species === 'giant' ? 8 : species === 'glowcap' ? 6 : species === 'windbent' ? 3.5 : species === 'conifer' ? 2.6 : 3.4) * scale;
    if (exclusions && exclusions.blocked(x, z, spec.trunkRadius * scale + 2.5)) continue;
    if (!big.fits(x, z, spacing)) continue;
    big.add(x, z, spacing);
    const windYaw = Math.atan2(-2, 4); // leeward lean: wind blows roughly +x (see uniforms)
    const yaw = species === 'windbent' ? windYaw + (rnd() - 0.5) * 0.5 : rnd() * Math.PI * 2;
    const hue = species === 'blossom' ? (rnd() - 0.5) * 0.3 : species === 'glowcap' ? (rnd() < 0.3 ? 0.35 : rnd() < 0.5 ? -0.25 : 0) : (f - 0.5) * 0.25;
    out.push({
      species,
      islandId: def.id,
      x,
      y: g.y - 0.15,
      z,
      yaw,
      scale,
      scaleY: 0.88 + rnd() * 0.25,
      leanX: (rnd() - 0.5) * 0.08,
      leanZ: (rnd() - 0.5) * 0.08,
      tint: tint(hue, 0.18),
    });
    planted++;
  }

  // --- Ground props ---------------------------------------------------------------------------
  const props: [SpeciesId, number, number, [number, number], (g: { ny: number; s: number }, x: number, z: number) => boolean][] = [
    ['bush', recipe.bushes, 2.2, [0.6, 1.3], (g, x, z) => g.ny > 0.78 && shape.surfaceAt(x, z, g.ny) === 'grass' && g.s < 0.96],
    ['boulder', recipe.boulders, 2.5, recipe.boulderScale, (g) => g.ny > 0.55 && g.s < 0.97],
    ['log', recipe.logs, 4, [0.8, 1.2], (g, x, z) => g.ny > 0.9 && shape.surfaceAt(x, z, g.ny) === 'grass' && g.s < 0.9],
    ['shrooms', recipe.shrooms, 1.2, [0.7, 1.6], (g, x, z) => g.ny > 0.8 && shape.surfaceAt(x, z, g.ny) === 'grass'],
    ['fern', recipe.ferns, 1, [0.7, 1.4], (g, x, z) => g.ny > 0.8 && shape.surfaceAt(x, z, g.ny) === 'grass' && g.s < 0.93],
  ];
  for (const [species, density, spacing, scales, ok] of props) {
    if (density <= 0) continue;
    const target = Math.round(area * density * opts.density);
    let tries = 0;
    let placed = 0;
    while (placed < target && tries < target * 8 + 20) {
      tries++;
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * 0.97;
      const R = shape.outlineRadius(a) * rr;
      const x = def.x + Math.cos(a) * R;
      const z = def.z + Math.sin(a) * R;
      const g = sampleGround(x, z);
      if (!g || !ok(g, x, z)) continue;
      // Undergrowth (ferns, shrooms, logs, bushes) gathers where the trees are.
      const f = 0.5 + 0.5 * forestN(x * 0.012, z * 0.012);
      if ((species === 'fern' || species === 'shrooms' || species === 'log') && rnd() > smoothstep(0.3, 0.7, f)) continue;
      if (species === 'boulder' && rnd() > 0.35 + 0.65 * smoothstep(0.6, 0.95, g.s) + (def.kind === 'rocky' || def.kind === 'plateau' ? 0.5 : 0)) continue;
      const scale = scales[0] + Math.pow(rnd(), 1.6) * (scales[1] - scales[0]);
      if (exclusions && exclusions.blocked(x, z, spacing * scale * 0.6 + 1)) continue;
      const grid = species === 'boulder' && scale > 2 ? big : small;
      if (!grid.fits(x, z, spacing * scale * 0.5)) continue;
      grid.add(x, z, spacing * scale * 0.5);
      const sink = species === 'boulder' ? 0.25 * scale : species === 'log' ? 0.12 : 0.05;
      out.push({
        species,
        islandId: def.id,
        x,
        y: g.y - sink,
        z,
        yaw: rnd() * Math.PI * 2,
        scale,
        scaleY: species === 'boulder' ? 0.7 + rnd() * 0.6 : 0.9 + rnd() * 0.2,
        leanX: species === 'boulder' ? (rnd() - 0.5) * 0.5 : 0,
        leanZ: species === 'boulder' ? (rnd() - 0.5) * 0.5 : 0,
        tint: tint(species === 'boulder' ? 0.05 : 0, 0.15),
      });
      placed++;
    }
  }
  return out;
}
