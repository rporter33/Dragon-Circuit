// A start gate: two stone pillars standing on small floating rocks (most gates hang in open
// sky), an arched lintel with a glowing keystone, braziers on the pillar tops, banners hanging
// inside the opening and a shimmering curtain of light across it. Built from the same kit and
// palette as the Roost so it belongs to the world. Build-time only.

import { BoxGeometry, Color, CylinderGeometry, IcosahedronGeometry, Matrix4, Mesh, PlaneGeometry, Vector3, type BufferGeometry, type Material } from 'three';
import type { BoxCollider, Collider, CylinderCollider } from '../core/types';
import type { RaceDef } from '../game/contracts';
import { displace, under, xf, type GeoBuilder } from '../world/dressing/geom';
import { PALETTE, bannerCloth, box, jitter, lantern, resetJitter, siteBuilders, stoneBlock, v, type SiteBuilders } from '../world/dressing/structures/kit';
import { GATE_HALF_HEIGHT, GATE_HALF_WIDTH } from './courseMath';

/** Course colors: the banner cloth, its trim, and the light of the rings and curtain. */
export interface CourseColors {
  cloth: string;
  trim: string;
  light: string;
}

export const COURSE_COLORS: Record<string, CourseColors> = {
  'roost-loop': { cloth: PALETTE.bannerBlue, trim: PALETTE.gold, light: '#7fd6ff' },
  'cascade-run': { cloth: '#2f6f7a', trim: PALETTE.cream, light: '#7ff0d8' },
  'archway-thread': { cloth: '#a8582a', trim: PALETTE.cream, light: '#ffc46b' },
  underspan: { cloth: '#4b6a2e', trim: PALETTE.gold, light: '#b8ff7a' },
  'needle-slalom': { cloth: PALETTE.bannerRed, trim: PALETTE.gold, light: '#ff8a6b' },
  'lantern-dash': { cloth: '#8a3a2a', trim: PALETTE.gold, light: '#ffb459' },
  'long-drift': { cloth: '#4b3a6b', trim: PALETTE.cream, light: '#c9a8ff' },
};

export function courseColors(id: string): CourseColors {
  return COURSE_COLORS[id] ?? { cloth: PALETTE.bannerBlue, trim: PALETTE.gold, light: '#8fe0ff' };
}

/** World transform of a gate: origin at the opening's center, +Z the way you fly through. */
export function gateFrame(def: RaceDef): Matrix4 {
  const [x, y, z] = def.start.position;
  return xf(x, y, z, 0, def.start.yaw, 0);
}

const BOX = new BoxGeometry(1, 1, 1);
const DRUM = displace(new CylinderGeometry(1, 1, 1, 14, 2), 0.035, 3, 77, 1);
const PILLAR_X = GATE_HALF_WIDTH + 2.4;
const PILLAR_BOTTOM = -GATE_HALF_HEIGHT - 5;
const PILLAR_TOP = GATE_HALF_HEIGHT + 1.5;

/** A small floating rock under a pillar: flat-ish top, a craggy point hanging below. */
function floatingRock(b: GeoBuilder, frame: Matrix4, x: number, y: number, seed: number): void {
  const geo = displace(new IcosahedronGeometry(1, 2), 0.22, 1.6, seed, 3);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const py = pos.getY(i);
    // Squash the top flat and stretch the bottom into an inverted peak.
    pos.setY(i, py > 0 ? py * 0.35 : py * (1.9 + 0.4 * Math.sin(seed + i)));
  }
  geo.computeVertexNormals();
  const grass = new Color('#6f9a4a');
  const rock = new Color('#8c7f70');
  const dark = new Color('#5f574f');
  b.add(geo, under(frame, xf(x, y, 0, 0, seed, 0, 5.2, 4.2, 5.2)), {
    color: (p, n, out) => {
      if (n.y > 0.55) out.copy(grass).multiplyScalar(0.9 + 0.2 * Math.sin(p.x * 3.1 + p.z * 2.3));
      else out.copy(rock).lerp(dark, Math.min(1, Math.max(0, (y - p.y) / 16)));
    },
  });
}

