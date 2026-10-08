import { describe, expect, it } from 'vitest';
import { inScale } from './notes';
import { MOODS, moodFor, MusicSequencer, STEPS_PER_CHORD, type MusicEvent } from './sequencer';

function run(seq: MusicSequencer, seconds: number, chunk = 0.25, start = 10): MusicEvent[] {
  const out: MusicEvent[] = [];
  for (let t = start; t < start + seconds; t += chunk) seq.schedule(t, t + chunk, out);
  return out;
}

describe('moodFor', () => {
  it('maps the clock to dawn, day, dusk and night', () => {
    expect(moodFor(0.0).name).toBe('night');
    expect(moodFor(0.25).name).toBe('dawn');
    expect(moodFor(0.5).name).toBe('day');
    expect(moodFor(0.72).name).toBe('dusk');
    expect(moodFor(0.9).name).toBe('night');
    expect(moodFor(1.5).name).toBe('day');
  });
});

describe('MusicSequencer', () => {
  it('is deterministic for a seed', () => {
    const a = run(new MusicSequencer(3), 60);
    const b = run(new MusicSequencer(3), 60);
    expect(a).toEqual(b);
  });

  it('emits events in order, inside the requested windows', () => {
    const seq = new MusicSequencer(1);
    let last = -Infinity;
    for (let t = 0; t < 40; t += 0.3) {
      const out: MusicEvent[] = [];
      seq.schedule(t, t + 0.3, out);
      for (const e of out) {
        // Phrase notes carry ±10 ms of humanization; bells may land later in the chord.
        if (e.kind !== 'bell') {
          expect(e.time).toBeGreaterThanOrEqual(t - 0.011);
          expect(e.time).toBeLessThan(t + 0.3 + 0.011);
        }
        if (e.kind === 'pad') {
          expect(e.time).toBeGreaterThanOrEqual(last);
          last = e.time;
        }
        expect(Number.isFinite(e.time) && Number.isFinite(e.dur) && Number.isFinite(e.vel)).toBe(true);
      }
    }
  });

  it('plays one pad chord per two bars', () => {
    const seq = new MusicSequencer(5);
    seq.setMood(MOODS.day);
    const ev = run(seq, 120);
    const pads = ev.filter((e) => e.kind === 'pad');
    const chordSeconds = STEPS_PER_CHORD * (30 / MOODS.day.tempo);
    expect(pads.length).toBeGreaterThanOrEqual(Math.floor(120 / chordSeconds) - 1);
    expect(pads.length).toBeLessThanOrEqual(Math.ceil(120 / chordSeconds) + 1);
    for (const p of pads) expect(p.notes.length).toBe(4);
  });

  it('keeps every melody note in the mood scale', () => {
    for (const mood of Object.values(MOODS)) {
      const seq = new MusicSequencer(11);
      seq.setMood(mood);
      const ev = run(seq, 240);
      const plucks = ev.filter((e) => e.kind === 'pluck' || e.kind === 'bell');
      expect(plucks.length).toBeGreaterThan(5);
      for (const p of plucks) expect(inScale(p.notes[0], mood.root, mood.scale)).toBe(true);
    }
  });

  it('stays sparse: melodies leave room to breathe', () => {
    const seq = new MusicSequencer(2);
    seq.setMood(MOODS.night);
    const ev = run(seq, 300);
    const notesPerMinute = ev.filter((e) => e.kind === 'pluck').length / 5;
    expect(notesPerMinute).toBeLessThan(25);
    expect(notesPerMinute).toBeGreaterThan(2);
  });

  it('is silent on percussion at intensity 0 and drives it at full intensity', () => {
    const calm = new MusicSequencer(4);
    const calmEv = run(calm, 60);
    expect(calmEv.some((e) => e.kind === 'drum' || e.kind === 'shaker' || e.kind === 'rim')).toBe(false);
    const race = new MusicSequencer(4);
    race.setIntensity(1);
    const raceEv = run(race, 60);
    const drums = raceEv.filter((e) => e.kind === 'drum').length;
    const shakers = raceEv.filter((e) => e.kind === 'shaker').length;
    expect(drums).toBeGreaterThan(40);
    expect(shakers).toBeGreaterThan(drums);
    const mid = new MusicSequencer(4);
    mid.setIntensity(0.35);
    const midEv = run(mid, 60);
    expect(midEv.filter((e) => e.kind === 'drum').length).toBeLessThan(drums);
    expect(midEv.some((e) => e.kind === 'rim')).toBe(false);
  });

  it('changes mood only on a chord boundary', () => {
    const seq = new MusicSequencer(8);
    seq.setMood(MOODS.day);
    const out: MusicEvent[] = [];
    seq.schedule(0, 3, out);
    seq.setMood(MOODS.night);
    expect(seq.currentMood.name).toBe('day');
    seq.schedule(3, 30, out);
    expect(seq.currentMood.name).toBe('night');
    const pads = out.filter((e) => e.kind === 'pad');
    // The first pad is day (G), a later one night (E minor).
    expect(pads[0].notes[0] % 12).toBe(MOODS.day.root % 12);
    expect(pads.some((p) => inScale(p.notes[0], MOODS.night.root, [0, 3, 5, 7, 8, 10]))).toBe(true);
  });

  it('skips a long clock gap instead of bursting out the backlog', () => {
    const seq = new MusicSequencer(6);
    const out: MusicEvent[] = [];
    seq.schedule(0, 0.3, out);
    out.length = 0;
    seq.schedule(500, 500.3, out);
    expect(out.length).toBeLessThan(6);
    for (const e of out) expect(e.time).toBeGreaterThanOrEqual(499.98);
  });
});
