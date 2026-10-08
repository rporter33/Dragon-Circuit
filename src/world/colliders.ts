// Collision for everything the analytic terrain doesn't describe: building walls and roofs,
// towers, posts, decks, tree trunks and canopies, race gates, relic pedestals.
//
// Colliders are simple shapes (vertical cylinders, spheres, boxes turned about Y) bucketed into a
// coarse grid, so a query only looks at the handful of shapes near the point asked about — the
// cost doesn't grow with how many trees and buildings the world has. Terrain folds this index into
// every TerrainQuery call (collideSphere, distance, raycast, groundAt), so flight, walking,
// landing and the camera all collide with it without knowing it exists.

import { Vector3 } from 'three';
import type { BoxCollider, Collider, ContactInfo, CylinderCollider, SphereCollider, SurfaceKind } from '../core/types';

/** Grid cell size (m). Shapes are small (≤ ~30 m), so most live in one or two cells. */
const CELL = 24;

/** How much of a soft (foliage) penetration is resolved per query: a cushion, not a wall. */
export const SOFT_PUSH = 0.35;

interface Entry {
  c: Collider;
  stamp: number;
  /** Top of the shape (m), for ground queries and quick rejects. */
  top: number;
  bottom: number;
}

const tmpN = new Vector3();

function isSphere(c: Collider): c is SphereCollider {
  return c.kind === 'sphere';
}
function isBox(c: Collider): c is BoxCollider {
  return c.kind === 'box';
}

export class ColliderIndex {
  private grid = new Map<number, Entry[]>();
  private entries: Entry[] = [];
  private stamp = 0;
  private scratch: Entry[] = [];
  private sources = new Map<string, { get: () => readonly Collider[]; list: readonly Collider[] | null; seen: number }>();

  get size(): number {
    return this.entries.length;
  }

