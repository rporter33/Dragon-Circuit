// Ambient occlusion for the wyvern's hide, baked per vertex into aExtra.x (A10).
//
// Two sources, the same contract (1 = open … 0 = fully shut in; multiplied onto what the part
// builders wrote, e.g. a strap's underside):
//   - bakeAO: cosine-weighted rays from every body vertex against the bind-pose triangles through
//     a uniform grid, a hit weighted by how near it is. Run off the main thread (aoWorker.ts) and
//     cached per shape key and LOD; tests call it directly.
//   - analyticAO: the instant fallback until the bake lands (and where workers are unavailable):
//     sphere occluders along the limbs, under the jaw and at the head-neck seam, and the saddle's
//     footprint.

import { Vector3 } from 'three';
import type { RigDef } from './rig';
import { humerusRootRadius } from './rig';

export interface AOOptions {
  /** Rays per vertex. */
  rays: number;
  /** Hits further than this (m) do not occlude. */
  maxDist: number;
  /** Strength: AO = 1 − strength · weighted occlusion (clamped to `floor`). */
  strength: number;
  floor: number;
}

export const AO_DEFAULTS: AOOptions = { rays: 12, maxDist: 0.5, strength: 1.25, floor: 0.25 };

const inv = (d: number) => (Math.abs(d) < 1e-9 ? 1e9 : 1 / Math.abs(d));

/** Cosine-weighted hemisphere directions (+Z up), a fixed Fibonacci set. */
function hemisphere(n: number): Float32Array {
  const out = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const r = Math.sqrt(u);
    const a = i * golden;
    out[i * 3] = r * Math.cos(a);
    out[i * 3 + 1] = r * Math.sin(a);
    out[i * 3 + 2] = Math.sqrt(1 - u);
  }
  return out;
}

/**
 * Bake AO for the vertices with mask[v] = 1 against the triangles listed in `tris` (vertex index
 * triples). Returns one value per vertex (1 where unmasked). Pure and allocation-light: runs the
 * same in a worker or a test.
 */
