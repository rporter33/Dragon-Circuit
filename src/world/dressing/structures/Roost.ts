// The Windward Roost: the stable (timber frame, plaster, shingles, open front with hay, saddle
// racks and a perch beam), three rookery towers with perches, banners, lanterns, a paddock,
// a flagstone path and the launch deck that juts out over the void toward Gull's Rest.

import { BoxGeometry, ConeGeometry, CylinderGeometry, Matrix4, TorusGeometry, Vector3 } from 'three';
import type { Collider } from '../../../core/types';
import type { Terrain } from '../../terrain';
import type { ExclusionSet } from '../exclusions';
import type { Deck } from '../Dressing';
import { GeoBuilder, under, xf } from '../geom';
import {
  PALETTE,
  barrel,
  beam,
  bannerPole,
  box,
  crate,
  fence,
  flagstone,
  hayBale,
  hayPile,
  jitter,
  lantern,
  lanternPost,
  pennant,
  post,
  isCoarse,
  rand,
  resetJitter,
  saddleRack,
  shingleRoof,
  v,
  windChime,
  type SiteBuilders,
} from './kit';
import type { RoostPlan, TowerPlan } from './roostPlan';
import { buildCourtyard } from './courtyard';
import { colBox, colCone, colCyl, colGable, colSpan, colSphere, toWorld } from '../colliderKit';

const boxGeo = new BoxGeometry(1, 1, 1);
const torusGeo = new TorusGeometry(1, 0.12, 6, 20);
const discGeo = new CylinderGeometry(1, 1, 1, 16);

export interface SiteOutputs {
  exclusions: ExclusionSet;
  /** Collision shapes in world space (boxes for buildings and roofs, cylinders, spheres). */
  colliders: Collider[];
  decks: Deck[];
}

/** Conical roof built from stacked shingle courses. */
export function coneRoof(b: GeoBuilder, frame: Matrix4, y: number, r: number, h: number, color: string, alt: string): void {
  const rows = Math.max(isCoarse() ? 3 : 4, Math.round(h / (isCoarse() ? 1.6 : 0.7)));
  for (let i = 0; i < rows; i++) {
    const t0 = i / rows;
    const t1 = (i + 1) / rows;
    const r0 = r * (1 - t0) + 0.12;
    const r1 = r * (1 - t1);
    const g = new CylinderGeometry(Math.max(0.05, r1), r0, (h / rows) * 1.25, 18, 1, true);
    b.add(g, under(frame, xf(0, y + h * (t0 + t1) / 2, 0, 0, i * 0.4, 0)), { color: jitter(i % 3 === 1 ? alt : color, 0.07) });
  }
  // Underside so the eaves aren't see-through from below.
  b.add(new ConeGeometry(r + 0.1, 0.6, 18, 1, true), under(frame, xf(0, y - 0.05, 0, Math.PI, 0, 0)), { color: '#4a3528' });
}

