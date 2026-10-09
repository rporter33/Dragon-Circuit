// One-shot synth voices. Every sound in Driftwing is built here from oscillators, filtered noise
// and envelopes — nothing is downloaded. Each voice schedules its nodes at time `t` on the
// engine's context and connects into `out` (usually an engine.strip()); the browser frees the
// nodes once the sources stop.
//
// Level convention: a voice at gain 1 peaks around 0.5 before the bus, leaving the limiter
// headroom when several overlap.

import type { SurfaceKind } from '../core/types';
import type { AudioEngine } from './engine';
import type { NoiseColor } from './dsp';
import { midiToHz } from './notes';
import { touchdownWeight, wingbeatParams } from './mix';

const EPS = 0.0001;

// ---------------------------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------------------------

/** Attack to `peak`, then exponential decay. Returns the time the envelope is silent. */
function envAD(p: AudioParam, t: number, attack: number, peak: number, decay: number): number {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.exponentialRampToValueAtTime(EPS, t + attack + decay);
  p.setValueAtTime(0, t + attack + decay + 0.005);
  return t + attack + decay + 0.01;
}

/** A sine/triangle/... tone with an AD envelope and an optional pitch glide to `freqEnd`. */
function tone(
  e: AudioEngine,
  out: AudioNode,
  type: OscillatorType,
  freq: number,
  t: number,
  attack: number,
  peak: number,
  decay: number,
  freqEnd?: number,
  glide?: number,
  detune = 0,
): void {
  const ctx = e.ctx;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freqEnd !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + (glide ?? decay));
  o.detune.value = detune;
  const g = ctx.createGain();
  const end = envAD(g.gain, t, attack, peak, decay);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(end);
}

/** Filtered noise burst. `freqEnd` sweeps the filter over the decay. */
function noiseBurst(
  e: AudioEngine,
  out: AudioNode,
  color: NoiseColor,
  t: number,
  attack: number,
  peak: number,
  decay: number,
  filter: BiquadFilterType,
  freq: number,
  q = 0.8,
  freqEnd?: number,
): BiquadFilterNode {
  const ctx = e.ctx;
  const src = e.noiseSource(color, false);
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (freqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + attack + decay);
  const g = ctx.createGain();
  const end = envAD(g.gain, t, attack, peak, decay);
  src.connect(f).connect(g).connect(out);
  e.startNoise(src, t, end - t + 0.02);
  return f;
}

/** Several tiny noise grains (crunch, gravel, rustle) scattered over `spread` seconds. */
function grains(e: AudioEngine, out: AudioNode, t: number, count: number, spread: number, peak: number, freq: number, q: number, grainLen = 0.02): void {
  const ctx = e.ctx;
  const src = e.noiseSource('white', false);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  // Grains in time order so the automation timeline stays monotonic.
  let tt = t;
  const step = spread / Math.max(1, count);
  for (let i = 0; i < count; i++) {
    tt += step * (0.4 + 1.2 * e.rand());
    const a = peak * (0.45 + 0.55 * e.rand());
    const len = grainLen * (0.6 + 0.8 * e.rand());
    g.gain.setValueAtTime(0, tt);
    g.gain.linearRampToValueAtTime(a, tt + 0.002);
    g.gain.exponentialRampToValueAtTime(EPS, tt + 0.002 + len);
    g.gain.setValueAtTime(0, tt + 0.003 + len);
  }
  src.connect(f).connect(g).connect(out);
  e.startNoise(src, t, tt - t + 0.1);
}

const jitter = (e: AudioEngine, amount: number) => 1 + (e.rand() - 0.5) * 2 * amount;

// ---------------------------------------------------------------------------------------------
// Flight
// ---------------------------------------------------------------------------------------------

/**
 * A wingbeat: the deep whump of air pushed down, a swoosh as the membrane sweeps, and a small
 * snap as it catches. Heavier breeds beat lower, longer and louder.
 */
