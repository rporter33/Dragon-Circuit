// Landmark structures: the Old Observatory (a ruined copper dome on a stone drum with broken
// ribs, a colonnade, a great brass telescope and an armillary sphere) and the lantern pavilion on
// top of the Lantern Spire, whose beacon burns brighter as night falls.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { IslandShape } from '../../islandShape';
import type { SpireDef } from '../../layout';
import type { Terrain } from '../../terrain';
import { FOG_PARS_GLSL } from '../../../render/painterly';
import { globalUniforms } from '../../../render/uniforms';
import { bezier, displace, tube, under, xf } from '../geom';
import {
  PALETTE,
  bannerCloth,
  beam,
  box,
  column,
  jitter,
  lantern,
  post,
  rand,
  resetJitter,
  ring,
  sphere,
  stoneBlock,
  v,
  windChime,
  type SiteBuilders,
} from './kit';
import type { SiteOutputs } from './Roost';
import { colBox, colChain, colCyl, colFrustum, colSpan, colSphere } from '../colliderKit';

const VERDIGRIS = '#4f9585';
const BRONZE = '#8a6a35';

/** A ring of rough stone blocks (walls, plinths). `heightAt(k)` lets segments crumble. */
function stoneRing(
  s: SiteBuilders,
  F: Matrix4,
  R: number,
  y: number,
  depth: number,
  segments: number,
  courses: (k: number) => number,
  courseH: number,
  seed: number,
  color: string = PALETTE.stone,
): void {
  for (let k = 0; k < segments; k++) {
    const n = courses(k);
    const a = ((k + 0.5) / segments) * Math.PI * 2;
    const w = ((Math.PI * 2 * R) / segments) * 1.02;
    for (let c = 0; c < n; c++) {
      const off = c % 2 === 0 ? 0 : 0.5 / segments;
      const aa = a + off * Math.PI * 2;
      const m = under(F, xf(Math.sin(aa) * R, y + (c + 0.5) * courseH, Math.cos(aa) * R, 0, aa, 0));
      stoneBlock(s.solid, m, 0, 0, 0, w * (0.94 + rand() * 0.06), courseH * 0.98, depth, seed + k * 13 + c, c % 3 === 1 ? PALETTE.stoneWarm : color, 0.5);
    }
  }
}

/** The Observatory's footprint: registered up front so trees and rocks keep clear of it. */
export function observatoryKeepOut(shape: IslandShape, out: SiteOutputs): void {
  out.exclusions.circle(shape.def.x, shape.def.z, 24);
}

