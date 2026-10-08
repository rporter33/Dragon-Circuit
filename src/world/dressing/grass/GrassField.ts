// Streams ground cover around the camera. The world is cut into CHUNK_SIZE squares; chunks within
// the quality's grass radius borrow a pooled GPU slot (instanced geometry with fixed-capacity
// attribute buffers, reused as chunks come and go). Chunk contents are generated on demand,
// time-sliced, and kept in a small LRU so turning around doesn't regenerate everything.

import {
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Sphere,
  Vector3,
  Vector4,
  type BufferGeometry,
  type Material,
  type PerspectiveCamera,
} from 'three';
import type { QualityProfile } from '../../../render/quality';
import type { Terrain } from '../../terrain';
import { LAYOUT } from '../../layout';
import type { ExclusionSet } from '../exclusions';
import {
  CHUNK_SIZE,
  allocInstances,
  flowerCapacity,
  generateFieldChunk,
  keepFraction,
  prefixCount,
  tuftCapacity,
  type FieldChunkData,
  type InstanceArrays,
} from './fieldChunk';
import { flowerGeometry, tuftGeometry } from './fieldGeometry';
import { flowerMaterial, grassMaterial, type FieldUniforms } from './fieldMaterial';
import type { FieldWorkerRequest } from './fieldWorker';

/** Chunks nearer than this are always generated immediately on the main thread. */
const NEAR_SYNC = 48;
/** Max chunk requests in flight to the worker. */
const MAX_PENDING = 8;
/** Chunks whose nearest point is farther than this (m) draw the 4-triangle far tuft. */
const FAR_TUFT: Record<QualityProfile['level'], number> = { low: 18, medium: 26, high: 30, ultra: 40 };

interface LayerSlot {
  mesh: Mesh;
  geo: InstancedBufferGeometry;
  pos: InstancedBufferAttribute;
  shape: InstancedBufferAttribute;
  base: InstancedBufferAttribute;
  tip: InstancedBufferAttribute;
  /** Drawing the far (simplified) base geometry. */
  far: boolean;
}

interface Slot {
  key: number;
  grass: LayerSlot;
  flowers: LayerSlot;
  data: FieldChunkData | null;
  center: Vector3;
  halfY: number;
}

const key = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096);
const byDistance = (a: { d: number }, b: { d: number }) => a.d - b.d;

const tmpBox = { x: 0, z: 0 };

/** Compact copy of the used part of an instance buffer (for the LRU cache). */
function compact(a: InstanceArrays): InstanceArrays {
  const n = a.count * 4;
  return { count: a.count, pos: a.pos.slice(0, n), shape: a.shape.slice(0, n), base: a.base.slice(0, n), tip: a.tip.slice(0, n) };
}

export interface GrassStats {
  chunks: number;
  visibleChunks: number;
  tufts: number;
  flowers: number;
  drawCalls: number;
  cached: number;
}

export class GrassField {
  readonly group = new Group();
  readonly uniforms: FieldUniforms = { uDwRadius: { value: 150 }, uDwBend: { value: new Vector4(0, -1e5, 0, 3.2) } };
  private terrain: Terrain;
  private exclusions: ExclusionSet;
  private quality: QualityProfile;
  private grassMat: Material;
  private flowerMat: Material;
  private tuftBase: BufferGeometry;
  private tuftFar: BufferGeometry;
  private flowerBase: BufferGeometry;
  private slots = new Map<number, Slot>();
  private free: Slot[] = [];
  private cache = new Map<number, FieldChunkData>();
  /** Chunks known to hold nothing (open sky or bare rock). */
  private empty = new Set<number>();
  private scratch: FieldChunkData;
  private cacheLimit = 200;
  private wanted: { k: number; cx: number; cz: number; d: number }[] = [];
  private wantedPool: { k: number; cx: number; cz: number; d: number }[] = [];
  private wantedKeys = new Set<number>();
  /** Island top bands per chunk (to skip chunks far above/below the camera before generating). */
  private bands = new Map<number, { minY: number; maxY: number } | null>();
  readonly stats: GrassStats = { chunks: 0, visibleChunks: 0, tufts: 0, flowers: 0, drawCalls: 0, cached: 0 };
  /** Background generator (null: generate on the main thread, e.g. tests or manual stepping). */
  private worker: Worker | null = null;
  private workerReady = false;
  private pending = new Set<number>();
  private gen = 0;
  private wantAsync: boolean;

