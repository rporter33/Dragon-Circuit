// The Roost's courtyard, lived in: a fountain with benches, planters spilling flowers, a market
// cart by the well, crates and sacks by the tower doors, a notice board where the path to the
// launch deck begins, bunting strung from the towers to the stable, and perch posts where
// wyverns wait. Everything keeps clear of the spawn, the wyvern's spot, the stable door and the
// walk between them, and carries its own colliders.

import { Color, CylinderGeometry, IcosahedronGeometry, Matrix4, TorusGeometry, Vector3 } from 'three';
import type { Collider } from '../../../core/types';
import { LAYOUT } from '../../layout';
import { displace, under, xf, GeoBuilder } from '../geom';
import { colBox, colCyl, colSpan } from '../colliderKit';
import { PALETTE, barrel, beam, box, crate, isCoarse, jitter, lanternPost, pick, post, rand, v, variants, type SiteBuilders } from './kit';
import type { RoostPlan } from './roostPlan';
import type { SiteOutputs } from './Roost';

const BURLAP = '#b59a6a';
const FLOWERS = ['#e8a0c4', '#f2d35b', '#f6f1e4', '#b98ad8', '#e8774f'];

/** World point → the same point in the stable's frame (door at the origin, +z toward the plaza). */
function stableLocal(plan: RoostPlan): (lx: number, lz: number) => { x: number; z: number } {
  const st = plan.stable;
  const fx = Math.sin(st.yaw);
  const fz = Math.cos(st.yaw);
  const rx = Math.cos(st.yaw);
  const rz = -Math.sin(st.yaw);
  return (lx, lz) => ({ x: st.x + rx * lx + fx * lz, z: st.z + rz * lx + fz * lz });
}

/** A mound of flowers and leaves (for planters). */
function flowerMound(b: GeoBuilder, F: Matrix4, x: number, y: number, z: number, w: number, d: number, seed: number): void {
  const leaf = new Color('#4f7f36');
  const leafHi = new Color('#7fae4c');
  const g = pick(variants('mound', 3, (i) => displace(new IcosahedronGeometry(1, 2), 0.22, 2.4, 950 + i)), seed);
  b.add(g, under(F, xf(x, y, z, 0, seed, 0, w * 0.5, 0.45, d * 0.5)), {
    color: (p, n, out) => out.copy(leaf).lerp(leafHi, Math.max(0, n.y) * 0.6 + 0.2 * Math.sin(p.x * 7 + p.z * 5)),
  });
  // Blossoms dotted over the top.
  const count = isCoarse() ? 0 : Math.round(w * d * 5);
  for (let i = 0; i < count; i++) {
    const fx = (rand() - 0.5) * w * 0.85;
    const fz = (rand() - 0.5) * d * 0.85;
    const r = 0.11 + rand() * 0.07;
    const c = FLOWERS[(seed + i) % FLOWERS.length];
    b.add(pick(variants('blossom', 2, () => new IcosahedronGeometry(1, 0)), i), under(F, xf(x + fx, y + 0.3 + rand() * 0.12, z + fz, 0, rand() * 3, 0, r, r * 0.6, r)), { color: jitter(c, 0.05) });
  }
}

function planter(s: SiteBuilders, C: Collider[], F: Matrix4, x: number, y: number, z: number, w: number, d: number, seed: number): void {
  const b = s.solid;
  box(b, F, x, y + 0.4, z, w, 0.8, d, PALETTE.stoneWarm);
  box(b, F, x, y + 0.82, z, w + 0.15, 0.08, d + 0.15, PALETTE.stone);
  box(b, F, x, y + 0.84, z, w - 0.2, 0.06, d - 0.2, '#5a4632');
  flowerMound(b, F, x, y + 0.85, z, w - 0.1, d - 0.1, seed);
  colBox(C, F, x, y + 0.45, z, w + 0.15, 1.3, d + 0.15, 0, { surface: 'stone' });
}

