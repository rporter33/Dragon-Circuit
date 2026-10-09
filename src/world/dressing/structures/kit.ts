// Building blocks for hand-shaped structures. Every helper appends to GeoBuilders (merged into a
// few meshes per site) with per-piece color jitter so timber, plaster, stone and shingles read
// as hand-painted rather than flat fills.

import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  IcosahedronGeometry,
  Matrix4,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mulberry32 } from '../../../core/rng';
import { GeoBuilder, between, displace, shade, tube, under, xf, type AddOptions } from '../geom';

export const PALETTE = {
  timber: '#5b3f2c',
  timberLight: '#7a5a3e',
  plaster: '#d3c4a3',
  stone: '#a49a8b',
  stoneDark: '#7c746a',
  stoneWarm: '#b3a184',
  shingle: '#9b4a35',
  shingleAlt: '#7d3b2d',
  slate: '#56637a',
  straw: '#d6b45c',
  strawDark: '#b08c3e',
  leather: '#7a4a2a',
  blanket: '#a8322e',
  brass: '#c9a24a',
  iron: '#3d3b3a',
  rope: '#bfa77a',
  bannerBlue: '#2d4f91',
  bannerRed: '#9e3434',
  gold: '#e2b84d',
  cream: '#efe2c4',
  glow: '#ffc46b',
  water: '#3f86a0',
  moss: '#5f8a3a',
  copper: '#5fa08f',
  lacquer: '#a33a2e',
};

/** All the builders one site writes into. */
export interface SiteBuilders {
  /** Rigid painted toon. */
  solid: GeoBuilder;
  /** Night-glowing parts that also glow faintly by day (lantern panes, beacons). */
  glow: GeoBuilder;
  /** Windows: dark glass by day, warm light (vertex color × glow) only at night. */
  windows: GeoBuilder;
  /** Cloth: banners and pennants (aSway = distance from the attached edge). */
  cloth: GeoBuilder;
  /** Wind chimes and other small pendulums (aSway = distance below the hook). */
  chime: GeoBuilder;
  /** Additive pools of lantern light on the ground: (x, y, z, radius). */
  pools: number[];
}

export function siteBuilders(): SiteBuilders {
  return { solid: new GeoBuilder(), glow: new GeoBuilder(), windows: new GeoBuilder(), cloth: new GeoBuilder(), chime: new GeoBuilder(), pools: [] };
}

const unitBox = new BoxGeometry(1, 1, 1);
const unitCyl6 = new CylinderGeometry(1, 1, 1, 6);
const unitCyl8 = new CylinderGeometry(1, 1, 1, 8);
const unitCyl12 = new CylinderGeometry(1, 1, 1, 12);

let jitterRnd = mulberry32(0x5eed);

/**
 * While set, helpers build a site's far version: whole shingle rows instead of single
 * shingles, plain blocks, coarser cloth, no flagstones, chimes or lantern brackets.
 */
let coarse = false;
export function setCoarse(on: boolean): void {
  coarse = on;
}
export function isCoarse(): boolean {
  return coarse;
}
/** Reset the color-jitter stream (call once per site so sites are deterministic). */
export function resetJitter(seed: number): void {
  jitterRnd = mulberry32(seed);
}

/** A color with small random lightness/hue variation. */
export function jitter(c: string | Color, amount = 0.06): Color {
  return shade(c, (jitterRnd() - 0.5) * amount * 2, (jitterRnd() - 0.5) * amount, (jitterRnd() - 0.5) * amount * 0.15);
}

export function rand(): number {
  return jitterRnd();
}

/** Axis-aligned (in `frame` space) box from center + size. */
export function box(b: GeoBuilder, frame: Matrix4, x: number, y: number, z: number, w: number, h: number, d: number, color: string | Color, opts: Omit<AddOptions, 'color'> & { ry?: number; rx?: number; rz?: number } = {}): void {
  const m = under(frame, xf(x, y, z, opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0, w, h, d));
  b.add(unitBox, m, { ...opts, color: typeof color === 'string' ? jitter(color) : color });
}