export function buildObservatory(s: SiteBuilders, shape: IslandShape, terrain: Terrain, out: SiteOutputs): void {
  resetJitter(0x0b5);
  const d = shape.def;
  const gy = shape.topHeight(d.x, d.z);
  const roost = terrain.layout.islands[0];
  const yaw = Math.atan2(roost.x - d.x, roost.z - d.z);
  const F = xf(d.x, gy, d.z, 0, yaw, 0);
  const b = s.solid;

  // Plinth: an outer step, the platform and a compass rose inlaid in brass.
  stoneRing(s, F, 18.2, -0.4, 2.6, 40, () => 1, 0.9, 101, PALETTE.stoneDark);
  b.add(new CylinderGeometry(17.2, 17.6, 1.6, 40), under(F, xf(0, 0.6, 0)), { color: jitter(PALETTE.stoneWarm) });
  b.add(new CylinderGeometry(16.8, 16.8, 0.06, 40), under(F, xf(0, 1.42, 0)), { color: '#b2a58d' });
  ring(b, under(F, xf(0, 1.47, 0, Math.PI / 2, 0, 0)), 8, 0.12, PALETTE.brass, 64);
  ring(b, under(F, xf(0, 1.47, 0, Math.PI / 2, 0, 0)), 11.5, 0.08, BRONZE, 64);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const len = k % 2 === 0 ? 11.5 : 8;
    box(b, F, Math.sin(a) * len * 0.5, 1.47, Math.cos(a) * len * 0.5, 0.14, 0.06, len, k % 2 === 0 ? PALETTE.brass : BRONZE, { ry: a });
  }
  // Front steps.
  for (let i = 0; i < 4; i++) box(b, F, 0, 0.18 + i * 0.32, 18.6 - i * 0.55, 7, 0.36, 1.2, PALETTE.stone);
  const C = out.colliders;
  const stone = { surface: 'stone' as const };
  colCyl(C, F, 0, -1, 0, 19.4, 1.5, stone);
  colCyl(C, F, 0, -1, 0, 17.4, 2.42, stone);
  for (let i = 0; i < 4; i++) colBox(C, F, 0, (0.36 + i * 0.32) / 2 - 0.3, 18.6 - i * 0.55, 7, 0.36 + i * 0.32 + 0.6, 1.2, 0, stone);

  // The drum: crumbling courses, a doorway at the front, a breach at the back-left.
  const segs = 28;
  const drumCourses = (k: number) => {
    if (k === 0 || k === segs - 1) return 0; // doorway (front)
    if (k >= 17 && k <= 19) return k === 18 ? 0 : 1; // breach
    const h = Math.sin(k * 1.7) * 0.5 + 0.5;
    return h > 0.75 ? 2 : h > 0.5 ? 3 : 4;
  };
  stoneRing(s, F, 14, 1.4, 1.3, segs, drumCourses, 1.25, 202);
  // Each drum segment as a box exactly as high as its surviving courses.
  for (let k = 0; k < segs; k++) {
    const n = drumCourses(k);
    if (n === 0) continue;
    const a = ((k + 0.5) / segs) * Math.PI * 2;
    const top = 1.4 + n * 1.25;
    colBox(C, F, Math.sin(a) * 14, (1.0 + top) / 2, Math.cos(a) * 14, ((Math.PI * 2 * 14) / segs) * 1.04, top - 1.0, 1.4, a, stone);
  }
  // Door jambs and a lintel fragment.
  for (const sx of [-1, 1]) {
    column(b, F, sx * 2.0, 1.4, 13.6, 0.45, 4.6, PALETTE.stoneWarm);
    colCyl(C, F, sx * 2.0, 1.0, 13.6, 0.65, 5.3, stone);
  }
  box(b, F, -0.6, 6.25, 13.6, 3.6, 0.6, 1.1, PALETTE.stoneWarm, { rz: 0.06 });
  colBox(C, F, -0.6, 6.25, 13.6, 3.6, 0.75, 1.1, 0, stone);

  // Colonnade around the platform rim.
  for (let k = 0; k < 12; k++) {
    const a = ((k + 0.5) / 12) * Math.PI * 2;
    const broken = [2, 5, 9].includes(k) ? 0.35 + rand() * 0.35 : 0;
    if (k === 7) continue; // fallen, see debris
    column(b, F, Math.sin(a) * 16.1, 1.4, Math.cos(a) * 16.1, 0.55, 6.6, PALETTE.stoneWarm, broken);
    // Base to capital (8.3 m), or to the jagged break.
    colCyl(C, F, Math.sin(a) * 16.1, 1.0, Math.cos(a) * 16.1, 0.78, broken ? 6.6 * (1 - broken) + 0.75 : 7.3, stone);
  }
  // Architrave fragments resting on intact neighbors.
  for (const k of [0, 3, 10]) {
    const a0 = ((k + 0.5) / 12) * Math.PI * 2;
    const a1 = ((k + 1.5) / 12) * Math.PI * 2;
    beam(b, F, v(Math.sin(a0) * 16.1, 8.25, Math.cos(a0) * 16.1), v(Math.sin(a1) * 16.1, 8.25, Math.cos(a1) * 16.1), 0.8, PALETTE.stoneWarm);
    colSpan(C, F, Math.sin(a0) * 16.1, Math.cos(a0) * 16.1, Math.sin(a1) * 16.1, Math.cos(a1) * 16.1, 7.85, 8.65, 0.8, stone);
  }

  // Dome ribs: copper gone green. Some reach the oculus, some snapped, a few are stubs.
  const R = 14;
  const base = 6.4;
  const phiTop = Math.acos(2.6 / R);
  const status = [1, 0.55, 1, 0.1, 1, 0.75, 1, 1, 0.4, 0.12, 1, 0.65];
  for (let k = 0; k < 12; k++) {
    const th = (k / 12) * Math.PI * 2 + 0.13;
    const end = status[k] * phiTop;
    const steps = Math.max(2, Math.round(end * 10));
    const pts: Vector3[] = [];
    for (let i = 0; i <= steps; i++) {
      const ph = (i / steps) * end;
      pts.push(v(Math.sin(th) * R * Math.cos(ph), base + R * Math.sin(ph), Math.cos(th) * R * Math.cos(ph)).applyMatrix4(F));
    }
    b.add(tube(pts, pts.map(() => 0.42), 6, status[k] < 1), null, { color: jitter(VERDIGRIS, 0.05) });
    colChain(C, pts, 0.55, { surface: 'stone' }, 0.85);
    // Brass collar where the rib meets the drum.
    b.add(new CylinderGeometry(0.62, 0.62, 0.5, 8), under(F, xf(Math.sin(th) * R, base + 0.1, Math.cos(th) * R)), { color: jitter(PALETTE.brass) });
    if (status[k] < 1 && status[k] > 0.2) {
      // A jagged break.
      const g = displace(new IcosahedronGeometry(0.55, 1), 0.25, 2, k * 7);
      b.add(g, xf(pts[pts.length - 1].x, pts[pts.length - 1].y, pts[pts.length - 1].z), { color: jitter(VERDIGRIS, 0.06) });
    }
  }
  // Oculus ring, held by the intact ribs; two horizontal hoops.
  ring(b, under(F, xf(0, base + R * Math.sin(phiTop), 0, Math.PI / 2, 0, 0)), 2.6, 0.38, VERDIGRIS, 32);
  {
    const pts: Vector3[] = [];
    for (let i = 0; i <= 24; i++) {
      const th = (i / 24) * Math.PI * 2;
      pts.push(v(Math.sin(th) * 2.6, base + R * Math.sin(phiTop), Math.cos(th) * 2.6).applyMatrix4(F));
    }
    colChain(C, pts, 0.5, stone, 0.75);
  }
  for (const ph of [0.55, 1.0]) {
    // Partial hoops: arcs between intact ribs only.
    const r = R * Math.cos(ph);
    const y = base + R * Math.sin(ph);
    for (const [k0, k1] of [[6, 7], [0, 2], [10, 12]]) {
      const pts: Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const th = ((k0 + ((k1 - k0) * i) / 8) / 12) * Math.PI * 2 + 0.13;
        pts.push(v(Math.sin(th) * r, y, Math.cos(th) * r).applyMatrix4(F));
      }
      b.add(tube(pts, pts.map(() => 0.26), 5, false), null, { color: jitter(VERDIGRIS, 0.05) });
      colChain(C, pts, 0.4, stone, 0.6);
    }
  }
  // Surviving dome panels (both faces), streaked with patina.
  const panel = (k0: number, k1: number, ph0: number, ph1: number) => {
    const th0 = (k0 / 12) * Math.PI * 2 + 0.13;
    const th1 = (k1 / 12) * Math.PI * 2 + 0.13;
    const g = new SphereGeometry(R - 0.05, 8, 6, 0, 1, Math.PI / 2 - ph1, ph1 - ph0);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      // Re-map the patch's azimuth (three.js: x = -cos φ, z = sin φ; φ in 0..1) onto th0..th1.
      const az = Math.atan2(z, -x);
      const rr = Math.hypot(x, z);
      const t = Math.min(1, Math.max(0, az));
      const th = th0 + (th1 - th0) * t;
      pos.setXYZ(i, Math.sin(th) * rr, y + base, Math.cos(th) * rr);
    }
    g.computeVertexNormals();
    const streak = (p: Vector3, _n: Vector3, c: import('three').Color) => {
      c.set(VERDIGRIS).multiplyScalar(0.85 + 0.25 * Math.sin(p.x * 3.1 + p.z * 2.7) * Math.sin(p.y * 0.7));
    };
    b.add(g, F, { color: streak });
    b.add(g, F, { color: streak, invert: true });
    // A thin curved sheet: a grid of spheres centered on it, close enough to leave no gap.
    const rows = Math.max(2, Math.ceil(((ph1 - ph0) * R) / 1.0));
    for (let i = 0; i <= rows; i++) {
      const ph = ph0 + ((ph1 - ph0) * i) / rows;
      const cols = Math.max(2, Math.ceil((Math.abs(th1 - th0) * R * Math.cos(ph)) / 1.0));
      for (let j = 0; j <= cols; j++) {
        const th = th0 + ((th1 - th0) * j) / cols;
        colSphere(C, F, Math.sin(th) * R * Math.cos(ph), base + R * Math.sin(ph), Math.cos(th) * R * Math.cos(ph), 0.75, stone);
      }
    }
  };
  panel(6, 7, 0.08, 1.05);
  panel(0, 1, 0.08, 0.7);
  panel(10, 11, 0.3, 1.2);

  // The great telescope on its pier, aimed up through the broken dome.
  box(b, F, 0, 2.9, -4.5, 2.6, 3.0, 2.6, PALETTE.stoneWarm);
  box(b, F, 0, 4.5, -4.5, 3.0, 0.3, 3.0, BRONZE);
  const pivot = v(0, 6.2, -4.5);
  for (const sx of [-1.1, 1.1]) beam(b, F, v(sx, 4.6, -4.5), v(sx, 6.4, -4.5), 0.35, PALETTE.brass);
  const elev = 0.95;
  const azim = 0.55;
  const dir = v(Math.sin(azim) * Math.cos(elev), Math.sin(elev), Math.cos(azim) * Math.cos(elev));
  const lower = pivot.clone().addScaledVector(dir, -5);
  const upper = pivot.clone().addScaledVector(dir, 11);
  // Tapered barrel as a lathe-like tube with brass bands.
  const barrel = [lower, pivot, upper].map((p) => p.clone().applyMatrix4(F));
  b.add(tube(bezier(barrel, 8), [1.05, 1.0, 0.98, 0.95, 0.9, 0.86, 0.82, 0.78, 0.74], 14, false), null, { color: jitter(PALETTE.brass, 0.04) });
  colChain(C, [barrel[0], barrel[2]], 0.95, { surface: 'stone' }, 1.1);
  for (const t of [0.05, 0.3, 0.62, 0.97]) {
    const c = lower.clone().lerp(upper, t);
    const q = new Matrix4().lookAt(v(0, 0, 0), dir, v(0, 1, 0));
    const m = under(F, new Matrix4().makeTranslation(c.x, c.y, c.z).multiply(q).multiply(xf(0, 0, 0, 0, 0, 0, 1)));
    ring(b, m, 1.08 - t * 0.3, 0.12, BRONZE, 24);
  }
  // Eyepiece, finder scope, counterweight.
  post(b, F, lower, lower.clone().addScaledVector(dir, -1.2), 0.3, BRONZE, 8);
  const side = v(Math.cos(azim), 0, -Math.sin(azim));
  post(b, F, pivot.clone().addScaledVector(side, 1.2).addScaledVector(dir, 2), pivot.clone().addScaledVector(side, 1.2).addScaledVector(dir, 6), 0.22, PALETTE.brass, 8);
  sphere(b, under(F, xf(pivot.x - side.x * 1.6, pivot.y - 0.5, pivot.z - side.z * 1.6, 0, 0, 0, 0.9)), BRONZE);
  s.glow.add(new CylinderGeometry(0.7, 0.7, 0.05, 16), under(F, new Matrix4().makeTranslation(upper.x, upper.y, upper.z).multiply(new Matrix4().lookAt(v(0, 0, 0), dir, v(0, 1, 0))).multiply(xf(0, 0, 0.02, Math.PI / 2, 0, 0))), { color: '#9fd8ff', glow: 0.6 });
  colBox(C, F, 0, 3.05, -4.5, 3.0, 3.3, 3.0, 0, stone);
  for (const sx of [-1.1, 1.1]) colBox(C, F, sx, 5.5, -4.5, 0.4, 1.9, 0.4, 0, stone);
  colSphere(C, F, pivot.x - side.x * 1.6, pivot.y - 0.5, pivot.z - side.z * 1.6, 0.9, stone);

  // Armillary sphere on a pedestal in front of the telescope.
  const ac = v(0, 7.0, 6.5);
  column(b, F, ac.x, 1.4, ac.z, 0.7, 2.2, PALETTE.stoneWarm);
  beam(b, F, v(0, 3.8, 6.5 - 0.0), v(0, ac.y - 3.1, 6.5), 0.3, BRONZE);
  const A = under(F, xf(ac.x, ac.y, ac.z));
  ring(b, under(A, xf(0, 0, 0, Math.PI / 2, 0, 0)), 3.2, 0.14, PALETTE.brass, 48); // horizon
  ring(b, A, 3.1, 0.12, PALETTE.brass, 48); // meridian
  ring(b, under(A, xf(0, 0, 0, Math.PI / 2 - 0.6, 0.4, 0)), 2.9, 0.1, BRONZE, 48); // equator
  ring(b, under(A, xf(0, 0, 0, Math.PI / 2 - 1.0, 0.4, 0)), 2.75, 0.1, PALETTE.brass, 48); // ecliptic
  ring(b, under(A, xf(0, 0, 0, 0, Math.PI / 2, 0)), 2.6, 0.08, BRONZE, 48);
  sphere(b, under(A, xf(0, 0, 0, 0, 0, 0, 0.7)), '#5c88a8');
  post(b, A, v(-1.6, -2.6, 0.7), v(1.6, 2.6, -0.7), 0.06, PALETTE.brass, 6);
  colCyl(C, F, ac.x, 1.0, ac.z, 1.0, 2.9, stone);
  colCyl(C, F, ac.x, 3.6, ac.z, 0.3, 0.6, stone);
  colSphere(C, F, ac.x, ac.y, ac.z, 3.25, stone);

  // Debris: a fallen column in drums, a fallen rib, scattered blocks.
  const a7 = (7.5 / 12) * Math.PI * 2;
  for (let i = 0; i < 4; i++) {
    const r = 18.5 + i * 1.3;
    const m = under(F, xf(Math.sin(a7 + 0.15) * r, 0.55, Math.cos(a7 + 0.15) * r, Math.PI / 2, a7 + 0.15 + i * 0.1, 0));
    b.add(new CylinderGeometry(0.55, 0.55, 1.2, 12), m, { color: jitter(PALETTE.stoneWarm) });
    colBox(C, F, Math.sin(a7 + 0.15) * r, 0.45, Math.cos(a7 + 0.15) * r, 1.1, 1.3, 1.2, a7 + 0.15 + i * 0.1, stone);
  }
  const fallenRib = bezier([v(-6, 1.7, -9), v(-3, 1.9, -11), v(1, 1.6, -11.5)], 6).map((p) => p.applyMatrix4(F));
  b.add(tube(fallenRib, [0.42, 0.42, 0.42, 0.42, 0.42, 0.42, 0.42], 6, true), null, { color: jitter(VERDIGRIS) });
  colChain(C, fallenRib, 0.5, stone, 0.8);
  for (let i = 0; i < 18; i++) {
    const a = rand() * Math.PI * 2;
    const r = 6 + rand() * 18;
    const sz = 0.5 + rand() * 0.9;
    const y = r > 17 ? 0.2 : 1.6;
    stoneBlock(b, F, Math.sin(a) * r, y, Math.cos(a) * r, sz * 1.4, sz, sz, 300 + i, PALETTE.stone, 0.6);
    colBox(C, F, Math.sin(a) * r, y - 0.15, Math.cos(a) * r, sz * 1.45, sz + 0.3, sz * 1.05, 0, stone);
  }
}