function sack(b: GeoBuilder, F: Matrix4, x: number, y: number, z: number, seed: number): void {
  const g = pick(variants('sack', 3, (i) => displace(new IcosahedronGeometry(1, 1), 0.15, 2, 970 + i)), seed);
  b.add(g, under(F, xf(x, y + 0.42, z, 0.1 * Math.sin(seed), seed, 0, 0.38, 0.45, 0.32)), { color: jitter(BURLAP, 0.06) });
}

function bench(s: SiteBuilders, C: Collider[], F: Matrix4, x: number, y: number, z: number, yaw: number): void {
  const B = under(F, xf(x, y, z, 0, yaw, 0));
  box(s.solid, B, 0, 0.48, 0, 2.4, 0.1, 0.55, PALETTE.timberLight);
  box(s.solid, B, 0, 0.85, -0.25, 2.4, 0.4, 0.08, PALETTE.timberLight, { rx: -0.15 });
  for (const sx of [-1, 1]) box(s.solid, B, sx * 1.0, 0.24, 0, 0.3, 0.48, 0.5, PALETTE.stoneDark);
  colBox(C, B, 0, 0.5, -0.05, 2.5, 1.0, 0.7, 0, { surface: 'wood' });
}

/** A stone fountain: a round basin, a two-tier center column, and a tall pole for the bunting. */
function fountain(s: SiteBuilders, C: Collider[], F: Matrix4, x: number, y: number, z: number): void {
  const A = under(F, xf(x, y, z));
  const b = s.solid;
  const R = 3.2;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    box(b, A, Math.sin(a) * R, 0.35, Math.cos(a) * R, 1.3, 0.7, 0.55, k % 3 ? PALETTE.stone : PALETTE.stoneWarm, { ry: a });
    box(b, A, Math.sin(a) * R, 0.76, Math.cos(a) * R, 1.35, 0.12, 0.7, PALETTE.stoneWarm, { ry: a });
  }
  b.add(new CylinderGeometry(R - 0.2, R - 0.2, 0.05, 24), under(A, xf(0, 0.5, 0)), { color: '#4b8fa3' });
  b.add(new CylinderGeometry(0.45, 0.6, 1.8, 10), under(A, xf(0, 0.9, 0)), { color: jitter(PALETTE.stoneWarm) });
  b.add(new CylinderGeometry(1.3, 0.5, 0.35, 16), under(A, xf(0, 1.85, 0)), { color: jitter(PALETTE.stone) });
  b.add(new CylinderGeometry(1.15, 1.15, 0.04, 16), under(A, xf(0, 2.0, 0)), { color: '#5aa2b5' });
  b.add(new CylinderGeometry(0.22, 0.3, 1.1, 8), under(A, xf(0, 2.5, 0)), { color: jitter(PALETTE.stoneWarm) });
  b.add(new CylinderGeometry(0.6, 0.25, 0.22, 12), under(A, xf(0, 3.1, 0)), { color: jitter(PALETTE.stone) });
  // Water spilling from the top bowl into the basin: thin pale sheets.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    box(s.glow, A, Math.sin(a) * 1.2, 1.25, Math.cos(a) * 1.2, 0.35, 1.2, 0.04, '#bfe6f2', { ry: a });
  }
  // The bunting pole rises from the top bowl.
  post(b, A, v(0, 3.1, 0), v(0, 8.5, 0), 0.08, PALETTE.timber, 6);
  box(b, A, 0, 8.6, 0, 0.25, 0.25, 0.25, PALETTE.brass);
  colCyl(C, A, 0, -0.5, 0, R + 0.35, 1.32, { surface: 'stone' });
  colCyl(C, A, 0, 0.8, 0, 0.65, 1.0, { surface: 'stone' });
  colCyl(C, A, 0, 1.7, 0, 1.3, 0.55, { surface: 'stone' });
  colCyl(C, A, 0, 2.2, 0, 0.35, 6.4, { surface: 'wood' });
}

