// Feathers and relics hidden around the Drift. (Baseline: none placed. The progression module
// owner places them, animates them and handles pickup + unlocks.)

import type { PerspectiveCamera, Vector3 } from 'three';
import type { CollectibleSystem, PlayerSystem } from '../game/contracts';

export class Collectibles implements CollectibleSystem {
  total = { feathers: 0, relics: 0 };
  found = { feathers: 0, relics: 0 };
  update(_dt: number, _camera: PerspectiveCamera, _player: PlayerSystem): void {}
  nearestHint(_p: Vector3, _range: number): Vector3 | null {
    return null;
  }
}
