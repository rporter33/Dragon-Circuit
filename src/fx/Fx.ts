// Visual effects. (Baseline: none. The fx module owner implements speed lines, wingtip trails,
// flap bursts, landing dust, ring bursts, sparkles, fireflies, thermal motes and screen effects.)

import type { PerspectiveCamera, Scene } from 'three';
import type { FxSystem, PlayerSystem, WyvernRenderable } from '../game/contracts';
import type { GameEventBus } from '../core/events';
import type { QualityProfile } from '../render/quality';
import type { Renderer } from '../render/renderer';
import type { Settings } from '../core/types';
import type { WorldLayout } from '../world/layout';

export interface FxDeps {
  scene: Scene;
  renderer: Renderer;
  events: GameEventBus;
  quality: QualityProfile;
  settings: () => Settings;
  layout: WorldLayout;
}

export class Fx implements FxSystem {
  constructor(_deps: FxDeps) {}
  update(_dt: number, _camera: PerspectiveCamera, _player: PlayerSystem, _wyvern: WyvernRenderable): void {}
  setQuality(_q: QualityProfile): void {}
}
