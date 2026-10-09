// Old stonework scattered to reward exploring: a standing-stone circle and cairns on Highmoor,
// shrine ruins on the Observatory's island, and small ruins (broken arches, wall corners,
// shrines, cairns, a sundial) on a deterministic selection of other islands.

import { BoxGeometry, Color, CylinderGeometry, IcosahedronGeometry, Vector3 } from 'three';
import { mulberry32 } from '../../../core/rng';
import type { IslandShape } from '../../islandShape';
import type { Terrain } from '../../terrain';
import { displace, under, xf } from '../geom';
import { PALETTE, box, column, jitter, lantern, pick, rand, resetJitter, stoneBlock, v, variants, type SiteBuilders } from './kit';
import type { SiteOutputs } from './Roost';
import { colBox, colCyl } from '../colliderKit';
import { Matrix4 } from 'three';

export type RuinKind = 'arch' | 'wall' | 'shrine' | 'cairns' | 'sundial' | 'stones';

export interface RuinSite {
  islandId: number;
  kind: RuinKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Footprint radius (for keep-outs). */
  radius: number;
}

/** Find a flat, clear spot on an island (or null). Deterministic for the given rng. */
function findSpot(shape: IslandShape, out: SiteOutputs, rnd: () => number, radius: number, band: [number, number]): { x: number; y: number; z: number } | null {
  const d = shape.def;
  for (let tries = 0; tries < 60; tries++) {
    const a = rnd() * Math.PI * 2;
    const s = band[0] + rnd() * (band[1] - band[0]);
    const R = shape.outlineRadius(a) * s;
    const x = d.x + Math.cos(a) * R;
    const z = d.z + Math.sin(a) * R;
    // Flat enough across the footprint?
    const y = shape.topHeight(x, z);
    let flat = true;
    for (let k = 0; k < 6 && flat; k++) {
      const b = (k / 6) * Math.PI * 2;
      const yy = shape.topHeight(x + Math.cos(b) * radius, z + Math.sin(b) * radius);
      if (Math.abs(yy - y) > radius * 0.25 + 0.4) flat = false;
    }
    if (!flat) continue;
    if (out.exclusions.blocked(x, z, radius + 2)) continue;
    return { x, y, z };
  }
  return null;
}

/** Choose ruin sites for the whole archipelago (pure given terrain + current keep-outs). */
export function planRuins(terrain: Terrain, out: SiteOutputs): RuinSite[] {
  const sites: RuinSite[] = [];
  const push = (shape: IslandShape, kind: RuinKind, radius: number, band: [number, number], rnd: () => number) => {
    const p = findSpot(shape, out, rnd, radius, band);
    if (!p) return;
    sites.push({ islandId: shape.def.id, kind, ...p, yaw: rnd() * Math.PI * 2, radius });
    out.exclusions.circle(p.x, p.z, radius + 1);
  };
  for (const shape of terrain.islands) {
    const d = shape.def;
    const rnd = mulberry32(d.seed ^ 0x2a15);
    if (d.landmark === 'highmoor') {
      push(shape, 'stones', 17, [0.1, 0.45], rnd);
      push(shape, 'shrine', 4, [0.3, 0.7], rnd);
      for (let i = 0; i < 6; i++) push(shape, 'cairns', 3, [0.45, 0.9], rnd);
      push(shape, 'arch', 4, [0.4, 0.85], rnd);
    } else if (d.kind === 'ruin') {
      push(shape, 'shrine', 4, [0.45, 0.8], rnd);
      push(shape, 'shrine', 4, [0.45, 0.85], rnd);
      push(shape, 'wall', 6, [0.4, 0.85], rnd);
      push(shape, 'cairns', 3, [0.5, 0.9], rnd);
    } else if (d.kind === 'roost' || d.landmark === 'cascade' || d.landmark === 'rootfall') {
      if (d.kind !== 'roost') push(shape, rnd() < 0.5 ? 'shrine' : 'arch', 4, [0.3, 0.8], rnd);
    } else if (rnd() < 0.42) {
      const kinds: RuinKind[] = ['arch', 'wall', 'shrine', 'cairns', 'sundial'];
      push(shape, kinds[Math.floor(rnd() * kinds.length)], 4, [0.1, 0.75], rnd);
    }
  }
  return sites;
}

