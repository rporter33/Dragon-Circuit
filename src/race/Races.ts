// Races: ring courses and sprints, timing, medals and ghosts. (Baseline: no courses. The race
// module owner implements courses, rings, timing, ghosts and start gates.)

import type { PerspectiveCamera, Vector3 } from 'three';
import type { PlayerSystem, RaceDef, RaceSystem } from '../game/contracts';

export class Races implements RaceSystem {
  defs: RaceDef[] = [];
  activeId: string | null = null;
  state: 'idle' | 'countdown' | 'running' | 'finished' = 'idle';
  elapsedMs = 0;
  nextRingIndex = 0;
  bestMs: number | null = null;
  lastDeltaMs: number | null = null;

  waypoint(_out: Vector3): Vector3 | null {
    return null;
  }
  nearbyStart(_p: Vector3): RaceDef | null {
    return null;
  }
  begin(_raceId: string): void {}
  restart(): void {}
  abort(_reason: 'quit' | 'restart' | 'respawn' | 'left-course'): void {}
  fixedUpdate(_dt: number, _player: PlayerSystem): void {}
  update(_dt: number, _camera: PerspectiveCamera, _player: PlayerSystem): void {}
  setShowGhost(_on: boolean): void {}
}
