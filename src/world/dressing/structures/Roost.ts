// The Windward Roost: the stable (timber frame, plaster, shingles, open front with hay, saddle
// racks and a perch beam), three rookery towers with perches, banners, lanterns, a paddock,
// a flagstone path and the launch deck that juts out over the void toward Gull's Rest.

import { BoxGeometry, ConeGeometry, CylinderGeometry, Matrix4, TorusGeometry, Vector3 } from 'three';
import type { CylinderCollider } from '../../../core/types';
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
  rand,
  resetJitter,
  saddleRack,
  shingleRoof,
  v,
  windChime,
  type SiteBuilders,
} from './kit';
import type { RoostPlan, TowerPlan } from './roostPlan';

const boxGeo = new BoxGeometry(1, 1, 1);
const torusGeo = new TorusGeometry(1, 0.12, 6, 20);
const discGeo = new CylinderGeometry(1, 1, 1, 16);

export interface SiteOutputs {
  exclusions: ExclusionSet;
  colliders: CylinderCollider[];
  decks: Deck[];
}

/** Conical roof built from stacked shingle courses. */
export function coneRoof(b: GeoBuilder, frame: Matrix4, y: number, r: number, h: number, color: string, alt: string): void {
  const rows = Math.max(4, Math.round(h / 0.7));
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
  const addCol = (lx: number, lz: number, r: number) => {
    const p = loc(lx, lz);
    out.colliders.push({ x: p.x, z: p.z, radius: r, y0: plan.ground - 1, y1: plan.ground + eave });
  };
  for (let z = 0; z >= -D; z -= 2) {
    addCol(-hw, z, 0.6);
    addCol(hw, z, 0.6);
  }
  for (let x = -hw + 2; x < hw; x += 2) addCol(x, -D, 0.6);
  for (const x of [-hw + 1, -hw + 2.5, hw - 1, hw - 2.5]) addCol(x, 0, 0.6);
}

function buildTower(s: SiteBuilders, t: TowerPlan, idx: number, out: SiteOutputs): void {
  const F = xf(t.x, t.y, t.z, 0, t.doorYaw, 0);
  const b = s.solid;
  const r = t.radius;
  const shaftH = t.height * 0.72;
  box(b, F, 0, 0.3, 0, r * 2.4, 0.9, r * 2.4, PALETTE.stoneDark, { ry: 0.4 });
  // Stone courses, slightly tapering.
  const course = 1.3;
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
  out.colliders.push({ x: t.x, z: t.z, radius: r + 0.3, y0: t.y - 1, y1: t.y + t.height });
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
      const w = toWorld(sx * hw, 0, z);
      out.colliders.push({ x: w.x, z: w.z, radius: 0.3, y0: dk.y - 1, y1: dk.y + 1.2 });
    }
    for (let i = 0; i < posts.length - 1; i++) {
      beam(b, F, posts[i].clone().setY(1.12), posts[i + 1].clone().setY(1.12), 0.12, PALETTE.timberLight);
      beam(b, F, posts[i].clone().setY(0.55), posts[i + 1].clone().setY(0.55), 0.04, PALETTE.rope);
    }
  }
  // Launch gate at the end: tall posts, crossbar, pennants, lanterns.
  for (const sx of [-1, 1]) {
    post(b, F, v(sx * (hw + 0.2), -0.6, L - 0.4), v(sx * (hw + 0.2), 5.2, L - 0.4), 0.2, PALETTE.timber, 8);
    box(b, F, sx * (hw + 0.2), 5.35, L - 0.4, 0.5, 0.3, 0.5, PALETTE.brass);
    lantern(s, F, sx * (hw + 0.2) - sx * 0.5, 3.7, L - 0.4, 0.8);
    pennant(s, F, sx * (hw + 0.2), 4.6, L - 0.4, 2.6, 0.8, sx < 0 ? PALETTE.bannerBlue : PALETTE.bannerRed);
  }
  beam(b, F, v(-hw - 0.6, 4.7, L - 0.4), v(hw + 0.6, 4.7, L - 0.4), 0.3, PALETTE.timber);
  // Windsock on the left gate post.
  pennant(s, F, -hw - 0.2, 5.0, L - 0.4, 3.0, 0.7, '#e8e2d6');
  // Root arch with a sign and chimes.
  for (const sx of [-1, 1]) post(b, F, v(sx * (hw + 0.3), -0.3, -1.2), v(sx * (hw + 0.3), 3.8, -1.2), 0.22, PALETTE.timber, 8);
  beam(b, F, v(-hw - 0.9, 3.9, -1.2), v(hw + 0.9, 3.9, -1.2), 0.36, PALETTE.timber);
  box(b, F, 0, 3.25, -1.25, 2.4, 0.6, 0.1, PALETTE.timberLight);
  box(b, F, 0, 3.25, -1.18, 1.0, 0.18, 0.05, PALETTE.gold);
  windChime(s, F, -1.8, 3.7, -1.2);
  windChime(s, F, 1.8, 3.7, -1.2);

  // Walkable surface + keep-outs.
  out.decks.push({ x: dk.x, z: dk.z, yaw: dk.yaw, halfWidth: hw, back: 1.5, length: L, y: dk.y, surface: 'wood' });
  const root = toWorld(0, 0, -1.5);
  const tip = toWorld(0, 0, dk.rimDist);
  out.exclusions.capsule(root.x, root.z, tip.x, tip.z, hw + 2, false);
}