export function bakeAO(pos: ArrayLike<number>, nrm: ArrayLike<number>, tris: ArrayLike<number>, mask: ArrayLike<number>, o: AOOptions = AO_DEFAULTS): Float32Array {
  const nv = pos.length / 3;
  const nt = tris.length / 3;
  const ao = new Float32Array(nv).fill(1);
  // Bounds and the grid.
  let x0 = Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < nv; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (z < z0) z0 = z;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
    if (z > z1) z1 = z;
  }
  const cell = 0.11;
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell) + 1);
  const ny = Math.max(1, Math.ceil((y1 - y0) / cell) + 1);
  const nz = Math.max(1, Math.ceil((z1 - z0) / cell) + 1);
  const ncell = nx * ny * nz;
  // Counting sort of triangles into the cells their bounding boxes overlap.
  const counts = new Uint32Array(ncell + 1);
  const span = (lo: number, hi: number, base: number, n: number): [number, number] => [
    Math.max(0, Math.min(n - 1, Math.floor((lo - base) / cell))),
    Math.max(0, Math.min(n - 1, Math.floor((hi - base) / cell))),
  ];
  const boxes = new Int32Array(nt * 6);
  for (let t = 0; t < nt; t++) {
    const a = tris[t * 3] * 3;
    const b = tris[t * 3 + 1] * 3;
    const c = tris[t * 3 + 2] * 3;
    const sx = span(Math.min(pos[a], pos[b], pos[c]), Math.max(pos[a], pos[b], pos[c]), x0, nx);
    const sy = span(Math.min(pos[a + 1], pos[b + 1], pos[c + 1]), Math.max(pos[a + 1], pos[b + 1], pos[c + 1]), y0, ny);
    const sz = span(Math.min(pos[a + 2], pos[b + 2], pos[c + 2]), Math.max(pos[a + 2], pos[b + 2], pos[c + 2]), z0, nz);
    boxes.set([sx[0], sx[1], sy[0], sy[1], sz[0], sz[1]], t * 6);
  }
  const triBox = (t: number): [[number, number], [number, number], [number, number]] => [
    [boxes[t * 6], boxes[t * 6 + 1]],
    [boxes[t * 6 + 2], boxes[t * 6 + 3]],
    [boxes[t * 6 + 4], boxes[t * 6 + 5]],
  ];
  for (let t = 0; t < nt; t++) {
    const [[ix0, ix1], [iy0, iy1], [iz0, iz1]] = triBox(t);
    for (let ix = ix0; ix <= ix1; ix++) for (let iy = iy0; iy <= iy1; iy++) for (let iz = iz0; iz <= iz1; iz++) counts[(ix * ny + iy) * nz + iz + 1]++;
  }
  for (let i = 0; i < ncell; i++) counts[i + 1] += counts[i];
  const items = new Uint32Array(counts[ncell]);
  const fill = counts.slice(0, ncell);
  for (let t = 0; t < nt; t++) {
    const [[ix0, ix1], [iy0, iy1], [iz0, iz1]] = triBox(t);
    for (let ix = ix0; ix <= ix1; ix++) for (let iy = iy0; iy <= iy1; iy++) for (let iz = iz0; iz <= iz1; iz++) items[fill[(ix * ny + iy) * nz + iz]++] = t;
  }
  const dirs = hemisphere(o.rays);
  const stamp = new Int32Array(nt).fill(-1);
  let rayId = 0;
  const md = o.maxDist;
  for (let v = 0; v < nv; v++) {
    if (!mask[v]) continue;
    const nX = nrm[v * 3];
    const nY = nrm[v * 3 + 1];
    const nZ = nrm[v * 3 + 2];
    // Tangent frame about the normal.
    let tX = Math.abs(nY) < 0.9 ? -nZ : 0;
    let tY = Math.abs(nY) < 0.9 ? 0 : nZ;
    let tZ = Math.abs(nY) < 0.9 ? nX : -nY;
    const tl = Math.hypot(tX, tY, tZ) || 1;
    tX /= tl;
    tY /= tl;
    tZ /= tl;
    const bX = nY * tZ - nZ * tY;
    const bY = nZ * tX - nX * tZ;
    const bZ = nX * tY - nY * tX;
    const oX = pos[v * 3] + nX * 0.012;
    const oY = pos[v * 3 + 1] + nY * 0.012;
    const oZ = pos[v * 3 + 2] + nZ * 0.012;
    let occ = 0;
    for (let r = 0; r < o.rays; r++) {
      const a = dirs[r * 3];
      const b = dirs[r * 3 + 1];
      const c = dirs[r * 3 + 2];
      const dX = tX * a + bX * b + nX * c;
      const dY = tY * a + bY * b + nY * c;
      const dZ = tZ * a + bZ * b + nZ * c;
      rayId++;
      // 3D DDA through the grid until a hit or maxDist.
      let ix = Math.floor((oX - x0) / cell);
      let iy = Math.floor((oY - y0) / cell);
      let iz = Math.floor((oZ - z0) / cell);
      const sX = dX > 0 ? 1 : -1;
      const sY = dY > 0 ? 1 : -1;
      const sZ = dZ > 0 ? 1 : -1;
      const ddX = cell * inv(dX);
      const ddY = cell * inv(dY);
      const ddZ = cell * inv(dZ);
      let tmX = (dX > 0 ? x0 + (ix + 1) * cell - oX : oX - (x0 + ix * cell)) * inv(dX);
      let tmY = (dY > 0 ? y0 + (iy + 1) * cell - oY : oY - (y0 + iy * cell)) * inv(dY);
      let tmZ = (dZ > 0 ? z0 + (iz + 1) * cell - oZ : oZ - (z0 + iz * cell)) * inv(dZ);
      let best = md;
      let tCell = 0;
      while (tCell < best && ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz) {
        const ci = (ix * ny + iy) * nz + iz;
        for (let k = counts[ci]; k < counts[ci + 1]; k++) {
          const t = items[k];
          if (stamp[t] === rayId) continue;
          stamp[t] = rayId;
          const i0 = tris[t * 3] * 3;
          const i1 = tris[t * 3 + 1] * 3;
          const i2 = tris[t * 3 + 2] * 3;
          // Möller–Trumbore.
          const e1x = pos[i1] - pos[i0];
          const e1y = pos[i1 + 1] - pos[i0 + 1];
          const e1z = pos[i1 + 2] - pos[i0 + 2];
          const e2x = pos[i2] - pos[i0];
          const e2y = pos[i2 + 1] - pos[i0 + 1];
          const e2z = pos[i2 + 2] - pos[i0 + 2];
          const px = dY * e2z - dZ * e2y;
          const py = dZ * e2x - dX * e2z;
          const pz = dX * e2y - dY * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (Math.abs(det) < 1e-10) continue;
          const id = 1 / det;
          const sx = oX - pos[i0];
          const sy = oY - pos[i0 + 1];
          const sz = oZ - pos[i0 + 2];
          const u = (sx * px + sy * py + sz * pz) * id;
          if (u < 0 || u > 1) continue;
          const qx = sy * e1z - sz * e1y;
          const qy = sz * e1x - sx * e1z;
          const qz = sx * e1y - sy * e1x;
          const w = (dX * qx + dY * qy + dZ * qz) * id;
          if (w < 0 || u + w > 1) continue;
          const tt = (e2x * qx + e2y * qy + e2z * qz) * id;
          if (tt > 0.004 && tt < best) best = tt;
        }
        // Step to the next cell.
        if (tmX < tmY && tmX < tmZ) {
          tCell = tmX;
          tmX += ddX;
          ix += sX;
        } else if (tmY < tmZ) {
          tCell = tmY;
          tmY += ddY;
          iy += sY;
        } else {
          tCell = tmZ;
          tmZ += ddZ;
          iz += sZ;
        }
      }
      if (best < md) occ += 1 - best / md;
    }
    ao[v] = Math.max(o.floor, 1 - (o.strength * occ) / o.rays);
  }
  return ao;
}