/** A square beam between two points (frame space). */
export function beam(b: GeoBuilder, frame: Matrix4, a: Vector3, c: Vector3, t: number, color: string | Color, opts: Omit<AddOptions, 'color'> = {}): void {
  const m = under(frame, between(a, c, t, t));
  b.add(unitBox, m, { ...opts, color: typeof color === 'string' ? jitter(color) : color });
}

/** A round post/column between two points. */
export function post(b: GeoBuilder, frame: Matrix4, a: Vector3, c: Vector3, r: number, color: string | Color, sides: 6 | 8 | 12 = 8, opts: Omit<AddOptions, 'color'> = {}): void {
  const geo = sides === 6 ? unitCyl6 : sides === 8 ? unitCyl8 : unitCyl12;
  const m = under(frame, between(a, c, r, r));
  b.add(geo, m, { ...opts, color: typeof color === 'string' ? jitter(color) : color });
}

export function v(x: number, y: number, z: number): Vector3 {
  return new Vector3(x, y, z);
}

/**
 * Gable roof of overlapping shingles. Ridge runs along local Z from z0 to z1 at height `ridgeY`,
 * eaves at ±halfSpan, `eaveY`. Shingle rows step down each slope.
 */
export function shingleRoof(
  b: GeoBuilder,
  frame: Matrix4,
  z0: number,
  z1: number,
  halfSpan: number,
  eaveY: number,
  ridgeY: number,
  color: string,
  alt: string,
): void {
  const rise = ridgeY - eaveY;
  const slope = Math.hypot(halfSpan, rise);
  const ang = Math.atan2(rise, halfSpan);
  const rows = Math.max(3, Math.round(slope / 0.75));
  const len = z1 - z0;
  const per = Math.max(2, Math.round(len / 0.9));
  const sw = len / per;
  for (const side of [-1, 1]) {
    // Underlay board so gaps never show sky.
    const midX = (side * halfSpan) / 2;
    const midY = (eaveY + ridgeY) / 2;
    box(b, frame, midX, midY - 0.12, (z0 + z1) / 2, slope + 0.1, 0.12, len, shade(color, -0.12), { rz: side * -ang });
    if (coarse) {
      // Far away: each course is one long strip.
      for (let r = 0; r < rows; r += 2) {
        const t = (r + 1) / rows;
        const x = side * halfSpan * (1 - t);
        const y = eaveY + rise * t;
        box(b, frame, x, y + 0.02, (z0 + z1) / 2, (slope / rows) * 2 + 0.22, 0.09, len, jitter(rand() < 0.22 ? alt : color, 0.08), { rz: side * -(ang + 0.07) });
      }
      continue;
    }
    for (let r = 0; r < rows; r++) {
      const t = (r + 0.5) / rows;
      const x = side * halfSpan * (1 - t);
      const y = eaveY + rise * t;
      const off = (r % 2) * sw * 0.5;
      for (let k = 0; k < per; k++) {
        const z = z0 + off + (k + 0.5) * sw;
        if (z > z1 - sw * 0.25) continue;
        const c = rand() < 0.22 ? alt : color;
        // Each shingle tilts a touch more than the slope so rows overlap like real tiles.
        box(b, frame, x, y + 0.02, z, slope / rows + 0.22, 0.09, sw * 0.94, jitter(c, 0.08), { rz: side * -(ang + 0.07), ry: (rand() - 0.5) * 0.04 });
      }
    }
  }
  // Ridge cap.
  box(b, frame, 0, ridgeY + 0.05, (z0 + z1) / 2, 0.5, 0.35, len + 0.2, shade(alt, -0.05));
}

