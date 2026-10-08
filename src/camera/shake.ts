// Camera shake. Impacts add "trauma" (0..1) that decays linearly; the visible shake is
// trauma², so small knocks are subtle and big hits are violent. Motion comes from smooth
// simplex noise (not random jitter), which reads as a heavy body being jolted rather than a
// vibrating screen. Two continuous sources sit on top: high-speed buffeting and stall wobble.

import { clamp01, DEG } from '../core/math';
import { noise2, type Noise2 } from '../core/noise';

export class Trauma {
  value = 0;
  /** Trauma lost per second; 1.1 means a full-strength hit settles in ~0.9 s. */
  constructor(public decay = 1.1) {}

  add(amount: number): void {
    if (amount > 0) this.value = clamp01(this.value + amount);
  }

  update(dt: number): void {
    this.value = Math.max(0, this.value - this.decay * dt);
  }

  /** What the camera actually shows: quadratic, so it falls off smoothly. */
  get intensity(): number {
    return this.value * this.value;
  }

  reset(): void {
    this.value = 0;
  }
}

/** Camera-local offsets: rotations in radians, translations in meters. */
export interface ShakeOffsets {
  yaw: number;
  pitch: number;
  roll: number;
  x: number;
  y: number;
}

export const SHAKE_MAX = {
  yaw: 2.4 * DEG,
  pitch: 2.8 * DEG,
  roll: 4 * DEG,
  pos: 0.22,
  /** Impact shake frequency (noise units per second). Low enough to feel weighty. */
  freq: 11,
  /** High-speed buffet. */
  buffetRot: 0.35 * DEG,
  buffetFreq: 17,
  /** Stall wobble: a slow, sickly roll and pitch. */
  wobbleRoll: 2.2 * DEG,
  wobblePitch: 1.3 * DEG,
  wobbleFreq: 1.3,
};

export class CameraShake {
  readonly trauma = new Trauma();
  /** 0..1 continuous high-speed buffeting, set each frame. */
  buffet = 0;
  /** 0..1 continuous stall wobble, set each frame. */
  wobble = 0;
  private t = 0;
  private n: Noise2;

  constructor(seed = 9181) {
    this.n = noise2(seed);
  }

  add(amount: number): void {
    this.trauma.add(amount);
  }

  update(dt: number, out: ShakeOffsets): ShakeOffsets {
    this.t += dt;
    this.trauma.update(dt);
    const n = this.n;
    const t = this.t;
    const i = this.trauma.intensity;
    const m = SHAKE_MAX;
    const ft = t * m.freq;
    out.yaw = m.yaw * i * n(ft, 11.3);
    out.pitch = m.pitch * i * n(ft, 23.7);
    out.roll = m.roll * i * n(ft, 37.1);
    out.x = m.pos * i * n(ft, 51.9);
    out.y = m.pos * i * n(ft, 67.5);

    if (this.buffet > 0) {
      const b = this.buffet * this.buffet;
      const bt = t * m.buffetFreq;
      out.yaw += m.buffetRot * b * n(bt, 81.1);
      out.pitch += m.buffetRot * b * (0.7 * n(bt, 93.3) + 0.3 * n(t * 3, 97.7));
      out.roll += m.buffetRot * 1.4 * b * n(bt, 105.9);
    }
    if (this.wobble > 0) {
      const w = this.wobble;
      const wt = t * m.wobbleFreq;
      out.roll += m.wobbleRoll * w * n(wt, 121.3);
      out.pitch += m.wobblePitch * w * n(wt, 133.9);
    }
    return out;
  }
}
