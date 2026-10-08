// Draws every placed tree, bush, rock, log, fern and mushroom: one InstancedMesh per species per
// LOD (so ~30 draw calls for the whole archipelago). Instances are re-bucketed by distance when
// the camera moves; islands outside the view frustum are skipped wholesale. Only LOD0 casts
// shadows, so the shadow pass sees just the trees near the player.

import {
  Frustum,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Sphere,
  Vector3,
  type BufferGeometry,
  type Material,
  type PerspectiveCamera,
} from 'three';
import type { Collider } from '../../../core/types';
import type { QualityProfile } from '../../../render/quality';
import { dressMaterial, swayDepthMaterial } from '../materials';
import type { PropInstance } from './placement';
import { SPECIES, SPECIES_IDS, instanceMatrix, speciesShapes, type SpeciesId } from './species';

interface LodMesh {
  mesh: InstancedMesh;
  matrices: Float32Array;
  colors: Float32Array;
  count: number;
}

interface SpeciesBucket {
  id: SpeciesId;
  lods: LodMesh[];
  /** Switch distances squared (scaled for quality), per LOD boundary; the last one culls. */
  dist2: number[];
}

/**
 * LOD distance scale per quality level: 'low' hands trees down to cheaper levels at half the
 * distance (a quarter of the area), 'ultra' keeps detail further out.
 */
export const FOREST_LOD_SCALE: Record<QualityProfile['level'], number> = { low: 0.5, medium: 0.75, high: 1, ultra: 1.3 };

interface IslandGroup {
  sphere: Sphere;
  /** Indices into the packed instance arrays. */
  start: number;
  end: number;
  /** Max cull distance of anything in this group. */
  reach: number;
}

const _frustum = new Frustum();
const _pv = new Matrix4();
const _dir = new Vector3();

export interface ForestStats {
  instances: number;
  drawn: number[];
  drawCalls: number;
  /** Instances drawn at each LOD (0 = nearest). */
  byLod: number[];
}

/**
 * Mark the first `count` items of an instanced attribute for upload, reusing one range object
 * per attribute (the renderer clears the list after each upload; addUpdateRange would allocate
 * a fresh object every refresh).
 */
const ownRange = new WeakMap<InstancedBufferAttribute, { start: number; count: number }>();
function setRange(attr: InstancedBufferAttribute, count: number): void {
  let range = ownRange.get(attr);
  if (!range) ownRange.set(attr, (range = { start: 0, count: 0 }));
  range.count = count;
  const r = attr.updateRanges;
  r.length = 0;
  r.push(range);
  attr.needsUpdate = true;
}

/** World-space colliders of one placed prop (its species' shapes, placed, turned and scaled). */
export function instanceColliders(p: PropInstance, out: Collider[]): void {
  const shapes = speciesShapes(p.species);
  if (shapes.length === 0) return;
  const s = p.scale;
  const sv = p.scale * p.scaleY;
  const cs = Math.cos(p.yaw);
  const sn = Math.sin(p.yaw);
  // Local (x, z) → world, turned by yaw like the instance matrix (Y rotation).
  const wx = (x: number, z: number) => p.x + (x * cs + z * sn) * s;
  const wz = (x: number, z: number) => p.z + (-x * sn + z * cs) * s;
  for (const sh of shapes) {
    if (sh.t === 'cyl') {
      const c: Collider = { x: wx(sh.x, sh.z), z: wz(sh.x, sh.z), radius: sh.r * s, y0: p.y + sh.y0 * sv, y1: p.y + sh.y1 * sv, surface: 'wood' };
      if (sh.soft) c.soft = true;
      out.push(c);
    } else if (sh.t === 'ell') {
      const a = sh.a * s;
      const b = sh.b * sv;
      const r = (a + b) / 2;
      // Centered on the ellipsoid, or with its top where the drawn top is.
      const y = p.y + sh.y * sv + (sh.top ? b - r : 0);
      const c: Collider = { kind: 'sphere', x: wx(sh.x, sh.z), y, z: wz(sh.x, sh.z), radius: r, surface: 'rock' };
      if (sh.soft) {
        c.soft = true;
        delete c.surface;
      }
      out.push(c);
    } else {
      out.push({ kind: 'box', x: wx(sh.x, sh.z), y: p.y + sh.y * sv, z: wz(sh.x, sh.z), hx: sh.hx * s, hy: sh.hy * sv, hz: sh.hz * s, yaw: p.yaw, surface: 'wood' });
    }
  }
}