/** A hanging lantern: bracket frame + glowing panes (+ a light pool on the ground). */
export function lantern(s: SiteBuilders, frame: Matrix4, x: number, y: number, z: number, scale = 1, groundY?: number): void {
  const f = under(frame, xf(x, y, z, 0, 0, 0, scale));
  if (coarse) {
    box(s.solid, f, 0, 0.32, 0, 0.42, 0.1, 0.42, PALETTE.iron);
    s.glow.add(unitBox, under(f, xf(0, 0, 0, 0, 0, 0, 0.36, 0.6, 0.36)), { color: PALETTE.glow, glow: 1 });
    return;
  }
  box(s.solid, f, 0, 0.32, 0, 0.42, 0.06, 0.42, PALETTE.iron);
  box(s.solid, f, 0, -0.32, 0, 0.38, 0.06, 0.38, PALETTE.iron);
  for (const [cx, cz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) box(s.solid, f, cx, 0, cz, 0.05, 0.62, 0.05, PALETTE.iron);
  box(s.solid, f, 0, 0.45, 0, 0.18, 0.2, 0.18, PALETTE.iron);
  s.glow.add(unitBox, under(f, xf(0, 0, 0, 0, 0, 0, 0.33, 0.56, 0.33)), { color: PALETTE.glow, glow: 1 });
  if (groundY !== undefined) {
    const p = new Vector3(x, groundY + 0.05, z).applyMatrix4(frame);
    s.pools.push(p.x, p.y, p.z, 5.5 * scale);
  }
}

/** A lantern on a post with an arm (path lighting). Base at (x, y, z) in frame. */
export function lanternPost(s: SiteBuilders, frame: Matrix4, x: number, y: number, z: number, armYaw: number): void {
  const f = under(frame, xf(x, y, z, 0, armYaw, 0));
  post(s.solid, f, v(0, -0.3, 0), v(0, 2.9, 0), 0.11, PALETTE.timber, 6);
  box(s.solid, f, 0, 0.1, 0, 0.36, 0.25, 0.36, PALETTE.stoneDark);
  beam(s.solid, f, v(0, 2.75, 0), v(0, 2.75, 0.75), 0.09, PALETTE.timber);
  beam(s.solid, f, v(0, 2.3, 0), v(0, 2.72, 0.5), 0.06, PALETTE.timber);
  post(s.solid, f, v(0, 2.7, 0.7), v(0, 2.45, 0.7), 0.012, PALETTE.iron, 6);
  lantern(s, f, 0, 2.1, 0.7, 0.85, 0);
}

/** Post-and-rail fence from a to b (frame space, a.y/b.y = ground). */
export function fence(b: GeoBuilder, frame: Matrix4, a: Vector3, c: Vector3, spacing = 2.6, groundAt?: (x: number, z: number) => number): void {
  if (coarse) spacing *= 2;
  const len = Math.hypot(c.x - a.x, c.z - a.z);
  const n = Math.max(1, Math.round(len / spacing));
  const tops: Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a.x + (c.x - a.x) * t;
    const z = a.z + (c.z - a.z) * t;
    const gy = groundAt ? groundAt(x, z) : a.y + (c.y - a.y) * t;
    const lean = (rand() - 0.5) * 0.08;
    post(b, frame, v(x, gy - 0.4, z), v(x + lean, gy + 1.25, z + lean), 0.1, PALETTE.timberLight, 6);
    tops.push(v(x, gy, z));
  }
  for (let i = 0; i < n; i++) {
    for (const h of coarse ? [1.05] : [0.55, 1.05]) {
      const p0 = tops[i].clone().add(v(0, h + (rand() - 0.5) * 0.06, 0));
      const p1 = tops[i + 1].clone().add(v(0, h + (rand() - 0.5) * 0.06, 0));
      beam(b, frame, p0, p1, 0.08, PALETTE.timberLight);
    }
  }
}

/** A banner hanging from a crossbar on a tall pole. Pole base at (x, y, z), banner faces `yaw`. */
export function bannerPole(s: SiteBuilders, frame: Matrix4, x: number, y: number, z: number, yaw: number, height: number, cloth: string, trim: string): void {
  const f = under(frame, xf(x, y, z, 0, yaw, 0));
  post(s.solid, f, v(0, -0.5, 0), v(0, height, 0), 0.13, PALETTE.timber, 8);
  post(s.solid, f, v(0, height, 0), v(0, height + 0.35, 0), 0.2, PALETTE.brass, 8);
  beam(s.solid, f, v(-1.3, height - 0.45, 0.15), v(1.3, height - 0.45, 0.15), 0.1, PALETTE.timber);
  for (const sx of [-1.3, 1.3]) box(s.solid, f, sx, height - 0.45, 0.15, 0.16, 0.16, 0.16, PALETTE.brass);
  bannerCloth(s, f, 0, height - 0.5, 0.2, 2.2, height * 0.55, cloth, trim);
}

