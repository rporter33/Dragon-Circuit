// Ghost runs: the player's best run recorded at 30 Hz into one packed Float32Array and replayed
// with interpolation. Pure (no rendering) so packing and sampling are unit-tested.
//
// Sample layout (GHOST_STRIDE floats): x, y, z, qx, qy, qz, qw, flapPhase, flapStrength,
// wingSpread, flare. Sample k is the pose k / rate seconds after the start gate.

import { Quaternion, Vector3 } from 'three';
import type { BreedId, RiderLook, WyvernLook } from '../core/types';
import type { GhostRecording } from '../game/contracts';
import { GHOST_STRIDE } from '../progression/save';

export { GHOST_STRIDE };
export const GHOST_RATE = 30;

/** One decoded ghost pose. */
export interface GhostSample {
  position: Vector3;
  orientation: Quaternion;
  /** World velocity (finite difference of neighbouring samples). */
  velocity: Vector3;
  flapPhase: number;
  flapStrength: number;
  wingSpread: number;
  flare: number;
}

export function createGhostSample(): GhostSample {
  return {
    position: new Vector3(),
    orientation: new Quaternion(),
    velocity: new Vector3(),
    flapPhase: 0,
    flapStrength: 0,
    wingSpread: 1,
    flare: 0,
  };
}

/** Records samples into a growable buffer without allocating per sample. */
export class GhostRecorder {
  private buf: Float32Array;
  private n = 0;

  constructor(initialSeconds = 180) {
    this.buf = new Float32Array(Math.ceil(initialSeconds * GHOST_RATE) * GHOST_STRIDE);
  }

  get count(): number {
    return this.n;
  }

  reset(): void {
    this.n = 0;
  }

  push(position: Vector3, orientation: Quaternion, flapPhase: number, flapStrength: number, wingSpread: number, flare: number): void {
    const need = (this.n + 1) * GHOST_STRIDE;
    if (need > this.buf.length) {
      const grown = new Float32Array(this.buf.length * 2);
      grown.set(this.buf);
      this.buf = grown;
    }
    const b = this.buf;
    const o = this.n * GHOST_STRIDE;
    b[o] = position.x;
    b[o + 1] = position.y;
    b[o + 2] = position.z;
    b[o + 3] = orientation.x;
    b[o + 4] = orientation.y;
    b[o + 5] = orientation.z;
    b[o + 6] = orientation.w;
    b[o + 7] = flapPhase;
    b[o + 8] = flapStrength;
    b[o + 9] = wingSpread;
    b[o + 10] = flare;
    this.n++;
  }

  /** A self-contained recording (the samples are copied, so the recorder can be reused). */
  finish(meta: { raceId: string; breed: BreedId; look: WyvernLook; rider: RiderLook; timeMs: number; splits?: number[] }): GhostRecording {
    return {
      raceId: meta.raceId,
      breed: meta.breed,
      look: { ...meta.look },
      rider: { ...meta.rider },
      timeMs: meta.timeMs,
      rate: GHOST_RATE,
      samples: this.buf.slice(0, this.n * GHOST_STRIDE),
      splits: meta.splits ? meta.splits.slice() : undefined,
    };
  }
}

export function ghostSampleCount(g: GhostRecording): number {
  return Math.floor(g.samples.length / GHOST_STRIDE);
}

/** Seconds covered by the recording. */
export function ghostDuration(g: GhostRecording): number {
  return Math.max(0, ghostSampleCount(g) - 1) / g.rate;
}

/** Decode sample i exactly (no interpolation). */
export function readGhostSample(g: GhostRecording, i: number, out: GhostSample): GhostSample {
  const s = g.samples;
  const o = i * GHOST_STRIDE;
  out.position.set(s[o], s[o + 1], s[o + 2]);
  out.orientation.set(s[o + 3], s[o + 4], s[o + 5], s[o + 6]);
  out.flapPhase = s[o + 7];
  out.flapStrength = s[o + 8];
  out.wingSpread = s[o + 9];
  out.flare = s[o + 10];
  return out;
}

const qa = new Quaternion();
const qb = new Quaternion();

/** Interpolate a phase in [0, 1) the short way round. */
export function lerpPhase(a: number, b: number, t: number): number {
  let d = b - a;
  if (d > 0.5) d -= 1;
  else if (d < -0.5) d += 1;
  let p = a + d * t;
  p -= Math.floor(p);
  return p;
}

/**
 * The ghost's pose `t` seconds after the start (clamped to the recording). Positions and scalar
 * channels are linear, orientation slerped, flap phase wrapped. Allocation-free.
 */
export function sampleGhost(g: GhostRecording, t: number, out: GhostSample): GhostSample {
  const n = ghostSampleCount(g);
  if (n === 0) return out;
  const f = Math.min(Math.max(t * g.rate, 0), n - 1);
  const i = Math.min(Math.floor(f), Math.max(0, n - 2));
  const u = n > 1 ? f - i : 0;
  const s = g.samples;
  const a = i * GHOST_STRIDE;
  const b = Math.min(i + 1, n - 1) * GHOST_STRIDE;
  const mix = (k: number) => s[a + k] + (s[b + k] - s[a + k]) * u;
  out.position.set(mix(0), mix(1), mix(2));
  qa.set(s[a + 3], s[a + 4], s[a + 5], s[a + 6]);
  qb.set(s[b + 3], s[b + 4], s[b + 5], s[b + 6]);
  out.orientation.slerpQuaternions(qa, qb, u).normalize();
  out.velocity.set(s[b] - s[a], s[b + 1] - s[a + 1], s[b + 2] - s[a + 2]).multiplyScalar(g.rate);
  out.flapPhase = lerpPhase(s[a + 7], s[b + 7], u);
  out.flapStrength = mix(8);
  out.wingSpread = mix(9);
  out.flare = mix(10);
  return out;
}