/** A stone well with a little shingled roof, a winch and a bucket. */
function buildWell(s: SiteBuilders, x: number, y: number, z: number): void {
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
    out.colliders.push({ x: bn.x, z: bn.z, radius: 0.35, y0: gy(bn.x, bn.z) - 1, y1: gy(bn.x, bn.z) + 9 });
  }
  for (const l of plan.lanterns) {
    lanternPost(s, I, l.x, gy(l.x, l.z), l.z, l.yaw);
    out.exclusions.circle(l.x, l.z, 1);
    out.colliders.push({ x: l.x, z: l.z, radius: 0.3, y0: gy(l.x, l.z) - 1, y1: gy(l.x, l.z) + 3 });
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
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const c = pts[(i + 1) % pts.length];
    if (i === pts.length - 1) {
      // Leave a gate: fence only the first and last thirds of the closing side.
      const m1 = { x: a.x + (c.x - a.x) * 0.33, z: a.z + (c.z - a.z) * 0.33 };
      const m2 = { x: a.x + (c.x - a.x) * 0.67, z: a.z + (c.z - a.z) * 0.67 };
      fence(s.solid, I, v(a.x, 0, a.z), v(m1.x, 0, m1.z), 2.6, gy);
      fence(s.solid, I, v(m2.x, 0, m2.z), v(c.x, 0, c.z), 2.6, gy);
    } else {
      fence(s.solid, I, v(a.x, 0, a.z), v(c.x, 0, c.z), 2.6, gy);
    }
  }
  // A well on the plaza and a feeding trough by where the wyvern waits.
  buildWell(s, plan.well.x, gy(plan.well.x, plan.well.z), plan.well.z);
  out.colliders.push({ x: plan.well.x, z: plan.well.z, radius: 1.9, y0: gy(plan.well.x, plan.well.z) - 1, y1: gy(plan.well.x, plan.well.z) + 4 });
  out.exclusions.circle(plan.well.x, plan.well.z, 3);
  {
    const t = plan.trough;
    const T = xf(t.x, gy(t.x, t.z), t.z, 0, t.yaw, 0);
    box(s.solid, T, 0, 0.45, 0, 3.4, 0.8, 1.2, PALETTE.timberLight);
    box(s.solid, T, 0, 0.82, 0, 3.1, 0.04, 0.9, PALETTE.water);
    for (const sx of [-1.6, 1.6]) box(s.solid, T, sx, 0.4, 0, 0.2, 0.85, 1.35, PALETTE.timber);
    hayPile(s.solid, T, 0.4, 0.1, 2.0, 1.6, 29);
    barrel(s.solid, T, 2.6, 0, 0.6);
    out.colliders.push({ x: t.x, z: t.z, radius: 1.7, y0: gy(t.x, t.z) - 1, y1: gy(t.x, t.z) + 1.2 });
    out.exclusions.circle(t.x, t.z, 3.5);
  }
  const pc = { x: pts.reduce((t, p) => t + p.x, 0) / pts.length, z: pts.reduce((t, p) => t + p.z, 0) / pts.length };
  hayPile(s.solid, I, pc.x + 2, gy(pc.x + 2, pc.z - 2), pc.z - 2, 1.8, 23);
  hayBale(s.solid, I, pc.x - 2.5, gy(pc.x - 2.5, pc.z + 3), pc.z + 3, 0.6, false);
  box(s.solid, I, pc.x - 3, gy(pc.x - 3, pc.z - 4) + 0.45, pc.z - 4, 2.6, 0.7, 1.0, PALETTE.timberLight, { ry: 0.3 });
  out.exclusions.capsule(pts[0].x, pts[0].z, pts[2].x, pts[2].z, 7, true);
}

