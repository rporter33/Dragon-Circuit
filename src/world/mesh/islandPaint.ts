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
import { gullyAt, gullyFade } from './strata';

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
  /**
   * How near each non-grass material is (wider transitions than the weights, never 0 right next
   * to one). Picks the over material's color on pure-grass vertices so a triangle straddling an
   * edge interpolates between two shades of the same material.
   */
  nearRock: number;
  nearDirt: number;
  nearStone: number;
  nearTrack: number;
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
  const edge = shape.rimDirtEdge(x, z);
  let dirt = remaining * smoothstep(edge - 0.015, edge + 0.015, s); // 50% on the rim dirt edge
  remaining -= dirt;
  let stone = 0;
  const sr = shape.pavedEdge(x, z);
  if (sr > 0) {
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
  out.nearRock = Math.max(smoothstep(0.95, 0.66, ny), kind === 'rocky' || kind === 'islet' ? 0.5 : 0);
  out.nearDirt = smoothstep(0.75, edge + 0.015, s);
  out.nearStone = sr > 0 ? smoothstep(sr + 0.12, sr, s) : 0;
  out.nearTrack = shape.track ? smoothstep(ROOST_TRACK_HALF_WIDTH + 6, ROOST_TRACK_HALF_WIDTH, shape.trackDistance(x, z)) : 0;
  return out;
}

const weights: TopWeights = { rock: 0, dirt: 0, stone: 0, grass: 0, track: 0, nearRock: 0, nearDirt: 0, nearStone: 0, nearTrack: 0 };

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
  /** 0..1 how far moss creeps down the cliffs (lush, damp islands). */
  mossiness: number;
}

const c = (hex: string) => new Color(hex);

const BASE: KindPalette = {
  grass: c('#62913b'),
  grassAlt: c('#7c9c40'),
  light: c('#a1b356'),
  dark: c('#3d7234'),
  dry: c('#958f55'),
  accent: c('#a8a845'),
  accent2: c('#9aa65a'),
  accentAmount: 0.18,
  rock: c('#958c7c'),
  mossiness: 0,
};