function pillar(s: SiteBuilders, frame: Matrix4, side: number, def: RaceDef, colors: CourseColors, floating: boolean): void {
  const b = s.solid;
  const x = side * PILLAR_X;
  if (floating) floatingRock(b, frame, x, PILLAR_BOTTOM - 0.6, side * 3.7 + def.difficulty);
  // Plinth, a shaft of slightly irregular drums, a capital.
  stoneBlock(b, frame, x, PILLAR_BOTTOM + 0.8, 0, 4.6, 1.6, 4.6, 11 + side, PALETTE.stoneDark, 0.5);
  // Round drums with a slight swell (entasis), each a touch off-true like old masonry.
  const drums = 8;
  const shaftH = PILLAR_TOP - PILLAR_BOTTOM - 4;
  for (let i = 0; i < drums; i++) {
    const h = shaftH / drums;
    const y = PILLAR_BOTTOM + 1.6 + h * (i + 0.5);
    const t = (i + 0.5) / drums;
    const r = 2.05 + 0.18 * Math.sin(t * Math.PI) - t * 0.25;
    const base = jitter(i % 3 === 1 ? PALETTE.stoneWarm : PALETTE.stone, 0.06);
    const moss = new Color(PALETTE.moss);
    b.add(DRUM, under(frame, xf(x + Math.sin(i * 1.7 + side) * 0.07, y, Math.cos(i * 2.3) * 0.07, 0, i * 0.7, 0, r, h * 0.97, r)), {
      color: (p, n, out) => {
        out.copy(base);
        // Weathering: darker toward the bottom of each drum, moss on the windward lips.
        if (n.y > 0.5) out.lerp(moss, 0.35);
      },
    });
  }
  stoneBlock(b, frame, x, PILLAR_TOP - 1.4, 0, 4.4, 1.2, 4.4, 71 + side, PALETTE.stoneWarm, 0.2);
  // Brass bands where the banners' cords tie off.
  box(b, frame, x, PILLAR_BOTTOM + shaftH * 0.33, 0, 3.5, 0.35, 3.5, PALETTE.brass);
  box(b, frame, x, PILLAR_BOTTOM + shaftH * 0.75, 0, 3.4, 0.35, 3.4, PALETTE.brass);
  // A brazier on top: a bowl on a short stem and a glowing coal bed (lit at night).
  box(b, frame, x, PILLAR_TOP - 0.3, 0, 1.2, 1.0, 1.2, PALETTE.iron);
  box(b, frame, x, PILLAR_TOP + 0.5, 0, 2.6, 0.7, 2.6, PALETTE.iron);
  s.glow.add(displace(new IcosahedronGeometry(1, 1), 0.2, 2, 5 + side), under(frame, xf(x, PILLAR_TOP + 1.05, 0, 0, 0, 0, 1.0, 0.45, 1.0)), {
    color: '#ff9a3c',
    glow: 1,
  });
  // A banner hanging down the outside face of each pillar, facing along the gate.
  bannerCloth(s, under(frame, xf(x + side * 2.3, 0, 0, 0, side * (Math.PI / 2), 0)), 0, PILLAR_TOP - 2.6, 0.05, 3.4, 16, colors.cloth, colors.trim);
}

/** The arched lintel: voussoirs along a shallow arc between the pillar tops, and a keystone. */
function lintel(s: SiteBuilders, frame: Matrix4, colors: CourseColors): void {
  const b = s.solid;
  const n = 11;
  const span = PILLAR_X;
  const rise = 4.5;
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const xm = -span + 2 * span * ((t0 + t1) / 2);
    const u = xm / span;
    const y = PILLAR_TOP + 0.8 + rise * (1 - u * u);
    const slope = (-2 * rise * u) / span;
    const keystone = i === (n - 1) / 2;
    const m = under(frame, xf(xm, y, 0, 0, 0, Math.atan(slope), (2 * span) / n + 0.15, keystone ? 3.2 : 2.4, keystone ? 3.6 : 3.0));
    b.add(BOX, m, { color: jitter(keystone ? PALETTE.stoneWarm : i % 2 ? PALETTE.stone : PALETTE.stoneDark) });
  }
  // The keystone's emblem glows in the course color, day and night.
  s.glow.add(new IcosahedronGeometry(1, 1), under(frame, xf(0, PILLAR_TOP + 0.8 + rise, 1.9, 0, 0, 0, 0.9, 0.9, 0.35)), { color: colors.light, glow: 1 });
  s.glow.add(new IcosahedronGeometry(1, 1), under(frame, xf(0, PILLAR_TOP + 0.8 + rise, -1.9, 0, 0, 0, 0.9, 0.9, 0.35)), { color: colors.light, glow: 1 });
  // Two short banners hanging inside the opening from the lintel ends.
  for (const side of [-1, 1]) {
    bannerCloth(s, frame, side * (span - 4.6), PILLAR_TOP + 0.6, 0, 3.0, 10, colors.cloth, colors.trim);
  }
  // Lanterns on cords below the lintel.
  lantern(s, frame, -span * 0.4, PILLAR_TOP + 1.4, 0, 2.4);
  lantern(s, frame, span * 0.4, PILLAR_TOP + 1.4, 0, 2.4);
}


export interface GateParts {
  /** Builders for the stone, glow and cloth (the caller merges these into meshes). */
  site: SiteBuilders;
  /** The curtain of light across the opening (local frame; the caller adds the material). */
  curtain: BufferGeometry;
  frame: Matrix4;
}

