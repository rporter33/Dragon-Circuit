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
import type { CylinderCollider } from '../../../core/types';
import type { QualityProfile } from '../../../render/quality';
import { dressMaterial, swayDepthMaterial } from '../materials';
import type { PropInstance } from './placement';
import { SPECIES, SPECIES_IDS, instanceMatrix, type SpeciesId } from './species';

interface LodMesh {
  mesh: InstancedMesh;
  matrices: Float32Array;
  colors: Float32Array;
  count: number;
}

interface SpeciesBucket {
  id: SpeciesId;
  lods: LodMesh[];
  /** lodDist squared, per LOD boundary. */
  dist2: [number, number, number];
}

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
const _lastPos = new Vector3();
const _lastDir = new Vector3();
const _dir = new Vector3();

export interface ForestStats {
  instances: number;
  drawn: number[];
  drawCalls: number;
  byLod: [number, number, number];
}

export class Forest {
  readonly group = new Group();
  readonly colliders: CylinderCollider[] = [];
  readonly stats: ForestStats = { instances: 0, drawn: [], drawCalls: 0, byLod: [0, 0, 0] };
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

  constructor(instances: PropInstance[], quality: QualityProfile) {
    this.group.name = 'dressing:forest';
    this.shadows = quality.shadows;
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
      const spec = SPECIES[p.species];
      if (spec.trunkRadius * p.scale > 0.55) {
        this.colliders.push({ x: p.x, z: p.z, radius: spec.trunkRadius * p.scale + 0.25, y0: p.y - 1, y1: p.y + spec.height * p.scale * 0.6 });
      }
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
        reach = Math.max(reach, spec.lodDist[2] * Math.sqrt(p.scale));
      }
      this.groups.push({ sphere: new Sphere(c, r), start, end, reach });
      start = end;
    }

    for (const id of SPECIES_IDS) {
      const count = counts.get(id) ?? 0;
      if (count === 0) continue;
      const spec = SPECIES[id];
      const lods: LodMesh[] = [];
      for (let l = 0; l < 3; l++) {
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
      const d = spec.lodDist;
      this.buckets.set(id, { id, lods, dist2: [d[0] * d[0], d[1] * d[1], d[2] * d[2]] });
    }
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

  setQuality(q: QualityProfile): void {
    this.shadows = q.shadows;
    for (const b of this.buckets.values()) {
      b.lods[0].mesh.castShadow = SPECIES[b.id].castShadow && q.shadows;
    }
    this.framesSince = 1e9;
  }

  /** Re-bucket instances into LOD meshes when the camera has moved or turned enough. */
  update(camera: PerspectiveCamera): void {
    camera.getWorldDirection(_dir);
    this.framesSince++;
    const moved = camera.position.distanceToSquared(_lastPos) > 9;
    const turned = _dir.dot(_lastDir) < 0.995;
    if (!moved && !turned && this.framesSince < 20) return;
    _lastPos.copy(camera.position);
    _lastDir.copy(_dir);
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
    byLod[0] = byLod[1] = byLod[2] = 0;
    const bucketList: (SpeciesBucket | undefined)[] = SPECIES_IDS.map((id) => this.buckets.get(id));

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
        const lod = d2 < b.dist2[0] ? 0 : d2 < b.dist2[1] ? 1 : d2 < b.dist2[2] ? 2 : 3;
        if (lod === 3) continue;
        const L = b.lods[lod];
        const k = L.count++;
        L.matrices.set(this.mats.subarray(i * 16, i * 16 + 16), k * 16);
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
          m.instanceMatrix.clearUpdateRanges();
          m.instanceMatrix.addUpdateRange(0, L.count * 16);
          m.instanceMatrix.needsUpdate = true;
          m.instanceColor!.clearUpdateRanges();
          m.instanceColor!.addUpdateRange(0, L.count * 3);
          m.instanceColor!.needsUpdate = true;
        }
        this.stats.drawn.push(L.count);
      }
    }
    this.stats.drawCalls = calls;
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