export function wingbeat(e: AudioEngine, out: AudioNode, t: number, strength: number, mass: number): void {
  const p = wingbeatParams(strength, mass);
  const pitch = p.pitch * jitter(e, 0.05);
  const L = p.length;
  const G = p.gain;
  // Body: broadband air, lowpassed, closing as the stroke ends.
  noiseBurst(e, out, 'pink', t, 0.03, 0.55 * G, 0.34 * L, 'lowpass', 900 * pitch, 0.7, 260 * pitch);
  // Swoosh: a band sweeping up as the wing accelerates and back down as it slows.
  const f = noiseBurst(e, out, 'pink', t - 0.01, 0.06, 0.32 * G, 0.36 * L, 'bandpass', 380 * pitch, 1.1);
  f.frequency.exponentialRampToValueAtTime(1100 * pitch, t + 0.06);
  f.frequency.exponentialRampToValueAtTime(300 * pitch, t + 0.4 * L);
  // The deep thump felt in the chest.
  tone(e, out, 'sine', 88 * pitch, t, 0.008, 0.7 * G, 0.3 * L, 38 * pitch, 0.16 * L);
  // Membrane snap.
  noiseBurst(e, out, 'white', t + 0.012, 0.002, 0.09 * G * (0.4 + 0.6 * strength), 0.045, 'bandpass', 1700 * pitch, 1.3);
}

/** A tired wyvern refusing to beat: a huff of breath and a weak half-stroke rustle. */
export function huff(e: AudioEngine, out: AudioNode, t: number, mass: number): void {
  const pitch = wingbeatParams(0.3, mass).pitch * jitter(e, 0.06);
  noiseBurst(e, out, 'pink', t, 0.07, 0.22, 0.42, 'bandpass', 560 * pitch, 1.4, 380 * pitch);
  const ctx = e.ctx;
  // A low throaty growl under the breath.
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 280;
  lp.connect(out);
  tone(e, lp, 'sawtooth', 64 * pitch, t + 0.02, 0.06, 0.09, 0.32, 52 * pitch);
  noiseBurst(e, out, 'pink', t + 0.12, 0.05, 0.08, 0.2, 'bandpass', 700 * pitch, 0.9);
}

/** A sweep of moving air: wing folds, unfolds, falls, catches. */
export function whoosh(e: AudioEngine, out: AudioNode, t: number, dur: number, gain: number, f0: number, f1: number, q = 0.9): void {
  const f = noiseBurst(e, out, 'pink', t, dur * 0.35, gain * 0.5, dur * 0.65, 'bandpass', f0, q);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
}

/** Hitting terrain: a thump, rock crunch and a scrape tail, all scaled by `w` (0..1). */
export function impact(e: AudioEngine, out: AudioNode, t: number, w: number): void {
  const k = Math.max(0.05, Math.min(1, w));
  tone(e, out, 'sine', 78 * jitter(e, 0.08), t, 0.004, 0.75 * k, 0.4 + 0.2 * k, 32, 0.25);
  noiseBurst(e, out, 'brown', t, 0.008, 0.6 * k, 0.45 + 0.5 * k, 'lowpass', 420, 0.7, 160);
  grains(e, out, t, 4 + Math.round(10 * k), 0.12 + 0.3 * k, 0.32 * k, 1500 * jitter(e, 0.15), 0.9, 0.03);
  whoosh(e, out, t + 0.02, 0.25 + 0.6 * k, 0.35 * k, 1100, 420, 1.2);
}

/** Touchdown: the weight landing, a surface-colored step and the wings settling. */
export function touchdown(e: AudioEngine, out: AudioNode, t: number, impactSpeed: number, surface: SurfaceKind, mass: number): void {
  const w = touchdownWeight(impactSpeed);
  const m = Math.sqrt(Math.max(200, mass) / 650);
  tone(e, out, 'sine', 84 / Math.pow(m, 0.3), t, 0.005, 0.8 * w * Math.min(1.3, m), 0.36, 36, 0.2);
  const cutoff = surface === 'stone' ? 1500 : surface === 'wood' ? 900 : surface === 'sand' ? 1100 : surface === 'grass' ? 750 : 550;
  noiseBurst(e, out, 'pink', t, 0.006, 0.42 * w, 0.28, 'lowpass', cutoff, 0.6, cutoff * 0.4);
  footstep(e, out, t + 0.01, surface, true, mass, 0.8 + 0.4 * w);
  footstep(e, out, t + 0.07 + 0.03 * e.rand(), surface, true, mass, 0.5 + 0.3 * w);
  // Wings fold in.
  whoosh(e, out, t + 0.12, 0.3, 0.12, 1300, 600, 1.1);
}

