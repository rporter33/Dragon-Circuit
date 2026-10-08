// Island vertex paint: the main palette per island kind, written as linear vertex colors plus the
// surface mask the terrain shader uses for brush detail (see MeshBuilder for the channels).
//
// Top-surface categories follow IslandShape.surfaceAt exactly (same thresholds, same precedence),
// blended softly across each threshold, so what you see underfoot is what the footsteps sound
// like and where the grass grows.

import { Color } from 'three';
import type { IslandKind } from '../layout';
import { ROOST_TRACK_HALF_WIDTH, type IslandShape } from '../islandShape';
import { LAYOUT } from '../layout';
import { clamp01, smoothstep } from '../../core/math';
import { fbm2, noise2, type Noise2 } from '../../core/noise';
import type { MeshBuilder } from './MeshBuilder';

/** Which part of the island surface a vertex belongs to. */
export const Region = { Top: 0, Brow: 1, Lip: 2, Cliff: 3, Under: 4 } as const;
export type Region = (typeof Region)[keyof typeof Region];

export interface TopWeights {
  rock: number;
  dirt: number;
  stone: number;
  grass: number;
  /** The part of `dirt` that is the Roost's worn track. */
  track: number;
}

/**
 * Painted material weights on the top surface. Same thresholds and precedence as
 * IslandShape.surfaceAt (rock by slope, dirt at the rim, stone paving, the Roost track, rock
 * outcrops on rocky islands, else grass), each blended softly so the 50% line sits exactly on
 * surfaceAt's threshold.
 */
export function topWeights(shape: IslandShape, x: number, z: number, s: number, ny: number, out: TopWeights): TopWeights {
  const kind = shape.def.kind;
  let remaining = 1;
  let rock = smoothstep(0.78, 0.66, ny); // 50% at normalY = 0.72
  remaining -= rock;
  let dirt = remaining * smoothstep(0.935, 0.965, s); // 50% at s = 0.95
  remaining -= dirt;
  let stone = 0;
  if (kind === 'roost' || kind === 'ruin') {
    const sr = shape.def.flatCenter * 0.55;
    stone = remaining * smoothstep(sr + 0.012, sr - 0.012, s);
    remaining -= stone;
  }
  let track = 0;
  if (shape.track) {
    track = remaining * smoothstep(ROOST_TRACK_HALF_WIDTH + 0.5, ROOST_TRACK_HALF_WIDTH - 0.5, shape.trackDistance(x, z));
    remaining -= track;
    dirt += track;
  }
  if (kind === 'rocky' || kind === 'islet') {
    // The same noise surfaceAt samples (seed + 2): outcrops where it exceeds 0.35.
    const r = remaining * smoothstep(0.25, 0.45, noise2(shape.def.seed + 2)(x * 0.05, z * 0.05));
    rock += r;
    remaining -= r;
  }
  out.rock = rock;
  out.dirt = dirt;
  out.stone = stone;
  out.grass = remaining;
  out.track = track;
  return out;
}

const weights: TopWeights = { rock: 0, dirt: 0, stone: 0, grass: 0, track: 0 };

interface KindPalette {
  grass: Color;
  /** Large-patch hue variant. */
  grassAlt: Color;
  /** Sun-bleached crests. */
  light: Color;
  /** Lush, shaded hollows. */
  dark: Color;
  /** Dry grass toward the rim. */
  dry: Color;
  /** Flower / heather patches. */
  accent: Color;
  accent2: Color;
  accentAmount: number;
  rock: Color;
}

const c = (hex: string) => new Color(hex);

const BASE: KindPalette = {
  grass: c('#62913b'),
  grassAlt: c('#7c9c40'),
  light: c('#a1b356'),
  dark: c('#3d7234'),
  dry: c('#958f55'),
  accent: c('#e2cf6a'),
  accent2: c('#ebe6cf'),
  accentAmount: 0.18,
  rock: c('#958c7c'),
};

