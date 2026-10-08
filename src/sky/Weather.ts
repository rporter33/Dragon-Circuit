// Weather and the wind field. (Baseline: steady breeze + thermals + boundary push. The sky
// module owner adds weather states, gusts, ridge lift, rain and mist.)

import { Vector3, type PerspectiveCamera, type Scene } from 'three';
import type { WeatherKind } from '../core/types';
import type { WeatherSystem } from '../game/contracts';
import type { GameEventBus } from '../core/events';
import type { QualityProfile } from '../render/quality';
import type { WorldLayout } from '../world/layout';
import { smoothstep } from '../core/math';
import { globalUniforms } from '../render/uniforms';

export class Weather implements WeatherSystem {
  kind: WeatherKind = 'clear';
  wind = new Vector3(3, 0, 1.5);
  rain = 0;
  mist = 0;
  cloudCover = 0.3;
  private layout: WorldLayout;

  constructor(_scene: Scene, layout: WorldLayout, _events: GameEventBus, _quality: QualityProfile) {
    this.layout = layout;
  }

  set(kind: WeatherKind, _immediate = false): void {
    this.kind = kind;
  }

  windAt(p: Vector3, out: Vector3): Vector3 {
    out.copy(this.wind);
    for (const t of this.layout.thermals) {
      const d = Math.hypot(p.x - t.x, p.z - t.z);
      if (d > t.radius * 1.6) continue;
      const core = 1 - smoothstep(t.radius * 0.4, t.radius * 1.6, d);
      const vert = smoothstep(t.baseY, t.baseY + 40, p.y) * (1 - smoothstep(t.topY - 80, t.topY, p.y));
      out.y += t.strength * core * vert;
    }
    const r = Math.hypot(p.x, p.z);
    const over = smoothstep(this.layout.boundaryRadius - 200, this.layout.boundaryRadius + 200, r);
    if (over > 0) {
      out.x -= (p.x / r) * 30 * over;
      out.z -= (p.z / r) * 30 * over;
    }
    return out;
  }

  update(_dt: number, _camera: PerspectiveCamera, _focus: Vector3): void {
    globalUniforms.uWind.value.copy(this.wind);
  }
}