const PALETTES: Record<IslandKind, KindPalette> = {
  roost: { ...BASE, accentAmount: 0.2 },
  meadow: { ...BASE, grass: c('#70a03f'), grassAlt: c('#8eac47'), accent: c('#a9a84a'), accent2: c('#8f9a62'), accentAmount: 0.3 },
  cascade: {
    ...BASE, grass: c('#579a3c'), grassAlt: c('#468e4d'), light: c('#97bd55'), dark: c('#2d6c38'), accent: c('#6ea54a'),
    accent2: c('#7f9f58'), accentAmount: 0.2, mossiness: 0.5,
  },
  forest: {
    ...BASE, grass: c('#55853a'), grassAlt: c('#6a843a'), light: c('#93a554'), dark: c('#2f5a2e'), accent: c('#80704a'),
    accent2: c('#5f7d36'), accentAmount: 0.3, rock: c('#958c7a'), mossiness: 0.6,
  },
  grove: {
    ...BASE, grass: c('#3f7d55'), grassAlt: c('#3a7663'), light: c('#548a5e'), dark: c('#1f4f43'), dry: c('#5b7f55'),
    accent: c('#3f8378'), accent2: c('#5e9568'), accentAmount: 0.35, rock: c('#858a84'), mossiness: 1,
  },
  plateau: {
    ...BASE, grass: c('#6f7d43'), grassAlt: c('#7c7a4b'), light: c('#9a9160'), dark: c('#4f5c38'), dry: c('#8f8558'),
    accent: c('#5e3170'), accent2: c('#7a4a86'), accentAmount: 0.75, rock: c('#8f897d'),
  },
  rocky: { ...BASE, grass: c('#7d9849'), grassAlt: c('#8e9a50'), light: c('#b2ad69'), dark: c('#55763c'), accentAmount: 0.1, rock: c('#8f8a80') },
  ruin: { ...BASE, grass: c('#6f9a44'), grassAlt: c('#83a04b'), accentAmount: 0.15 },
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
    this.stoneR = shape.def.kind === 'roost' || shape.def.kind === 'ruin' ? 1 : -1;
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
        const moss = Math.max((1 - smoothstep(0.5, 6, aux)) * 0.85, (1 - smoothstep(2, 22, aux)) * this.pal.mossiness);
        const n = this.detailN(x * 0.03, z * 0.03) * 0.5 + 0.5;
        tmp.copy(CLIFF).lerp(UNDER_NEAR, 0.15 + 0.25 * n + 0.3 * smoothstep(4, 16, aux));
        // Gullies sit in their own shade; the buttresses between them catch the light.
        const th = Math.atan2(z - d.z, x - d.x);
        const g = gullyAt(Math.cos(th), Math.sin(th), this.shape.outlineRadius(th), d.seed) * smoothstep(1, 4, aux);
        tmp.multiplyScalar(1.08 - 0.42 * g);
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
        // The cliff's gullies run on down the upper underside, in shade.
        const th = Math.atan2(z - d.z, x - d.x);
        const g = gullyAt(Math.cos(th), Math.sin(th), this.shape.outlineRadius(th), d.seed) * gullyFade(aux, d.depth);
        tmp.multiplyScalar(1.06 - 0.36 * g);
        // Cool, faintly lit by the cloud sea below.
        const moss = Math.max((1 - smoothstep(4, 14, total)) * 0.7, (1 - smoothstep(10, 40, total)) * 0.8 * this.pal.mossiness);
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
    const w = topWeights(shape, x, z, s, ny, weights);
    const { rock, dirt, stone, track } = w;

    // --- Grass ----------------------------------------------------------------------------------
    const big = fbm2(this.patchN, x * 0.011, z * 0.011, 3) * 0.5 + 0.5;
    const small = this.detailN(x * 0.07, z * 0.07) * 0.5 + 0.5;
    const hills = Math.max(1, d.hills);
    const rel = (y - d.y) / hills;
    const relief = smoothstep(d.flatCenter * 0.7, d.flatCenter + 0.15, s);
    const crest = smoothstep(0.5, 0.95, rel) * relief;
    const hollow = smoothstep(0.38, 0.05, rel) * relief;
    const g = tmp.copy(pal.grass).lerp(pal.grassAlt, smoothstep(0.3, 0.75, big));
    g.lerp(pal.light, crest * 0.4 + 0.05 * small);
    g.lerp(pal.dark, hollow * 0.45 + 0.08 * (1 - small) * (1 - crest));
    // Wildflower / heather drifts.
    const acc = smoothstep(0.62, 0.85, this.patchN(x * 0.035 + 40, z * 0.035 - 17) * 0.5 + 0.5 + 0.1 * small);
    if (acc > 0 && pal.accentAmount > 0) {
      tmp2.copy(pal.accent).lerp(pal.accent2, smoothstep(0.35, 0.65, small));
      g.lerp(tmp2, acc * pal.accentAmount);
    }
    // Grass dries out toward the windy rim.
    g.lerp(pal.dry, smoothstep(0.8, 0.95, s) * 0.3);
    // On paving's edge the turf is trampled and darker.
    if (this.stoneR > 0) {
      const edge = shape.pavedEdge(x, z);
      g.lerp(pal.dark, smoothstep(edge + 0.06, edge, s) * 0.3);
    }
    const gr = g.r;
    const gg = g.g;
    const gb = g.b;

    // --- Other materials ------------------------------------------------------------------------
    // Rock: warm grey and ochre in patches, darker where it breaks through the turf.
    tmp2.copy(pal.rock).lerp(ROCK_OCHRE, smoothstep(0.35, 0.7, big) * 0.5).multiplyScalar(0.82 + 0.12 * small);
    const rr = tmp2.r;
    const rg = tmp2.g;
    const rb = tmp2.b;
    // Dirt: toward the rim the turf thins and dries until bare earth shows at the very lip.
    tmp2.copy(DIRT).lerp(DIRT_LIGHT, small * 0.5);
    // Patchy, wind-dried turf over thin soil: varies with the same patches as the grass inside.
    tmp.setRGB(gr, gg, gb).lerp(pal.dry, 0.35 + 0.35 * big).lerp(DIRT, 0.08 + 0.22 * small * (1 - big));
    tmp2.lerp(tmp, (1 - smoothstep(0.985, 0.999, s)) * 0.92);
    const dr = tmp2.r;
    const dg = tmp2.g;
    const db = tmp2.b;
    // The track: trodden earth all the way to the launch point.
    tmp2.copy(TRACK).lerp(DIRT_LIGHT, small * 0.3);
    const tr = tmp2.r;
    const tg = tmp2.g;
    const tb = tmp2.b;
    // Stone paving: a lighter worn walkway from the spawn to the stable door.
    tmp2.copy(STONE);
    if (kind === 'roost') {
      const sp = LAYOUT.spawn.position;
      const st = LAYOUT.stable;
      const walk = smoothstep(3.2, 1.8, segDist(x, z, sp[0], sp[2], st.x, st.z));
      tmp2.lerp(WALKWAY, walk * 0.8);
    } else if (kind === 'ruin') {
      tmp2.lerp(pal.rock, 0.3 + 0.3 * small);
    }

    // The over material: actual weights where present, proximity otherwise (see TopWeights).
    const rimDirt = dirt - track;
    const eps = 0.02;
    const wr = rock + eps * w.nearRock;
    const wd = rimDirt + eps * w.nearDirt;
    const wt = track + eps * w.nearTrack;
    const ws = stone + eps * w.nearStone;
    const sum = wr + wd + wt + ws;
    if (sum > 1e-9) {
      const k = 1 / sum;
      b.setOver(
        i,
        (rr * wr + dr * wd + tr * wt + tmp2.r * ws) * k,
        (rg * wr + dg * wd + tg * wt + tmp2.g * ws) * k,
        (rb * wr + db * wd + tb * wt + tmp2.b * ws) * k,
        rock + dirt + stone,
      );
    } else {
      b.setOver(i, dr, dg, db, 0);
    }
    b.setColor(i, gr, gg, gb);
    // Shares of the over material: rock shows faint strata, paving gets flagstones.
    b.setSurf(i, (sum > 1e-9 ? wr / sum : 0) * 0.75, 1, sum > 1e-9 ? ws / sum : 0, 0);
  }
}
