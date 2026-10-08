// Renders the generative score (sequencer.ts) through the synth voices on the music bus.

import type { AudioEngine } from './engine';
import { moodFor, MusicSequencer, type MusicEvent } from './sequencer';
import { bass, chime, drum, pluck, rim, shaker, swell } from './voices';

/** How far ahead of the audio clock events are scheduled (s). */
const LOOKAHEAD = 0.35;

export class MusicPlayer {
  readonly sequencer: MusicSequencer;
  private events: MusicEvent[] = [];
  /** Level of the whole percussion layer, glided per event from the requested intensity. */
  private percLevel = 0;

  constructor(private e: AudioEngine, seed = 7) {
    this.sequencer = new MusicSequencer(seed);
  }

  /** Steer the mood by time of day and the percussion by intensity, then schedule ahead. */
  update(timeOfDay: number, intensity: number): void {
    const s = this.sequencer;
    s.setMood(moodFor(timeOfDay));
    s.setIntensity(intensity);
    this.percLevel = intensity;
    const now = this.e.now;
    this.events.length = 0;
    s.schedule(now + 0.05, now + LOOKAHEAD, this.events);
    for (const ev of this.events) this.play(ev);
  }

  /** Schedule everything in [from, to) at once (offline rendering). */
  renderSpan(from: number, to: number, timeOfDay: number, intensity: number): number {
    const s = this.sequencer;
    s.setMood(moodFor(timeOfDay));
    s.setIntensity(intensity);
    this.events.length = 0;
    s.schedule(from, to, this.events);
    for (const ev of this.events) this.play(ev);
    return this.events.length;
  }

  private play(ev: MusicEvent): void {
    const e = this.e;
    const bus = e.music;
    const t = Math.max(ev.time, e.now + 0.005);
    switch (ev.kind) {
      case 'pad':
        swell(e, e.strip(bus, 1, 0, 0.55), t, ev.notes, 0.55 * ev.vel, ev.dur, ev.bright ?? 0.5);
        break;
      case 'bass':
        bass(e, e.strip(bus, 1, 0, 0.1), t, ev.notes[0], ev.vel, ev.dur);
        break;
      case 'pluck':
        pluck(e, e.strip(bus, 0.9, (e.rand() - 0.5) * 0.7, 0.45), t, ev.notes[0], ev.vel, ev.dur);
        break;
      case 'bell':
        chime(e, e.strip(bus, 0.35, (e.rand() - 0.5) * 0.9, 0.75), t, ev.notes[0], ev.vel, 2.2);
        break;
      case 'drum':
        drum(e, e.strip(bus, 1.1 * this.percLevel, 0, 0.12), t, ev.vel, ev.dur);
        break;
      case 'shaker':
        shaker(e, e.strip(bus, 0.9 * this.percLevel, 0.25, 0.08), t, ev.vel);
        break;
      case 'rim':
        rim(e, e.strip(bus, 0.9 * this.percLevel, -0.2, 0.2), t, ev.vel);
        break;
    }
  }
}