function buildStable(s: SiteBuilders, plan: RoostPlan, out: SiteOutputs): void {
  const st = plan.stable;
  const F = xf(st.x, plan.ground, st.z, 0, st.yaw, 0);
  const W = st.width;
  const D = st.depth;
  const hw = W / 2;
  const eave = 7.2;
  const ridge = 12.8;
  const b = s.solid;

  // Plinth, floor, a stone apron ramping up to the opening.
  box(b, F, 0, 0.25, -D / 2, W + 1.2, 0.6, D + 1.2, PALETTE.stoneDark);
  box(b, F, 0, 0.56, -D / 2, W - 0.5, 0.06, D - 0.5, '#b39563');
  box(b, F, 0, 0.18, 1.0, 17, 0.36, 2.0, PALETTE.stone, { rx: -0.08 });

  // Posts.
  const postAt = (x: number, z: number, h = eave) => box(b, F, x, 0.6 + (h - 0.6) / 2, z, 0.5, h - 0.6, 0.5, PALETTE.timber);
  for (const x of [-hw, -8, 8, hw]) postAt(x, 0);
  for (const z of [-5, -10, -15, -D]) {
    postAt(-hw, z);
    postAt(hw, z);
  }
  for (const x of [-6, 0, 6]) postAt(x, -D);

  // Wall panels: stone footing, plaster above, timber rails and braces.
  const panel = (x0: number, z0: number, x1: number, z1: number, window: boolean) => {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ry = Math.atan2(x1 - x0, z1 - z0);
    box(b, F, cx, 1.05, cz, 0.55, 1.0, len, PALETTE.stone, { ry });
    box(b, F, cx, 4.35, cz, 0.3, 5.7, len, PALETTE.plaster, { ry });
    const P = F.clone().multiply(xf(cx, 0, cz, 0, ry, 0));
    // Mid rail and a pair of braces (half-timbering).
    box(b, P, 0, 3.9, 0, 0.42, 0.28, len, PALETTE.timber);
    box(b, P, 0, 1.62, 0, 0.62, 0.22, len + 0.1, PALETTE.timber);
    beam(b, P, v(0, 1.7, -len / 2 + 0.3), v(0, 3.8, -0.4), 0.26, PALETTE.timber, {});
    beam(b, P, v(0, 1.7, len / 2 - 0.3), v(0, 3.8, 0.4), 0.26, PALETTE.timber, {});
    if (window) {
      // Shuttered window with a glowing pane (lit from inside at night).
      for (const side of [-1, 1]) {
        box(b, P, side * 0.2, 5.4, 0, 0.12, 1.4, 1.3, PALETTE.timber);
        s.windows.add(boxGeo, under(P, xf(side * 0.17, 5.4, 0, 0, 0, 0, 0.04, 1.1, 1.0)), { color: '#ffb35a', glow: 1 });
        box(b, P, side * 0.21, 5.4, 0, 0.08, 1.2, 0.08, PALETTE.timber);
        box(b, P, side * 0.21, 5.4, 0, 0.08, 0.08, 1.1, PALETTE.timber);
        // Open shutters.
        box(b, P, side * 0.3, 5.4, 1.05, 0.08, 1.3, 0.6, PALETTE.bannerBlue, { ry: side * 0.5 });
        box(b, P, side * 0.3, 5.4, -1.05, 0.08, 1.3, 0.6, PALETTE.bannerBlue, { ry: -side * 0.5 });
      }
    } else {
      beam(b, P, v(0, 4.0, -len / 2 + 0.3), v(0, 7.0, len / 2 - 0.3), 0.24, PALETTE.timber, {});
    }
  };
  const sideZ = [0, -5, -10, -15, -D];
  for (let i = 0; i < sideZ.length - 1; i++) {
    panel(-hw, sideZ[i], -hw, sideZ[i + 1], i === 1 || i === 2);
    panel(hw, sideZ[i], hw, sideZ[i + 1], i === 1 || i === 2);
  }
  const backX = [-hw, -6, 0, 6, hw];
  for (let i = 0; i < backX.length - 1; i++) panel(backX[i], -D, backX[i + 1], -D, i === 1 || i === 2);
  panel(-hw, 0, -8, 0, false);
  panel(8, 0, hw, 0, false);

  // Sill plate and top plate all round.
  for (const [a, c] of [
    [v(-hw, 7.25, 0.3), v(-hw, 7.25, -D - 0.3)],
    [v(hw, 7.25, 0.3), v(hw, 7.25, -D - 0.3)],
    [v(-hw - 0.3, 7.25, -D), v(hw + 0.3, 7.25, -D)],
    [v(-hw - 0.3, 7.25, 0), v(hw + 0.3, 7.25, 0)],
  ] as [Vector3, Vector3][]) {
    beam(b, F, a, c, 0.55, PALETTE.timber);
  }
  // Heavy lintel over the opening with knee braces.
  beam(b, F, v(-8.3, 6.55, 0.05), v(8.3, 6.55, 0.05), 0.75, PALETTE.timber);
  for (const sx of [-1, 1]) beam(b, F, v(sx * 8, 4.9, 0.05), v(sx * 6.3, 6.3, 0.05), 0.3, PALETTE.timber);
  // Hanging sign under the lintel: a board with a brass wing.
  for (const sx of [-0.9, 0.9]) post(b, F, v(sx, 6.2, 0.35), v(sx, 5.6, 0.35), 0.02, PALETTE.iron, 6);
  box(b, F, 0, 5.25, 0.35, 2.6, 0.75, 0.1, PALETTE.timberLight);
  box(b, F, 0, 5.25, 0.42, 1.2, 0.3, 0.04, PALETTE.gold, { rz: 0.25 });
  box(b, F, 0.35, 5.3, 0.42, 0.8, 0.22, 0.04, PALETTE.gold, { rz: -0.35 });

  // Gables: plaster triangles with a king post, collar and a round window up front.
  for (const gz of [0.0, -D]) {
    const front = gz === 0;
    const verts: number[] = [];
    const tri = (z: number, flip: boolean) => {
      const a = [-hw, eave + 0.2, z];
      const c = [hw, eave + 0.2, z];
      const t = [0, ridge - 0.2, z];
      if (flip) verts.push(...a, ...t, ...c);
      else verts.push(...a, ...c, ...t);
    };
    tri(gz + 0.12, false);
    tri(gz - 0.12, true);
    const g = new GeoBuilder();
    g.addTriangles(verts);
    b.add(g.build(), F, { color: jitter(PALETTE.plaster) });
    beam(b, F, v(-hw - 0.4, eave + 0.1, gz + 0.2), v(0, ridge + 0.25, gz + 0.2), 0.42, PALETTE.timber);
    beam(b, F, v(hw + 0.4, eave + 0.1, gz + 0.2), v(0, ridge + 0.25, gz + 0.2), 0.42, PALETTE.timber);
    beam(b, F, v(0, front ? 9.3 : eave + 0.2, gz + 0.2), v(0, ridge, gz + 0.2), 0.32, PALETTE.timber);
    beam(b, F, v(-5.6, 9.7, gz + 0.2), v(5.6, 9.7, gz + 0.2), 0.3, PALETTE.timber);
    if (front) {
      const wm = under(F, xf(0, 8.4, gz + 0.22, Math.PI / 2, 0, 0));
      b.add(torusGeo, under(wm, xf(0, 0, 0, 0, 0, 0, 0.75, 0.75, 0.75)), { color: PALETTE.timber });
      s.windows.add(discGeo, under(wm, xf(0, 0, 0, 0, 0, 0, 0.7, 0.05, 0.7)), { color: '#ffb35a', glow: 1 });
    }
  }

  shingleRoof(b, F, -D - 1.8, 2.2, hw + 1.6, eave - 0.35, ridge, PALETTE.shingle, PALETTE.shingleAlt);

  // Wyvern-head finial on the front ridge end; a weathervane at the back.
  const neck = [v(0, ridge + 0.2, 2.1), v(0, ridge + 1.0, 2.5), v(0, ridge + 1.7, 3.1)];
  beam(b, F, neck[0], neck[1], 0.38, PALETTE.timber);
  beam(b, F, neck[1], neck[2], 0.32, PALETTE.timber);
  box(b, F, 0, ridge + 1.8, 3.5, 0.42, 0.42, 0.95, PALETTE.timber, { rx: 0.25 });
  for (const sx of [-0.14, 0.14]) beam(b, F, v(sx, ridge + 2.0, 3.2), v(sx * 2.5, ridge + 2.6, 2.6), 0.08, PALETTE.timberLight);
  post(b, F, v(0, ridge, -D), v(0, ridge + 2.4, -D), 0.05, PALETTE.iron, 6);
  box(b, F, 0, ridge + 2.3, -D, 1.4, 0.25, 0.05, PALETTE.brass);
  box(b, F, 0.6, ridge + 2.4, -D, 0.35, 0.5, 0.05, PALETTE.brass, { rz: 0.5 });

  // Interior: perch beam, hay, saddle racks, trough, hanging lanterns.
  for (const x of [-9, 9]) post(b, F, v(x, 0.6, -14), v(x, 3.4, -14), 0.22, PALETTE.timber, 8);
  post(b, F, v(-9.5, 3.3, -14), v(9.5, 3.3, -14), 0.32, PALETTE.timberLight, 8);
  hayPile(b, F, -8.5, 0.7, -17, 2.8, 11);
  hayPile(b, F, 7.5, 0.7, -17.5, 2.4, 13);
  hayPile(b, F, -1.5, 0.6, -18, 2.0, 17);
  hayBale(b, F, -10.5, 0.6, -6, 0.1);
  hayBale(b, F, -10.5, 0.6, -8.0, -0.1);
  hayBale(b, F, -10.4, 1.5, -7.0, 0.05);
  hayBale(b, F, -10.6, 0.6, -10.5, 0, false);
  saddleRack(b, F, 10.4, 0.6, -5.5, Math.PI / 2, PALETTE.blanket);
  saddleRack(b, F, 10.4, 0.6, -8.0, Math.PI / 2, PALETTE.bannerBlue);
  saddleRack(b, F, 10.4, 0.6, -10.5, Math.PI / 2, '#3f7a4a');
  box(b, F, 9.8, 1.0, -13, 1.2, 0.8, 3.2, PALETTE.timberLight);
  box(b, F, 9.8, 1.36, -13, 1.0, 0.04, 3.0, PALETTE.water);
  for (const lx of [-6, 6]) {
    post(b, F, v(lx, 7.0, -9), v(lx, 5.6, -9), 0.02, PALETTE.iron, 6);
    lantern(s, F, lx, 5.25, -9, 1, 0.6);
  }
  for (const lx of [-9.2, 9.2]) lantern(s, F, lx, 5.4, 0.55, 0.9, 0);
  for (const lx of [-12.8, 12.8]) windChime(s, F, lx, 6.9, 1.6);
  // Outside: barrels and crates by the front corners.
  barrel(b, F, -13.5, 0, 1.5);
  barrel(b, F, -14.4, 0, 0.6);
  crate(b, F, 13.8, 0, 1.2);
  crate(b, F, 14.6, 0, 0.1, 0.7);
  crate(b, F, 13.9, 0.9, 1.1, 0.6);

  // Keep-outs and colliders.
  const loc = (lx: number, lz: number) => new Vector3(lx, 0, lz).applyMatrix4(F);
  const a = loc(0, -D / 2 + 2);
  const c = loc(0, -D / 2 - 2);
  out.exclusions.capsule(a.x, a.z, c.x, c.z, hw + 1.5);
  stableColliders(out.colliders, F, W, D, eave, ridge);
}