// ---------------------------------------------------------------------------------------------
// Feet
// ---------------------------------------------------------------------------------------------

/**
 * One footstep on a surface. `heavy` is a wyvern foot: a low thump under a coarser, lower
 * version of the texture, scaled by mass.
 */
export function footstep(e: AudioEngine, out: AudioNode, t: number, surface: SurfaceKind, heavy: boolean, mass: number, gain = 1): void {
  const j = jitter(e, 0.08);
  const g = gain * jitter(e, 0.15);
  const h = heavy ? 0.6 : 1; // heavy feet push textures lower
  if (heavy) {
    const m = Math.min(1.5, Math.sqrt(Math.max(200, mass) / 650));
    tone(e, out, 'sine', (66 / m) * j, t, 0.004, 0.42 * g * m, 0.22, 34, 0.12);
  }
  switch (surface) {
    case 'grass':
      noiseBurst(e, out, 'white', t, 0.012, 0.11 * g, heavy ? 0.16 : 0.08, 'bandpass', 3800 * h * j, 0.6, 2400 * h);
      noiseBurst(e, out, 'white', t + 0.03, 0.01, 0.05 * g, 0.06, 'highpass', 4500 * h * j, 0.5);
      noiseBurst(e, out, 'pink', t, 0.004, 0.08 * g, 0.05, 'lowpass', 500, 0.5);
      break;
    case 'stone':
      noiseBurst(e, out, 'white', t, 0.001, 0.2 * g, 0.022, 'bandpass', 2800 * h * j, 1.8);
      tone(e, out, 'sine', 2100 * h * j, t, 0.001, 0.035 * g, 0.04);
      if (heavy) grains(e, out, t + 0.01, 4, 0.08, 0.1 * g, 1800, 1.2, 0.015);
      break;
    case 'wood':
      tone(e, out, 'sine', 205 * h * j, t, 0.002, 0.2 * g, 0.1, 190 * h);
      tone(e, out, 'triangle', 470 * h * j, t, 0.001, 0.08 * g, 0.05);
      noiseBurst(e, out, 'white', t, 0.001, 0.09 * g, 0.014, 'bandpass', 1500 * h, 1.4);
      if (heavy) tone(e, out, 'sine', 120 * j, t + 0.004, 0.003, 0.18 * g, 0.18, 105);
      break;
    case 'rock':
      grains(e, out, t, heavy ? 7 : 4, heavy ? 0.09 : 0.05, 0.22 * g, 1900 * h * j, 1.0, 0.016);
      noiseBurst(e, out, 'pink', t, 0.003, 0.08 * g, 0.05, 'lowpass', 700, 0.5);
      break;
    case 'sand':
      noiseBurst(e, out, 'white', t, 0.018, 0.1 * g, heavy ? 0.2 : 0.12, 'bandpass', 2600 * h * j, 0.5, 1600 * h);
      noiseBurst(e, out, 'pink', t, 0.005, 0.07 * g, 0.06, 'lowpass', 400, 0.5);
      break;
    case 'dirt':
    default:
      noiseBurst(e, out, 'pink', t, 0.004, 0.2 * g, heavy ? 0.12 : 0.07, 'lowpass', 650 * h * j, 0.6, 300);
      tone(e, out, 'sine', 115 * h * j, t, 0.003, 0.08 * g, 0.05);
      grains(e, out, t + 0.005, 2, 0.03, 0.05 * g, 2200, 1.0, 0.01);
      break;
  }
}

/** Saddle leather and cloth: mounting, dismounting. */
export function rustle(e: AudioEngine, out: AudioNode, t: number, gain: number): void {
  grains(e, out, t, 7, 0.3, 0.08 * gain, 2000 * jitter(e, 0.1), 0.8, 0.04);
  noiseBurst(e, out, 'pink', t + 0.05, 0.08, 0.06 * gain, 0.22, 'bandpass', 1300, 1.0);
  // Leather creak: a buzzy low tone through a narrow band.
  const bp = e.ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 520;
  bp.Q.value = 3;
  bp.connect(out);
  tone(e, bp, 'sawtooth', 92 * jitter(e, 0.1), t + 0.12, 0.04, 0.12 * gain, 0.12, 80);
}

