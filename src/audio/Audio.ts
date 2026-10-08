// Procedural audio. (Baseline: silent. The audio module owner implements wind, wingbeats, chimes,
// ambience and generative music on WebAudio.)

import type { PerspectiveCamera } from 'three';
import type { Settings } from '../core/types';
import type { AudioSystemApi, PlayerSystem, SkySystem, WeatherSystem } from '../game/contracts';
import type { GameEventBus } from '../core/events';

export class AudioSystem implements AudioSystemApi {
  constructor(_events: GameEventBus, _settings: () => Settings) {}
  unlock(): void {}
  update(_dt: number, _camera: PerspectiveCamera, _player: PlayerSystem, _weather: WeatherSystem, _sky: SkySystem): void {}
  applySettings(_s: Settings): void {}
  setIntensity(_v: number): void {}
}
