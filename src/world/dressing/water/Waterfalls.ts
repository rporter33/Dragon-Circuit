// Builds the visible water from the waterfall plans: a stream ribbon (with a spring pool at its
// head) running to the rim, the falling column — a widening elliptical tube along the ballistic
// path that frays into streaks and vanishes far below the island — and GPU-animated spray and
// mist billboards at the lip, along the fall and around its dissolving foot.

import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Sphere,
  Vector3,
} from 'three';
import { mulberry32 } from '../../../core/rng';
import type { QualityProfile } from '../../../render/quality';
import type { Terrain } from '../../terrain';
import type { ExclusionSet } from '../exclusions';
import type { PropInstance } from '../trees/placement';
import { fallMaterial, mistMaterial, streamMaterial } from './waterMaterials';
import { fallOffset, type WaterfallPlan } from './waterfallPlan';

export interface WaterStats {
  falls: number;
  streams: number;
  mistParticles: number;
  meshes: number;
}

/** Stream ribbon + spring pool geometry for one plan. */
function streamGeometry(plan: WaterfallPlan, terrain: Terrain): BufferGeometry {
  const shape = terrain.islands.find((s) => s.def.id === plan.islandId)!;
  const pos: number[] = [];
  const attr: number[] = [];
  const idx: number[] = [];
  const pts = plan.stream;
  let along = 0;
  const across = 5;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    if (i > 0) along += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    const rapid = Math.max(0, Math.min(1, (i - (n - 7)) / 5));
    for (let k = 0; k < across; k++) {
      const u = k / (across - 1);
      const off = (u - 0.5) * 2 * p.w;
      const x = p.x - tz * off;
      const z = p.z + tx * off;
      const ground = shape.topHeight(x, z);
      // Edges follow the bank within reason; the middle sits a touch lower (a shallow channel).
      const edgeY = Math.min(p.y + 0.35, Math.max(p.y - 0.35, ground + 0.08));
      const center = 1 - Math.abs(u - 0.5) * 2;
      const y = p.y * center + edgeY * (1 - center) - center * 0.05;
      pos.push(x, y, z);
      attr.push(u, along, rapid);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < across - 1; k++) {
      const a = i * across + k;
      idx.push(a, a + across, a + 1, a + 1, a + across, a + across + 1);
    }
  }
  // Spring pool at the head: a disc slightly wider than the stream, slow circular flow.
  const head = pts[0];
  const R = head.w * 2.6 + 1;
  const c0 = pos.length / 3;
  const ringN = 20;
  pos.push(head.x, head.y, head.z);
  attr.push(0.5, 0, 0);
  for (let k = 0; k < ringN; k++) {
    const a = (k / ringN) * Math.PI * 2;
    const rr = R * (0.85 + 0.15 * Math.sin(a * 3 + head.x));
    const x = head.x + Math.cos(a) * rr;
    const z = head.z + Math.sin(a) * rr;
    pos.push(x, Math.max(head.y, shape.topHeight(x, z) + 0.05), z);
    attr.push(1, a * R, 0);
  }
  for (let k = 0; k < ringN; k++) idx.push(c0, c0 + 1 + ((k + 1) % ringN), c0 + 1 + k);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aStream', new BufferAttribute(new Float32Array(attr), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** The falling column for one plan, in world space. */
