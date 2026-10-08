// The visible archipelago: island, spire and arch meshes with distance LODs, plus floating debris.
// Vegetation, water and structures belong to the Dressing system (world/dressing/).
//
// Build strategy: the coarsest LOD of everything is built up front (~0.1 s for the whole world),
// finer LODs are built lazily as the camera approaches, nearest first, inside a per-frame time
// budget (builders are generators that yield between rings). Fine LODs that fall far behind the
// camera are dropped again to bound memory. The first update builds whatever the starting view
// needs synchronously, and with ?manual=1 (headless captures) the budget is unlimited so every
// capture shows final detail.

import { Group, Mesh, type PerspectiveCamera, type Scene, type Vector3 } from 'three';
import type { WorldSystem } from '../game/contracts';
import type { QualityProfile } from '../render/quality';
import { readDebugParams } from '../debug/params';
import { LAYOUT, type WorldLayout } from './layout';
import { Terrain } from './terrain';
import type { ArchShape, IslandShape, SpireShape } from './islandShape';
import { BoundsLOD, boundsDistance, type Bounds } from './mesh/BoundsLOD';
import { ISLAND_LODS, buildIslandMesh, islandLodDistances } from './mesh/islandMesh';
import { SPIRE_LODS, buildSpireMesh } from './mesh/spireMesh';
import { ARCH_LODS, buildArchMesh } from './mesh/archMesh';
import { toGeometry, type MeshData } from './mesh/MeshBuilder';
import { terrainMaterial } from './mesh/terrainMaterial';
import { Debris } from './mesh/debris';

/** Per-frame build budget (ms) during normal play. */
const BUILD_BUDGET_MS = 3;
/** Start building a finer level this far (m) before the camera reaches its switch distance. */
const PREFETCH = 160;
/** Drop a finer level once the camera is this many times its switch distance away. */
const EVICT_FACTOR = 2.6;
/** LOD distance scale per quality level. */
const LOD_SCALE: Record<QualityProfile['level'], number> = { low: 0.6, medium: 0.8, high: 1, ultra: 1.35 };

type Builder = (level: number) => Generator<void, { data: MeshData }>;

interface Feature {
  name: string;
  lod: BoundsLOD;
  bounds: Bounds;
  /** Base switch distance of each level (level 0 at 0), before quality scaling. */
  distances: number[];
  meshes: (Mesh | null)[];
  build: Builder;
}

interface Job {
  feature: Feature;
  level: number;
  gen: Generator<void, { data: MeshData }>;
}

export interface WorldStats {
  /** Triangles per level, summed over every feature that currently has that level built. */
  trianglesBuilt: number[];
  /** Time to construct the world (shapes, coarse LODs, debris), ms. */
  constructMs: number;
  /** Total time spent in lazy builds so far, ms. */
  lazyBuildMs: number;
  lazyBuilds: number;
}

export class World implements WorldSystem {
  readonly terrain: Terrain;
  readonly layout: WorldLayout;
  readonly group = new Group();
  readonly stats: WorldStats = { trianglesBuilt: [0, 0, 0], constructMs: 0, lazyBuildMs: 0, lazyBuilds: 0 };
  private features: Feature[] = [];
  private job: Job | null = null;
  private quality: QualityProfile;
  private lodScale: number;
  private unlimitedBudget: boolean;
  private firstUpdate = true;
  private debris: Debris;

  constructor(scene: Scene, quality: QualityProfile) {
    const t0 = performance.now();
    this.layout = LAYOUT;
    this.terrain = new Terrain(this.layout);
    this.quality = quality;
    this.lodScale = LOD_SCALE[quality.level];
    this.unlimitedBudget = readDebugParams().manual;
    this.group.name = 'world';

    for (const shape of this.terrain.islands) this.addIsland(shape);
    for (const shape of this.terrain.spires) this.addSpire(shape);
    for (const shape of this.terrain.arches) this.addArch(shape);
    // The coarsest level of everything, now: the whole archipelago is visible from the start.
    for (const f of this.features) this.install(f, f.distances.length - 1, runBuilder(f.build(f.distances.length - 1)));

    this.debris = new Debris(this.terrain, quality);
    this.group.add(this.debris.mesh);
    scene.add(this.group);
    this.stats.constructMs = performance.now() - t0;
  }

  // --- Features -------------------------------------------------------------------------------

  private addFeature(name: string, bounds: Bounds, distances: number[], position: Vector3Like, build: Builder): void {
    const lod = new BoundsLOD(bounds);
    lod.name = name;
    lod.position.set(position[0], position[1], position[2]);
    lod.updateMatrix();
    lod.matrixAutoUpdate = false;
    this.group.add(lod);
    this.features.push({ name, lod, bounds, distances, meshes: distances.map(() => null), build });
  }

  private addIsland(shape: IslandShape): void {
    const d = shape.def;
    this.addFeature(
      `island-${d.id}`,
      { kind: 'cylinder', x: d.x, z: d.z, radius: shape.maxRadius + 1, minY: shape.minY, maxY: shape.maxY },
      islandLodDistances(d.radius),
      [d.x, d.y, d.z],
      (level) => buildIslandMesh(shape, ISLAND_LODS[level]),
    );
  }