/**
 * The stable as boxes: plinth and floor you can walk on, four walls (the front split around the
 * 16 m opening, with the lintel above it), the gable roof as stepped boxes whose tops follow the
 * shingles within ±0.4 m (walkable: wyverns perch on it), and the furniture inside and out.
 */
function stableColliders(out: Collider[], F: Matrix4, W: number, D: number, eave: number, ridge: number): void {
  const hw = W / 2;
  const stone = { surface: 'stone' as const };
  const wood = { surface: 'wood' as const };
  // Plinth (stone, a step up from the yard) and the plank floor inside.
  colBox(out, F, 0, 0.025, -D / 2, W + 1.2, 1.05, D + 1.2, 0, stone);
  colBox(out, F, 0, 0.295, -D / 2, W - 0.5, 0.59, D - 0.5, 0, wood);
  // Walls: stone footing, plaster and timber up to the top plate (7.5 m).
  const top = eave + 0.3;
  colSpan(out, F, -hw, 0.3, -hw, -D - 0.3, -0.5, top, 0.7, wood);
  colSpan(out, F, hw, 0.3, hw, -D - 0.3, -0.5, top, 0.7, wood);
  colSpan(out, F, -hw - 0.3, -D, hw + 0.3, -D, -0.5, top, 0.7, wood);
  colSpan(out, F, -hw - 0.3, 0, -8, 0, -0.5, top, 0.7, wood);
  colSpan(out, F, 8, 0, hw + 0.3, 0, -0.5, top, 0.7, wood);
  // Lintel over the opening and the hanging sign under it.
  colSpan(out, F, -8.3, 0.05, 8.3, 0.05, 6.15, top, 0.8, wood);
  colBox(out, F, 0, 5.25, 0.35, 2.6, 0.75, 0.2, 0, wood);
  // Roof: shingles from the eaves (6.85) to the ridge cap (13.0), overhanging the walls.
  colGable(out, F, -D - 1.8, 2.2, hw + 1.6, eave - 0.35, ridge + 0.25, eave, 8, wood);
  // The wyvern-head finial on the front ridge end.
  colBox(out, F, 0, ridge + 1.2, 2.9, 0.6, 2.2, 1.6, 0, wood);
  // Inside: perch posts and beam, hay, bales, saddle racks, trough.
  for (const x of [-9, 9]) colCyl(out, F, x, 0, -14, 0.3, 3.5, wood);
  colSpan(out, F, -9.8, -14, 9.8, -14, 2.95, 3.65, 0.7, wood);
  colSphere(out, F, -8.5, 1.0, -17, 2.0, { soft: true });
  colSphere(out, F, 7.5, 1.0, -17.5, 1.7, { soft: true });
  colSphere(out, F, -1.5, 0.9, -18, 1.4, { soft: true });
  colBox(out, F, -10.5, 1.5, -7.0, 1.7, 1.8, 3.2, 0, wood);
  colBox(out, F, -10.6, 1.35, -10.5, 1.2, 1.5, 1.5, 0, wood);
  colBox(out, F, 10.4, 1.25, -8.0, 1.2, 1.3, 6.6, 0, wood);
  colBox(out, F, 9.8, 1.0, -13, 1.3, 0.85, 3.3, 0, wood);
  // Outside the front corners: barrels and crates.
  colCyl(out, F, -13.5, 0, 1.5, 0.45, 1.1, wood);
  colCyl(out, F, -14.4, 0, 0.6, 0.45, 1.1, wood);
  colBox(out, F, 14.15, 0.75, 0.7, 1.6, 1.5, 1.9, 0, wood);
}