function fallGeometry(plan: WaterfallPlan): BufferGeometry {
  const rings = 80;
  const around = 12;
  const pos: number[] = [];
  const nrm: number[] = [];
  const attr: number[] = [];
  const idx: number[] = [];
  const out = new Vector3(plan.outX, 0, plan.outZ);
  const side = new Vector3(-plan.outZ, 0, plan.outX);
  const up = new Vector3(0, 1, 0);
  const P = new Vector3();
  const Pn = new Vector3();
  const T = new Vector3();
  const sheetN = new Vector3();
  const lip = new Vector3(plan.lip.x, plan.lip.y, plan.lip.z);
  const at = (t: number, o: Vector3) => {
    const f = fallOffset(plan.speed, t);
    return o.copy(lip).addScaledVector(out, f.out).addScaledVector(up, -f.down);
  };
  for (let i = 0; i <= rings; i++) {
    // Denser rings near the lip where the arc bends.
    const t = plan.duration * Math.pow(i / rings, 1.7);
    at(t, P);
    at(t + 0.02, Pn);
    T.subVectors(Pn, P).normalize();
    sheetN.crossVectors(side, T).normalize();
    const f = fallOffset(plan.speed, t);
    const dropFrac = f.down / plan.drop;
    // Widens as it falls; starts as a thin sheet and thickens into a column.
    const W = plan.width * (1 + 2.4 * dropFrac + 0.2 * Math.min(1, t));
    const Th = W * (0.12 + 0.3 * Math.min(1, t / 2.2));
    for (let k = 0; k < around; k++) {
      const a = (k / around) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      // Wobbly edge so the column isn't a perfect tube.
      const wob = 1 + 0.08 * Math.sin(a * 3 + t * 1.7 + plan.lip.x);
      pos.push(P.x + side.x * c * W * wob + sheetN.x * s * Th, P.y + side.y * c * W * wob + sheetN.y * s * Th, P.z + side.z * c * W * wob + sheetN.z * s * Th);
      const nx = (side.x * c) / W + (sheetN.x * s) / Th;
      const ny = (side.y * c) / W + (sheetN.y * s) / Th;
      const nz = (side.z * c) / W + (sheetN.z * s) / Th;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nrm.push(nx / nl, ny / nl, nz / nl);
      attr.push(k / around, t, dropFrac);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let k = 0; k < around; k++) {
      const a = i * around + k;
      const b = i * around + ((k + 1) % around);
      const c = (i + 1) * around + k;
      const d = (i + 1) * around + ((k + 1) % around);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('aFall', new BufferAttribute(new Float32Array(attr), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Spray and mist billboards for a set of plans (one instanced draw). */
function mistGeometry(plans: WaterfallPlan[], quality: QualityProfile): InstancedBufferGeometry | null {
  const origin: number[] = [];
  const params: number[] = [];
  const drift: number[] = [];
  const P = new Vector3();
  for (const plan of plans) {
    const rnd = mulberry32(Math.floor(plan.lip.x * 31 + plan.lip.z * 17) >>> 0);
    const out = new Vector3(plan.outX, 0, plan.outZ);
    const side = new Vector3(-plan.outZ, 0, plan.outX);
    const lip = new Vector3(plan.lip.x, plan.lip.y, plan.lip.z);
    const at = (t: number) => {
      const f = fallOffset(plan.speed, t);
      return P.copy(lip).addScaledVector(out, f.out).add(new Vector3(0, -f.down, 0));
    };
    const q = quality.particles;
    const add = (o: Vector3, size: number, rate: number, alpha: number, dir: Vector3, dist: number) => {
      origin.push(o.x, o.y, o.z);
      params.push(rnd(), size, rate, alpha);
      drift.push(dir.x, dir.y, dir.z, dist);
    };
    const scaleW = plan.width / 3;
    // Lip spray: small, quick, kicked outward and down.
    for (let i = 0; i < Math.round(30 * q); i++) {
      const t = rnd() * 1.2;
      const o = at(t).clone().addScaledVector(side, (rnd() - 0.5) * plan.width * 2);
      const dir = out.clone().multiplyScalar(0.6 + rnd()).add(new Vector3((rnd() - 0.5) * 0.6, -0.8 - rnd(), (rnd() - 0.5) * 0.6)).normalize();
      add(o, (2.5 + rnd() * 3) * Math.max(0.7, scaleW), 0.35 + rnd() * 0.3, 0.35, dir, 5 + rnd() * 8);
    }
    // Spray along the column: drifting off the sheet, growing as it falls.
    for (let i = 0; i < Math.round(130 * q); i++) {
      const t = plan.duration * Math.pow(rnd(), 0.8) * 0.9;
      const f = fallOffset(plan.speed, t);
      const frac = f.down / plan.drop;
      const o = at(t).clone().addScaledVector(side, (rnd() - 0.5) * plan.width * (2 + frac * 3));
      const dir = out.clone().multiplyScalar(0.5 + rnd() * 0.6).addScaledVector(side, (rnd() - 0.5) * 1.2).add(new Vector3(0, -0.6 - rnd() * 0.8, 0)).normalize();
      add(o, (4 + frac * 18 + rnd() * 6) * Math.max(0.6, scaleW), 0.08 + rnd() * 0.1, 0.08 + 0.1 * (1 - frac), dir, 12 + frac * 35);
    }
    // The foot: big slow puffs where the column dissolves.
    for (let i = 0; i < Math.round(40 * q); i++) {
      const t = plan.duration * (0.68 + rnd() * 0.32);
      const o = at(t).clone().addScaledVector(side, (rnd() - 0.5) * plan.width * 8).addScaledVector(out, (rnd() - 0.5) * 30);
      const dir = new Vector3(rnd() - 0.5, -0.2 - rnd() * 0.3, rnd() - 0.5).normalize();
      add(o, (24 + rnd() * 30) * Math.max(0.7, scaleW), 0.03 + rnd() * 0.04, 0.1, dir, 20 + rnd() * 30);
    }
  }
  const n = origin.length / 3;
  if (n === 0) return null;
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('aOrigin', new InstancedBufferAttribute(new Float32Array(origin), 3));
  g.setAttribute('aParams', new InstancedBufferAttribute(new Float32Array(params), 4));
  g.setAttribute('aDrift', new InstancedBufferAttribute(new Float32Array(drift), 4));
  g.instanceCount = n;
  // Bounds: everything the particles can reach.
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, origin[i * 3]);
    maxX = Math.max(maxX, origin[i * 3]);
    minY = Math.min(minY, origin[i * 3 + 1]);
    maxY = Math.max(maxY, origin[i * 3 + 1]);
    minZ = Math.min(minZ, origin[i * 3 + 2]);
    maxZ = Math.max(maxZ, origin[i * 3 + 2]);
  }
  const center = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  const radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2 + 80;
  g.boundingSphere = new Sphere(center, radius);
  return g;
}

export class Waterfalls {
  readonly group = new Group();
  readonly stats: WaterStats = { falls: 0, streams: 0, mistParticles: 0, meshes: 0 };
  private plans: WaterfallPlan[];
  private terrain: Terrain;
  private mist: Mesh[] = [];

  constructor(terrain: Terrain, plans: WaterfallPlan[], quality: QualityProfile) {
    this.group.name = 'dressing:water';
    this.terrain = terrain;
    this.plans = plans;
    const byIsland = new Map<number, WaterfallPlan[]>();
    for (const p of plans) {
      let list = byIsland.get(p.islandId);
      if (!list) byIsland.set(p.islandId, (list = []));
      list.push(p);
    }
    for (const [islandId, list] of byIsland) {
      const streams = mergeGeometries(list.map((p) => streamGeometry(p, terrain)));
      const falls = mergeGeometries(list.map((p) => fallGeometry(p)));
      const sm = new Mesh(streams, streamMaterial());
      sm.name = `streams-${islandId}`;
      sm.renderOrder = 1;
      const fm = new Mesh(falls, fallMaterial());
      fm.name = `falls-${islandId}`;
      fm.renderOrder = 3;
      this.group.add(sm, fm);
      this.stats.meshes += 2;
      this.stats.streams += list.length;
      this.stats.falls += list.length;
    }
    this.buildMist(quality);
  }

  private buildMist(quality: QualityProfile): void {
    for (const m of this.mist) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    this.mist = [];
    this.stats.mistParticles = 0;
    const byIsland = new Map<number, WaterfallPlan[]>();
    for (const p of this.plans) {
      let list = byIsland.get(p.islandId);
      if (!list) byIsland.set(p.islandId, (list = []));
      list.push(p);
    }
    for (const [islandId, list] of byIsland) {
      const g = mistGeometry(list, quality);
      if (!g) continue;
      const m = new Mesh(g, mistMaterial());
      m.name = `mist-${islandId}`;
      m.renderOrder = 4;
      this.group.add(m);
      this.mist.push(m);
      this.stats.mistParticles += g.instanceCount;
    }
  }

  setQuality(q: QualityProfile): void {
    this.buildMist(q);
  }

  /** Keep-outs for streams/pools and rocks along the banks (added to the forest scatter). */
  static bankProps(terrain: Terrain, plans: WaterfallPlan[], exclusions: ExclusionSet): PropInstance[] {
    const props: PropInstance[] = [];
    for (const plan of plans) {
      const shape = terrain.islands.find((s) => s.def.id === plan.islandId)!;
      const rnd = mulberry32(Math.floor(plan.lip.x * 7 + plan.lip.z * 13) >>> 0);
      const pts = plan.stream;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        exclusions.capsule(a.x, a.z, b.x, b.z, b.w + 0.8, false);
      }
      exclusions.circle(pts[0].x, pts[0].z, pts[0].w * 2.6 + 2, false);
      for (let i = 1; i < pts.length - 1; i++) {
        if (rnd() > 0.45) continue;
        const p = pts[i];
        const q = pts[i + 1];
        const tx = q.x - p.x;
        const tz = q.z - p.z;
        const tl = Math.hypot(tx, tz) || 1;
        const side = rnd() < 0.5 ? -1 : 1;
        const off = side * (p.w + 0.6 + rnd() * 1.2);
        const x = p.x - (tz / tl) * off;
        const z = p.z + (tx / tl) * off;
        const s = 0.35 + Math.pow(rnd(), 2) * 1.1;
        props.push({
          species: 'boulder',
          islandId: plan.islandId,
          x,
          y: shape.topHeight(x, z) - s * 0.25,
          z,
          yaw: rnd() * 6.28,
          scale: s,
          scaleY: 0.6 + rnd() * 0.4,
          leanX: (rnd() - 0.5) * 0.4,
          leanZ: (rnd() - 0.5) * 0.4,
          tint: [0.92 + rnd() * 0.1, 0.95 + rnd() * 0.1, 0.95 + rnd() * 0.1],
        });
      }
      // A ring of rocks around the spring.
      const head = pts[0];
      const R = head.w * 2.6 + 1.2;
      for (let k = 0; k < 9; k++) {
        const ang = (k / 9) * Math.PI * 2 + rnd() * 0.4;
        const x = head.x + Math.cos(ang) * R;
        const z = head.z + Math.sin(ang) * R;
        const s = 0.5 + rnd() * 0.9;
        props.push({ species: 'boulder', islandId: plan.islandId, x, y: shape.topHeight(x, z) - s * 0.2, z, yaw: rnd() * 6.28, scale: s, scaleY: 0.7, leanX: 0, leanZ: 0, tint: [1, 1, 1] });
      }
    }
    return props;
  }

  get plansList(): readonly WaterfallPlan[] {
    return this.plans;
  }

  get terrainRef(): Terrain {
    return this.terrain;
  }
}

function mergeGeometries(list: BufferGeometry[]): BufferGeometry {
  const names = Object.keys(list[0].attributes);
  const out = new BufferGeometry();
  let vtx = 0;
  const idx: number[] = [];
  const data: Record<string, number[]> = {};
  for (const n of names) data[n] = [];
  for (const g of list) {
    for (const n of names) {
      const a = g.getAttribute(n);
      data[n].push(...(a.array as Float32Array));
    }
    const ix = g.getIndex()!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + vtx);
    vtx += g.getAttribute('position').count;
  }
  for (const n of names) out.setAttribute(n, new BufferAttribute(new Float32Array(data[n]), list[0].getAttribute(n).itemSize));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}
