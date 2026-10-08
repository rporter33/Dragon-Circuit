// Sample generation for the procedural audio: looping noise beds, the reverb's impulse response
// and the limiter's soft-clip curve. Pure Float32Array maths (seeded), so it is unit-tested and
// identical for the live context and an OfflineAudioContext check.

import { mulberry32 } from '../core/rng';

export type NoiseColor = 'white' | 'pink' | 'brown';

/** Fill with uniform white noise in [-1, 1). */
export function fillWhite(out: Float32Array, rand: () => number): Float32Array {
  for (let i = 0; i < out.length; i++) out[i] = rand() * 2 - 1;
  return out;
}

/** Pink (-3 dB/oct) noise, Paul Kellet's economy filter on white noise. */
export function fillPink(out: Float32Array, rand: () => number): Float32Array {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < out.length; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return out;
}

/** Brown (-6 dB/oct) noise: leaky integrated white noise. */
export function fillBrown(out: Float32Array, rand: () => number): Float32Array {
  let last = 0;
  for (let i = 0; i < out.length; i++) {
    const w = rand() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    out[i] = last;
  }
  return out;
}

/** Scale so the peak magnitude is `peak`. */
export function normalize(buf: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m > 1e-9) {
    const k = peak / m;
    for (let i = 0; i < buf.length; i++) buf[i] *= k;
  }
  return buf;
}

/** Remove any DC offset (brown noise drifts). */
export function removeDc(buf: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i];
  const mean = sum / Math.max(1, buf.length);
  for (let i = 0; i < buf.length; i++) buf[i] -= mean;
  return buf;
}

/**
 * Make a buffer loop seamlessly: the last `fade` samples crossfade (equal power) into a copy of
 * the first ones, and the buffer is shortened by `fade` so the seam is inaudible.
 */
export function loopable(buf: Float32Array, fade: number): Float32Array {
  const n = buf.length - fade;
  if (n <= fade) return buf;
  const out = buf.slice(0, n);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    const a = Math.cos((t * Math.PI) / 2);
    const b = Math.sin((t * Math.PI) / 2);
    // Tail of the original fades out while the head (which plays next) fades in.
    out[i] = buf[n + i] * a + buf[i] * b;
  }
  return out;
}

/** A seamless, normalized noise loop of `seconds` at `sampleRate`. */
export function noiseLoop(color: NoiseColor, sampleRate: number, seconds: number, seed: number): Float32Array {
  const fade = Math.floor(sampleRate * 0.08);
  const raw = new Float32Array(Math.floor(sampleRate * seconds) + fade);
  const rand = mulberry32(seed);
  if (color === 'white') fillWhite(raw, rand);
  else if (color === 'pink') fillPink(raw, rand);
  else fillBrown(raw, rand);
  removeDc(raw);
  return normalize(loopable(raw, fade), 0.9);
}

/**
 * A stereo reverb impulse: decorrelated noise under an exponential decay, a short pre-delay and
 * a darkening tail (a one-pole lowpass whose cutoff falls over time), like a soft open hall —
 * the "sky" rather than a room.
 */
export function reverbImpulse(sampleRate: number, seconds: number, seed: number): [Float32Array, Float32Array] {
  const len = Math.floor(sampleRate * seconds);
  const pre = Math.floor(sampleRate * 0.018);
  const chans: [Float32Array, Float32Array] = [new Float32Array(len), new Float32Array(len)];
  for (let c = 0; c < 2; c++) {
    const rand = mulberry32(seed + c * 7919);
    const ch = chans[c];
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sampleRate;
      const env = Math.exp((-6.9 * t) / seconds); // -60 dB at the end
      // Lowpass coefficient: bright early reflections, dull tail.
      const a = 0.85 - 0.75 * Math.min(1, t / seconds);
      lp += a * ((rand() * 2 - 1) - lp);
      ch[i] = lp * env;
    }
    // Ramp in over 4 ms so the onset is soft.
    const ramp = Math.floor(sampleRate * 0.004);
    for (let i = 0; i < ramp; i++) ch[pre + i] *= i / ramp;
  }
  // Same overall energy regardless of length or rate.
  let e = 0;
  for (const ch of chans) for (let i = 0; i < len; i++) e += ch[i] * ch[i];
  const k = 1 / Math.sqrt(Math.max(1e-9, e / 2));
  for (const ch of chans) for (let i = 0; i < len; i++) ch[i] *= k * 0.6;
  return chans;
}

/**
 * Soft-clip transfer curve for a WaveShaper: unity below `knee`, then a tanh shoulder that never
 * exceeds `ceiling`. Sits after the compressor as a last guard against clipping.
 */
export function softClipCurve(samples = 2048, knee = 0.75, ceiling = 0.98): Float32Array {
  const curve = new Float32Array(samples);
  const room = ceiling - knee;
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + room * Math.tanh((a - knee) / room);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

/** RMS and peak of a block of samples (used by the offline check and tests). */
export function levels(buf: Float32Array): { rms: number; peak: number; nan: boolean } {
  let s = 0;
  let p = 0;
  let nan = false;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    if (!Number.isFinite(v)) {
      nan = true;
      continue;
    }
    s += v * v;
    const a = Math.abs(v);
    if (a > p) p = a;
  }
  return { rms: Math.sqrt(s / Math.max(1, buf.length)), peak: p, nan };
}