function buildTower(s: SiteBuilders, t: TowerPlan, idx: number, out: SiteOutputs): void {
  const F = xf(t.x, t.y, t.z, 0, t.doorYaw, 0);
  const b = s.solid;
  const r = t.radius;
  const shaftH = t.height * 0.72;
  box(b, F, 0, 0.3, 0, r * 2.4, 0.9, r * 2.4, PALETTE.stoneDark, { ry: 0.4 });
  // Stone courses, slightly tapering.
  const course = isCoarse() ? 3.6 : 1.3;
  const n = Math.ceil(shaftH / course);
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const rr = r * (1 - 0.08 * t0);
    const g = new CylinderGeometry(rr * 0.99, rr, course + 0.02, 14, 1, true);
    b.add(g, under(F, xf(0, 0.7 + (i + 0.5) * (shaftH / n), 0, 0, i * 0.23, 0)), { color: jitter(i % 2 ? PALETTE.stone : PALETTE.stoneWarm, 0.06) });
  }
  // Door and window slits.
  box(b, F, 0, 1.9, r * 0.98, 1.7, 2.8, 0.3, '#2a211b');
  box(b, F, 0, 3.45, r * 0.98, 2.1, 0.35, 0.45, PALETTE.stoneDark);
  box(b, F, 0, 1.8, r * 1.02, 1.4, 2.5, 0.12, PALETTE.timber);
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + 0.6;
    const y = 4 + k * (shaftH - 5) / 3;
    const rr = r * (1 - 0.08 * (y / shaftH)) + 0.02;
    s.windows.add(boxGeo, under(F, xf(Math.sin(a) * rr, y, Math.cos(a) * rr, 0, a, 0, 0.35, 1.1, 0.12)), { color: '#ffb35a', glow: 1 });
  }
  // Gallery: floor ring, posts, rail, plaster drum, perches.
  const gy = 0.7 + shaftH;
  const gr = r * 1.35;
  b.add(new CylinderGeometry(gr, gr * 0.92, 0.5, 18), under(F, xf(0, gy, 0)), { color: jitter(PALETTE.timber) });
  b.add(new CylinderGeometry(r * 0.95, r * 0.95, 3.4, 16, 1, true), under(F, xf(0, gy + 1.9, 0)), { color: jitter(PALETTE.plaster) });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    post(b, F, v(Math.sin(a) * gr * 0.95, gy, Math.cos(a) * gr * 0.95), v(Math.sin(a) * gr * 0.95, gy + 3.6, Math.cos(a) * gr * 0.95), 0.14, PALETTE.timber, 6);
    const a2 = ((k + 1) / 8) * Math.PI * 2;
    beam(b, F, v(Math.sin(a) * gr * 0.95, gy + 1.1, Math.cos(a) * gr * 0.95), v(Math.sin(a2) * gr * 0.95, gy + 1.1, Math.cos(a2) * gr * 0.95), 0.1, PALETTE.timberLight);
    if (k % 2 === 0) s.windows.add(boxGeo, under(F, xf(Math.sin(a + 0.4) * r * 0.97, gy + 2.2, Math.cos(a + 0.4) * r * 0.97, 0, a + 0.4, 0, 0.8, 1.0, 0.1)), { color: '#ffb35a', glow: 1 });
  }
  // Perch beams jutting out (wyverns land on these).
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4 + idx;
    const len = 4.5 + (k % 2) * 1.5;
    const p0 = v(Math.sin(a) * r * 0.6, gy - 0.1, Math.cos(a) * r * 0.6);
    const p1 = v(Math.sin(a) * (gr + len), gy + 0.15, Math.cos(a) * (gr + len));
    post(b, F, p0, p1, 0.28, PALETTE.timberLight, 8);
    box(b, F, p1.x, p1.y, p1.z, 0.65, 0.65, 0.65, PALETTE.timber, { ry: a });
    beam(b, F, v(Math.sin(a) * (r + 0.1), gy - 2.2, Math.cos(a) * (r + 0.1)), v(Math.sin(a) * (gr + len * 0.5), gy, Math.cos(a) * (gr + len * 0.5)), 0.2, PALETTE.timber);
  }
  // Roof, finial, flag.
  coneRoof(b, F, gy + 3.5, gr + 0.9, 5.2 + r * 0.4, PALETTE.slate, '#475268');
  const top = gy + 3.5 + 5.2 + r * 0.4;
  post(b, F, v(0, top - 0.3, 0), v(0, top + 3.2, 0), 0.06, PALETTE.iron, 6);
  b.add(new CylinderGeometry(0.2, 0.2, 0.2, 8), under(F, xf(0, top + 3.25, 0)), { color: PALETTE.brass });
  pennant(s, F, 0.06, top + 2.6, 0, 3.2, 1.0, idx === 1 ? PALETTE.bannerBlue : PALETTE.bannerRed);
  lantern(s, F, 0, 2.6, r + 0.45, 0.9, -1.9);

  out.exclusions.circle(t.x, t.z, r + 2.5);
  towerColliders(out.colliders, F, r, shaftH, idx);
}