/**
 * A vertical banner hanging from (x, top, z) in frame, facing frame +Z. Swallow-tail bottom,
 * a trim band and a simple emblem (a diamond), all in the cloth builder.
 */
export function bannerCloth(s: SiteBuilders, frame: Matrix4, x: number, top: number, z: number, w: number, h: number, cloth: string, trim: string): void {
  const cols = coarse ? 3 : 10;
  const rows = coarse ? 4 : Math.max(10, Math.round(h / 0.25));
  const verts: number[] = [];
  const P = (u: number, t: number): [number, number, number] => {
    // u: -0.5..0.5 across, t: 0..1 down. Swallow tail cut at the bottom center.
    let yy = t;
    if (t > 0.999) yy = 1 - 0.18 * (1 - Math.abs(u) * 2);
    return [x + u * w, top - yy * h, z];
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u0 = c / cols - 0.5;
      const u1 = (c + 1) / cols - 0.5;
      const t0 = r / rows;
      const t1 = (r + 1) / rows;
      const a = P(u0, t0);
      const b2 = P(u1, t0);
      const c2 = P(u0, t1);
      const d = P(u1, t1);
      verts.push(...a, ...c2, ...b2, ...b2, ...c2, ...d);
    }
  }
  const base = new Color(cloth);
  const trimC = new Color(trim);
  const fm = frame;
  const inv = new Matrix4().copy(fm).invert();
  const lp = new Vector3();
  s.cloth.add(
    (() => {
      const g = new GeoBuilder();
      g.addTriangles(verts);
      return g.build();
    })(),
    fm,
    {
      color: (p, _n, out) => {
        lp.copy(p).applyMatrix4(inv);
        const tt = (top - lp.y) / h;
        const uu = (lp.x - x) / w;
        out.copy(base);
        if (tt < 0.08 || tt > 0.86 || Math.abs(uu) > 0.42) out.copy(trimC);
        // Emblem: a diamond in the upper half.
        if (Math.abs(uu) * 1.6 + Math.abs(tt - 0.38) < 0.2) out.copy(trimC);
      },
      sway: (p) => {
        lp.copy(p).applyMatrix4(inv);
        return Math.max(0, top - lp.y);
      },
    },
  );
}

/** A triangular pennant streaming from a pole at (x, y, z) toward frame +X. */
export function pennant(s: SiteBuilders, frame: Matrix4, x: number, y: number, z: number, len: number, hgt: number, color: string): void {
  const inv = new Matrix4().copy(frame).invert();
  const lp = new Vector3();
  const segs = coarse ? 2 : 5;
  const verts: number[] = [];
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const h0 = hgt * (1 - t0);
    const h1 = hgt * (1 - t1);
    const a = [x + t0 * len, y + h0 / 2, z];
    const b2 = [x + t0 * len, y - h0 / 2, z];
    const c2 = [x + t1 * len, y + h1 / 2, z];
    const d = [x + t1 * len, y - h1 / 2, z];
    verts.push(...a, ...b2, ...c2, ...c2, ...b2, ...d);
  }
  const g = new GeoBuilder();
  g.addTriangles(verts);
  s.cloth.add(g.build(), frame, {
    color: jitter(color, 0.04),
    sway: (p) => {
      lp.copy(p).applyMatrix4(inv);
      return Math.max(0, lp.x - x) * 1.4;
    },
  });
}