  private addSpire(shape: SpireShape): void {
    const d = shape.def;
    this.addFeature(
      `spire-${d.id}`,
      { kind: 'cylinder', x: d.x, z: d.z, radius: shape.maxRadius, minY: d.tipY, maxY: d.topY },
      SPIRE_LODS.map((l) => l.distance),
      [d.x, d.topY, d.z],
      (level) => buildSpireMesh(shape, SPIRE_LODS[level]),
    );
  }

  private addArch(shape: ArchShape): void {
    const c = shape.center;
    this.addFeature(
      `arch-${shape.def.id}`,
      { kind: 'sphere', x: c.x, y: c.y, z: c.z, radius: shape.boundRadius },
      ARCH_LODS.map((l) => l.distance),
      [c.x, c.y, c.z],
      (level) => buildArchMesh(shape, ARCH_LODS[level], this.terrain),
    );
  }

  private install(f: Feature, level: number, data: MeshData): void {
    const mesh = new Mesh(toGeometry(data), terrainMaterial());
    mesh.name = `${f.name}-lod${level}`;
    mesh.castShadow = this.quality.shadows;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    f.meshes[level] = mesh;
    f.lod.setLevel(mesh, f.distances[level] * this.lodScale);
    this.stats.trianglesBuilt[level] += data.indices.length / 3;
  }

  private evict(f: Feature, level: number): void {
    const mesh = f.meshes[level];
    if (!mesh) return;
    f.lod.removeLevel(f.distances[level] * this.lodScale);
    f.lod.refresh();
    this.stats.trianglesBuilt[level] -= (mesh.geometry.index?.count ?? 0) / 3;
    mesh.geometry.dispose();
    f.meshes[level] = null;
  }

  // --- Per frame --------------------------------------------------------------------------------

  /** The finest level a camera at distance `dist` needs (prefetching ahead of the switch). */
  private neededLevel(f: Feature, dist: number): number {
    const n = f.distances.length;
    for (let k = 0; k < n - 1; k++) {
      if (dist < f.distances[k + 1] * this.lodScale + PREFETCH) return k;
    }
    return n - 1;
  }

  /** The nearest feature missing a level it needs, and evicts levels far behind the camera. */
  private nextMissing(cam: Vector3, evict: boolean): Job | null {
    let best: Feature | null = null;
    let bestLevel = 0;
    let bestDist = Infinity;
    for (const f of this.features) {
      const dist = boundsDistance(f.bounds, cam.x, cam.y, cam.z);
      const need = this.neededLevel(f, dist);
      // The finest needed level first: a teleport should not wait on intermediate levels.
      for (let k = need; k < f.distances.length - 1; k++) {
        if (!f.meshes[k] && dist < bestDist) {
          best = f;
          bestLevel = k;
          bestDist = dist;
        }
      }
      if (evict) {
        for (let k = 0; k < f.distances.length - 1; k++) {
          if (f.meshes[k] && dist > f.distances[k + 1] * this.lodScale * EVICT_FACTOR + PREFETCH) this.evict(f, k);
        }
      }
    }
    return best ? { feature: best, level: bestLevel, gen: best.build(bestLevel) } : null;
  }

  update(dt: number, camera: PerspectiveCamera, _focus: Vector3): void {
    const cam = camera.position;
    const unlimited = this.unlimitedBudget || this.firstUpdate;
    this.firstUpdate = false;
    if (!this.job) this.job = this.nextMissing(cam, true);
    const deadline = performance.now() + BUILD_BUDGET_MS;
    while (this.job) {
      const t0 = performance.now();
      let done = false;
      while (unlimited || performance.now() < deadline) {
        const r = this.job.gen.next();
        if (r.done) {
          this.install(this.job.feature, this.job.level, r.value.data);
          done = true;
          break;
        }
      }
      this.stats.lazyBuildMs += performance.now() - t0;
      if (!done) break;
      this.stats.lazyBuilds++;
      // Keep going while there is time (always, without a budget) and work left.
      this.job = unlimited || performance.now() < deadline ? this.nextMissing(cam, false) : null;
    }
    this.debris.update(dt);
  }

  /** Builds every level the current view needs right now (debug captures, teleports). */
  flushBuilds(camera: PerspectiveCamera): void {
    this.firstUpdate = true;
    this.update(0, camera, camera.position);
  }

  setQuality(q: QualityProfile): void {
    this.quality = q;
    const scale = LOD_SCALE[q.level];
    for (const f of this.features) {
      for (const level of f.lod.levels) {
        const k = f.meshes.indexOf(level.object as Mesh);
        if (k >= 0) level.distance = f.distances[k] * scale;
        level.object.castShadow = q.shadows;
      }
      f.lod.refresh();
    }
    this.lodScale = scale;
    this.debris.setQuality(q);
  }
}

type Vector3Like = [number, number, number];

function runBuilder<T>(gen: Generator<void, { data: T }>): T {
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value.data;
  }
}