/** A two-wheeled market cart with a load of crates, sacks and a barrel. */
function cart(s: SiteBuilders, C: Collider[], F: Matrix4, x: number, y: number, z: number, yaw: number): void {
  const K = under(F, xf(x, y, z, 0, yaw, 0));
  const b = s.solid;
  box(b, K, 0, 1.0, 0, 1.8, 0.12, 3.0, PALETTE.timberLight);
  for (const sx of [-1, 1]) box(b, K, sx * 0.9, 1.3, 0, 0.08, 0.5, 3.0, PALETTE.timber);
  box(b, K, 0, 1.3, -1.5, 1.8, 0.5, 0.08, PALETTE.timber);
  for (const sx of [-1, 1]) {
    const W = under(K, xf(sx * 1.05, 0.62, -0.2, 0, Math.PI / 2, 0));
    b.add(new TorusGeometry(0.6, 0.07, 6, 18), W, { color: jitter(PALETTE.timber) });
    for (let k = 0; k < 4; k++) box(b, W, 0, 0, 0, 0.06, 1.15, 0.06, PALETTE.timber, { rz: (k * Math.PI) / 4 });
    // Shafts resting on the ground ahead.
    beam(b, K, v(sx * 0.7, 1.0, 1.4), v(sx * 0.55, 0.15, 3.6), 0.1, PALETTE.timber);
  }
  post(b, K, v(-1.2, 0.62, -0.2), v(1.2, 0.62, -0.2), 0.06, PALETTE.iron, 6);
  crate(b, K, -0.4, 1.06, -0.6, 0.8);
  crate(b, K, 0.35, 1.06, -0.9, 0.7);
  crate(b, K, -0.3, 1.86, -0.7, 0.55);
  sack(b, K, 0.4, 1.06, 0.5, 3);
  sack(b, K, -0.35, 1.06, 0.8, 4);
  barrel(b, K, 0.3, 1.06, 0.1);
  colBox(C, K, 0, 1.05, -0.2, 2.4, 2.1, 3.2, 0, { surface: 'wood' });
}

/** A notice board with race posters pinned to it. */
function noticeBoard(s: SiteBuilders, C: Collider[], F: Matrix4, x: number, y: number, z: number, yaw: number): void {
  const N = under(F, xf(x, y, z, 0, yaw, 0));
  const b = s.solid;
  for (const sx of [-1.1, 1.1]) post(b, N, v(sx, -0.3, 0), v(sx, 2.8, 0), 0.09, PALETTE.timber, 6);
  box(b, N, 0, 1.85, 0, 2.5, 1.5, 0.1, PALETTE.timberLight);
  box(b, N, 0, 2.75, 0, 2.9, 0.12, 0.5, PALETTE.shingle, { rx: 0.25 });
  const posters = ['#efe2c4', '#e8d5a8', '#d9c9a2', '#f3ead2'];
  for (let k = 0; k < 5; k++) {
    const px = -0.85 + (k % 3) * 0.85 + (rand() - 0.5) * 0.15;
    const py = k < 3 ? 2.15 : 1.5;
    box(b, N, px, py + (rand() - 0.5) * 0.1, 0.07, 0.55, 0.65, 0.02, posters[k % posters.length], { rz: (rand() - 0.5) * 0.12 });
    box(b, N, px, py + 0.1, 0.085, 0.3, 0.12, 0.02, k % 2 ? PALETTE.bannerRed : PALETTE.bannerBlue);
  }
  colBox(C, N, 0, 1.3, 0, 2.6, 3.1, 0.4, 0, { surface: 'wood' });
}

/** A wyvern perch: a stout post with a padded crossbar. */
function perch(s: SiteBuilders, C: Collider[], F: Matrix4, x: number, y: number, z: number, yaw: number): void {
  const P = under(F, xf(x, y, z, 0, yaw, 0));
  const b = s.solid;
  box(b, P, 0, 0.25, 0, 1.6, 0.5, 1.6, PALETTE.stoneDark);
  post(b, P, v(0, 0, 0), v(0, 4.4, 0), 0.32, PALETTE.timber, 8);
  post(b, P, v(-2.2, 4.5, 0), v(2.2, 4.5, 0), 0.26, PALETTE.timberLight, 8);
  for (const sx of [-1, 1]) {
    beam(b, P, v(0, 3.4, 0), v(sx * 1.4, 4.4, 0), 0.16, PALETTE.timber);
    box(b, P, sx * 1.4, 4.78, 0, 0.9, 0.12, 0.55, PALETTE.leather);
  }
  colCyl(C, P, 0, -0.5, 0, 0.45, 4.9, { surface: 'wood' });
  colSpan(C, P, -2.4, 0, 2.4, 0, 4.2, 4.85, 0.6, { surface: 'wood' });
}

