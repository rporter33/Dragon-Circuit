import { describe, expect, it } from 'vitest';
import { finishArpeggio, inScale, MAJOR_PENT, medalChord, midiToHz, MINOR_PENT, ringNote, RING_ROOT, scaleNote, thermalNotes, unlockJingle } from './notes';

describe('notes', () => {
  it('converts MIDI to Hz', () => {
    expect(midiToHz(69)).toBeCloseTo(440, 6);
    expect(midiToHz(81)).toBeCloseTo(880, 6);
    expect(midiToHz(60)).toBeCloseTo(261.626, 2);
  });

  it('walks a scale across octaves, including negative degrees', () => {
    expect(scaleNote(60, MAJOR_PENT, 0)).toBe(60);
    expect(scaleNote(60, MAJOR_PENT, 4)).toBe(69);
    expect(scaleNote(60, MAJOR_PENT, 5)).toBe(72);
    expect(scaleNote(60, MAJOR_PENT, -1)).toBe(57);
    expect(scaleNote(57, MINOR_PENT, 2)).toBe(62);
  });

  it('ring chimes climb strictly through a course and stay in the pentatonic scale', () => {
    for (const total of [3, 6, 11, 16, 30]) {
      let prev = -Infinity;
      for (let i = 0; i < total; i++) {
        const n = ringNote(i, total);
        expect(inScale(n, RING_ROOT, MAJOR_PENT)).toBe(true);
        if (total <= 11) expect(n).toBeGreaterThan(prev);
        else expect(n).toBeGreaterThanOrEqual(prev);
        prev = n;
      }
      expect(ringNote(0, total)).toBe(RING_ROOT);
    }
  });

  it('long courses are compressed so the last ring tops out two octaves up', () => {
    expect(ringNote(29, 30)).toBe(RING_ROOT + 24);
    expect(ringNote(10, 11)).toBe(RING_ROOT + 24);
    // Short courses step one degree per ring.
    expect(ringNote(2, 4)).toBe(scaleNote(RING_ROOT, MAJOR_PENT, 2));
  });

  it('ringNote clamps out-of-range indices', () => {
    expect(ringNote(-3, 5)).toBe(RING_ROOT);
    expect(ringNote(99, 5)).toBe(ringNote(4, 5));
  });

  it('finish arpeggio rises and medal chords get wider with better medals', () => {
    const a = finishArpeggio();
    for (let i = 1; i < a.length; i++) expect(a[i]).toBeGreaterThan(a[i - 1]);
    const span = (m: Parameters<typeof medalChord>[0]) => {
      const c = medalChord(m);
      return Math.max(...c) - Math.min(...c);
    };
    expect(span('gold')).toBeGreaterThan(span('bronze'));
    expect(medalChord('gold').length).toBeGreaterThan(medalChord('bronze').length);
    expect(unlockJingle().length).toBeGreaterThan(3);
  });

  it('the thermal chime rises a fifth inside the ring chimes\' pentatonic', () => {
    const [a, b] = thermalNotes();
    expect(b - a).toBe(7);
    expect(inScale(a, RING_ROOT, MAJOR_PENT)).toBe(true);
    expect(inScale(b, RING_ROOT, MAJOR_PENT)).toBe(true);
  });
});