/** Build one gate's geometry in world space. `floating` adds the rocks under the pillars. */
export function buildGate(def: RaceDef, floating: boolean): GateParts {
  resetJitter(0x6a7e + def.difficulty * 101 + def.id.length * 7);
  const frame = gateFrame(def);
  const colors = courseColors(def.id);
  const site = siteBuilders();
  pillar(site, frame, -1, def, colors, floating);
  pillar(site, frame, 1, def, colors, floating);
  lintel(site, frame, colors);
  const curtain = new PlaneGeometry(PILLAR_X * 2 - 3.6, PILLAR_TOP - PILLAR_BOTTOM - 1.6, 1, 1);
  curtain.translate(0, (PILLAR_TOP + PILLAR_BOTTOM) / 2 + 0.2, 0);
  curtain.applyMatrix4(frame);
  return { site, curtain, frame };
}

// ---------------------------------------------------------------------------------------------
// Collision
// ---------------------------------------------------------------------------------------------

/** Lintel arc: rises this much from its ends to the keystone; voussoirs this tall/deep. */
const LINTEL_RISE = 4.5;
const LINTEL_SPAN = PILLAR_X + 0.1;

/**
 * The gate's solid parts as simple shapes in world space: each pillar (plinth to brazier) as a
 * box, the floating rock under it (a walkable slab and its hanging point), and the arched lintel
 * stepped into five boxes that follow the arc. Pillar tops, the lintel and the rocks can be
 * landed on. Banners, lanterns and the curtain of light stay soft to the touch (not here).
 */
export function gateColliders(def: RaceDef): Collider[] {
  const [gx, gy, gz] = def.start.position;
  const yaw = def.start.yaw;
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  // Gate frame: local +X = (cos, 0, -sin), local +Z = (sin, 0, cos) (as xf/BoxCollider).
  const wx = (lx: number, lz: number) => gx + lx * cs + lz * sn;
  const wz = (lx: number, lz: number) => gz - lx * sn + lz * cs;
  const box = (lx: number, y0: number, y1: number, hx: number, hz: number): BoxCollider => ({
    kind: 'box',
    x: wx(lx, 0),
    y: gy + (y0 + y1) / 2,
    z: wz(lx, 0),
    hx,
    hy: (y1 - y0) / 2,
    hz,
    yaw,
    surface: 'stone',
  });
  const cyl = (lx: number, y0: number, y1: number, radius: number): CylinderCollider => ({
    x: wx(lx, 0),
    z: wz(lx, 0),
    radius,
    y0: gy + y0,
    y1: gy + y1,
    surface: 'stone',
  });
  const out: Collider[] = [];
  for (const side of [-1, 1]) {
    const x = side * PILLAR_X;
    // Plinth, drums, capital and the brazier bowl on top.
    out.push(box(x, PILLAR_BOTTOM, PILLAR_TOP + 0.85, 2.3, 2.3));
    // The floating rock: a grassy top around the plinth, and the crag hanging beneath it.
    out.push(cyl(x, PILLAR_BOTTOM - 3, PILLAR_BOTTOM - 0.9, 4.8));
    out.push(cyl(x, PILLAR_BOTTOM - 10.2, PILLAR_BOTTOM - 3, 2.6));
  }
  // The lintel, in five steps along its arc.
  const base = PILLAR_TOP + 0.8;
  const arcY = (lx: number) => base + LINTEL_RISE * (1 - (lx / PILLAR_X) ** 2);
  const n = 5;
  for (let i = 0; i < n; i++) {
    const x0 = -LINTEL_SPAN + (2 * LINTEL_SPAN * i) / n;
    const x1 = x0 + (2 * LINTEL_SPAN) / n;
    const keystone = i === (n - 1) / 2;
    const half = keystone ? 1.6 : 1.2;
    const ys = [arcY(x0), arcY(x1), x0 < 0 && x1 > 0 ? arcY(0) : arcY(x0)];
    const top = Math.max(...ys) + half + 0.3;
    const bottom = Math.min(...ys) - half - 0.3;
    out.push(box((x0 + x1) / 2, bottom, top, (x1 - x0) / 2, keystone ? 1.9 : 1.6));
  }
  return out;
}

/** World position of a gate's keystone (for a far-off glint). */
export function gateKeystone(def: RaceDef, out: Vector3): Vector3 {
  return out.copy(v(0, PILLAR_TOP + 5.3, 0)).applyMatrix4(gateFrame(def));
}

export function curtainMesh(geo: BufferGeometry, material: Material): Mesh {
  const m = new Mesh(geo, material);
  m.frustumCulled = true;
  m.renderOrder = 2;
  return m;
}
