// TerrainQuery over the whole archipelago: a coarse spatial grid of analytic solids. Cheap
// enough to call several times per physics step; deterministic, so it runs in unit tests.

import { Vector3 } from 'three';
import type { GroundHit, RayHit, SurfaceKind, TerrainQuery } from '../core/types';
import { LAYOUT, type WorldLayout } from './layout';
import { ArchShape, IslandShape, SpireShape } from './islandShape';

const CELL = 400;

type Solid =
  | { type: 'island'; shape: IslandShape; stamp: number }
  | { type: 'spire'; shape: SpireShape; stamp: number }
  | { type: 'arch'; shape: ArchShape; stamp: number };

const tmpN = new Vector3();
const tmpP = new Vector3();
const tmpQ = new Vector3();

export class Terrain implements TerrainQuery {
  readonly layout: WorldLayout;
  readonly islands: IslandShape[];
  readonly spires: SpireShape[];
  readonly arches: ArchShape[];
  private grid = new Map<number, Solid[]>();
  private solids: Solid[] = [];
  private stamp = 0;
  private scratch: Solid[] = [];

  constructor(layout: WorldLayout = LAYOUT) {
    this.layout = layout;
    this.islands = layout.islands.map((d) => new IslandShape(d));
    this.spires = layout.spires.map((d) => new SpireShape(d));
    this.arches = layout.arches.map((d) => new ArchShape(d));
    for (const shape of this.islands) this.insert({ type: 'island', shape, stamp: 0 }, shape.def.x, shape.def.z, shape.maxRadius);
    for (const shape of this.spires) this.insert({ type: 'spire', shape, stamp: 0 }, shape.def.x, shape.def.z, shape.maxRadius);
    for (const shape of this.arches) this.insert({ type: 'arch', shape, stamp: 0 }, shape.center.x, shape.center.z, shape.boundRadius);
  }

  private key(cx: number, cz: number): number {
    return (cx + 1000) * 4096 + (cz + 1000);
  }