/**
 * A rookery tower: stone shaft on its plinth, the gallery floor (walkable) with its rail and
 * posts, the plaster drum, the perch beams wyverns land on, and the slate cone.
 */
function towerColliders(out: Collider[], F: Matrix4, r: number, shaftH: number, idx: number): void {
  const stone = { surface: 'stone' as const };
  const wood = { surface: 'wood' as const };
  const gy = 0.7 + shaftH;
  const gr = r * 1.35;
  colBox(out, F, 0, -0.2, 0, r * 2.4, 1.9, r * 2.4, 0.4, stone);
  colCyl(out, F, 0, -1, 0, r, gy + 0.75, stone);
  colCyl(out, F, 0, gy - 0.25, 0, gr, 0.5, wood);
  colCyl(out, F, 0, gy + 0.25, 0, r * 0.95, 3.3, wood);
  const rr = gr * 0.95;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const a2 = ((k + 1) / 8) * Math.PI * 2;
    colCyl(out, F, Math.sin(a) * rr, gy, Math.cos(a) * rr, 0.2, 3.6, wood);
    colSpan(out, F, Math.sin(a) * rr, Math.cos(a) * rr, Math.sin(a2) * rr, Math.cos(a2) * rr, gy + 0.25, gy + 1.2, 0.25, wood);
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4 + idx;
    const len = 4.5 + (k % 2) * 1.5;
    colSpan(out, F, Math.sin(a) * r * 0.9, Math.cos(a) * r * 0.9, Math.sin(a) * (gr + len + 0.3), Math.cos(a) * (gr + len + 0.3), gy - 0.4, gy + 0.45, 0.62, wood);
  }
  colCone(out, F, 0, gy + 3.4, 0, gr + 0.9, 5.3 + r * 0.4, 5, stone);
}

