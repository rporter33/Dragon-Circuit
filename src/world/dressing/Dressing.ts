// World dressing: everything that grows or was built on the islands. Grass and flowers stream
// around the camera; trees, rocks, roots, waterfalls and structures are generated once from the
// layout (deterministically) and drawn instanced / merged with distance LOD.
//
// Build order matters: structures and streams register keep-out zones first, so trees, rocks and
// grass never grow through a floor or a stream.

import { Group, Vector3, type PerspectiveCamera, type Scene } from 'three';
import type { CylinderCollider } from '../../core/types';
import type { GameEventBus } from '../../core/events';
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

export interface DressingDeps {
  scene: Scene;
  terrain: Terrain;
  quality: QualityProfile;
  events?: GameEventBus;
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
  readonly colliders: CylinderCollider[] = [];
  readonly decks: Deck[] = [];
  readonly exclusions = new ExclusionSet();
  readonly grass: GrassField;
  forest!: Forest;
  readonly structures: Structures;
  readonly water: Waterfalls;
  private bankProps: PropInstance[];
  private terrain: Terrain;
  private quality: QualityProfile;

  constructor(deps: DressingDeps) {
    this.terrain = deps.terrain;
    this.quality = deps.quality;
    this.group.name = 'dressing';

    this.structures = new Structures(this.terrain, { exclusions: this.exclusions, colliders: this.colliders, decks: this.decks });
    this.group.add(this.structures.group);
    // Streams avoid built-up ground; their banks then keep trees and grass out of the water.
    const plans = planWaterfalls(this.terrain, this.exclusions);
    this.bankProps = Waterfalls.bankProps(this.terrain, plans, this.exclusions);
    this.water = new Waterfalls(this.terrain, plans, this.quality);
    this.group.add(this.water.group);
    this.buildForest();
    this.grass = new GrassField(this.terrain, this.exclusions, this.quality);
    this.group.add(this.grass.group);
    deps.scene.add(this.group);
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
    this.grass.update(camera, focus);
    this.forest.update(camera);
  }

  setQuality(q: QualityProfile): void {
    const rebuild = q.propDensity !== this.quality.propDensity;
    this.quality = q;
    this.grass.setQuality(q);
    if (rebuild) this.buildForest();
    else this.forest.setQuality(q);
    this.water.setQuality(q);
  }

  stats(): DressingStats {
    return { grass: this.grass.stats, forest: this.forest.stats, structures: this.structures.stats, water: this.water.stats };
  }
}