  private insert(solid: Solid, x: number, z: number, r: number): void {
    this.solids.push(solid);
    const x0 = Math.floor((x - r) / CELL);
    const x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL);
    const z1 = Math.floor((z + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(solid);
      }
    }
  }

  /** Solids whose horizontal bounds come within `r` of (x, z). Reuses an internal array. */
  candidates(x: number, z: number, r: number): Solid[] {
    const out = this.scratch;
    out.length = 0;
    const s = ++this.stamp;
    const x0 = Math.floor((x - r) / CELL);
    const x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL);
    const z1 = Math.floor((z + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = this.grid.get(this.key(cx, cz));
        if (!list) continue;
        for (const solid of list) {
          if (solid.stamp === s) continue;
          solid.stamp = s;
          out.push(solid);
        }
      }
    }
    return out;
  }

  /** Island whose footprint contains (x, z) with the highest top at or below fromY + 2. */
  islandAt(x: number, z: number, fromY = Infinity): IslandShape | null {
    let best: IslandShape | null = null;
    let bestY = -Infinity;
    for (const s of this.candidates(x, z, 0)) {
      if (s.type !== 'island') continue;
      if (s.shape.normRadius(x, z) > 1) continue;
      const y = s.shape.topHeight(x, z);
      if (y <= fromY + 2 && y > bestY) {
        bestY = y;
        best = s.shape;
      }
    }
    return best;
  }

  groundAt(x: number, z: number, fromY: number): GroundHit | null {
    let best: GroundHit | null = null;
    for (const s of this.candidates(x, z, 0)) {
      if (s.type === 'island') {
        const shape = s.shape;
        if (shape.normRadius(x, z) > 1) continue;
        const y = shape.topHeight(x, z);
        if (y > fromY + 2) continue;
        if (best && y <= best.y) continue;
        const normal = shape.topNormal(x, z, new Vector3());
        best = { y, normal, islandId: shape.def.id, surface: shape.surfaceAt(x, z, normal.y) };
      } else if (s.type === 'spire') {
        const d = s.shape.def;
        const r = Math.hypot(x - d.x, z - d.z);
        if (r > d.topRadius) continue;
        if (d.topY > fromY + 2) continue;
        if (best && d.topY <= best.y) continue;
        best = { y: d.topY, normal: new Vector3(0, 1, 0), islandId: -1 - d.id, surface: 'stone' as SurfaceKind };
      }
    }
    return best;
  }

  collideSphere(center: Vector3, radius: number, outPush: Vector3, outNormal: Vector3): boolean {
    outPush.set(0, 0, 0);
    outNormal.set(0, 0, 0);
    let hit = false;
    const p = tmpP.copy(center);
    for (const s of this.candidates(center.x, center.z, radius + 1)) {
      // Resolve against each solid in turn, accumulating the correction.
      let pushed = false;
      if (s.type === 'island') pushed = this.collideIsland(s.shape, p, radius);
      else if (s.type === 'spire') pushed = this.collideSpire(s.shape, p, radius);
      else pushed = this.collideArch(s.shape, p, radius);
      if (pushed) {
        hit = true;
        outNormal.add(tmpN);
      }
    }
    if (!hit) return false;
    outPush.subVectors(p, center);
    if (outNormal.lengthSq() < 1e-8) outNormal.set(0, 1, 0);
    outNormal.normalize();
    return true;
  }

  /** Pushes p out of the island in place. On contact, tmpN holds the contact normal. */
  private collideIsland(shape: IslandShape, p: Vector3, radius: number): boolean {
    const d = shape.def;
    if (p.y > shape.maxY + radius || p.y < shape.minY - radius) return false;
    const dx = p.x - d.x;
    const dz = p.z - d.z;
    const rxz = Math.hypot(dx, dz);
    if (rxz > shape.maxRadius + radius) return false;
    const theta = Math.atan2(dz, dx);
    const R = shape.outlineRadius(theta);
    const top = shape.topHeight(p.x, p.z);
    const bottom = shape.bottomHeight(p.x, p.z);

    if (rxz <= R) {
      const mid = (top + bottom) * 0.5;
      if (p.y >= mid) {
        const n = shape.topNormal(p.x, p.z, tmpN);
        const dist = (p.y - top) * n.y;
        if (dist >= radius) return false;
        p.addScaledVector(n, radius - dist);
        return true;
      }
      const n = shape.bottomNormal(p.x, p.z, tmpN);
      const dist = (bottom - p.y) * -n.y;
      if (dist >= radius) return false;
      p.addScaledVector(n, radius - dist);
      return true;
    }

    // Outside the footprint: collide with the cliff rim band [bottom, top] at radius R.
    const out = rxz - R;
    let vy = 0;
    if (p.y > top) vy = p.y - top;
    else if (p.y < bottom) vy = p.y - bottom;
    const dist = Math.hypot(out, vy);
    if (dist >= radius) return false;
    const ox = dx / rxz;
    const oz = dz / rxz;
    if (dist < 1e-6) {
      tmpN.set(ox, 0, oz);
      p.x += ox * radius;
      p.z += oz * radius;
      return true;
    }
    tmpN.set((ox * out) / dist, vy / dist, (oz * out) / dist);
    p.addScaledVector(tmpN, radius - dist);
    return true;
  }

  private collideSpire(shape: SpireShape, p: Vector3, radius: number): boolean {
    const d = shape.def;
    if (p.y < d.tipY - radius || p.y > d.topY + radius) return false;
    const dx = p.x - d.x;
    const dz = p.z - d.z;
    const rxz = Math.hypot(dx, dz);
    if (rxz > shape.maxRadius + radius) return false;
    // Flat top.
    if (p.y > d.topY - 1 && rxz < d.topRadius) {
      const dist = p.y - d.topY;
      if (dist >= radius) return false;
      tmpN.set(0, 1, 0);
      p.y += radius - dist;
      return true;
    }
    const R = shape.baseRadiusAt(Math.min(d.topY - 0.01, Math.max(d.tipY + 0.01, p.y))) * 0.97;
    const dist = rxz - R;
    if (dist >= radius) return false;
    const ox = rxz > 1e-6 ? dx / rxz : 1;
    const oz = rxz > 1e-6 ? dz / rxz : 0;
    tmpN.set(ox, 0, oz);
    p.x += ox * (radius - dist);
    p.z += oz * (radius - dist);
    return true;
  }

  private collideArch(shape: ArchShape, p: Vector3, radius: number): boolean {
    if (p.distanceTo(shape.center) > shape.boundRadius + radius) return false;
    const dist = shape.distance(p);
    if (dist >= radius) return false;
    // Normal by central differences of the distance field.
    const e = 0.25;
    const q = tmpQ;
    const gx = shape.distance(q.set(p.x + e, p.y, p.z)) - shape.distance(q.set(p.x - e, p.y, p.z));
    const gy = shape.distance(q.set(p.x, p.y + e, p.z)) - shape.distance(q.set(p.x, p.y - e, p.z));
    const gz = shape.distance(q.set(p.x, p.y, p.z + e)) - shape.distance(q.set(p.x, p.y, p.z - e));
    tmpN.set(gx, gy, gz);
    if (tmpN.lengthSq() < 1e-10) tmpN.set(0, 1, 0);
    tmpN.normalize();
    p.addScaledVector(tmpN, radius - dist);
    return true;
  }

  distance(p: Vector3): number {
    let best = Infinity;
    // Look a generous distance around; far solids are bounded by their cylinders.
    for (const s of this.candidates(p.x, p.z, 450)) {
      let d: number;
      if (s.type === 'island') d = islandDistance(s.shape, p);
      else if (s.type === 'spire') d = spireDistance(s.shape, p);
      else {
        const bound = p.distanceTo(s.shape.center) - s.shape.boundRadius;
        d = bound > 5 ? bound : s.shape.distance(p);
      }
      if (d < best) best = d;
    }
    // Outside the searched cells nothing is closer than the cell margin.
    return Math.min(best, 400);
  }

  raycast(origin: Vector3, dir: Vector3, maxDist: number): RayHit | null {
    let t = 0;
    const p = new Vector3();
    for (let i = 0; i < 160 && t < maxDist; i++) {
      p.copy(origin).addScaledVector(dir, t);
      const d = this.distance(p);
      if (d < 0.25) {
        const normal = this.gradient(p, new Vector3());
        return { point: p.clone(), normal, distance: t };
      }
      t += Math.max(d, 0.3);
    }
    return null;
  }

  /** Approximate outward normal at a point near a surface. */
  gradient(p: Vector3, out: Vector3): Vector3 {
    const e = 0.5;
    const q = new Vector3();
    const gx = this.distance(q.set(p.x + e, p.y, p.z)) - this.distance(q.set(p.x - e, p.y, p.z));
    const gy = this.distance(q.set(p.x, p.y + e, p.z)) - this.distance(q.set(p.x, p.y - e, p.z));
    const gz = this.distance(q.set(p.x, p.y, p.z + e)) - this.distance(q.set(p.x, p.y, p.z - e));
    out.set(gx, gy, gz);
    if (out.lengthSq() < 1e-10) out.set(0, 1, 0);
    return out.normalize();
  }

  /** Resolve a spawn-style (x, z) to a standing position on the ground. */
  standingPoint(x: number, z: number, out: Vector3): Vector3 {
    const g = this.groundAt(x, z, 1e6);
    return out.set(x, g ? g.y : 300, z);
  }
}

