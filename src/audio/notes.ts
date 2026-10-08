// Pitch helpers shared by the chimes, stings and the generative music. Pure: everything here is
// plain numbers so the scale logic can be unit-tested without an AudioContext.

/** Semitone offsets of the major pentatonic (do re mi so la). */
export const MAJOR_PENT = [0, 2, 4, 7, 9] as const;
/** Semitone offsets of the minor pentatonic (la do re mi so, rooted on la). */
export const MINOR_PENT = [0, 3, 5, 7, 10] as const;

export type Scale = readonly number[];

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Positive modulo. */
export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** The MIDI note `degree` steps up `scale` from `root` (degrees past the scale wrap into octaves). */
export function scaleNote(root: number, scale: Scale, degree: number): number {
  const n = scale.length;
  const octave = Math.floor(degree / n);
  return root + 12 * octave + scale[mod(degree, n)];
}

/** True if `midi` belongs to `scale` rooted at `root` (any octave). */
export function inScale(midi: number, root: number, scale: Scale): boolean {
  return scale.includes(mod(midi - root, 12));
}

/** Chime root for ring courses: C5, bright but not piercing once the bell partials are added. */
export const RING_ROOT = 72;

/**
 * The chime for passing ring `index` (0-based) of `total`: climbs the major pentatonic, one step
 * per ring. Long courses are compressed so the last ring always lands two octaves up, which
 * makes the final rings feel like a crescendo instead of running off the top of the range.
 */
export function ringNote(index: number, total: number, root = RING_ROOT): number {
  const span = 10; // two octaves of pentatonic steps
  const last = Math.max(1, total - 1);
  const i = Math.max(0, Math.min(index, last));
  const degree = total - 1 <= span ? i : Math.round((i * span) / last);
  return scaleNote(root, MAJOR_PENT, degree);
}

/** Rising major arpeggio for crossing the finish line. */
export function finishArpeggio(root = RING_ROOT - 12): number[] {
  return [0, 4, 7, 12, 16, 19, 24].map((s) => root + s);
}

export type MedalKind = 'none' | 'bronze' | 'silver' | 'gold';

/** The chord voiced after the finish arpeggio; brighter and wider the better the medal. */
export function medalChord(medal: MedalKind, root = RING_ROOT - 12): number[] {
  switch (medal) {
    case 'gold':
      return [0, 7, 11, 14, 16, 19, 23].map((s) => root + s); // maj9 spread, sparkling top
    case 'silver':
      return [0, 7, 12, 14, 17].map((s) => root + s); // sus: bright, open
    case 'bronze':
      return [0, 7, 12, 16].map((s) => root + s); // plain major, warm
    case 'none':
    default:
      return [-12, -5, 0, 4].map((s) => root + s); // soft, low, consoling
  }
}

/** A short pentatonic flourish for unlocking a cosmetic. */
export function unlockJingle(root = RING_ROOT - 12): number[] {
  return [0, 4, 7, 9, 12, 16].map((s) => root + s);
}
