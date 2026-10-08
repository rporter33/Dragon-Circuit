// The generative score: decides WHAT plays and WHEN, as plain events on the audio clock. The
// MusicPlayer turns events into sound. Pure and seeded, so the musical rules are unit-tested.
//
// Shape of the music:
//   - slow pad chords (a two-bar progression step), a soft bass note under each,
//   - sparse plucked pentatonic phrases with long rests between them,
//   - at night, the occasional high bell like a star coming out,
//   - a percussive layer (frame drum, shaker, rim) whose density follows `intensity`; races
//     raise it, free flight leaves it silent.
// The mood (key, scale, tempo, brightness, density) follows the time of day and only changes on
// a chord boundary, so transitions are always musical.

import { clamp01 } from '../core/math';
import { Rng } from '../core/rng';
import { MAJOR_PENT, MINOR_PENT, mod, scaleNote, type Scale } from './notes';

export type MoodName = 'dawn' | 'day' | 'dusk' | 'night';

export interface Mood {
  name: MoodName;
  /** Pad/bass register root (MIDI). Melodies sit two octaves up. */
  root: number;
  scale: Scale;
  minor: boolean;
  /** Quarter notes per minute. */
  tempo: number;
  /** 0..1 pad filter brightness. */
  brightness: number;
  /** 0..1 chance a chord carries a melodic phrase. */
  density: number;
}

export const MOODS: Record<MoodName, Mood> = {
  dawn: { name: 'dawn', root: 50, scale: MAJOR_PENT, minor: false, tempo: 72, brightness: 0.5, density: 0.55 }, // D
  day: { name: 'day', root: 55, scale: MAJOR_PENT, minor: false, tempo: 80, brightness: 0.7, density: 0.6 }, // G
  dusk: { name: 'dusk', root: 57, scale: MINOR_PENT, minor: true, tempo: 70, brightness: 0.45, density: 0.5 }, // A minor
  night: { name: 'night', root: 52, scale: MINOR_PENT, minor: true, tempo: 62, brightness: 0.28, density: 0.38 }, // E minor
};

export function moodFor(timeOfDay: number): Mood {
  const t = mod(timeOfDay, 1);
  if (t < 0.21 || t >= 0.82) return MOODS.night;
  if (t < 0.31) return MOODS.dawn;
  if (t < 0.66) return MOODS.day;
  return MOODS.dusk;
}

/** Chords as semitone offsets from the key root, voiced for a warm pad. */
const MAJOR_CHORDS: Record<string, number[]> = {
  I: [0, 4, 7, 14],
  vi: [-3, 4, 7, 12],
  IV: [5, 9, 12, 16],
  ii: [2, 5, 9, 12],
  Vsus: [-5, 2, 7, 12],
};
const MINOR_CHORDS: Record<string, number[]> = {
  i: [0, 3, 7, 10],
  VI: [-4, 0, 3, 7],
  III: [3, 7, 10, 14],
  VII: [-2, 2, 5, 10],
  iv: [5, 8, 12, 15],
};
const MAJOR_PROGRESSIONS = [
  ['I', 'vi', 'IV', 'I'],
  ['I', 'IV', 'vi', 'Vsus'],
  ['IV', 'I', 'ii', 'I'],
  ['I', 'Vsus', 'vi', 'IV'],
];
const MINOR_PROGRESSIONS = [
  ['i', 'VI', 'III', 'VII'],
  ['i', 'iv', 'VI', 'i'],
  ['VI', 'VII', 'i', 'i'],
  ['i', 'III', 'iv', 'VI'],
];

export type MusicEventKind = 'pad' | 'bass' | 'pluck' | 'bell' | 'drum' | 'shaker' | 'rim';

export interface MusicEvent {
  kind: MusicEventKind;
  /** Audio-clock time (s). */
  time: number;
  /** MIDI notes (one for single voices, the chord for pads). */
  notes: number[];
  /** Seconds. */
  dur: number;
  /** 0..1 */
  vel: number;
  /** Pad brightness 0..1 (pads only). */
  bright?: number;
}

/** Eighth-note steps per chord (two bars of 4/4). */
export const STEPS_PER_CHORD = 16;

interface Phrase {
  /** Remaining notes. */
  left: number;
  /** Step index (within the sequencer) of the next note. */
  nextStep: number;
  /** Current scale degree (melody register). */
  degree: number;
}

export class MusicSequencer {
  private rng: Rng;
  private mood: Mood = MOODS.day;
  private pending: Mood = MOODS.day;
  private intensity = 0;
  private step = 0;
  private nextTime = 0;
  private started = false;
  private progression: string[] = MAJOR_PROGRESSIONS[0];
  private chordIdx = -1;
  private chord: number[] = MAJOR_CHORDS.I;
  private phrase: Phrase | null = null;
  /** Percussion variation for the current bar. */
  private barFill = 0;

  constructor(seed = 0x5eed) {
    this.rng = new Rng(seed);
  }

  get currentMood(): Mood {
    return this.mood;
  }

  /** Seconds per eighth-note step at the current tempo. */
  get stepSeconds(): number {
    return 30 / this.mood.tempo;
  }

  setMood(m: Mood): void {
    this.pending = m;
    if (!this.started) this.mood = m;
  }

  setIntensity(v: number): void {
    this.intensity = clamp01(v);
  }