function buildDeck(s: SiteBuilders, plan: RoostPlan, terrain: Terrain, out: SiteOutputs): void {
  const dk = plan.deck;
  const F = xf(dk.x, dk.y, dk.z, 0, dk.yaw, 0);
  const b = s.solid;
  const hw = dk.halfWidth;
  const L = dk.length;
  const roost = terrain.islands.find((sh) => sh.def.id === plan.islandId)!;
  const toWorld = (lx: number, ly: number, lz: number) => new Vector3(lx, ly, lz).applyMatrix4(F);
  // Planks.
  for (let z = -1.5; z < L; z += 0.52) {
    box(b, F, (rand() - 0.5) * 0.08, -0.08, z + 0.24, hw * 2 + 0.25, 0.14, 0.46, jitter(PALETTE.timberLight, 0.09));
  }
  // Joists and a deep edge beam.
  for (const x of [-hw + 0.3, 0, hw - 0.3]) beam(b, F, v(x, -0.42, -1.5), v(x, -0.42, L), 0.42, PALETTE.timber);
  for (const sx of [-1, 1]) beam(b, F, v(sx * (hw + 0.1), -0.25, -1.5), v(sx * (hw + 0.1), -0.25, L), 0.3, PALETTE.timber);
  beam(b, F, v(-hw - 0.2, -0.3, L - 0.1), v(hw + 0.2, -0.3, L - 0.1), 0.35, PALETTE.timber);
  // Legs down to the ground while over land; struts to the cliff face beyond the rim.
  for (let z = 0; z < dk.rimDist - 1; z += 4) {
    for (const sx of [-1, 1]) {
      const w = toWorld(sx * (hw - 0.3), 0, z);
      const gy = roost.topHeight(w.x, w.z) - dk.y;
      post(b, F, v(sx * (hw - 0.3), gy - 0.6, z), v(sx * (hw - 0.3), -0.3, z), 0.24, PALETTE.timber, 8);
    }
  }
  const rimLocal = dk.rimDist;
  for (const zEnd of [rimLocal + 5, rimLocal + 10, rimLocal + 15]) {
    for (const sx of [-1, 1]) {
      const anchor = v(sx * (hw - 0.6), -7.5 - (zEnd - rimLocal) * 0.25, rimLocal - 2.5);
      post(b, F, anchor, v(sx * (hw - 0.3), -0.5, zEnd), 0.22, PALETTE.timber, 8);
      box(b, F, anchor.x, anchor.y, anchor.z, 0.8, 0.8, 0.8, PALETTE.iron);
    }
    beam(b, F, v(-hw + 0.3, -0.62, zEnd), v(hw - 0.3, -0.62, zEnd), 0.3, PALETTE.timber);
  }
  // Railings, open at the far end.
  for (const sx of [-1, 1]) {
    const posts: Vector3[] = [];
    for (let z = -0.5; z <= L - 2.5; z += 2.5) {
      posts.push(v(sx * hw, 0, z));
      post(b, F, v(sx * hw, -0.3, z), v(sx * hw, 1.15, z), 0.09, PALETTE.timber, 6);
    }
    for (let i = 0; i < posts.length - 1; i++) {
      beam(b, F, posts[i].clone().setY(1.12), posts[i + 1].clone().setY(1.12), 0.12, PALETTE.timberLight);
      beam(b, F, posts[i].clone().setY(0.55), posts[i + 1].clone().setY(0.55), 0.04, PALETTE.rope);
    }
    // The rail as one thin wall from the first post to the last.
    colSpan(out.colliders, F, sx * hw, posts[0].z, sx * hw, posts[posts.length - 1].z, -0.3, 1.2, 0.25, { surface: 'wood' });
  }
  // Launch gate at the end: tall posts, crossbar, pennants, lanterns. Tall enough for the biggest
  // wyvern to run out under it with its head up.
  const gateH = 7.6;
  for (const sx of [-1, 1]) {
    post(b, F, v(sx * (hw + 0.2), -0.6, L - 0.4), v(sx * (hw + 0.2), gateH, L - 0.4), 0.22, PALETTE.timber, 8);
    box(b, F, sx * (hw + 0.2), gateH + 0.15, L - 0.4, 0.5, 0.3, 0.5, PALETTE.brass);
    lantern(s, F, sx * (hw + 0.2) - sx * 0.5, gateH - 1.7, L - 0.4, 0.8);
    pennant(s, F, sx * (hw + 0.2), gateH - 0.8, L - 0.4, 2.6, 0.8, sx < 0 ? PALETTE.bannerBlue : PALETTE.bannerRed);
    colCyl(out.colliders, F, sx * (hw + 0.2), -0.6, L - 0.4, 0.3, gateH + 0.9, { surface: 'wood' });
  }
  beam(b, F, v(-hw - 0.6, gateH - 0.5, L - 0.4), v(hw + 0.6, gateH - 0.5, L - 0.4), 0.3, PALETTE.timber);
  colSpan(out.colliders, F, -hw - 0.6, L - 0.4, hw + 0.6, L - 0.4, gateH - 0.7, gateH - 0.3, 0.35, { surface: 'wood' });
  // Windsock on the left gate post.
  pennant(s, F, -hw - 0.2, gateH - 0.2, L - 0.4, 3.0, 0.7, '#e8e2d6');
  // Root arch with a sign and chimes, as tall as the launch gate.
  const archH = 7.6;
  for (const sx of [-1, 1]) {
    post(b, F, v(sx * (hw + 0.3), -0.3, -1.2), v(sx * (hw + 0.3), archH, -1.2), 0.22, PALETTE.timber, 8);
    colCyl(out.colliders, F, sx * (hw + 0.3), -0.3, -1.2, 0.3, archH + 0.4, { surface: 'wood' });
  }
  beam(b, F, v(-hw - 0.9, archH + 0.1, -1.2), v(hw + 0.9, archH + 0.1, -1.2), 0.36, PALETTE.timber);
  box(b, F, 0, archH - 0.55, -1.25, 2.4, 0.6, 0.1, PALETTE.timberLight);
  box(b, F, 0, archH - 0.55, -1.18, 1.0, 0.18, 0.05, PALETTE.gold);
  for (const cx of [-0.9, 0.9]) post(b, F, v(cx, archH - 0.08, -1.25), v(cx, archH - 0.25, -1.25), 0.02, PALETTE.iron, 6);
  colSpan(out.colliders, F, -hw - 0.9, -1.2, hw + 0.9, -1.2, archH - 0.9, archH + 0.3, 0.45, { surface: 'wood' });
  windChime(s, F, -1.8, archH - 0.1, -1.2);
  windChime(s, F, 1.8, archH - 0.1, -1.2);

  // Walkable surface + keep-outs.
  out.decks.push({ x: dk.x, z: dk.z, yaw: dk.yaw, halfWidth: hw, back: 1.5, length: L, y: dk.y, surface: 'wood' });
  const root = toWorld(0, 0, -1.5);
  const tip = toWorld(0, 0, dk.rimDist);
  out.exclusions.capsule(root.x, root.z, tip.x, tip.z, hw + 2, false);
}