/** Wind chime: a disc with hanging tubes (chime builder) on a short cord. */
export function windChime(s: SiteBuilders, frame: Matrix4, x: number, y: number, z: number): void {
  if (coarse) return;
  const f = under(frame, xf(x, y, z));
  post(s.solid, f, v(0, 0, 0), v(0, -0.35, 0), 0.01, PALETTE.rope, 6);
  s.chime.add(unitCyl12, under(f, xf(0, -0.38, 0, 0, 0, 0, 0.18, 0.04, 0.18)), { color: PALETTE.timberLight, sway: 0.2 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const len = 0.35 + (i % 3) * 0.12;
    const cx = Math.cos(a) * 0.13;
    const cz = Math.sin(a) * 0.13;
    s.chime.add(unitCyl8, under(f, xf(cx, -0.45 - len / 2, cz, 0, 0, 0, 0.02, len, 0.02)), { color: PALETTE.brass, sway: (p) => 0.35 + Math.max(0, y - 0.45 - p.y) * 1.2 });
  }
}

/** A round hay bale lying on its side, or a square one. */
export function hayBale(b: GeoBuilder, frame: Matrix4, x: number, y: number, z: number, yaw: number, square = true): void {
  if (square) {
    box(b, frame, x, y + 0.45, z, 1.6, 0.9, 1.0, PALETTE.straw, { ry: yaw });
    // Twine bands.
    for (const o of [-0.45, 0.45]) {
      const m = under(frame, xf(x, y + 0.45, z, 0, yaw, 0));
      box(b, m, o, 0, 0, 0.05, 0.92, 1.02, PALETTE.strawDark);
    }
  } else {
    const m = under(frame, xf(x, y + 0.75, z, 0, yaw, Math.PI / 2, 0.75, 1.2, 0.75));
    b.add(unitCyl12, m, { color: jitter(PALETTE.straw) });
  }
}

/** A loose pile of hay (lumpy flattened blob). */
export function hayPile(b: GeoBuilder, frame: Matrix4, x: number, y: number, z: number, r: number, seed: number): void {
  const g = pick(variants('hay', 3, (i) => displace(new IcosahedronGeometry(1, 2), 0.25, 2.2, 700 + i)), seed);
  b.add(g, under(frame, xf(x, y, z, 0, seed, 0, r, r * 0.45, r * 0.9)), {
    color: (p, n, out) => out.set(PALETTE.straw).lerp(new Color(PALETTE.strawDark), Math.max(0, -n.y) + 0.25 * Math.sin(p.x * 9 + p.z * 7)),
  });
}

export function barrel(b: GeoBuilder, frame: Matrix4, x: number, y: number, z: number): void {
  const m = under(frame, xf(x, y + 0.55, z, 0, rand() * 3, 0, 0.42, 1.1, 0.42));
  b.add(unitCyl12, m, { color: jitter(PALETTE.timberLight) });
  for (const h of [-0.33, 0.33]) b.add(unitCyl12, under(m, xf(0, h, 0, 0, 0, 0, 1.03, 0.06, 1.03)), { color: PALETTE.iron });
}

export function crate(b: GeoBuilder, frame: Matrix4, x: number, y: number, z: number, s = 0.9): void {
  const yaw = rand() * 0.6;
  box(b, frame, x, y + s / 2, z, s, s, s, PALETTE.timberLight, { ry: yaw });
  const m = under(frame, xf(x, y + s / 2, z, 0, yaw, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(b, m, (sx * s) / 2, 0, (sz * s) / 2, 0.1, s + 0.02, 0.1, PALETTE.timber);
}

/** A saddle on a wooden rack. */
export function saddleRack(b: GeoBuilder, frame: Matrix4, x: number, y: number, z: number, yaw: number, blanket: string): void {
  const f = under(frame, xf(x, y, z, 0, yaw, 0));
  for (const sx of [-0.7, 0.7]) {
    beam(b, f, v(sx, 0, -0.35), v(sx, 1.1, 0), 0.08, PALETTE.timber);
    beam(b, f, v(sx, 0, 0.35), v(sx, 1.1, 0), 0.08, PALETTE.timber);
  }
  beam(b, f, v(-0.8, 1.12, 0), v(0.8, 1.12, 0), 0.12, PALETTE.timber);
  // Blanket draped over, saddle on top, stirrups hanging.
  box(b, f, 0, 1.12, 0, 0.9, 0.04, 1.1, blanket, { rx: 0 });
  box(b, f, 0, 1.2, 0, 0.75, 0.16, 0.7, PALETTE.leather);
  box(b, f, 0.32, 1.3, 0, 0.12, 0.2, 0.55, PALETTE.leather);
  for (const sz of [-0.55, 0.55]) {
    beam(b, f, v(0, 1.1, sz), v(0, 0.6, sz * 1.1), 0.03, PALETTE.leather);
    box(b, f, 0, 0.56, sz * 1.1, 0.16, 0.05, 0.06, PALETTE.brass);
  }
}

// Displacing (welding + noise) is the expensive part of rough stones, so each shape comes in a
// handful of pre-made variants that callers pick from by seed and then transform.
const variantCache = new Map<string, BufferGeometry[]>();
function variants(key: string, count: number, make: (i: number) => BufferGeometry): BufferGeometry[] {
  let list = variantCache.get(key);
  if (!list) {
    list = Array.from({ length: count }, (_, i) => make(i));
    variantCache.set(key, list);
  }
  return list;
}
const pick = <T>(list: T[], seed: number): T => list[Math.abs(Math.floor(seed * 7919 + seed)) % list.length];

/** An irregular flat stepping stone. */
export function flagstone(b: GeoBuilder, frame: Matrix4, x: number, y: number, z: number, r: number, seed: number): void {
  if (coarse) return;
  const g = pick(variants('flag', 5, (i) => displace(new CylinderGeometry(1, 1.05, 1, 9), 0.12, 1.6, 900 + i, 1)), seed);
  b.add(g, under(frame, xf(x, y, z, 0, seed * 0.37, 0, r, 0.22, r * (0.7 + 0.3 * Math.sin(seed)))), { color: jitter(PALETTE.stone, 0.08) });
}

/** A rough stone block (ruins, cairns). */
export function stoneBlock(b: GeoBuilder, frame: Matrix4, x: number, y: number, z: number, w: number, h: number, d: number, seed: number, color: string = PALETTE.stone, mossy = 0.4): void {
  const g = coarse ? unitBox : pick(variants('block', 8, (i) => displace(new BoxGeometry(1, 1, 1, 2, 2, 2), 0.06, 2.5, 500 + i, 1)), seed);
  const moss = new Color(PALETTE.moss);
  const base = jitter(color, 0.07);
  b.add(g, under(frame, xf(x, y, z, (rand() - 0.5) * 0.06, (rand() - 0.5) * 0.15, (rand() - 0.5) * 0.06, w, h, d)), {
    color: (p, n, out) => {
      out.copy(base);
      if (n.y > 0.5) out.lerp(moss, mossy * (0.6 + 0.4 * Math.sin(p.x * 3.1 + p.z * 2.3)));
    },
  });
}

/** Fluted stone column with base and capital. Base center at (x, y, z). */
export function column(b: GeoBuilder, frame: Matrix4, x: number, y: number, z: number, r: number, h: number, color: string = PALETTE.stoneWarm, broken = 0): void {
  const top = h * (1 - broken);
  box(b, frame, x, y + 0.2, z, r * 2.8, 0.4, r * 2.8, color);
  box(b, frame, x, y + 0.5, z, r * 2.4, 0.25, r * 2.4, color);
  b.add(unitCyl12, under(frame, xf(x, y + 0.6 + (top - 0.6) / 2, z, 0, 0, 0, r, top - 0.6, r)), { color: jitter(color) });
  if (broken === 0) {
    box(b, frame, x, y + h + 0.15, z, r * 2.6, 0.3, r * 2.6, color);
    box(b, frame, x, y + h - 0.1, z, r * 2.2, 0.25, r * 2.2, color);
  } else {
    // A jagged break.
    const g = pick(variants('break', 3, (i) => displace(new CylinderGeometry(0.95, 1, 0.6, 12), 0.15, 3, 600 + i, 1)), x * 13 + z * 7);
    b.add(g, under(frame, xf(x, y + top, z, 0.1, 0, -0.08, r, 1, r)), { color: jitter(color) });
  }
}

/** A ring (torus) — armillary bands, brass hoops. */
export function ring(b: GeoBuilder, m: Matrix4, radius: number, tubeR: number, color: string, segs = 48): void {
  b.add(new TorusGeometry(radius, tubeR, 6, segs), m, { color: jitter(color, 0.03) });
}

export function sphere(b: GeoBuilder, m: Matrix4, color: string, opts: Omit<AddOptions, 'color'> = {}): void {
  b.add(new SphereGeometry(1, 16, 10), m, { ...opts, color: jitter(color, 0.03) });
}

export { tube, xf, under, variants, pick };