/** Conservative-ish distance to an island (scaled down because the surfaces slope). */
function islandDistance(shape: IslandShape, p: Vector3): number {
  const d = shape.def;
  const dx = p.x - d.x;
  const dz = p.z - d.z;
  const rxz = Math.hypot(dx, dz);
  // Far away: distance to the bounding cylinder is plenty.
  const boundOut = rxz - shape.maxRadius;
  const boundVy = p.y > shape.maxY ? p.y - shape.maxY : p.y < shape.minY ? shape.minY - p.y : 0;
  if (boundOut > 30 || boundVy > 30) return Math.hypot(Math.max(0, boundOut), boundVy);
  const R = shape.outlineRadius(Math.atan2(dz, dx));
  const top = shape.topHeight(p.x, p.z);
  const bottom = shape.bottomHeight(p.x, p.z);
  const dr = rxz - R;
  const dy = Math.max(p.y - top, bottom - p.y);
  let dist: number;
  if (dr <= 0) dist = dy > 0 ? dy : Math.max(dy, dr);
  else dist = dy > 0 ? Math.hypot(dr, dy) : dr;
  return dist * 0.7;
}

function spireDistance(shape: SpireShape, p: Vector3): number {
  const d = shape.def;
  const rxz = Math.hypot(p.x - d.x, p.z - d.z);
  if (p.y > d.topY) return Math.hypot(Math.max(0, rxz - d.topRadius), p.y - d.topY);
  if (p.y < d.tipY) return Math.hypot(rxz, d.tipY - p.y);
  return (rxz - shape.baseRadiusAt(p.y)) * 0.8;
}
