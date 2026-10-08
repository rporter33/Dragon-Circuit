// Meshes for the hanging roots, vines (with leaves), glowing fungal threads and moss curtains.
// One merged mesh per island per material; everything sways slowly like heavy rope.

import { BufferGeometry, Color, Group, Mesh, Vector3 } from 'three';
import { mulberry32 } from '../../../core/rng';
import { noise3 } from '../../../core/noise';
import { GeoBuilder, tube } from '../geom';
import { dressMaterial } from '../materials';
import type { MossCurtain, RootPlan, Strand } from './rootPlan';
import type { Terrain } from '../../terrain';

export interface RootStats {
  strands: number;
  curtains: number;
  meshes: number;
  triangles: number;
}

const barkTop = new Color('#4a3b31');
const barkMid = new Color('#5f4d3d');
const barkTip = new Color('#735f4b');
const moss = new Color('#5b7f37');
const vineA = new Color('#3d6a2d');
const vineB = new Color('#77a148');
const tmp = new Color();
const bn = noise3(0x7007);

/** Radius profile: flared at the rock, holding thickness, then tapering to the tip. */
function rootRadius(s: Strand, t: number, i: number): number {
  const base = s.kind === 'root' ? s.r0 * (1 - 0.9 * Math.pow(t, 1.35)) + s.r1 * Math.pow(t, 1.35) : s.r0 + (s.r1 - s.r0) * t;
  return base * (1 + 0.7 * Math.pow(1 - t, 8)) * (1 + 0.12 * Math.sin(i * 1.7 + s.r0 * 10));
}

function strandGeometry(s: Strand, b: GeoBuilder): void {
  const pts = s.points.map((p) => new Vector3(p.x, p.y, p.z));
  const n = pts.length;
  const len = pts.reduce((acc, p, i) => (i ? acc + p.distanceTo(pts[i - 1]) : 0), 0);
  // Big roots are braids of two or three twisted strands: they read as gnarled, not as hoses.
  const braids = s.kind === 'root' && s.r0 > 1.4 ? (s.r0 > 2.6 ? 3 : 2) : 1;
  if (braids > 1) {
    for (let k = 0; k < braids; k++) {
      const phase = (k / braids) * Math.PI * 2;
      const sub = pts.map((p, i) => {
        const t = i / (n - 1);
        const r = rootRadius(s, t, i) * 0.55;
        const a = phase + (p.y / 22) + t * 2;
        return new Vector3(p.x + Math.cos(a) * r, p.y, p.z + Math.sin(a) * r);
      });
      // Strands peel apart near the tip, one ending early.
      const keep = k === braids - 1 ? Math.max(4, Math.round(n * 0.75)) : n;
      addStrandTube(s, b, sub.slice(0, keep), len, (t, i) => rootRadius(s, t, i) * 0.62, pts[0]);
    }
    return;
  }
  addStrandTube(s, b, pts, len, (t, i) => rootRadius(s, t, i), pts[0]);
}

function addStrandTube(s: Strand, b: GeoBuilder, pts: Vector3[], len: number, radius: (t: number, i: number) => number, top: Vector3): void {
  const n = pts.length;
  const radii = pts.map((_, i) => radius(i / (n - 1), i));
  const radial = s.kind === 'root' ? (s.r0 > 1 ? 7 : 6) : 4;
  const geo = tube(pts, radii, radial, true);
  // Map each vertex to its fraction down the strand by height (strands hang roughly downward).
  const span = Math.max(1, top.y - pts[n - 1].y);
  b.add(geo, null, {
    color: (p, nrm, out) => {
      const t = Math.min(1, Math.max(0, (top.y - p.y) / span));
      if (s.kind === 'root') {
        out.copy(barkTop).lerp(barkMid, Math.min(1, t * 2.2));
        if (t > 0.5) out.lerp(barkTip, (t - 0.5) * 2);
        const v = bn(p.x * 0.4, p.y * 0.08, p.z * 0.4);
        out.multiplyScalar(0.88 + 0.22 * v);
        // Moss on the upper reaches and on outward faces.
        const m = Math.max(0, 0.38 - t) * 1.7 * (0.5 + 0.5 * bn(p.x * 0.3 + 5, p.y * 0.3, p.z * 0.3));
        out.lerp(moss, Math.min(0.75, m + Math.max(0, nrm.y) * 0.25));
      } else if (s.kind === 'vine') {
        out.copy(vineA).lerp(vineB, t * 0.8 + 0.2 * bn(p.x, p.y * 0.2, p.z));
      } else {
        out.set('#bff6ff').lerp(tmp.set('#6fd8ff'), t);
      }
    },
    sway: (p) => {
      const t = Math.min(1, Math.max(0, (top.y - p.y) / span));
      return Math.pow(t, 1.5) * Math.min(len, 130) * (s.kind === 'root' ? 0.011 : 0.03);
    },
    glow: s.kind === 'glow' ? (p) => 0.5 + 0.5 * Math.min(1, (top.y - p.y) / span) : 0,
  });
}