const _p = new Vector3();
const _c = new Vector3();

/**
 * The instant fallback: occlusion of each body-tube vertex by sphere occluders (the limbs at
 * their roots, the head and jaw, the saddle), (r/d)² · max(0, n·l) each as a sphere occludes (the
 * facing wrapped a little), and by depth where the hide lies
 * within one (the root of a limb).
 * Writes into `out` (one value per vertex, 1 where unmasked).
 */
export function analyticAO(rig: RigDef, pos: ArrayLike<number>, nrm: ArrayLike<number>, mask: ArrayLike<number>, seat: Vector3, out: Float32Array): Float32Array {
  const P = rig.props;
  const S = P.shape;
  const spheres: [number, number, number, number][] = [];
  const humR = humerusRootRadius(rig);
  for (const sx of [1, -1]) {
    const sh = new Vector3(P.shoulder[0] * sx, P.shoulder[1], P.shoulder[2]);
    const el = new Vector3(rig.elbow.x * sx, rig.elbow.y, rig.elbow.z);
    for (const f of [0.15, 0.4]) {
      _c.lerpVectors(sh, el, f);
      spheres.push([_c.x, _c.y, _c.z, humR * (1 - 0.4 * f)]);
    }
    const hip = new Vector3(P.hip[0] * sx, P.hip[1], P.hip[2]);
    const knee = new Vector3(rig.knee.x * sx, rig.knee.y, rig.knee.z);
    for (const f of [0.2, 0.5]) {
      _c.lerpVectors(hip, knee, f);
      spheres.push([_c.x, _c.y, _c.z, S.thighRadius * (1 - 0.4 * f)]);
    }
  }
  const head = rig.bones[rig.idx.head].pos;
  spheres.push([head.x, head.y + 0.1 * S.headHalfHeight, head.z + 0.35 * S.headLength, 0.9 * S.headHalfHeight]);
  const jaw = rig.bones[rig.idx.jaw].pos;
  spheres.push([jaw.x, jaw.y - 0.2 * S.headHalfHeight, jaw.z + 0.3 * S.headLength, 0.55 * S.headHalfHeight]);
  spheres.push([seat.x, seat.y - 0.2, seat.z, 0.35]);
  const nv = pos.length / 3;
  for (let v = 0; v < nv; v++) {
    if (!mask[v]) {
      out[v] = 1;
      continue;
    }
    _p.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    let occ = 0;
    let bur = 0;
    for (const [x, y, z, r] of spheres) {
      _c.set(x - _p.x, y - _p.y, z - _p.z);
      const d = _c.length();
      if (d < r * 0.9) {
        bur = Math.max(bur, 0.35 + 0.4 * (1 - d / (r * 0.9))); // within a limb's root: deeper, darker
        continue;
      }
      if (d < r * 1.05) continue; // on the part's own surface
      // Wrapped facing: the hide beside a limb root is shaded even where it faces a little away.
      const cos = (_c.x * nrm[v * 3] + _c.y * nrm[v * 3 + 1] + _c.z * nrm[v * 3 + 2]) / d;
      if (cos > -0.3) occ += ((r * r) / (d * d)) * ((cos + 0.3) / 1.3);
    }
    out[v] = Math.max(AO_DEFAULTS.floor, 1 - 0.9 * Math.min(1, occ + bur));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The bake off the main thread, cached per shape key and LOD
// ---------------------------------------------------------------------------------------------

export interface AOJob {
  pos: Float32Array;
  nrm: Float32Array;
  tris: Uint32Array;
  mask: Uint8Array;
}

const cache = new Map<string, Float32Array>();
const CACHE_MAX = 24;
let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;
const waiting = new Map<number, { key: string; resolve: (ao: Float32Array) => void }>();

/** A cached bake for a shape key and LOD, if any. */
export function cachedAO(key: string): Float32Array | undefined {
  return cache.get(key);
}

/**
 * Bake AO off the main thread (resolves with one value per vertex), or null where no worker can
 * run (node tests, a failed worker): the caller keeps the analytic fallback then.
 */
export function requestAO(key: string, job: AOJob): Promise<Float32Array> | null {
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  if (workerFailed || typeof Worker === 'undefined') return null;
  try {
    if (!worker) {
      worker = new Worker(new URL('./aoWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ id: number; ao: Float32Array }>) => {
        const w = waiting.get(e.data.id);
        if (!w) return;
        waiting.delete(e.data.id);
        cache.set(w.key, e.data.ao);
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
        w.resolve(e.data.ao);
      };
      worker.onerror = () => {
        workerFailed = true;
        worker = null;
        waiting.clear();
      };
    }
    const id = nextId++;
    return new Promise((resolve) => {
      waiting.set(id, { key, resolve });
      worker!.postMessage({ id, ...job }, [job.pos.buffer, job.nrm.buffer, job.tris.buffer, job.mask.buffer]);
    });
  } catch {
    workerFailed = true;
    return null;
  }
}