  constructor(terrain: Terrain, exclusions: ExclusionSet, quality: QualityProfile, opts: { async?: boolean } = {}) {
    this.wantAsync = opts.async ?? true;
    this.terrain = terrain;
    this.exclusions = exclusions;
    this.quality = quality;
    this.group.name = 'dressing:grass';
    this.grassMat = grassMaterial(this.uniforms);
    this.flowerMat = flowerMaterial(this.uniforms);
    this.tuftBase = tuftGeometry();
    this.tuftFar = tuftGeometry(true);
    this.flowerBase = flowerGeometry();
    this.scratch = this.allocScratch();
    this.uniforms.uDwRadius.value = quality.grassRadius;
  }

  private allocScratch(): FieldChunkData {
    return {
      cx: 0,
      cz: 0,
      tufts: allocInstances(tuftCapacity(this.quality.grassDensity)),
      flowers: allocInstances(flowerCapacity(this.quality.propDensity)),
      minY: 0,
      maxY: 0,
    };
  }

  private params() {
    return { density: this.quality.grassDensity, flowerDensity: this.quality.propDensity };
  }

  /** Start (or re-arm) the worker. Called lazily so every keep-out zone is registered first. */
  private initWorker(): void {
    this.workerReady = true;
    if (!this.wantAsync || typeof Worker === 'undefined' || this.terrain.layout !== LAYOUT) return;
    try {
      this.worker ??= new Worker(new URL('./fieldWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this.receive(e.data);
      this.worker.onerror = () => {
        // Fall back to main-thread generation if the worker can't run.
        this.worker = null;
        this.pending.clear();
      };
      const msg: FieldWorkerRequest = { type: 'init', exclusions: this.exclusions.items, params: this.params(), gen: this.gen };
      this.worker.postMessage(msg);
    } catch {
      this.worker = null;
    }
  }

  private receive(m: { key: number; gen: number; cx: number; cz: number; tufts: InstanceArrays; flowers: InstanceArrays; minY: number; maxY: number }): void {
    if (m.gen !== this.gen) return;
    this.pending.delete(m.key);
    if (m.tufts.count === 0 && m.flowers.count === 0) {
      this.empty.add(m.key);
      return;
    }
    this.store(m.key, { cx: m.cx, cz: m.cz, tufts: m.tufts, flowers: m.flowers, minY: m.minY, maxY: m.maxY });
  }

  setQuality(q: QualityProfile): void {
    const changed = q.grassDensity !== this.quality.grassDensity || q.propDensity !== this.quality.propDensity;
    this.quality = q;
    this.uniforms.uDwRadius.value = q.grassRadius;
    if (!changed) return;
    this.gen++;
    this.pending.clear();
    if (this.worker) {
      const msg: FieldWorkerRequest = { type: 'init', exclusions: this.exclusions.items, params: this.params(), gen: this.gen };
      this.worker.postMessage(msg);
    }
    // Densities changed: drop everything; slots are rebuilt with new capacities on demand.
    for (const s of [...this.slots.values(), ...this.free]) this.disposeSlot(s);
    this.slots.clear();
    this.free.length = 0;
    this.cache.clear();
    this.empty.clear();
    this.scratch = this.allocScratch();
  }

  private makeLayer(base: BufferGeometry, mat: Material, capacity: number, name: string): LayerSlot {
    const geo = new InstancedBufferGeometry();
    for (const [n, a] of Object.entries(base.attributes)) geo.setAttribute(n, a);
    geo.setIndex(base.getIndex());
    const mk = (arr: Float32Array | Uint8Array, normalized: boolean) => {
      const a = new InstancedBufferAttribute(arr, 4, normalized);
      a.setUsage(35048); // DynamicDrawUsage
      return a;
    };
    const pos = mk(new Float32Array(capacity * 4), false);
    const shape = mk(new Float32Array(capacity * 4), false);
    const baseA = mk(new Uint8Array(capacity * 4), true);
    const tip = mk(new Uint8Array(capacity * 4), true);
    geo.setAttribute('aPos', pos);
    geo.setAttribute('aShape', shape);
    geo.setAttribute('aBase', baseA);
    geo.setAttribute('aTip', tip);
    geo.instanceCount = 0;
    geo.boundingSphere = new Sphere(new Vector3(), 1);
    const mesh = new Mesh(geo, mat);
    mesh.name = name;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    return { mesh, geo, pos, shape, base: baseA, tip, far: false };
  }

  /** Swap a layer's shared base geometry (near or far tuft); instance data stays. */
  private setBase(layer: LayerSlot, base: BufferGeometry, far: boolean): void {
    if (layer.far === far) return;
    layer.far = far;
    for (const [n, a] of Object.entries(base.attributes)) layer.geo.setAttribute(n, a);
    layer.geo.setIndex(base.getIndex());
  }

  private acquire(): Slot {
    const s = this.free.pop();
    if (s) return s;
    const slot: Slot = {
      key: -1,
      grass: this.makeLayer(this.tuftBase, this.grassMat, tuftCapacity(this.quality.grassDensity), 'grass-chunk'),
      flowers: this.makeLayer(this.flowerBase, this.flowerMat, flowerCapacity(this.quality.propDensity), 'flower-chunk'),
      data: null,
      center: new Vector3(),
      halfY: 1,
    };
    return slot;
  }

  private disposeSlot(s: Slot): void {
    for (const l of [s.grass, s.flowers]) {
      l.mesh.removeFromParent();
      // Only the per-slot instanced attributes are ours to free; base attributes are shared.
      for (const n of Object.keys(l.geo.attributes)) {
        if (!(l.geo.attributes[n] instanceof InstancedBufferAttribute)) l.geo.deleteAttribute(n);
      }
      l.geo.setIndex(null);
      l.geo.dispose();
    }
  }

  private upload(layer: LayerSlot, a: InstanceArrays): void {
    const n = Math.min(a.count, layer.pos.count);
    const len = n * 4;
    const put = (attr: InstancedBufferAttribute, src: Float32Array | Uint8Array) => {
      (attr.array as Float32Array | Uint8Array).set(src.subarray(0, len));
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, Math.max(4, len));
      attr.needsUpdate = true;
    };
    put(layer.pos, a.pos);
    put(layer.shape, a.shape);
    put(layer.base, a.base);
    put(layer.tip, a.tip);
    layer.geo.instanceCount = n;
  }

  /** Vertical band of island tops over a chunk, or null for open sky. */
  private band(k: number, cx: number, cz: number): { minY: number; maxY: number } | null {
    if (this.bands.has(k)) return this.bands.get(k)!;
    const S = CHUNK_SIZE;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const s of this.terrain.candidates(cx * S + S / 2, cz * S + S / 2, S * 0.75)) {
      if (s.type !== 'island') continue;
      const d = s.shape.def;
      const nx = Math.max(cx * S, Math.min(d.x, cx * S + S));
      const nz = Math.max(cz * S, Math.min(d.z, cz * S + S));
      if (Math.hypot(nx - d.x, nz - d.z) > s.shape.maxRadius) continue;
      minY = Math.min(minY, d.y - 4);
      maxY = Math.max(maxY, s.shape.maxY + 2);
    }
    const b = minY <= maxY ? { minY, maxY } : null;
    this.bands.set(k, b);
    return b;
  }