// ---------------------------------------------------------------------------------------------
// Lantern Spire pavilion + beacon
// ---------------------------------------------------------------------------------------------

export function buildPavilion(s: SiteBuilders, sp: SpireDef, out: SiteOutputs): Vector3 {
  resetJitter(0x1a7);
  const F = xf(sp.x, sp.topY, sp.z, 0, 0.3, 0);
  const b = s.solid;
  const C = out.colliders;
  const wood = { surface: 'wood' as const };
  const stone = { surface: 'stone' as const };
  // Platform (walkable), two roof tiers as stepped frustums (hexagons: radius between the
  // corner and the flat side), the finial, brazier and beacon, the great lantern.
  colCyl(C, F, 0, -1, 0, 9.3, 1.96, stone);
  colFrustum(C, F, 0, 5.95, 0, 9.4 * 0.93, 4.2 * 0.93, 2.7, 3, wood);
  colCyl(C, F, 0, 8.65, 0, 4.0, 0.65, wood);
  colFrustum(C, F, 0, 9.2, 0, 5.45 * 0.93, 0.5, 2.7, 3, wood);
  colCyl(C, F, 0, 11.8, 0, 0.4, 2.1, wood);
  colCyl(C, F, 0, 13.9, 0, 0.9, 0.8, wood);
  colSphere(C, F, 0, 15.0, 0, 0.8, wood);
  colCyl(C, F, 0, 2.15, 0, 1.3, 3.5, wood);
  const n = 6;
  const R = 7.2;
  // Hexagonal stone platform with a rim.
  b.add(new CylinderGeometry(9.6, 10.4, 1.2, n), under(F, xf(0, 0.3, 0)), { color: jitter(PALETTE.stoneWarm) });
  b.add(new CylinderGeometry(9.0, 9.0, 0.1, n), under(F, xf(0, 0.93, 0)), { color: '#a8977d' });
  // Pillars, beams, brackets.
  const corner = (k: number, r: number) => {
    const a = (k / n) * Math.PI * 2;
    return v(Math.sin(a) * r, 0, Math.cos(a) * r);
  };
  for (let k = 0; k < n; k++) {
    const p = corner(k, R);
    post(b, F, v(p.x, 0.9, p.z), v(p.x, 6.4, p.z), 0.36, PALETTE.lacquer, 8);
    box(b, F, p.x, 1.1, p.z, 0.9, 0.4, 0.9, PALETTE.stoneDark);
    const q = corner(k + 1, R);
    beam(b, F, v(p.x, 6.2, p.z), v(q.x, 6.2, q.z), 0.45, PALETTE.lacquer);
    beam(b, F, v(p.x, 5.2, p.z), v(q.x, 5.2, q.z), 0.18, PALETTE.gold);
    // A low lattice railing except on the entry side.
    if (k !== 0) beam(b, F, v(p.x, 1.9, p.z), v(q.x, 1.9, q.z), 0.14, PALETTE.lacquer);
    colCyl(C, F, p.x, 0.9, p.z, 0.5, 5.6, wood);
    if (k !== 0) colSpan(C, F, p.x, p.z, q.x, q.z, 0.95, 2.05, 0.3, wood);
  }
  // Two-tier roof with upturned eaves.
  const roofTier = (y: number, r0: number, r1: number, h: number) => {
    b.add(new CylinderGeometry(r1, r0, h, n, 1, false), under(F, xf(0, y + h / 2, 0)), { color: jitter('#2f6b6b') });
    b.add(new CylinderGeometry(r0 + 0.05, r0 + 0.05, 0.25, n), under(F, xf(0, y, 0)), { color: jitter(PALETTE.gold) });
    for (let k = 0; k < n; k++) {
      const p = corner(k, r0);
      const tip = corner(k, r0 + 1.6);
      const pts = bezier([v(p.x * 0.8, y + 0.4, p.z * 0.8), v(p.x, y + 0.05, p.z), v(tip.x, y + 0.9, tip.z)], 5).map((q) => q.applyMatrix4(F));
      b.add(tube(pts, [0.32, 0.3, 0.27, 0.23, 0.18, 0.12], 5, true), null, { color: jitter(PALETTE.gold) });
      // Little bells on the tips.
      s.chime.add(new SphereGeometry(0.22, 8, 6), under(F, xf(tip.x, y + 0.4, tip.z)), { color: PALETTE.brass, sway: 0.4 });
    }
  };
  roofTier(6.45, 9.4, 4.2, 2.2);
  roofTier(9.3, 5.4, 0.5, 2.6);
  b.add(new CylinderGeometry(0.2, 0.35, 2.2, 8), under(F, xf(0, 12.9, 0)), { color: PALETTE.gold });
  // The great hanging lantern: a glowing paper globe with lacquered ribs.
  post(b, F, v(0, 6.5, 0), v(0, 5.4, 0), 0.04, PALETTE.iron, 6);
  s.glow.add(new SphereGeometry(1, 16, 12), under(F, xf(0, 3.9, 0, 0, 0, 0, 1.25, 1.55, 1.25)), { color: '#ffb459', glow: 1 });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const pts: Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const ph = -Math.PI / 2 + (i / 8) * Math.PI;
      pts.push(v(Math.sin(a) * Math.cos(ph) * 1.29, 3.9 + Math.sin(ph) * 1.6, Math.cos(a) * Math.cos(ph) * 1.29).applyMatrix4(F));
    }
    b.add(tube(pts, pts.map(() => 0.04), 4, false), null, { color: PALETTE.lacquer });
  }
  box(b, F, 0, 5.5, 0, 0.9, 0.2, 0.9, PALETTE.lacquer);
  box(b, F, 0, 2.3, 0, 0.6, 0.25, 0.6, PALETTE.lacquer);
  // Corner lanterns and streamers.
  for (let k = 0; k < n; k++) {
    const p = corner(k + 0.5, R + 0.3);
    lantern(s, F, p.x, 5.4, p.z, 0.7, 0.95);
    if (k % 2 === 0) {
      const c = corner(k, R + 0.4);
      const yaw = Math.atan2(c.x, c.z);
      bannerCloth(s, under(F, xf(c.x, 0, c.z, 0, yaw, 0)), 0, 6.1, 0.1, 0.9, 3.2, PALETTE.bannerRed, PALETTE.gold);
      colBox(C, under(F, xf(c.x, 0, c.z, 0, yaw, 0)), 0, 4.5, 0.1, 0.9, 3.2, 0.35, 0, { soft: true });
    }
  }
  windChime(s, F, 0, 6.3, R * 0.5);
  // The beacon brazier on the roof ridge.
  b.add(new CylinderGeometry(0.9, 0.5, 0.8, 8), under(F, xf(0, 14.3, 0)), { color: PALETTE.iron });
  s.glow.add(new IcosahedronGeometry(0.75, 1), under(F, xf(0, 15.0, 0)), { color: '#ffcf7a', glow: 1 });
  return v(0, 15.4, 0).applyMatrix4(F);
}

