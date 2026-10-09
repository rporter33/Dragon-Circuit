// Continuous sound layers: they run for the whole session and are steered every frame by
// gliding their parameters (setTargetAtTime), never by restarting nodes.
//   WindLayer      — airspeed wind: body, rush, whistle, flare buffeting
//   StallLayer     — membrane flutter while stalled
//   AmbienceLayer  — daytime air, rain, waterfall roar, night crickets; schedules birdsong and
//                    distant thunder as one-shots

import type { AudioEngine } from './engine';
import type { AmbienceMix, WindMix } from './mix';
import { birdPhrase, thunder } from './voices';

/** Glide time constant (s) for per-frame parameter steering. */
const GLIDE = 0.07;

function glide(p: AudioParam, v: number, t: number, tc = GLIDE): void {
  p.setTargetAtTime(Number.isFinite(v) ? v : 0, t, tc);
}

function filter(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function gain(ctx: BaseAudioContext, v: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

// ---------------------------------------------------------------------------------------------

export class WindLayer {
  private bodyLp: BiquadFilterNode;
  private bodyGain: GainNode;
  private rushBp: BiquadFilterNode;
  private rushGain: GainNode;
  private whistle1: BiquadFilterNode;
  private whistle2: BiquadFilterNode;
  private whistleGain: GainNode;
  private buffet: GainNode;
  private buffetLfo: OscillatorNode;
  private buffetDepth: GainNode;

  constructor(private e: AudioEngine, t: number) {
    const ctx = e.ctx;
    const out = e.sfx.dry;
    this.buffet = gain(ctx, 1);
    this.buffet.connect(out);

    const pink = e.noiseSource('pink');
    this.bodyLp = filter(ctx, 'lowpass', 300, 0.5);
    this.bodyGain = gain(ctx, 0);
    pink.connect(this.bodyLp).connect(this.bodyGain).connect(this.buffet);

    const white = e.noiseSource('white');
    this.rushBp = filter(ctx, 'bandpass', 1200, 0.7);
    this.rushGain = gain(ctx, 0);
    white.connect(this.rushBp).connect(this.rushGain).connect(this.buffet);

    // Two narrow resonances a fifth-ish apart: the whistle of air over horns and saddle straps.
    this.whistle1 = filter(ctx, 'bandpass', 1200, 26);
    this.whistle2 = filter(ctx, 'bandpass', 1800, 30);
    this.whistleGain = gain(ctx, 0);
    const wsum = gain(ctx, 1);
    white.connect(this.whistle1).connect(wsum);
    white.connect(this.whistle2).connect(wsum);
    // Narrow bandpasses lose most of the energy; make it back up before the level control.
    wsum.gain.value = 9;
    wsum.connect(this.whistleGain).connect(out);

    // Buffeting: a tremolo on body + rush while flaring at speed.
    this.buffetLfo = ctx.createOscillator();
    this.buffetLfo.type = 'triangle';
    this.buffetLfo.frequency.value = 8;
    this.buffetDepth = gain(ctx, 0);
    this.buffetLfo.connect(this.buffetDepth).connect(this.buffet.gain);

    e.startNoise(pink, t);
    e.startNoise(white, t);
    this.buffetLfo.start(t);
  }

  /** Steer toward `m`. `gust` (≈0.7..1.3) modulates the level for a living, breathing wind. */
  apply(m: WindMix, gust: number, t: number): void {
    glide(this.bodyGain.gain, m.bodyGain * gust, t);
    glide(this.bodyLp.frequency, m.bodyCutoff * (0.9 + 0.1 * gust), t);
    glide(this.rushGain.gain, m.rushGain * gust, t);
    glide(this.rushBp.frequency, m.rushFreq, t);
    glide(this.whistleGain.gain, m.whistleGain, t, 0.15);
    // The whistle wanders a little with the gusts.
    glide(this.whistle1.frequency, m.whistleFreq * (0.97 + 0.06 * (gust - 0.7)), t, 0.2);
    glide(this.whistle2.frequency, m.whistleFreq * 1.52 * (0.98 + 0.04 * (gust - 0.7)), t, 0.2);
    // Tremolo around 1 - depth/2 so the average level holds.
    glide(this.buffet.gain, 1 - m.buffetDepth * 0.5, t);
    glide(this.buffetDepth.gain, m.buffetDepth * 0.5, t);
    glide(this.buffetLfo.frequency, m.buffetRate, t, 0.2);
  }
}

// ---------------------------------------------------------------------------------------------

/** The wing membranes luffing like a sail while stalled: band-limited noise chopped by a fast LFO. */
export class StallLayer {
  private bp: BiquadFilterNode;
  private gate: GainNode;
  private level: GainNode;
  private lfo: OscillatorNode;

  constructor(e: AudioEngine, t: number) {
    const ctx = e.ctx;
    const src = e.noiseSource('pink');
    this.bp = filter(ctx, 'bandpass', 520, 1.3);
    this.gate = gain(ctx, 0.5);
    this.level = gain(ctx, 0);
    src.connect(this.bp).connect(this.gate).connect(this.level).connect(e.sfx.dry);
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'square';
    this.lfo.frequency.value = 16;
    const depth = gain(ctx, 0.5);
    this.lfo.connect(depth).connect(this.gate.gain);
    e.startNoise(src, t);
    this.lfo.start(t);
  }

  /** `amount` 0..1 (0 = silent); `airspeed` sets the flutter rate. */
  apply(amount: number, airspeed: number, t: number): void {
    glide(this.level.gain, 0.5 * amount, t, amount > 0 ? 0.05 : 0.12);
    glide(this.lfo.frequency, 11 + 0.55 * Math.max(0, airspeed), t, 0.1);
    glide(this.bp.frequency, 420 + 12 * Math.max(0, airspeed), t, 0.1);
  }
}

// ---------------------------------------------------------------------------------------------

interface Cricket {
  osc: OscillatorNode;
  gate: GainNode;
  pan: StereoPannerNode;
  next: number;
  period: number;
}

export class AmbienceLayer {
  private airGain: GainNode;
  private rainGain: GainNode;
  private rainLowGain: GainNode;
  private fallGain: GainNode;
  private fallPan: StereoPannerNode;
  private cricketGain: GainNode;
  private crickets: Cricket[] = [];
  private birdOut: GainNode;
  private birdPan: StereoPannerNode;
  private thunderPan: StereoPannerNode;
  private thunderOut: GainNode;
  private stormGain: GainNode;
  private lastMix: AmbienceMix | null = null;

  constructor(private e: AudioEngine, t: number) {
    const ctx = e.ctx;
    const dry = e.amb.dry;
    const wet = e.amb.wet;

    // Soft open-air bed.
    const brown = e.noiseSource('brown');
    this.airGain = gain(ctx, 0);
    brown.connect(filter(ctx, 'lowpass', 520, 0.5)).connect(this.airGain).connect(dry);

    // Rain: a bright hiss plus a low patter rumble.
    const white = e.noiseSource('white');
    this.rainGain = gain(ctx, 0);
    white.connect(filter(ctx, 'highpass', 1100, 0.5)).connect(filter(ctx, 'lowpass', 7500, 0.5)).connect(this.rainGain).connect(dry);
    const pink = e.noiseSource('pink');
    this.rainLowGain = gain(ctx, 0);
    pink.connect(filter(ctx, 'lowpass', 480, 0.5)).connect(this.rainLowGain).connect(dry);

    // Waterfall roar: pink noise with a body peak, and brown for the deep thunder of the drop.
    this.fallGain = gain(ctx, 0);
    this.fallPan = ctx.createStereoPanner();
    const fallPink = e.noiseSource('pink');
    const peak = filter(ctx, 'peaking', 320, 0.8);
    peak.gain.value = 6;
    fallPink.connect(filter(ctx, 'lowpass', 1800, 0.5)).connect(peak).connect(this.fallGain);
    const fallBrown = e.noiseSource('brown');
    const fb = gain(ctx, 0.9);
    fallBrown.connect(filter(ctx, 'lowpass', 200, 0.5)).connect(fb).connect(this.fallGain);
    this.fallGain.connect(this.fallPan).connect(dry);
    this.fallPan.connect(gain(ctx, 0.25)).connect(wet);

    // Crickets: three voices, pure tones gated into chirps.
    this.cricketGain = gain(ctx, 0);
    this.cricketGain.connect(dry);
    this.cricketGain.connect(gain(ctx, 0.3)).connect(wet);
    const freqs = [4300, 4650, 4050];
    const pans = [-0.55, 0.45, 0.05];
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freqs[i];
      const g = gain(ctx, 0);
      const p = ctx.createStereoPanner();
      p.pan.value = pans[i];
      osc.connect(g).connect(p).connect(this.cricketGain);
      osc.start(t);
      this.crickets.push({ osc, gate: g, pan: p, next: t + 0.3 * i, period: 0.55 + 0.25 * e.rand() });
    }

    this.birdOut = gain(ctx, 1);
    this.birdPan = ctx.createStereoPanner();
    this.birdOut.connect(this.birdPan).connect(dry);
    this.birdPan.connect(gain(ctx, 0.35)).connect(wet);
    this.thunderOut = gain(ctx, 1);
    this.thunderPan = ctx.createStereoPanner();
    this.thunderOut.connect(this.thunderPan).connect(dry);
    this.thunderPan.connect(gain(ctx, 0.5)).connect(wet);

    // Edge storm: a low roar that surges slowly, under a howl whose pitch wanders, so the wall
    // of weather sounds alive rather than like a fan. Silent (gain 0) inside the archipelago.
    this.stormGain = gain(ctx, 0);
    this.stormGain.connect(dry);
    this.stormGain.connect(gain(ctx, 0.35)).connect(wet);
    const stormBrown = e.noiseSource('brown');
    const surge = gain(ctx, 0.75);
    stormBrown.connect(filter(ctx, 'lowpass', 240, 0.6)).connect(surge).connect(this.stormGain);
    const stormPink = e.noiseSource('pink');
    const howlBp = filter(ctx, 'bandpass', 430, 2.2);
    const howl = gain(ctx, 0.55);
    stormPink.connect(howlBp).connect(howl).connect(this.stormGain);
    const lfo = (freq: number, depth: number, target: AudioParam) => {
      const o = ctx.createOscillator();
      o.frequency.value = freq;
      const d = gain(ctx, depth);
      o.connect(d).connect(target);
      o.start(t);
    };
    lfo(0.11, 150, howlBp.frequency);
    lfo(0.047, 70, howlBp.frequency);
    lfo(0.23, 0.3, surge.gain);
    lfo(0.17, 0.25, howl.gain);

    for (const s of [brown, white, pink, fallPink, fallBrown, stormBrown, stormPink]) e.startNoise(s, t);
  }

  /**
   * Steer the beds and schedule chirps/birds/thunder for the next `lookahead` seconds.
   * `fallGain` and `fallPan` place the loudest waterfall.
   */
  apply(m: AmbienceMix, fallGain: number, fallPan: number, t: number, dt: number, lookahead = 0.3): void {
    this.lastMix = m;
    const e = this.e;
    glide(this.airGain.gain, m.air, t, 0.4);
    glide(this.rainGain.gain, m.rainHiss, t, 0.5);
    glide(this.rainLowGain.gain, m.rainHiss * 0.8, t, 0.5);
    glide(this.fallGain.gain, 0.22 * fallGain, t, 0.25);
    glide(this.fallPan.pan, fallPan, t, 0.25);
    glide(this.cricketGain.gain, m.crickets, t, 0.8);
    glide(this.stormGain.gain, m.storm, t, 0.6);

    // Cricket chirps, scheduled just ahead of the clock.
    for (const c of this.crickets) {
      if (m.crickets < 0.002) {
        c.next = Math.max(c.next, t + 0.1);
        continue;
      }
      if (c.next < t) c.next = t + 0.02;
      while (c.next < t + lookahead) {
        const pulses = 3 + (e.rand() < 0.3 ? 1 : 0);
        let p = c.next;
        for (let i = 0; i < pulses; i++) {
          c.gate.gain.setValueAtTime(0, p);
          c.gate.gain.linearRampToValueAtTime(1, p + 0.004);
          c.gate.gain.setValueAtTime(1, p + 0.015);
          c.gate.gain.linearRampToValueAtTime(0, p + 0.021);
          p += 0.038;
        }
        // Mostly steady rhythm, with the occasional rest.
        c.next += e.rand() < 0.08 ? 1.5 + 3 * e.rand() : c.period * (0.92 + 0.16 * e.rand());
      }
    }

    // Birdsong and thunder: Poisson-ish one-shots.
    if (m.birds > 0.01 && e.rand() < dt * 0.22 * m.birds) {
      this.birdPan.pan.setValueAtTime((e.rand() - 0.5) * 1.4, t + 0.04);
      birdPhrase(e, this.birdOut, t + 0.05, 0.035 * (0.5 + 0.5 * m.birds));
    }
    if (m.thunder > 0.01 && e.rand() < dt * 0.035 * m.thunder) {
      this.thunderPan.pan.setValueAtTime((e.rand() - 0.5) * 1.2, t + 0.04);
      thunder(e, this.thunderOut, t + 0.05, 0.55 * (0.5 + 0.5 * e.rand()));
    }
  }

  get mix(): AmbienceMix | null {
    return this.lastMix;
  }
}