// ---------------------------------------------------------------------------------------------
// Tones: chimes, bells, sparkles, stings
// ---------------------------------------------------------------------------------------------

const CHIME_PARTIALS = [1, 2.0, 3.01, 4.07, 5.2];
const CHIME_AMPS = [1, 0.42, 0.2, 0.1, 0.05];
const CHIME_DECAYS = [2.2, 1.3, 0.7, 0.45, 0.3];

/** A glassy bell chime (ring passes, arpeggios, countdown). */
export function chime(e: AudioEngine, out: AudioNode, t: number, midi: number, vel: number, length = 1): void {
  const f = midiToHz(midi);
  for (let i = 0; i < CHIME_PARTIALS.length; i++) {
    const pf = f * CHIME_PARTIALS[i];
    if (pf > 16000) break;
    tone(e, out, 'sine', pf, t, i === 0 ? 0.004 : 0.002, 0.16 * vel * CHIME_AMPS[i], CHIME_DECAYS[i] * length);
  }
  noiseBurst(e, out, 'white', t, 0.001, 0.025 * vel, 0.012, 'highpass', 5000, 0.7);
}

/**
 * Rising air under the wings: two soft chimes a fifth apart, the higher one answering, over a
 * breath of air that sweeps upward. `vel` 0..1 (stronger lift rings a little brighter).
 */
export function thermalChime(e: AudioEngine, out: AudioNode, t: number, notes: readonly [number, number], vel: number): void {
  chime(e, out, t, notes[0], 0.34 * vel, 1.3);
  chime(e, out, t + 0.17, notes[1], 0.28 * vel, 1.7);
  whoosh(e, out, t, 1.1, 0.05 * vel, 420, 1500, 0.7);
}

const BELL_RATIOS = [0.5, 1, 1.2, 1.5, 2, 2.52, 3, 4.2];
const BELL_AMPS = [0.55, 1, 0.45, 0.25, 0.45, 0.14, 0.18, 0.07];
const BELL_DECAYS = [6.5, 4.8, 3.2, 2.6, 2.4, 1.6, 1.2, 0.8];

/** A deep bronze bell (relic found): hum, prime, minor-third tierce, and a slow beat. */
export function deepBell(e: AudioEngine, out: AudioNode, t: number, midi: number, vel: number): void {
  const f = midiToHz(midi);
  for (let i = 0; i < BELL_RATIOS.length; i++) {
    tone(e, out, 'sine', f * BELL_RATIOS[i], t, 0.003, 0.14 * vel * BELL_AMPS[i], BELL_DECAYS[i]);
  }
  // The prime's twin, 1.3 Hz apart: the slow shimmer of a big bell.
  tone(e, out, 'sine', f + 1.3, t, 0.003, 0.08 * vel, 4.2);
  noiseBurst(e, out, 'pink', t, 0.001, 0.12 * vel, 0.05, 'lowpass', 2400, 0.6);
}

/** A soft music-box pluck (generative melody). */
export function pluck(e: AudioEngine, out: AudioNode, t: number, midi: number, vel: number, dur: number): void {
  const ctx = e.ctx;
  const f = midiToHz(midi);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.6;
  lp.frequency.setValueAtTime(Math.min(7000, f * 5), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(200, f * 1.4), t + 0.35);
  lp.connect(out);
  const d = Math.max(0.5, Math.min(2.6, dur));
  tone(e, lp, 'triangle', f, t, 0.004, 0.2 * vel, d);
  tone(e, lp, 'sine', f * 2.002, t, 0.003, 0.05 * vel, d * 0.5);
  tone(e, out, 'sine', f * 4.01, t, 0.001, 0.012 * vel, 0.12);
}