/**
 * A camera-facing glow sprite that never shrinks below a minimum angular size, so the Lantern
 * Spire's beacon reads from across the archipelago; its brightness follows uNight.
 */
export function beaconSprite(center: Vector3): Mesh {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const mat = new ShaderMaterial({
    name: 'beacon',
    uniforms: { ...globalUniforms, uCenter: { value: center.clone() } },
    vertexShader: /* glsl */ `
      uniform vec3 uCenter;
      uniform float uNight;
      varying vec2 vUv;
      varying vec3 vDwWorldPos;
      void main() {
        vec4 mv = viewMatrix * vec4(uCenter, 1.0);
        float dist = -mv.z;
        // At least ~1.6% of the view distance wide, bigger at night.
        float size = max(6.0, dist * (0.012 + 0.022 * uNight));
        mv.xy += position.xy * size;
        vUv = position.xy;
        vDwWorldPos = uCenter;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      ${FOG_PARS_GLSL}
      varying vec2 vUv;
      varying vec3 vDwWorldPos;
      void main() {
        float r2 = dot(vUv, vUv);
        float core = exp(-r2 * 18.0);
        float halo = (exp(-r2 * 4.5) * 0.45 + exp(-r2 * 1.6) * 0.12) * (1.0 - smoothstep(0.55, 1.0, sqrt(r2)));
        float flicker = 0.92 + 0.08 * sin(uTime * 7.3) * sin(uTime * 3.1 + 1.7);
        vec3 col = vec3(1.0, 0.58, 0.24) * (core * 1.5 + halo * 1.4) * (0.12 + uNight * 2.4) * flicker;
        // A beacon punches through the haze: only half the fog applies.
        vec3 fogged = dwApplyFog(col, vDwWorldPos, cameraPosition) - dwApplyFog(vec3(0.0), vDwWorldPos, cameraPosition);
        gl_FragColor = vec4(max(mix(col, fogged, 0.5), 0.0), 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const m = new Mesh(g, mat);
  m.name = 'beacon';
  m.frustumCulled = false;
  m.renderOrder = 5;
  return m;
}

export type { Terrain };
