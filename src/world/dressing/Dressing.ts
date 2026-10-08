// World dressing: everything that grows or was built on the islands. Grass and flowers stream
// around the camera; trees, rocks, roots, waterfalls and structures are generated once from the
// layout (deterministically) and drawn instanced / merged with distance LOD.
//
// Build order matters: structures and streams register keep-out zones first, so trees, rocks and
// grass never grow through a floor or a stream.

import { Group, Vector3, type PerspectiveCamera, type Scene } from 'three';
import type { Collider } from '../../core/types';
import type { DressingSystem } from '../../game/contracts';
import type { QualityProfile } from '../../render/quality';
import type { Terrain } from '../terrain';
import { ExclusionSet } from './exclusions';
import { GrassField } from './grass/GrassField';
import { Forest } from './trees/Forest';
import { scatterIsland, type PropInstance } from './trees/placement';
import { Structures } from './structures/Structures';
import { Waterfalls } from './water/Waterfalls';
import { planWaterfalls } from './water/waterfallPlan';
import { HangingRoots } from './roots/HangingRoots';
import { planRoots, type RootPlan } from './roots/rootPlan';
import { colliderView } from './colliderView';
import { deckCollider } from '../colliders';

export interface DressingDeps {
  scene: Scene;
  terrain: Terrain;
  quality: QualityProfile;
  /**
   * Generate far grass chunks in a Web Worker (default true). Pass false when frames are stepped
   * by automation (?manual=1) so every capture is complete and deterministic.
   */
  asyncStreaming?: boolean;
}

/** Something with an oriented rectangle top you can walk on (decks, bridges). */
export interface Deck {
  x: number;
  z: number;
  /** Facing (radians): local +Z = (sin yaw, cos yaw). */
  yaw: number;
  halfWidth: number;
  /** Extends from -back to +length along local +Z. */
  back: number;
  length: number;
  y: number;
  surface: 'wood' | 'stone';
}

export interface DressingStats {
  grass: GrassField['stats'];
  [layer: string]: unknown;
}

export class Dressing implements DressingSystem {
  readonly group = new Group();
  /** Collision shapes of everything built (boxes, cylinders, spheres; foliage-soft where noted). */
  readonly colliders: Collider[] = [];
  readonly decks: Deck[] = [];
  readonly exclusions = new ExclusionSet();
  readonly grass: GrassField;
  forest!: Forest;
  readonly structures: Structures;
  readonly water: Waterfalls;
  readonly roots: HangingRoots;
  /** The hanging strands (for course design: see strandClearance()). */
  readonly rootPlan: RootPlan;
  private bankProps: PropInstance[];
  private terrain: Terrain;
  private quality: QualityProfile;

  /** Milliseconds spent building at construction (for the perf report). */
  readonly buildMs: number;
  /** Distant geometry still to build, a little per frame (see update()). */
  private tasks: (() => void)[] = [];

  constructor(deps: DressingDeps) {
    const t0 = performance.now();
    this.terrain = deps.terrain;
    this.quality = deps.quality;
    this.group.name = 'dressing';

    const defer = (task: () => void) => this.tasks.push(task);
    this.structures = new Structures(this.terrain, { exclusions: this.exclusions, colliders: this.colliders, decks: this.decks }, defer);
    this.group.add(this.structures.group);
    // Streams avoid built-up ground; their banks then keep trees and grass out of the water.
    const plans = planWaterfalls(this.terrain, this.exclusions);
    this.bankProps = Waterfalls.bankProps(this.terrain, plans, this.exclusions);
    this.water = new Waterfalls(this.terrain, plans, this.quality);
    this.group.add(this.water.group);
    this.rootPlan = planRoots(this.terrain);
    this.roots = new HangingRoots(this.terrain, this.rootPlan, defer, this.quality);
    this.group.add(this.roots.group);
    this.buildForest();
    this.grass = new GrassField(this.terrain, this.exclusions, this.quality, { async: deps.asyncStreaming ?? true });
    this.group.add(this.grass.group);
    deps.scene.add(this.group);
    // Automation wants complete, deterministic frames: build everything now.
    if (deps.asyncStreaming === false) this.flushTasks();
    this.buildMs = performance.now() - t0;
  }

  /** Run every deferred build task now. */
  flushTasks(): void {
    while (this.tasks.length) this.tasks.shift()!();
  }

  /** True once every deferred site has been built. */
  get ready(): boolean {
    return this.tasks.length === 0;
  }

  /** Scatter trees and props over every island (deterministic) and build the instanced forest. */
  private buildForest(): void {
    if (this.forest) {
      this.forest.group.removeFromParent();
      this.forest.dispose();
    }
    const all: PropInstance[] = [...this.bankProps];
    for (const shape of this.terrain.islands) all.push(...scatterIsland(shape, this.exclusions, { density: this.quality.propDensity }));
    this.forest = new Forest(all, this.quality);
    this.group.add(this.forest.group);
  }

  deckAt(x: number, z: number, fromY: number): { y: number; surface: 'wood' | 'stone' } | null {
    let best: Deck | null = null;
    for (const d of this.decks) {
      if (d.y > fromY + 2 || (best && d.y <= best.y)) continue;
      const dx = x - d.x;
      const dz = z - d.z;
      const s = Math.sin(d.yaw);
      const c = Math.cos(d.yaw);
      const along = dx * s + dz * c;
      const across = dx * c - dz * s;
      if (along < -d.back || along > d.length || Math.abs(across) > d.halfWidth) continue;
      best = d;
    }
    return best ? { y: best.y, surface: best.surface } : null;
  }

  update(_dt: number, camera: PerspectiveCamera, focus: Vector3): void {
    // Finish distant sites a few milliseconds at a time.
    const t0 = performance.now();
    while (this.tasks.length && performance.now() - t0 < 4) this.tasks.shift()!();
    this.grass.update(camera, focus);
    this.forest.update(camera);
    this.roots.update(camera);
  }

  setQuality(q: QualityProfile): void {
    const rebuild = q.propDensity !== this.quality.propDensity;
    this.quality = q;
    this.grass.setQuality(q);
    if (rebuild) this.buildForest();
    else this.forest.setQuality(q);
    this.water.setQuality(q);
    this.roots.setQuality(q);
  }

  private colliderDebug: Group | null = null;

  /** Debug: draw every dressing collider (structures, decks, forest) as wireframes. */
  showColliders(on: boolean): void {
    if (this.colliderDebug) {
      this.colliderDebug.removeFromParent();
      this.colliderDebug = null;
    }
    if (!on) return;
    this.colliderDebug = colliderView([this.colliders, this.forest.colliders, this.decks.map(deckCollider)]);
    this.group.add(this.colliderDebug);
  }

  stats(): DressingStats {
    return { grass: this.grass.stats, forest: this.forest.stats, structures: this.structures.stats, water: this.water.stats, roots: this.roots.stats };
  }
}