/** Leaves along a vine (on the card builder). */
function vineLeaves(s: Strand, cards: GeoBuilder, seed: number): void {
  const rnd = mulberry32(seed);
  const pts = s.points;
  const top = pts[0];
  const span = Math.max(1, top.y - pts[pts.length - 1].y);
  const verts: number[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i];
    const c = pts[i + 1];
    for (let k = 0; k < 3; k++) {
      const t = rnd();
      const x = a.x + (c.x - a.x) * t;
      const y = a.y + (c.y - a.y) * t;
      const z = a.z + (c.z - a.z) * t;
      const ang = rnd() * Math.PI * 2;
      const sz = 0.35 + rnd() * 0.35;
      const dx = Math.cos(ang) * sz;
      const dz = Math.sin(ang) * sz;
      // A diamond leaf drooping from the stem.
      verts.push(x, y, z, x + dx * 0.5 - dz * 0.25, y - sz * 0.3, z + dz * 0.5 + dx * 0.25, x + dx, y - sz * 0.5, z + dz);
      verts.push(x, y, z, x + dx, y - sz * 0.5, z + dz, x + dx * 0.5 + dz * 0.25, y - sz * 0.45, z + dz * 0.5 - dx * 0.25);
    }
  }
  if (!verts.length) return;
  cards.addTriangles(verts, {
    color: (p, _n, out) => out.copy(vineA).lerp(vineB, 0.3 + 0.7 * bn(p.x * 2, p.y * 2, p.z * 2) * 0.5 + 0.35),
    sway: (p) => Math.pow(Math.min(1, Math.max(0, (top.y - p.y) / span)), 1.3) * span * 0.03 + 0.05,
    normal: (_p, n) => n.set(n.x, Math.abs(n.y) * 0.3 + 0.2, n.z).normalize(),
  });
}

/** A shaggy curtain of hanging moss with a ragged hem. */
function curtainGeometry(c: MossCurtain, shape: { bottomHeight(x: number, z: number): number }, cards: GeoBuilder): void {
  const rnd = mulberry32(c.seed);
  const cols = Math.max(4, Math.round(c.width / 0.7));
  const rows = 7;
  const sx = -c.nz;
  const sz = c.nx;
  const verts: number[] = [];
  const hem: number[] = [];
  for (let i = 0; i <= cols; i++) hem.push(c.length * (0.35 + 0.65 * Math.pow(rnd(), 0.7)));
  const pt = (i: number, r: number): [number, number, number] => {
    const u = i / cols - 0.5;
    const x0 = c.x + sx * u * c.width;
    const z0 = c.z + sz * u * c.width;
    const top = shape.bottomHeight(x0, z0) + 1.0;
    const t = r / rows;
    const L = hem[i];
    const bow = Math.sin(t * Math.PI) * 0.8;
    return [x0 + c.nx * bow, top - t * L, z0 + c.nz * bow];
  };
  for (let i = 0; i < cols; i++) {
    for (let r = 0; r < rows; r++) {
      // Thin vertical strands: each column is split into a strip with a gap to look stringy.
      const a = pt(i, r);
      const b = pt(i + 1, r);
      const c2 = pt(i, r + 1);
      const d = pt(i + 1, r + 1);
      const shrink = r === rows - 1 ? 0.5 : 1;
      const mid = (p: number[], q: number[], f: number) => p.map((v, k) => v + (q[k] - v) * f);
      const b2 = mid(a, b, 0.5 + 0.4 * shrink);
      const d2 = mid(c2, d, 0.5 + 0.35 * shrink);
      verts.push(...a, ...c2, ...b2, ...b2, ...c2, ...d2);
    }
  }
  const top = c.y;
  const dark = new Color('#45613a');
  const light = new Color('#9cb56a');
  cards.addTriangles(verts, {
    color: (p, _n, out) => {
      const t = Math.min(1, Math.max(0, (top - p.y) / c.length));
      out.copy(dark).lerp(light, t * 0.85 + 0.15 * bn(p.x * 1.3, p.y * 0.4, p.z * 1.3));
    },
    sway: (p) => Math.pow(Math.min(1, Math.max(0, (top - p.y) / c.length)), 1.5) * c.length * 0.05,
    normal: (_p, n) => n.set(c.nx, 0.25, c.nz).normalize(),
  });
}

export class HangingRoots {
  readonly group = new Group();
  readonly stats: RootStats = { strands: 0, curtains: 0, meshes: 0, triangles: 0 };

  constructor(terrain: Terrain, plan: RootPlan) {
    this.group.name = 'dressing:roots';
    const islands = new Set<number>([...plan.strands.map((s) => s.islandId), ...plan.curtains.map((c) => c.islandId)]);
    for (const id of islands) {
      const shape = terrain.islands.find((s) => s.def.id === id)!;
      const solid = new GeoBuilder();
      const cards = new GeoBuilder();
      const glow = new GeoBuilder();
      let k = 0;
      for (const s of plan.strands) {
        if (s.islandId !== id) continue;
        strandGeometry(s, s.kind === 'glow' ? glow : solid);
        if (s.kind === 'vine') vineLeaves(s, cards, id * 1000 + k);
        k++;
        this.stats.strands++;
      }
      for (const c of plan.curtains) {
        if (c.islandId !== id) continue;
        curtainGeometry(c, shape, cards);
        this.stats.curtains++;
      }
      this.addMesh(solid, dressMaterial({ sway: 'root' }), `roots-${id}`);
      this.addMesh(cards, dressMaterial({ sway: 'root', doubleSide: true, keepNormals: true }), `moss-${id}`);
      this.addMesh(glow, dressMaterial({ sway: 'root', glow: true, glowDay: 0.2, glowNight: 3.2 }), `glowroots-${id}`);
    }
  }

  private addMesh(b: GeoBuilder, mat: ReturnType<typeof dressMaterial>, name: string): void {
    if (b.isEmpty()) return;
    const geo: BufferGeometry = b.build(true);
    const m = new Mesh(geo, mat);
    m.name = name;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    this.group.add(m);
    this.stats.meshes++;
    this.stats.triangles += (geo.getIndex()?.count ?? 0) / 3;
  }
}