const PALETTES: Record<IslandKind, KindPalette> = {
  roost: { ...BASE, accentAmount: 0.12 },
  meadow: { ...BASE, grass: c('#70a03f'), grassAlt: c('#8eac47'), accent: c('#ecdc8e'), accent2: c('#dcaabb'), accentAmount: 0.28 },
  cascade: {
    ...BASE, grass: c('#579a3c'), grassAlt: c('#468e4d'), light: c('#97bd55'), dark: c('#2d6c38'), accent: c('#8cc862'),
    accent2: c('#e8e2c2'), accentAmount: 0.15,
  },
  forest: {
    ...BASE, grass: c('#55853a'), grassAlt: c('#6a843a'), light: c('#93a554'), dark: c('#2f5a2e'), accent: c('#80704a'),
    accent2: c('#5f7d36'), accentAmount: 0.3, rock: c('#958c7a'),
  },
  grove: {
    ...BASE, grass: c('#3f7d55'), grassAlt: c('#3c7a62'), light: c('#6f9c6c'), dark: c('#215345'), dry: c('#5f8459'),
    accent: c('#4f8f86'), accent2: c('#7fae74'), accentAmount: 0.3, rock: c('#858a84'),
  },
  plateau: {
    ...BASE, grass: c('#848f4c'), grassAlt: c('#958e55'), light: c('#b6aa6c'), dark: c('#5e6c40'), dry: c('#a39662'),
    accent: c('#6e3f73'), accent2: c('#8a5582'), accentAmount: 0.5, rock: c('#8f897d'),
  },
  rocky: { ...BASE, grass: c('#7d9849'), grassAlt: c('#8e9a50'), light: c('#b2ad69'), dark: c('#55763c'), accentAmount: 0.1, rock: c('#8f8a80') },
  ruin: { ...BASE, grass: c('#6f9a44'), grassAlt: c('#83a04b'), accent: c('#c4b6d6'), accentAmount: 0.12 },
  islet: { ...BASE, grass: c('#77a345'), accentAmount: 0.1, rock: c('#928c80') },
};

const DIRT = c('#7a5c41');
const DIRT_LIGHT = c('#937252');
const TRACK = c('#7d6045');
const STONE = c('#aca596');
const WALKWAY = c('#c2b8a1');
const ROCK_OCHRE = c('#ad946c');
const CLIFF = c('#b9a088');
const UNDER_NEAR = c('#97806e');
const UNDER_MID = c('#756a6c');
const UNDER_DEEP = c('#54536a');
const ROOTS = c('#4e3a2c');
const MOSS = c('#4c7a35');
const tmp = new Color();
const tmp2 = new Color();

/** Distance from (x, z) to the segment a-b. */
function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const u = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz));
  return Math.hypot(x - ax - dx * u, z - az - dz * u);
}

export class IslandPainter {
  private shape: IslandShape;
  private pal: KindPalette;
  private patchN: Noise2;
  private detailN: Noise2;
  private stoneR: number;

  constructor(shape: IslandShape) {
    this.shape = shape;
    this.pal = PALETTES[shape.def.kind];
    this.patchN = noise2(shape.def.seed + 101);
    this.detailN = noise2(shape.def.seed + 102);
    this.stoneR = shape.def.kind === 'roost' || shape.def.kind === 'ruin' ? shape.def.flatCenter * 0.55 : -1;
  }

  paint(b: MeshBuilder, i: number, region: Region, aux: number, nx: number, ny: number, nz: number): void {
    const d = this.shape.def;
    const x = b.x(i) + d.x;
    const y = b.y(i) + d.y;
    const z = b.z(i) + d.z;
    switch (region) {
      case Region.Top:
        this.paintTop(b, i, x, y, z, aux, ny);
        return;
      case Region.Brow: {
        // The turf's rolled edge: grass on top, browning where it curls over.
        const n = this.patchN(x * 0.08, z * 0.08) * 0.5 + 0.5;
        tmp.copy(this.pal.dark).lerp(DIRT, 0.25 + 0.25 * n);
        b.setColor(i, tmp.r, tmp.g, tmp.b);
        b.setSurf(i, 0, 0.6, 0, 0.5);
        return;
      }
      case Region.Lip: {
        tmp.copy(ROOTS).lerp(DIRT, 0.35);
        b.setColor(i, tmp.r, tmp.g, tmp.b);
        b.setSurf(i, 0.25, 0, 0, 1);
        return;
      }
      case Region.Cliff: {
        // aux = depth below the rim (m).
        const moss = (1 - smoothstep(0.5, 6, aux)) * 0.85;
        const n = this.detailN(x * 0.03, z * 0.03) * 0.5 + 0.5;
        tmp.copy(CLIFF).lerp(UNDER_NEAR, 0.15 + 0.25 * n + 0.3 * smoothstep(4, 16, aux));
        b.setColor(i, tmp.r, tmp.g, tmp.b);
        b.setSurf(i, 1, 0, 0, moss);
        return;
      }
      case Region.Under: {
        // aux = depth below the cliff foot (m).
        const total = aux + d.lip;
        const deepT = smoothstep(6, Math.max(30, d.depth * 0.45), aux);
        const n = this.patchN(x * 0.02 + 7, z * 0.02 - 3) * 0.5 + 0.5;
        tmp.copy(UNDER_NEAR).lerp(UNDER_MID, smoothstep(0, 0.5, deepT));
        tmp.lerp(UNDER_DEEP, smoothstep(0.4, 1, deepT) * (0.75 + 0.25 * n));
        // Cool, faintly lit by the cloud sea below.
        const moss = (1 - smoothstep(4, 14, total)) * 0.7;
        b.setColor(i, tmp.r, tmp.g, tmp.b);
        b.setSurf(i, 1 - 0.7 * deepT, 0, 0, moss);
        return;
      }
    }
  }