  /**
   * Append every event whose time falls in [from, to) to `out`. Call each frame with a short
   * lookahead window; the first call starts the music at `from`. If the clock jumped far ahead
   * (tab suspended), the sequencer skips the gap instead of bursting out the backlog.
   */
  schedule(from: number, to: number, out: MusicEvent[]): void {
    if (!this.started) {
      this.started = true;
      this.nextTime = from;
    }
    if (this.nextTime < from - 1) {
      this.nextTime = from;
      this.phrase = null;
    }
    while (this.nextTime < to) {
      this.runStep(this.nextTime, out);
      this.step++;
      this.nextTime += this.stepSeconds;
    }
  }

  private runStep(t: number, out: MusicEvent[]): void {
    const rng = this.rng;
    const inChord = this.step % STEPS_PER_CHORD;
    const stepS = this.stepSeconds;

    if (inChord === 0) {
      // Chord boundary: adopt a pending mood, advance the progression.
      if (this.pending !== this.mood) {
        this.mood = this.pending;
        this.chordIdx = -1;
        this.phrase = null;
      }
      this.chordIdx++;
      if (this.chordIdx % 4 === 0) {
        this.progression = rng.pick(this.mood.minor ? MINOR_PROGRESSIONS : MAJOR_PROGRESSIONS);
        this.chordIdx = 0;
      }
      const table = this.mood.minor ? MINOR_CHORDS : MAJOR_CHORDS;
      this.chord = table[this.progression[this.chordIdx]];
      const chordDur = STEPS_PER_CHORD * stepS;
      const notes = this.chord.map((s) => this.mood.root + s);
      out.push({
        kind: 'pad',
        time: t,
        notes,
        dur: chordDur + 1.5,
        vel: 0.75 + 0.25 * rng.float(),
        bright: clamp01(this.mood.brightness + 0.25 * this.intensity),
      });
      out.push({ kind: 'bass', time: t, notes: [this.mood.root - 12 + mod(this.chord[0], 12) - (mod(this.chord[0], 12) > 7 ? 12 : 0)], dur: chordDur * 0.6, vel: 0.7 });
      // Maybe a phrase this chord, starting somewhere in the first bar.
      const density = clamp01(this.mood.density + 0.3 * this.intensity);
      if (!this.phrase && rng.chance(density)) {
        const chordTone = this.chord[rng.int(0, this.chord.length - 1)];
        this.phrase = {
          left: rng.int(3, 7),
          nextStep: this.step + rng.int(1, 8),
          degree: this.nearestDegree(mod(chordTone, 12)),
        };
      }
      // A star coming out: a lone high bell, mostly at night.
      if (rng.chance(this.mood.name === 'night' ? 0.35 : 0.08)) {
        const deg = rng.int(10, 14);
        out.push({ kind: 'bell', time: t + stepS * rng.int(2, 12), notes: [scaleNote(this.mood.root + 12, this.mood.scale, deg)], dur: 5, vel: 0.35 + 0.3 * rng.float() });
      }
      this.barFill = rng.float();
    }
    if (inChord === 8) this.barFill = rng.float();

    // Melody.
    const p = this.phrase;
    if (p && this.step >= p.nextStep) {
      // Random walk with a pull back toward the middle of the register.
      const pull = p.degree > 9 ? -1 : p.degree < 3 ? 1 : 0;
      const stepBy = rng.pick([-2, -1, -1, 1, 1, 2, 0]) + pull;
      p.degree = Math.max(0, Math.min(12, p.degree + stepBy));
      const midi = scaleNote(this.mood.root + 12, this.mood.scale, p.degree);
      const gap = rng.pick([1, 1, 2, 2, 2, 3, 4]);
      out.push({ kind: 'pluck', time: t + (rng.float() - 0.5) * 0.02, notes: [midi], dur: Math.max(0.6, gap * stepS * 1.6), vel: 0.45 + 0.4 * rng.float() });
      p.left--;
      p.nextStep = this.step + gap;
      if (p.left <= 0) this.phrase = null;
    }

    // Percussion, gated and densified by intensity.
    const i = this.intensity;
    if (i > 0.05) {
      const inBar = this.step % 8;
      const v = 0.35 + 0.65 * i;
      if (inBar === 0) out.push({ kind: 'drum', time: t, notes: [], dur: 0.6, vel: v });
      if (inBar === 4 && i > 0.2) out.push({ kind: 'drum', time: t, notes: [], dur: 0.5, vel: v * 0.7 });
      if (i > 0.55 && ((inBar === 3 && this.barFill > 0.4) || (inBar === 7 && this.barFill > 0.7) || (inBar === 6 && this.barFill < 0.25))) {
        out.push({ kind: 'drum', time: t, notes: [], dur: 0.4, vel: v * 0.5 });
      }
      if (i > 0.45 && (inBar === 2 || inBar === 6)) out.push({ kind: 'rim', time: t, notes: [], dur: 0.1, vel: v * 0.6 });
      if (i > 0.3) {
        const accent = inBar % 2 === 1 ? 0.75 : 0.45;
        out.push({ kind: 'shaker', time: t, notes: [], dur: 0.08, vel: v * accent });
        if (i > 0.75) out.push({ kind: 'shaker', time: t + stepS / 2, notes: [], dur: 0.06, vel: v * 0.3 });
      }
    }
  }

  /** Melody scale degree closest to `semis` semitones above the melody root (root + 12). */
  private nearestDegree(semis: number): number {
    let best = 0;
    let bestD = Infinity;
    for (let d = 0; d <= 12; d++) {
      const n = scaleNote(12, this.mood.scale, d) - 12;
      const dist = Math.abs(n - semis);
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    return best;
  }
}