export class Forest {
  readonly group = new Group();
  /**
   * Every tree's trunk (solid) and canopy (soft), bushes (soft), boulders and logs (solid), for
   * the instances this quality level plants. A new Forest (quality change) brings a new array.
   */
  readonly colliders: Collider[] = [];
  readonly stats: ForestStats = { instances: 0, drawn: [], drawCalls: 0, byLod: [0, 0, 0, 0] };
  private lodScale: number;
  /** Camera position and direction at the last re-bucket; dirty forces the next one. */
  private lastPos = new Vector3(Infinity, 0, 0);
  private lastDir = new Vector3();
  private dirty = true;
  private buckets = new Map<SpeciesId, SpeciesBucket>();
  /** Packed per-instance data, sorted by island. */
  private speciesOf: Uint8Array;
  private pos: Float32Array;
  private mats: Float32Array;
  private cols: Float32Array;
  private scaleOf: Float32Array;
  private groups: IslandGroup[] = [];
  private shadows: boolean;
  private framesSince = 1e9;
  /** Buckets indexed like SPECIES_IDS (speciesOf values). */
  private bucketList: (SpeciesBucket | undefined)[] = [];

  constructor(instances: PropInstance[], quality: QualityProfile) {
    this.group.name = 'dressing:forest';
    this.shadows = quality.shadows;
    this.lodScale = FOREST_LOD_SCALE[quality.level];
    const sorted = [...instances].sort((a, b) => a.islandId - b.islandId);
    const n = sorted.length;
    this.speciesOf = new Uint8Array(n);
    this.pos = new Float32Array(n * 3);
    this.mats = new Float32Array(n * 16);
    this.cols = new Float32Array(n * 3);
    this.scaleOf = new Float32Array(n);
    const counts = new Map<SpeciesId, number>();
    sorted.forEach((p, i) => {
      this.speciesOf[i] = SPECIES_IDS.indexOf(p.species);
      this.pos.set([p.x, p.y, p.z], i * 3);
      instanceMatrix(p.x, p.y, p.z, p.yaw, p.scale, p.scaleY, p.leanX, p.leanZ).toArray(this.mats, i * 16);
      this.cols.set(p.tint, i * 3);
      this.scaleOf[i] = p.scale;
      counts.set(p.species, (counts.get(p.species) ?? 0) + 1);
      instanceColliders(p, this.colliders);
    });
    this.stats.instances = n;

    // Island groups with bounding spheres.
    let start = 0;
    while (start < n) {
      const island = sorted[start].islandId;
      let end = start;
      const c = new Vector3();
      while (end < n && sorted[end].islandId === island) {
        c.x += sorted[end].x;
        c.y += sorted[end].y;
        c.z += sorted[end].z;
        end++;
      }
      c.multiplyScalar(1 / (end - start));
      let r = 0;
      let reach = 0;
      for (let i = start; i < end; i++) {
        const p = sorted[i];
        const spec = SPECIES[p.species];
        r = Math.max(r, Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z) + spec.height * p.scale * 1.3);
        reach = Math.max(reach, spec.lodDist[spec.lodDist.length - 1] * Math.sqrt(p.scale));
      }
      this.groups.push({ sphere: new Sphere(c, r), start, end, reach });
      start = end;
    }