  private paintTop(b: MeshBuilder, i: number, x: number, y: number, z: number, s: number, ny: number): void {
    const shape = this.shape;
    const d = shape.def;
    const pal = this.pal;
    const kind = d.kind;
    const { rock, dirt, stone, grass, track } = topWeights(shape, x, z, s, ny, weights);

    // --- Grass ----------------------------------------------------------------------------------
    const big = fbm2(this.patchN, x * 0.011, z * 0.011, 3) * 0.5 + 0.5;
    const small = this.detailN(x * 0.07, z * 0.07) * 0.5 + 0.5;
    const hills = Math.max(1, d.hills);
    const rel = (y - d.y) / hills;
    const relief = smoothstep(d.flatCenter * 0.7, d.flatCenter + 0.15, s);
    const crest = smoothstep(0.5, 0.95, rel) * relief;
    const hollow = smoothstep(0.38, 0.05, rel) * relief;
    const g = tmp.copy(pal.grass).lerp(pal.grassAlt, smoothstep(0.3, 0.75, big));
    g.lerp(pal.light, crest * 0.4 + 0.1 * small);
    g.lerp(pal.dark, hollow * 0.45 + 0.15 * (1 - small) * (1 - crest));
    // Wildflower / heather drifts.
    const acc = smoothstep(0.58, 0.8, this.patchN(x * 0.035 + 40, z * 0.035 - 17) * 0.5 + 0.5 + 0.15 * small);
    if (acc > 0 && pal.accentAmount > 0) {
      tmp2.copy(pal.accent).lerp(pal.accent2, smoothstep(0.35, 0.65, small));
      g.lerp(tmp2, acc * pal.accentAmount);
    }
    // Grass dries out toward the windy rim.
    g.lerp(pal.dry, smoothstep(0.8, 0.95, s) * 0.3);
    // On paving's edge the turf is trampled and darker.
    if (this.stoneR > 0) g.lerp(pal.dark, smoothstep(this.stoneR + 0.06, this.stoneR, s) * 0.3);
    const gr = g.r;
    const gg = g.g;
    const gb = g.b;

    // --- Other materials ------------------------------------------------------------------------
    // Rock: warm grey and ochre in patches, darker where it breaks through the turf.
    tmp2.copy(pal.rock).lerp(ROCK_OCHRE, smoothstep(0.35, 0.7, big) * 0.5).multiplyScalar(0.82 + 0.12 * small);
    const rr = tmp2.r;
    const rg = tmp2.g;
    const rb = tmp2.b;
    // Dirt: toward the rim the turf thins and dries until bare earth shows at the very lip;
    // the track is trodden earth all the way.
    tmp2.copy(DIRT).lerp(DIRT_LIGHT, small * 0.5);
    tmp.setRGB(gr, gg, gb).lerp(pal.dry, 0.3).lerp(DIRT, 0.2 + 0.15 * small);
    tmp2.lerp(tmp, (1 - smoothstep(0.982, 0.999, s)) * 0.9);
    if (track > 0) tmp2.lerp(TRACK, track / Math.max(1e-6, dirt));
    const dr = tmp2.r;
    const dg = tmp2.g;
    const db = tmp2.b;
    // Stone paving: a lighter worn walkway from the spawn to the stable door.
    tmp2.copy(STONE);
    if (kind === 'roost' && stone > 0) {
      const sp = LAYOUT.spawn.position;
      const st = LAYOUT.stable;
      const w = smoothstep(3.2, 1.8, segDist(x, z, sp[0], sp[2], st.x, st.z));
      tmp2.lerp(WALKWAY, w * 0.8);
    } else if (kind === 'ruin') {
      tmp2.lerp(pal.rock, 0.3 + 0.3 * small);
    }

    const r = gr * grass + rr * rock + dr * dirt + tmp2.r * stone;
    const gg2 = gg * grass + rg * rock + dg * dirt + tmp2.g * stone;
    const bb = gb * grass + rb * rock + db * dirt + tmp2.b * stone;
    b.setColor(i, r, gg2, bb);
    // Exposed rock on top shows faint strata; grass gets brush strokes; paving gets flagstones.
    b.setSurf(i, rock * 0.75, grass, stone, 0);
  }
}