  add(c: Collider): void {
    let minX: number, maxX: number, minZ: number, maxZ: number, top: number, bottom: number;
    if (isSphere(c)) {
      minX = c.x - c.radius;
      maxX = c.x + c.radius;
      minZ = c.z - c.radius;
      maxZ = c.z + c.radius;
      top = c.y + c.radius;
      bottom = c.y - c.radius;
    } else if (isBox(c)) {
      const ext = Math.abs(Math.cos(c.yaw)) * c.hx + Math.abs(Math.sin(c.yaw)) * c.hz;
      const exz = Math.abs(Math.sin(c.yaw)) * c.hx + Math.abs(Math.cos(c.yaw)) * c.hz;
      minX = c.x - ext;
      maxX = c.x + ext;
      minZ = c.z - exz;
      maxZ = c.z + exz;
      top = c.y + c.hy;
      bottom = c.y - c.hy;
    } else {
      minX = c.x - c.radius;
      maxX = c.x + c.radius;
      minZ = c.z - c.radius;
      maxZ = c.z + c.radius;
      top = c.y1;
      bottom = c.y0;
    }
    const e: Entry = { c, stamp: 0, top, bottom };
    this.entries.push(e);
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const k = key(cx, cz);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(e);
      }
    }
  }

  addAll(list: readonly Collider[]): void {
    for (const c of list) this.add(c);
  }

  /**
   * Register a list that may grow (dressing builds distant sites later) or be replaced outright
   * (the forest is rebuilt when tree density changes with quality). Call sync() once a frame:
   * appended entries are indexed incrementally; a replaced list triggers a full rebuild.
   */
  addSource(id: string, get: () => readonly Collider[]): void {
    this.sources.set(id, { get, list: null, seen: 0 });
    this.sync();
  }

  /** Bring the index up to date with its sources. Cheap when nothing changed. */
  sync(): void {
    let replaced = false;
    for (const src of this.sources.values()) {
      const list = src.get();
      if (src.list !== null && list !== src.list) replaced = true;
    }
    if (replaced) {
      this.clear();
      for (const src of this.sources.values()) {
        src.list = null;
        src.seen = 0;
      }
    }
    for (const src of this.sources.values()) {
      const list = src.get();
      src.list = list;
      for (let i = src.seen; i < list.length; i++) this.add(list[i]);
      src.seen = list.length;
    }
  }

  /** Drop every indexed collider (sources stay registered and refill on the next sync). */
  clear(): void {
    this.grid.clear();
    this.entries.length = 0;
  }

  /** Entries whose horizontal bounds come within r of (x, z). Reuses an internal array. */
  private near(x: number, z: number, r: number): Entry[] {
    const out = this.scratch;
    out.length = 0;
    const s = ++this.stamp;
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        const list = this.grid.get(key(cx, cz));
        if (!list) continue;
        for (const e of list) {
          if (e.stamp === s) continue;
          e.stamp = s;
          out.push(e);
        }
      }
    }
    return out;
  }

  /**
   * Push a sphere (moved in place in `p`) out of nearby colliders. Accumulates contact normals into
   * outNormal (not normalized). Returns true on contact; info.soft stays true only if every contact
   * was soft (foliage).
   */
  resolveSphere(p: Vector3, radius: number, outNormal: Vector3, info?: ContactInfo): boolean {
    if (this.entries.length === 0) return false;
    let hit = false;
    for (const e of this.near(p.x, p.z, radius)) {
      if (p.y - radius > e.top || p.y + radius < e.bottom) continue;
      const c = e.c;
      const d = signedDistance(c, p, tmpN);
      if (d >= radius) continue;
      const depth = radius - d;
      p.addScaledVector(tmpN, c.soft ? depth * SOFT_PUSH : depth);
      outNormal.add(tmpN);
      if (info) {
        if (!hit) info.soft = !!c.soft;
        else if (!c.soft) info.soft = false;
        if (!c.soft) info.solidSurface = c.surface ?? 'wood';
      }
      hit = true;
    }
    return hit;
  }

  /** Signed distance to the nearest collider within maxR (Infinity if none that close). */
  distance(p: Vector3, maxR: number): number {
    if (this.entries.length === 0) return Infinity;
    let best = Infinity;
    for (const e of this.near(p.x, p.z, maxR)) {
      if (p.y - maxR > e.top || p.y + maxR < e.bottom) continue;
      const d = signedDistance(e.c, p, null);
      if (d < best) best = d;
    }
    return best;
  }

  /**
   * The highest solid (non-soft) top under (x, z) at or below fromY + stepUp — roofs, decks,
   * wall tops — as walkable ground. Null if none.
   */
  groundAt(x: number, z: number, fromY: number, stepUp: number): { y: number; surface: SurfaceKind } | null {
    if (this.entries.length === 0) return null;
    let best: { y: number; surface: SurfaceKind } | null = null;
    for (const e of this.near(x, z, 0)) {
      const c = e.c;
      if (c.soft || e.top > fromY + stepUp) continue;
      if (best && e.top <= best.y) continue;
      if (!insideTopFace(c, x, z)) continue;
      best = { y: e.top, surface: c.surface ?? 'wood' };
    }
    return best;
  }
}

function key(cx: number, cz: number): number {
  return (cx + 2048) * 8192 + (cz + 2048);
}

function insideTopFace(c: Collider, x: number, z: number): boolean {
  if (isSphere(c)) return false;
  if (isBox(c)) {
    const dx = x - c.x;
    const dz = z - c.z;
    const cs = Math.cos(c.yaw);
    const sn = Math.sin(c.yaw);
    // Local axes: +x' = (cos, 0, -sin), +z' = (sin, 0, cos) (yaw turns +Z toward +X).
    const lx = dx * cs - dz * sn;
    const lz = dx * sn + dz * cs;
    return Math.abs(lx) <= c.hx && Math.abs(lz) <= c.hz;
  }
  return Math.hypot(x - c.x, z - c.z) <= c.radius;
}