    for (const id of SPECIES_IDS) {
      const count = counts.get(id) ?? 0;
      if (count === 0) continue;
      const spec = SPECIES[id];
      const lods: LodMesh[] = [];
      for (let l = 0; l < spec.lodDist.length; l++) {
        const geo = spec.build(l);
        const mesh = new InstancedMesh(geo, this.materialFor(spec.material), count);
        mesh.name = `${id}-lod${l}`;
        mesh.frustumCulled = false;
        mesh.count = 0;
        mesh.castShadow = l === 0 && spec.castShadow && this.shadows;
        mesh.receiveShadow = true;
        if (spec.material === 'foliage' || spec.material === 'card') mesh.customDepthMaterial = swayDepthMaterial('tree');
        mesh.instanceMatrix.setUsage(35048);
        mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
        mesh.instanceColor.setUsage(35048);
        this.group.add(mesh);
        lods.push({ mesh, matrices: mesh.instanceMatrix.array as Float32Array, colors: mesh.instanceColor.array as Float32Array, count: 0 });
      }
      this.buckets.set(id, { id, lods, dist2: [] });
    }
    this.applyLodScale();
    this.bucketList = SPECIES_IDS.map((sid) => this.buckets.get(sid));
  }

  private materialFor(kind: 'foliage' | 'glow' | 'rock' | 'card'): Material {
    switch (kind) {
      case 'foliage':
        return dressMaterial({ sway: 'tree' });
      case 'glow':
        return dressMaterial({ sway: 'tree', glow: true, glowDay: 0.06, glowNight: 1.9 });
      case 'rock':
        return dressMaterial({});
      case 'card':
        return dressMaterial({ sway: 'tree', doubleSide: true, keepNormals: true });
    }
  }

  /** Switch distances for the current quality (the cull distance itself is not scaled). */
  private applyLodScale(): void {
    for (const b of this.buckets.values()) {
      const d = SPECIES[b.id].lodDist;
      b.dist2 = d.map((v, i) => (i < d.length - 1 ? v * this.lodScale : v) ** 2);
    }
  }

  setQuality(q: QualityProfile): void {
    this.shadows = q.shadows;
    for (const b of this.buckets.values()) {
      b.lods[0].mesh.castShadow = SPECIES[b.id].castShadow && q.shadows;
    }
    this.lodScale = FOREST_LOD_SCALE[q.level];
    this.applyLodScale();
    this.dirty = true;
  }

  /** Re-bucket instances into LOD meshes when the camera has moved or turned enough. */
  update(camera: PerspectiveCamera): void {
    camera.getWorldDirection(_dir);
    this.framesSince++;
    const drift = camera.position.distanceToSquared(this.lastPos);
    const moved = drift > 9;
    const turned = _dir.dot(this.lastDir) < 0.995;
    // Re-bucket after a real move or turn, or now and then while creeping; never while still.
    const still = drift < 1e-4 && _dir.dot(this.lastDir) > 0.99999;
    if (!this.dirty && !moved && !turned && (this.framesSince < 20 || still)) return;
    this.dirty = false;
    this.lastPos.copy(camera.position);
    this.lastDir.copy(_dir);
    this.framesSince = 0;

    camera.updateMatrixWorld();
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pv);
    const far2 = camera.far * camera.far;

    for (const b of this.buckets.values()) for (const l of b.lods) l.count = 0;
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    const byLod = this.stats.byLod;
    byLod.fill(0);
    const bucketList = this.bucketList;

    for (const g of this.groups) {
      const dc = g.sphere.center.distanceTo(camera.position) - g.sphere.radius;
      if (dc > g.reach || dc * dc > far2) continue;
      if (!_frustum.intersectsSphere(g.sphere)) continue;
      for (let i = g.start; i < g.end; i++) {
        const b = bucketList[this.speciesOf[i]]!;
        const dx = this.pos[i * 3] - cx;
        const dy = this.pos[i * 3 + 1] - cy;
        const dz = this.pos[i * 3 + 2] - cz;
        // Bigger things keep detail further out.
        const d2 = (dx * dx + dy * dy + dz * dz) / this.scaleOf[i];
        const bounds = b.dist2;
        let lod = 0;
        while (lod < bounds.length && d2 >= bounds[lod]) lod++;
        if (lod === bounds.length) continue;
        const L = b.lods[lod];
        const k = L.count++;
        const src = i * 16;
        const dst = k * 16;
        for (let e = 0; e < 16; e++) L.matrices[dst + e] = this.mats[src + e];
        L.colors[k * 3] = this.cols[i * 3];
        L.colors[k * 3 + 1] = this.cols[i * 3 + 1];
        L.colors[k * 3 + 2] = this.cols[i * 3 + 2];
        byLod[lod]++;
      }
    }

    let calls = 0;
    this.stats.drawn.length = 0;
    for (const b of this.buckets.values()) {
      for (const L of b.lods) {
        const m = L.mesh;
        m.count = L.count;
        m.visible = L.count > 0;
        if (L.count > 0) {
          calls++;
          // Upload only the used prefix; reuse the range objects instead of allocating new ones.
          setRange(m.instanceMatrix, L.count * 16);
          setRange(m.instanceColor!, L.count * 3);
        }
        this.stats.drawn.push(L.count);
      }
    }
    this.stats.drawCalls = calls;
  }

  /** Horizontal distance from (x, z) to the nearest tree/prop with a trunk (debug cameras). */
  clearance(x: number, z: number): number {
    let best = Infinity;
    for (let i = 0; i < this.speciesOf.length; i++) {
      if (SPECIES[SPECIES_IDS[this.speciesOf[i]]].height < 3) continue;
      const d = Math.hypot(this.pos[i * 3] - x, this.pos[i * 3 + 2] - z);
      if (d < best) best = d;
    }
    return best;
  }

  dispose(): void {
    for (const b of this.buckets.values()) {
      for (const l of b.lods) {
        l.mesh.geometry.dispose();
        l.mesh.dispose();
      }
    }
  }

  /** Geometry sizes (triangles) per species and LOD, for the perf report. */
  triangleCounts(): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const b of this.buckets.values()) {
      out[b.id] = b.lods.map((l) => {
        const g = l.mesh.geometry as BufferGeometry;
        return (g.getIndex()?.count ?? 0) / 3;
      });
    }
    return out;
  }
}