/** Feather pickup: a quick cascade of tiny high pings and a shimmer. */
export function sparkle(e: AudioEngine, left: AudioNode, right: AudioNode, t: number, gain: number): void {
  const notes = [93, 96, 98, 100, 103, 105, 108];
  let tt = t;
  for (let i = 0; i < 7; i++) {
    const idx = Math.min(notes.length - 1, Math.max(0, i + Math.round((e.rand() - 0.5) * 2)));
    const out = i % 2 === 0 ? left : right;
    tone(e, out, 'sine', midiToHz(notes[idx]) * jitter(e, 0.004), tt, 0.002, 0.07 * gain, 0.22);
    tt += 0.04 + 0.025 * e.rand();
  }
  noiseBurst(e, left, 'white', t, 0.12, 0.025 * gain, 0.55, 'highpass', 7000, 0.6);
  noiseBurst(e, right, 'white', t + 0.03, 0.12, 0.025 * gain, 0.55, 'highpass', 7500, 0.6);
}

/** A warm swell under stings: detuned saws through a lowpass. */
export function swell(e: AudioEngine, out: AudioNode, t: number, notes: readonly number[], vel: number, dur: number, bright = 0.5): void {
  const ctx = e.ctx;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.5;
  lp.frequency.value = 450 + 1700 * bright;
  const g = ctx.createGain();
  const att = Math.min(dur * 0.45, 2.2);
  const rel = Math.min(dur * 0.5, 2.4);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + att);
  g.gain.setValueAtTime(vel, t + dur - rel);
  g.gain.linearRampToValueAtTime(0, t + dur);
  lp.connect(g).connect(out);
  const per = 0.045 / Math.sqrt(Math.max(1, notes.length));
  for (const n of notes) {
    const f = midiToHz(n);
    for (const [type, det, amp] of [['sawtooth', -7, 0.55], ['sawtooth', 6, 0.55], ['triangle', 0, 0.8]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = per * amp;
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }
}

/** Soft bass under a pad chord. */
export function bass(e: AudioEngine, out: AudioNode, t: number, midi: number, vel: number, dur: number): void {
  const ctx = e.ctx;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 240;
  lp.connect(out);
  const f = midiToHz(midi);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.16 * vel, t + 0.35);
  g.gain.exponentialRampToValueAtTime(EPS, t + dur);
  g.connect(lp);
  for (const [type, amp] of [['sine', 1], ['triangle', 0.25]] as const) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const og = ctx.createGain();
    og.gain.value = amp;
    o.connect(og).connect(g);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

// ---------------------------------------------------------------------------------------------
// Percussion (music intensity layer)
// ---------------------------------------------------------------------------------------------

/** A soft frame drum: pitched skin thump with a little hand slap. */
export function drum(e: AudioEngine, out: AudioNode, t: number, vel: number, dur: number): void {
  tone(e, out, 'sine', 116 * jitter(e, 0.02), t, 0.002, 0.5 * vel, Math.max(0.25, dur * 0.7), 55, 0.1);
  tone(e, out, 'sine', 186, t, 0.002, 0.08 * vel, 0.12, 150);
  noiseBurst(e, out, 'pink', t, 0.001, 0.12 * vel, 0.05, 'lowpass', 900, 0.6);
}

export function shaker(e: AudioEngine, out: AudioNode, t: number, vel: number): void {
  noiseBurst(e, out, 'white', t, 0.012, 0.12 * vel, 0.055, 'bandpass', 7800 * jitter(e, 0.05), 0.8);
}

/** A muted woodblock click on the backbeat. */
export function rim(e: AudioEngine, out: AudioNode, t: number, vel: number): void {
  tone(e, out, 'sine', 1040, t, 0.001, 0.12 * vel, 0.05);
  tone(e, out, 'sine', 1660, t, 0.001, 0.05 * vel, 0.03);
}

// ---------------------------------------------------------------------------------------------
// Weather and wildlife
// ---------------------------------------------------------------------------------------------

/** Distant thunder: a long, low rolling rumble with a few swells. */
export function thunder(e: AudioEngine, out: AudioNode, t: number, gain: number): void {
  const ctx = e.ctx;
  const src = e.noiseSource('brown', false);
  const lp1 = ctx.createBiquadFilter();
  lp1.type = 'lowpass';
  lp1.frequency.value = 170 + 80 * e.rand();
  const lp2 = ctx.createBiquadFilter();
  lp2.type = 'lowpass';
  lp2.frequency.value = 260;
  const g = ctx.createGain();
  const len = 5 + 3 * e.rand();
  g.gain.setValueAtTime(0, t);
  let tt = t + 0.4 + 0.6 * e.rand();
  g.gain.linearRampToValueAtTime(gain * (0.5 + 0.3 * e.rand()), tt);
  const rolls = 2 + Math.floor(e.rand() * 3);
  for (let i = 0; i < rolls; i++) {
    tt += 0.5 + 1.1 * e.rand();
    g.gain.linearRampToValueAtTime(gain * (0.25 + 0.75 * e.rand()), tt);
  }
  g.gain.exponentialRampToValueAtTime(EPS, Math.max(tt + 1.5, t + len));
  src.connect(lp1).connect(lp2).connect(g).connect(out);
  e.startNoise(src, t, Math.max(tt + 1.6, t + len) - t);
}

/** A short songbird phrase: one of a few chirp shapes, 2–6 notes. */
export function birdPhrase(e: AudioEngine, out: AudioNode, t: number, gain: number): void {
  const ctx = e.ctx;
  const kind = Math.floor(e.rand() * 3);
  const n = 2 + Math.floor(e.rand() * 5);
  const base = 2600 + 1600 * e.rand();
  let tt = t;
  for (let i = 0; i < n; i++) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    const g = ctx.createGain();
    let len: number;
    if (kind === 0) {
      // Rising "tweet".
      len = 0.07;
      o.frequency.setValueAtTime(base, tt);
      o.frequency.exponentialRampToValueAtTime(base * 1.6, tt + len);
    } else if (kind === 1) {
      // Falling "tseeu".
      len = 0.11;
      o.frequency.setValueAtTime(base * 1.7, tt);
      o.frequency.exponentialRampToValueAtTime(base * 0.95, tt + len);
    } else {
      // Trill: fast vibrato.
      len = 0.16;
      o.frequency.setValueAtTime(base * 1.2, tt);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 28 + 10 * e.rand();
      const depth = ctx.createGain();
      depth.gain.value = base * 0.12;
      lfo.connect(depth).connect(o.frequency);
      lfo.start(tt);
      lfo.stop(tt + len + 0.02);
    }
    g.gain.setValueAtTime(0, tt);
    g.gain.linearRampToValueAtTime(gain * (0.6 + 0.4 * e.rand()), tt + 0.012);
    g.gain.exponentialRampToValueAtTime(EPS, tt + len);
    g.gain.setValueAtTime(0, tt + len + 0.005);
    o.connect(g).connect(out);
    o.start(tt);
    o.stop(tt + len + 0.02);
    tt += len + 0.04 + 0.09 * e.rand();
  }
}