/** A banner pole (base at the frame origin, facing frame +Z): pole, crossbar, and the cloth (soft). */
function bannerColliders(out: Collider[], F: Matrix4, height: number): void {
  colCyl(out, F, 0, -0.5, 0, 0.22, height + 0.85, { surface: 'wood' });
  colSpan(out, F, -1.4, 0.15, 1.4, 0.15, height - 0.6, height - 0.3, 0.25, { surface: 'wood' });
  const clothH = height * 0.55;
  colBox(out, F, 0, height - 0.5 - clothH / 2, 0.2, 2.2, clothH, 0.4, 0, { soft: true });
}

/** A stone well with a little shingled roof, a winch and a bucket. */
function buildWell(s: SiteBuilders, x: number, y: number, z: number, colliders: Collider[]): void {
  const F = xf(x, y, z, 0, 0.4, 0);
  const b = s.solid;
  for (let c = 0; c < 3; c++) {
    for (let k = 0; k < 10; k++) {
      const a = ((k + (c % 2) * 0.5) / 10) * Math.PI * 2;
      box(b, F, Math.sin(a) * 1.35, 0.18 + c * 0.32, Math.cos(a) * 1.35, 0.85, 0.3, 0.42, c === 2 ? PALETTE.stoneWarm : PALETTE.stone, { ry: a });
    }
  }
  b.add(new CylinderGeometry(1.15, 1.15, 0.05, 16), under(F, xf(0, 0.55, 0)), { color: '#24323a' });
  for (const sx of [-1.45, 1.45]) post(b, F, v(sx, 0, 0), v(sx, 2.6, 0), 0.12, PALETTE.timber, 6);
  post(b, F, v(-1.6, 1.85, 0), v(1.6, 1.85, 0), 0.1, PALETTE.timberLight, 8);
  box(b, F, 1.75, 1.85, 0.25, 0.08, 0.08, 0.5, PALETTE.iron);
  shingleRoof(b, F, -1.1, 1.1, 1.9, 2.3, 3.1, PALETTE.shingle, PALETTE.shingleAlt);
  post(b, F, v(0, 1.85, 0), v(0, 1.0, 0), 0.015, PALETTE.rope, 6);
  b.add(new CylinderGeometry(0.22, 0.17, 0.32, 10), under(F, xf(0, 0.85, 0)), { color: jitter(PALETTE.timberLight) });
  colCyl(colliders, F, 0, -0.5, 0, 1.6, 1.47, { surface: 'stone' });
  for (const sx of [-1.45, 1.45]) colCyl(colliders, F, sx, 0.9, 0, 0.18, 1.5, { surface: 'wood' });
  colGable(colliders, F, -1.1, 1.1, 1.9, 2.3, 3.15, 2.2, 2, { surface: 'wood' });
}