/**
 * A string of little flags between two world points, sagging in the middle (cloth: sways in
 * the wind). Flags alternate the Roost's colors.
 */
export function bunting(s: SiteBuilders, a: Vector3, c: Vector3, sag: number, spacing = 1.1): void {
  const len = a.distanceTo(c);
  const n = Math.max(3, Math.round(len / (isCoarse() ? spacing * 3 : spacing)));
  const pts: Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(new Vector3().lerpVectors(a, c, t).add(new Vector3(0, -sag * 4 * t * (1 - t), 0)));
  }
  for (let i = 0; i < n; i++) post(s.solid, new Matrix4(), pts[i], pts[i + 1], 0.02, PALETTE.rope, 6);
  const colors = [PALETTE.bannerRed, PALETTE.gold, PALETTE.bannerBlue, PALETTE.cream];
  const side = new Vector3();
  for (let i = 0; i < n; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    side.subVectors(p1, p0).multiplyScalar(0.32);
    const mid = new Vector3().lerpVectors(p0, p1, 0.5);
    const tip = mid.clone().add(new Vector3(0, -0.55, 0));
    const l = mid.clone().addScaledVector(side, -1);
    const r = mid.clone().addScaledVector(side, 1);
    const g = new GeoBuilder();
    g.addTriangles([l.x, l.y, l.z, tip.x, tip.y, tip.z, r.x, r.y, r.z]);
    const top = mid.y;
    s.cloth.add(g.build(), null, { color: jitter(colors[i % colors.length], 0.05), sway: (p) => Math.max(0, top - p.y) * 0.9 + 0.05 });
  }
}