/**
 * Signed distance from p to the collider's surface (negative inside). When `n` is given it
 * receives the outward unit normal at the closest surface point.
 */
export function signedDistance(c: Collider, p: Vector3, n: Vector3 | null): number {
  if (isSphere(c)) {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const dz = p.z - c.z;
    const len = Math.hypot(dx, dy, dz);
    if (n) {
      if (len > 1e-6) n.set(dx / len, dy / len, dz / len);
      else n.set(0, 1, 0);
    }
    return len - c.radius;
  }
  if (isBox(c)) return boxDistance(c, p, n);
  return cylinderDistance(c, p, n);
}

function cylinderDistance(c: CylinderCollider, p: Vector3, n: Vector3 | null): number {
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  const rxz = Math.hypot(dx, dz);
  const ox = rxz > 1e-6 ? dx / rxz : 1;
  const oz = rxz > 1e-6 ? dz / rxz : 0;
  const radial = rxz - c.radius; // + outside the side
  const mid = (c.y0 + c.y1) * 0.5;
  const half = (c.y1 - c.y0) * 0.5;
  const vertical = Math.abs(p.y - mid) - half; // + above the top / below the bottom
  const up = p.y >= mid ? 1 : -1;
  if (radial <= 0 && vertical <= 0) {
    // Inside: leave through the nearest face.
    if (radial > vertical) {
      n?.set(ox, 0, oz);
      return radial;
    }
    n?.set(0, up, 0);
    return vertical;
  }
  if (radial > 0 && vertical > 0) {
    const d = Math.hypot(radial, vertical);
    n?.set((ox * radial) / d, (up * vertical) / d, (oz * radial) / d);
    return d;
  }
  if (radial > 0) {
    n?.set(ox, 0, oz);
    return radial;
  }
  n?.set(0, up, 0);
  return vertical;
}

function boxDistance(c: BoxCollider, p: Vector3, n: Vector3 | null): number {
  const cs = Math.cos(c.yaw);
  const sn = Math.sin(c.yaw);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const dz = p.z - c.z;
  const lx = dx * cs - dz * sn;
  const lz = dx * sn + dz * cs;
  const qx = Math.abs(lx) - c.hx;
  const qy = Math.abs(dy) - c.hy;
  const qz = Math.abs(lz) - c.hz;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let d: number;
  if (qx <= 0 && qy <= 0 && qz <= 0) {
    // Inside: the least-deep face.
    if (qx >= qy && qx >= qz) nx = Math.sign(lx) || 1;
    else if (qy >= qz) ny = Math.sign(dy) || 1;
    else nz = Math.sign(lz) || 1;
    d = Math.max(qx, qy, qz);
  } else {
    const ex = Math.max(qx, 0);
    const ey = Math.max(qy, 0);
    const ez = Math.max(qz, 0);
    d = Math.hypot(ex, ey, ez);
    nx = (ex * (Math.sign(lx) || 1)) / d;
    ny = (ey * (Math.sign(dy) || 1)) / d;
    nz = (ez * (Math.sign(lz) || 1)) / d;
  }
  // Back to world axes (inverse of the rotation above).
  n?.set(nx * cs + nz * sn, ny, -nx * sn + nz * cs);
  return d;
}

/** A walkable deck (the dressing's Deck shape) as a solid slab: you stand on it and can't fly through it. */
export function deckCollider(d: {
  x: number;
  z: number;
  yaw: number;
  halfWidth: number;
  back: number;
  length: number;
  y: number;
  surface: 'wood' | 'stone';
}): BoxCollider {
  const mid = (d.length - d.back) / 2;
  const thickness = 0.5;
  return {
    kind: 'box',
    x: d.x + Math.sin(d.yaw) * mid,
    y: d.y - thickness / 2,
    z: d.z + Math.cos(d.yaw) * mid,
    hx: d.halfWidth,
    hy: thickness / 2,
    hz: (d.length + d.back) / 2,
    yaw: d.yaw,
    surface: d.surface,
  };
}