/** Build everything on the Roost into the site builders; registers keep-outs/colliders/decks. */
export function buildRoost(s: SiteBuilders, plan: RoostPlan, terrain: Terrain, out: SiteOutputs): void {
  resetJitter(0x2005);
  const roost = terrain.islands.find((sh) => sh.def.id === plan.islandId)!;
  const gy = (x: number, z: number) => roost.topHeight(x, z);
  const I = new Matrix4();
  // The plaza: no trees or rocks; grass is already excluded by the stone surface.
  out.exclusions.circle(roost.def.x, roost.def.z, 54, true);
  for (const c of plan.clear) out.exclusions.circle(c.x, c.z, c.r, true);

  buildStable(s, plan, out);
  plan.towers.forEach((t, i) => buildTower(s, t, i, out));
  buildDeck(s, plan, terrain, out);

  for (const bn of plan.banners) {
    bannerPole(s, I, bn.x, gy(bn.x, bn.z), bn.z, bn.yaw, 9, bn.color === 'blue' ? PALETTE.bannerBlue : PALETTE.bannerRed, PALETTE.gold);
    out.exclusions.circle(bn.x, bn.z, 1.2);
    bannerColliders(out.colliders, xf(bn.x, gy(bn.x, bn.z), bn.z, 0, bn.yaw, 0), 9);
  }
  for (const l of plan.lanterns) {
    lanternPost(s, I, l.x, gy(l.x, l.z), l.z, l.yaw);
    out.exclusions.circle(l.x, l.z, 1);
    colCyl(out.colliders, I, l.x, gy(l.x, l.z) - 0.5, l.z, 0.22, 3.5, { surface: 'wood' });
  }
  // Flagstone path.
  plan.path.forEach((p, i) => {
    for (const side of [-1, 1]) {
      const ox = side * 0.95 + (rand() - 0.5) * 0.5;
      const dir = plan.path[Math.min(plan.path.length - 1, i + 1)];
      const prev = plan.path[Math.max(0, i - 1)];
      const tx = dir.x - prev.x;
      const tz = dir.z - prev.z;
      const tl = Math.hypot(tx, tz) || 1;
      const x = p.x + (-tz / tl) * ox;
      const z = p.z + (tx / tl) * ox;
      flagstone(s.solid, I, x, gy(x, z) + 0.02, z, 0.75 + rand() * 0.3, i * 2 + side);
    }
    if (i > 0) {
      const q = plan.path[i - 1];
      out.exclusions.capsule(q.x, q.z, p.x, p.z, 1.9);
    }
  });
  // Paddock with a gate gap facing the plaza.
  const pts = plan.paddock;
  const fenceRun = (ax: number, az: number, bx: number, bz: number) => {
    fence(s.solid, I, v(ax, 0, az), v(bx, 0, bz), 2.6, gy);
    const lo = Math.min(gy(ax, az), gy(bx, bz));
    const hi = Math.max(gy(ax, az), gy(bx, bz));
    colSpan(out.colliders, I, ax, az, bx, bz, lo - 0.4, hi + 1.3, 0.25, { surface: 'wood' });
  };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const c = pts[(i + 1) % pts.length];
    if (i === pts.length - 1) {
      // Leave a gate: fence only the first and last thirds of the closing side.
      const m1 = { x: a.x + (c.x - a.x) * 0.33, z: a.z + (c.z - a.z) * 0.33 };
      const m2 = { x: a.x + (c.x - a.x) * 0.67, z: a.z + (c.z - a.z) * 0.67 };
      fenceRun(a.x, a.z, m1.x, m1.z);
      fenceRun(m2.x, m2.z, c.x, c.z);
    } else {
      fenceRun(a.x, a.z, c.x, c.z);
    }
  }
  // A well on the plaza and a feeding trough by where the wyvern waits.
  buildWell(s, plan.well.x, gy(plan.well.x, plan.well.z), plan.well.z, out.colliders);
  out.exclusions.circle(plan.well.x, plan.well.z, 3);
  buildCourtyard(s, plan, gy, out);
  {
    const t = plan.trough;
    const T = xf(t.x, gy(t.x, t.z), t.z, 0, t.yaw, 0);
    box(s.solid, T, 0, 0.45, 0, 3.4, 0.8, 1.2, PALETTE.timberLight);
    box(s.solid, T, 0, 0.82, 0, 3.1, 0.04, 0.9, PALETTE.water);
    for (const sx of [-1.6, 1.6]) box(s.solid, T, sx, 0.4, 0, 0.2, 0.85, 1.35, PALETTE.timber);
    hayPile(s.solid, T, 0.4, 0.1, 2.0, 1.6, 29);
    barrel(s.solid, T, 2.6, 0, 0.6);
    colBox(out.colliders, T, 0, 0.42, 0, 3.6, 0.85, 1.35, 0, { surface: 'wood' });
    colCyl(out.colliders, T, 2.6, -0.3, 0.6, 0.45, 1.4, { surface: 'wood' });
    colSphere(out.colliders, T, 0.4, -0.4, 2.0, 1.3, { soft: true });
    out.exclusions.circle(t.x, t.z, 3.5);
  }
  const pc = { x: pts.reduce((t, p) => t + p.x, 0) / pts.length, z: pts.reduce((t, p) => t + p.z, 0) / pts.length };
  hayPile(s.solid, I, pc.x + 2, gy(pc.x + 2, pc.z - 2), pc.z - 2, 1.8, 23);
  hayBale(s.solid, I, pc.x - 2.5, gy(pc.x - 2.5, pc.z + 3), pc.z + 3, 0.6, false);
  box(s.solid, I, pc.x - 3, gy(pc.x - 3, pc.z - 4) + 0.45, pc.z - 4, 2.6, 0.7, 1.0, PALETTE.timberLight, { ry: 0.3 });
  colSphere(out.colliders, I, pc.x + 2, gy(pc.x + 2, pc.z - 2) - 0.45, pc.z - 2, 1.45, { soft: true });
  colBox(out.colliders, I, pc.x - 2.5, gy(pc.x - 2.5, pc.z + 3) + 0.75, pc.z + 3, 1.2, 1.5, 1.5, 0.6, { surface: 'wood' });
  colBox(out.colliders, I, pc.x - 3, gy(pc.x - 3, pc.z - 4) + 0.4, pc.z - 4, 2.6, 0.9, 1.0, 0.3, { surface: 'wood' });
  out.exclusions.capsule(pts[0].x, pts[0].z, pts[2].x, pts[2].z, 7, true);
}