  private store(k: number, data: FieldChunkData): void {
    this.cache.set(k, data);
    if (this.cache.size > this.cacheLimit) {
      // Evict least-recently-used entries that aren't on screen.
      let excess = this.cache.size - this.cacheLimit;
      for (const key of this.cache.keys()) {
        if (excess <= 0) break;
        if (this.slots.has(key)) continue;
        this.cache.delete(key);
        excess--;
      }
    }
  }

  /** Cached chunk data (LRU touch), or null. */
  private cached(k: number): FieldChunkData | null {
    const hit = this.cache.get(k);
    if (!hit) return null;
    this.cache.delete(k);
    this.cache.set(k, hit);
    return hit;
  }

  /** Generate a chunk right now on this thread. */
  private generateNow(k: number, cx: number, cz: number): FieldChunkData | null {
    const d = generateFieldChunk(this.terrain, this.exclusions, cx, cz, this.params(), this.scratch);
    if (d.tufts.count === 0 && d.flowers.count === 0) {
      this.empty.add(k);
      return null;
    }
    const stored: FieldChunkData = { cx, cz, tufts: compact(d.tufts), flowers: compact(d.flowers), minY: d.minY, maxY: d.maxY };
    this.store(k, stored);
    return stored;
  }

  update(camera: PerspectiveCamera, focus: Vector3): void {
    const q = this.quality;
    const R = q.grassRadius;
    this.uniforms.uDwBend.value.set(focus.x, focus.y, focus.z, 3.4);
    if (q.grassDensity <= 0) {
      this.stats.chunks = 0;
      return;
    }
    const S = CHUNK_SIZE;
    const c = camera.position;
    const wanted = this.wanted;
    wanted.length = 0;
    this.wantedKeys.clear();
    const cx0 = Math.floor((c.x - R) / S);
    const cx1 = Math.floor((c.x + R) / S);
    const cz0 = Math.floor((c.z - R) / S);
    const cz1 = Math.floor((c.z + R) / S);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const k = key(cx, cz);
        if (this.empty.has(k)) continue;
        tmpBox.x = Math.max(cx * S, Math.min(c.x, cx * S + S));
        tmpBox.z = Math.max(cz * S, Math.min(c.z, cz * S + S));
        const dxz = Math.hypot(tmpBox.x - c.x, tmpBox.z - c.z);
        if (dxz > R) continue;
        const b = this.cache.get(k) ?? this.band(k, cx, cz);
        if (!b) {
          this.empty.add(k);
          continue;
        }
        const dy = c.y > b.maxY ? c.y - b.maxY : c.y < b.minY ? b.minY - c.y : 0;
        const d = Math.hypot(dxz, dy);
        if (d > R) continue;
        // Reuse entry objects frame to frame (no per-frame garbage).
        let w = this.wantedPool[wanted.length];
        if (!w) this.wantedPool.push((w = { k: 0, cx: 0, cz: 0, d: 0 }));
        w.k = k;
        w.cx = cx;
        w.cz = cz;
        w.d = d;
        wanted.push(w);
        this.wantedKeys.add(k);
      }
    }

    // Release slots that left the radius.
    for (const [k, s] of this.slots) {
      if (this.wantedKeys.has(k)) continue;
      s.grass.mesh.removeFromParent();
      s.flowers.mesh.removeFromParent();
      s.key = -1;
      s.data = null;
      this.slots.delete(k);
      this.free.push(s);
    }

    // Fill missing chunks nearest first: anything close is generated now (no bald patch at the
    // player's feet); the rest go to the worker, or (without one) a per-frame time budget.
    if (!this.workerReady) this.initWorker();
    wanted.sort(byDistance);
    const t0 = performance.now();
    let generated = 0;
    for (const w of wanted) {
      if (this.slots.has(w.k)) continue;
      let data = this.cached(w.k);
      if (!data) {
        if (this.empty.has(w.k)) continue;
        if (this.worker && w.d > NEAR_SYNC) {
          if (!this.pending.has(w.k) && this.pending.size < MAX_PENDING) {
            this.pending.add(w.k);
            const msg: FieldWorkerRequest = { type: 'gen', key: w.k, cx: w.cx, cz: w.cz, gen: this.gen };
            this.worker.postMessage(msg);
          }
          continue;
        }
        if (w.d > NEAR_SYNC && generated > 0 && performance.now() - t0 > 3) continue;
        data = this.generateNow(w.k, w.cx, w.cz);
        generated++;
      }
      if (!data) continue;
      const slot = this.acquire();
      slot.key = w.k;
      slot.data = data;
      this.upload(slot.grass, data.tufts);
      this.upload(slot.flowers, data.flowers);
      const cy = (data.minY + data.maxY) / 2;
      slot.center.set(w.cx * S + S / 2, Number.isFinite(cy) ? cy : 0, w.cz * S + S / 2);
      slot.halfY = Number.isFinite(cy) ? (data.maxY - data.minY) / 2 : 1;
      const r = Math.hypot(S * 0.71, slot.halfY) + 2;
      for (const l of [slot.grass, slot.flowers]) {
        l.geo.boundingSphere!.center.copy(slot.center);
        l.geo.boundingSphere!.radius = r;
      }
      if (data.tufts.count > 0) this.group.add(slot.grass.mesh);
      if (data.flowers.count > 0) this.group.add(slot.flowers.mesh);
      this.slots.set(w.k, slot);
    }

    // Per-chunk LOD: draw only the rank prefix the nearest point of the chunk needs.
    let tufts = 0;
    let flowers = 0;
    for (const w of wanted) {
      const s = this.slots.get(w.k);
      if (!s || !s.data) continue;
      const keep = keepFraction(w.d);
      const far = w.d > FAR_TUFT[this.quality.level];
      this.setBase(s.grass, far ? this.tuftFar : this.tuftBase, far);
      s.grass.geo.instanceCount = prefixCount(s.data.tufts, keep);
      s.flowers.geo.instanceCount = prefixCount(s.data.flowers, keepFraction(w.d * 0.75));
      tufts += s.grass.geo.instanceCount;
      flowers += s.flowers.geo.instanceCount;
    }
    this.stats.chunks = this.slots.size;
    this.stats.tufts = tufts;
    this.stats.flowers = flowers;
    this.stats.cached = this.cache.size;
  }
}