// ---------------------------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------------------------

export type UiKind = 'move' | 'select' | 'back' | 'locked' | 'tab';

export function uiSound(e: AudioEngine, out: AudioNode, t: number, kind: UiKind): void {
  switch (kind) {
    case 'move':
      tone(e, out, 'sine', 1250, t, 0.002, 0.1, 0.045);
      tone(e, out, 'triangle', 2500, t, 0.001, 0.02, 0.015);
      break;
    case 'select':
      tone(e, out, 'sine', 880, t, 0.002, 0.11, 0.07);
      tone(e, out, 'sine', 1320, t + 0.055, 0.002, 0.12, 0.16);
      break;
    case 'back':
      tone(e, out, 'sine', 1046, t, 0.002, 0.1, 0.06);
      tone(e, out, 'sine', 698, t + 0.05, 0.002, 0.1, 0.12);
      break;
    case 'locked': {
      const lp = e.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      lp.connect(out);
      tone(e, lp, 'triangle', 155, t, 0.004, 0.14, 0.16);
      tone(e, lp, 'triangle', 164, t, 0.004, 0.12, 0.16);
      break;
    }
    case 'tab':
      noiseBurst(e, out, 'white', t, 0.001, 0.05, 0.012, 'bandpass', 3000, 1.2);
      tone(e, out, 'sine', 1568, t, 0.002, 0.07, 0.05);
      break;
  }
}