/** Dress the courtyard (after the stable, towers and well are placed). */
export function buildCourtyard(s: SiteBuilders, plan: RoostPlan, gy: (x: number, z: number) => number, out: SiteOutputs): void {
  const I = new Matrix4();
  const C = out.colliders;
  const local = stableLocal(plan);
  const at = (lx: number, lz: number) => {
    const p = local(lx, lz);
    return { x: p.x, y: gy(p.x, p.z), z: p.z };
  };
  const yaw = plan.stable.yaw;
  const keep = (x: number, z: number, r: number) => out.exclusions.circle(x, z, r);

  // Fountain with benches, off the walk between the spawn and the stable door.
  const f = at(-16, 34);
  fountain(s, C, I, f.x, f.y, f.z);
  keep(f.x, f.z, 4.5);
  for (const [dx, dz, ry] of [[-6.2, 0, Math.PI / 2], [0, 6.4, Math.PI], [5.8, -2.5, -Math.PI / 2 + 0.3]] as const) {
    const p = local(-16 + dx, 34 + dz);
    bench(s, C, I, p.x, gy(p.x, p.z), p.z, yaw + ry);
  }
  // Planters flanking the stable door and dotted around the plaza.
  for (const [lx, lz, w, d] of [[-8.6, 2.6, 2.4, 1.1], [8.6, 2.6, 2.4, 1.1], [-27, 20, 1.6, 1.6], [26, 40, 1.6, 1.6], [-4, 46, 3.2, 1.2], [-34, 38, 1.4, 2.6]] as const) {
    const p = at(lx, lz);
    planter(s, C, I, p.x, p.y, p.z, w, d, Math.round(lx * 7 + lz));
    keep(p.x, p.z, Math.max(w, d) * 0.7);
  }
  // The market cart by the well.
  const c = at(31, 28.5);
  cart(s, C, I, c.x, c.y, c.z, yaw - 0.55);
  keep(c.x, c.z, 3);
  // Crates, sacks and barrels by each tower door.
  plan.towers.forEach((t, i) => {
    const dx = Math.sin(t.doorYaw);
    const dz = Math.cos(t.doorYaw);
    const sx = dz;
    const sz = -dx;
    const bx = t.x + dx * (t.radius + 2.2) + sx * 3.2;
    const bz = t.z + dz * (t.radius + 2.2) + sz * 3.2;
    const by = gy(bx, bz);
    crate(s.solid, I, bx, by, bz, 1.0);
    crate(s.solid, I, bx + sx * 1.1, by, bz + sz * 1.1, 0.8);
    crate(s.solid, I, bx + sx * 0.4, by + 1.0, bz + sz * 0.4, 0.7);
    sack(s.solid, I, bx - sx * 1.0 + dx * 0.6, by, bz - sz * 1.0 + dz * 0.6, i);
    sack(s.solid, I, bx - sx * 1.5 + dx * 0.2, by, bz - sz * 1.5 + dz * 0.2, i + 5);
    barrel(s.solid, I, bx + dx * 1.3, by, bz + dz * 1.3);
    colSpan(C, I, bx - sx * 1.9, bz - sz * 1.9, bx + sx * 1.7, bz + sz * 1.7, by - 0.3, by + 1.75, 2.0, { surface: 'wood' });
    keep(bx, bz, 2.6);
  });
  // A notice board where the walk to the launch deck leaves the plaza.
  const track = plan.path;
  if (track.length > 2) {
    const p0 = track[0];
    const p1 = track[2];
    const tl = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
    const tx = (p1.x - p0.x) / tl;
    const tz = (p1.z - p0.z) / tl;
    const bx = p0.x - tx * 5 - tz * 6.5;
    const bz = p0.z - tz * 5 + tx * 6.5;
    noticeBoard(s, C, I, bx, gy(bx, bz), bz, Math.atan2(-tz, tx) + Math.PI / 2);
    keep(bx, bz, 2.2);
  }
  // Perch posts near where the wyvern waits.
  const ws = LAYOUT.wyvernSpawn.position;
  for (const [ox, oz] of [[12, 14], [-14, 10]] as const) {
    const px = ws[0] + ox;
    const pz = ws[2] + oz;
    perch(s, C, I, px, gy(px, pz), pz, Math.atan2(ws[0] - px, ws[2] - pz) + Math.PI / 2);
    keep(px, pz, 3);
  }
  // Bunting from two towers' galleries to the stable's front gable, and from the third tower to
  // the fountain's pole.
  const apex = new Vector3(0, 12.6, 0.3).applyMatrix4(xf(plan.stable.x, plan.ground, plan.stable.z, 0, yaw, 0));
  const gallery = (i: number) => {
    const t = plan.towers[i];
    const gyT = t.y + 0.7 + t.height * 0.72 + 1.1;
    const dx = plan.stable.x - t.x;
    const dz = plan.stable.z - t.z;
    const l = Math.hypot(dx, dz) || 1;
    return new Vector3(t.x + (dx / l) * t.radius * 1.3, gyT, t.z + (dz / l) * t.radius * 1.3);
  };
  if (plan.towers.length >= 3) {
    bunting(s, gallery(0), apex, 2.2);
    bunting(s, apex.clone(), gallery(1), 2.6);
    const top = new Vector3(f.x, f.y + 8.5, f.z);
    const g2 = plan.towers[2];
    const from = new Vector3(g2.x, g2.y + 0.7 + g2.height * 0.72 + 1.1, g2.z).lerp(top, (g2.radius * 1.3) / Math.max(1, Math.hypot(top.x - g2.x, top.z - g2.z)));
    bunting(s, from, top, 1.6);
  }
  // A lantern post by the fountain for the evening.
  const lp = local(-16 + 4.6, 34 - 3.4);
  lanternPost(s, I, lp.x, gy(lp.x, lp.z), lp.z, yaw + 2.3);
  colCyl(C, I, lp.x, gy(lp.x, lp.z) - 0.5, lp.z, 0.22, 3.5, { surface: 'wood' });
  keep(lp.x, lp.z, 1);
}