/** A stack of rounded stones; returns the height of its top above y. */
function cairn(s: SiteBuilders, x: number, y: number, z: number, h: number, seed: number): number {
  const rnd = mulberry32(seed);
  let yy = y;
  let r = 0.75;
  for (let i = 0; i < h; i++) {
    const g = pick(variants('cairn', 6, (k) => displace(new IcosahedronGeometry(1, 1), 0.18, 2.2, 800 + k)), seed + i);
    const sy = r * (0.5 + rnd() * 0.2);
    s.solid.add(g, xf(x + (rnd() - 0.5) * 0.15, yy + sy * 0.85, z + (rnd() - 0.5) * 0.15, 0, rnd() * 3, 0, r, sy, r * (0.85 + rnd() * 0.3)), {
      color: (p, n, out) => out.copy(jitter(i % 2 ? PALETTE.stone : PALETTE.stoneDark, 0.06)).lerp(jitter(PALETTE.moss), Math.max(0, n.y - 0.6) * (i === 0 ? 1.2 : 0.4)),
    });
    yy += sy * 1.55;
    r *= 0.8;
  }
  return yy - y;
}

function buildSite(s: SiteBuilders, site: RuinSite, out: SiteOutputs, idx: number): void {
  const F = xf(site.x, site.y, site.z, 0, site.yaw, 0);
  const b = s.solid;
  const C = out.colliders;
  const stone = { surface: 'stone' as const };
  /** A rough block as a box (the visual adds ±6% jitter and a slight tilt). */
  const blockCol = (x: number, y: number, z: number, w: number, h: number, d: number) => colBox(C, F, x, y, z, w * 1.04, h * 1.04, d * 1.04, 0, stone);
  switch (site.kind) {
    case 'arch': {
      column(b, F, -2.2, -0.3, 0, 0.45, 4.6, PALETTE.stoneWarm, 0);
      column(b, F, 2.2, -0.3, 0, 0.45, 3.4, PALETTE.stoneWarm, 0.3);
      box(b, F, -1.4, 4.65, 0, 2.6, 0.6, 1.0, PALETTE.stoneWarm, { rz: -0.12 });
      stoneBlock(b, F, 1.2, 0.25, 1.4, 1.6, 0.6, 0.9, idx * 7, PALETTE.stoneWarm);
      stoneBlock(b, F, 2.8, 0.2, -1.1, 0.9, 0.5, 0.7, idx * 7 + 1, PALETTE.stoneWarm);
      colCyl(C, F, -2.2, -1, 0, 0.65, 0.7 + 4.6 + 0.3, stone);
      colCyl(C, F, 2.2, -1, 0, 0.65, 0.7 + 3.4 * 0.7 + 0.35, stone);
      colBox(C, F, -1.4, 4.65, 0, 2.7, 0.95, 1.0, 0, stone);
      blockCol(1.2, 0.25, 1.4, 1.6, 0.6, 0.9);
      blockCol(2.8, 0.2, -1.1, 0.9, 0.5, 0.7);
      break;
    }
    case 'wall': {
      // An L-shaped wall corner with a window gap, courses crumbling at the ends.
      for (let i = 0; i < 6; i++) {
        const h = i < 2 ? 4 : i < 4 ? 3 : 1 + (i % 2);
        for (let c = 0; c < h; c++) {
          if (i === 2 && c === 2) continue;
          stoneBlock(b, F, -3 + i * 1.2 + (c % 2) * 0.3, 0.35 + c * 0.75, 0, 1.15, 0.72, 0.8, idx * 31 + i * 5 + c);
        }
        // One box per column of blocks, as high as its courses (the window gap is open).
        const n = i === 2 ? 2 : h;
        const top = 0.35 + (n - 0.5) * 0.75;
        colBox(C, F, -3 + i * 1.2 + 0.15, (top - 0.4) / 2, 0, 1.5, top + 0.4, 0.85, 0, stone);
      }
      for (let i = 1; i < 4; i++) {
        const h = 4 - i;
        for (let c = 0; c < h; c++) stoneBlock(b, F, -3, 0.35 + c * 0.75, i * 1.2, 0.8, 0.72, 1.15, idx * 37 + i * 5 + c);
        const top = 0.35 + (h - 0.5) * 0.75;
        colBox(C, F, -3, (top - 0.4) / 2, i * 1.2, 0.85, top + 0.4, 1.2, 0, stone);
      }
      for (let i = 0; i < 5; i++) {
        const rx = (rand() - 0.2) * 4;
        const rz = 1 + rand() * 3;
        stoneBlock(b, F, rx, 0.2, rz, 0.9, 0.5, 0.7, idx * 41 + i);
        blockCol(rx, 0.2, rz, 0.9, 0.5, 0.7);
      }
      break;
    }
    case 'shrine': {
      // A plinth, a small stone canopy on four posts, an offering lantern that glows at night.
      box(b, F, 0, 0.2, 0, 3.4, 0.5, 3.4, PALETTE.stone);
      box(b, F, 0, 0.55, 0, 2.8, 0.25, 2.8, PALETTE.stoneWarm);
      colBox(C, F, 0, 0.0, 0, 3.4, 0.9, 3.4, 0, stone);
      colBox(C, F, 0, 0.34, 0, 2.8, 0.68, 2.8, 0, stone);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const broken = sx === 1 && sz === 1 && idx % 2 === 0;
        box(b, F, sx * 1.15, broken ? 1.1 : 1.9, sz * 1.15, 0.38, broken ? 1.0 : 2.6, 0.38, PALETTE.stoneWarm);
        colBox(C, F, sx * 1.15, broken ? 1.1 : 1.9, sz * 1.15, 0.42, broken ? 1.0 : 2.6, 0.42, 0, stone);
      }
      if (idx % 2 === 1) {
        box(b, F, 0, 3.35, 0, 3.2, 0.35, 3.2, PALETTE.stone);
        box(b, F, 0, 3.75, 0, 2.2, 0.45, 2.2, PALETTE.stoneWarm);
        box(b, F, 0, 4.15, 0, 1.0, 0.35, 1.0, PALETTE.stone);
        colBox(C, F, 0, 3.35, 0, 3.2, 0.35, 3.2, 0, stone);
        colBox(C, F, 0, 3.75, 0, 2.2, 0.45, 2.2, 0, stone);
        colBox(C, F, 0, 4.15, 0, 1.0, 0.35, 1.0, 0, stone);
      } else {
        box(b, F, -0.7, 3.3, -0.4, 2.0, 0.3, 2.4, PALETTE.stone, { rz: 0.18 });
        stoneBlock(b, F, 1.6, 0.3, 1.9, 1.3, 0.4, 1.0, idx * 11, PALETTE.stone);
        colBox(C, F, -0.7, 3.3, -0.4, 2.0, 0.65, 2.4, 0, stone);
        blockCol(1.6, 0.3, 1.9, 1.3, 0.4, 1.0);
      }
      // A weathered figure: a stack of rounded stones under the canopy.
      const fig = cairn(s, site.x, site.y + 0.65, site.z, 3, idx * 97);
      colCyl(C, F, 0, 0.6, 0, 0.75, fig + 0.05, stone);
      s.solid.add(new CylinderGeometry(0.35, 0.25, 0.25, 10), under(F, xf(0.9, 0.82, 0.9)), { color: jitter(PALETTE.brass) });
      lantern(s, F, -0.9, 1.05, 0.9, 0.55, 0.62);
      break;
    }
    case 'cairns': {
      const h1 = cairn(s, site.x, site.y - 0.15, site.z, 4 + (idx % 3), idx * 53);
      const h2 = cairn(s, site.x + 1.6, site.y - 0.15, site.z + 0.7, 2, idx * 59);
      const I = new Matrix4();
      colCyl(C, I, site.x, site.y - 1, site.z, 0.8, h1 + 0.85, stone);
      colCyl(C, I, site.x + 1.6, site.y - 1, site.z + 0.7, 0.8, h2 + 0.85, stone);
      break;
    }
    case 'sundial': {
      box(b, F, 0, 0.15, 0, 4.2, 0.3, 4.2, PALETTE.stone);
      s.solid.add(new CylinderGeometry(1.4, 1.6, 0.9, 16), under(F, xf(0, 0.6, 0)), { color: jitter(PALETTE.stoneWarm) });
      s.solid.add(new CylinderGeometry(1.45, 1.45, 0.05, 24), under(F, xf(0, 1.07, 0)), { color: jitter(PALETTE.brass) });
      box(b, F, 0, 1.6, 0.2, 0.06, 1.0, 1.0, PALETTE.brass, { rx: -0.6 });
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        box(b, F, Math.sin(a) * 1.25, 1.11, Math.cos(a) * 1.25, 0.06, 0.04, 0.25, BRONZE, { ry: a });
      }
      colBox(C, F, 0, 0, 0, 4.2, 0.6, 4.2, 0, stone);
      colCyl(C, F, 0, 0, 0, 1.6, 1.1, stone);
      colBox(C, F, 0, 1.55, 0.2, 0.2, 0.9, 0.9, 0, stone);
      break;
    }
    case 'stones': {
      // A ring of standing stones, two fallen, with a flat altar stone in the middle.
      const n = 11;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const r = 14;
        const x = Math.sin(a) * r;
        const z = Math.cos(a) * r;
        const fallen = k === 3 || k === 8;
        const h = 4.6 + ((k * 37) % 7) * 0.5;
        const g = pick(variants('menhir', 4, (q) => displace(new BoxGeometry(1, 1, 1, 3, 4, 2), 0.12, 1.4, 850 + q, 2)), idx * 100 + k);
        const m = fallen
          ? under(F, xf(x * 1.08, 0.55, z * 1.08, Math.PI / 2 - 0.1, a + 0.4, 0, 1.5, h, 0.8))
          : under(F, xf(x, h * 0.5 - 0.6, z, (rand() - 0.5) * 0.12, a, (rand() - 0.5) * 0.12, 1.5, h, 0.8));
        // Standing: an upright slab. Fallen: lying along its yaw, a little higher at one end.
        if (fallen) colBox(C, F, x * 1.08, 0.5, z * 1.08, 1.6, 1.3, h * 1.02, a + 0.4, stone);
        else colBox(C, F, x, h * 0.5 - 0.6, z, 1.65, h + 0.1, 0.95, a, stone);
        const base = jitter('#8c857b', 0.05);
        const lichen = new Color('#b9b48a');
        s.solid.add(g, m, {
          color: (p, nn, o) => {
            o.copy(base).multiplyScalar(0.85 + 0.2 * Math.sin(p.y * 2.3 + p.x));
            // Lichen speckle on the sides, moss on top and around the foot.
            if (Math.sin(p.x * 5.1 + p.y * 3.7 + p.z * 4.3) > 0.75) o.lerp(lichen, 0.5);
            o.lerp(jitter(PALETTE.moss), Math.min(0.8, Math.max(0, nn.y - 0.3) * 0.9 + Math.max(0, 1.2 - (p.y - site.y)) * 0.4));
          },
        });
      }
      stoneBlock(b, F, 0, 0.4, 0, 3.2, 0.8, 1.8, idx * 3, PALETTE.stoneDark, 0.6);
      blockCol(0, 0.4, 0, 3.2, 0.8, 1.8);
      lantern(s, F, 0.9, 1.2, 0.3, 0.6, 0.8);
      break;
    }
  }
}

const BRONZE = '#8a6a35';

export function buildRuins(s: SiteBuilders, sites: RuinSite[], out: SiteOutputs): void {
  resetJitter(0x2b1);
  sites.forEach((site, i) => buildSite(s, site, out, i));
}

export { v };
