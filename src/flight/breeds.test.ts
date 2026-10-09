import { describe, expect, it } from 'vitest';
import type { BreedId } from '../core/types';
import { BREEDS, BREED_ORDER } from './breeds';
import { AIR_DENSITY, GRAVITY, deriveFlight } from './FlightModel';
import { measureBestGlide, measureCircling, measureClimb, measureDive, measureRoll } from './telemetry';

/** Breeds sorted by a measured quantity, highest first. */
function rank(measure: (id: BreedId) => number): BreedId[] {
  const values = new Map(BREED_ORDER.map((id) => [id, measure(id)]));
  return [...BREED_ORDER].sort((a, b) => values.get(b)! - values.get(a)!);
}

/** Breeds sorted by a display rating, highest first. */
function rankRating(key: keyof (typeof BREEDS)['harrier']['ratings']): BreedId[] {
  return [...BREED_ORDER].sort((a, b) => BREEDS[b].ratings[key] - BREEDS[a].ratings[key]);
}

describe('breed ratings tell the truth', () => {
  // The measurements sweep many long glides and climbs: allow time on a busy machine.
  const SLOW = 60_000;

  it('agility follows the measured roll rate', () => {
    expect(rankRating('agility')).toEqual(rank((id) => measureRoll(BREEDS[id]).peakRate));
  });

  it('glide follows the measured best glide ratio', () => {
    expect(rankRating('glide')).toEqual(rank((id) => measureBestGlide(BREEDS[id]).ratio));
  }, SLOW);

  it('power follows the measured sustained climb', () => {
    expect(rankRating('power')).toEqual(rank((id) => measureClimb(BREEDS[id]).climb));
  }, SLOW);

  it('stamina follows staminaSeconds', () => {
    expect(rankRating('stamina')).toEqual(rank((id) => BREEDS[id].staminaSeconds));
  });

  it('speed puts the fastest diver first', () => {
    expect(rankRating('speed')[0]).toBe(rank((id) => measureDive(BREEDS[id]))[0]);
  }, SLOW);

  // B8's bigger wings carry the same weight on 8% more area: stall and cruise come down 4% (the
  // client: "the stall speed may drop a little"), the galewing and skimmer cruising just over 21.
  it('stall speeds sit in the 12–17 m/s band and cruise in 21–30', () => {
    for (const id of BREED_ORDER) {
      const d = deriveFlight(BREEDS[id]);
      expect(d.vStall, id).toBeGreaterThan(12);
      expect(d.vStall, id).toBeLessThan(17);
      expect(d.vCruise, id).toBeGreaterThan(21);
      expect(d.vCruise, id).toBeLessThan(30);
    }
  });
});

describe('wingbeat timing (FANIM-02)', () => {
  it('drives down for longer than it recovers, longest on the big and heavy breeds', () => {
    for (const id of BREED_ORDER) {
      expect(BREEDS[id].downFrac, id).toBeGreaterThanOrEqual(0.54);
      expect(BREEDS[id].downFrac, id).toBeLessThanOrEqual(0.65);
    }
    expect(BREEDS.ironback.downFrac!).toBeGreaterThan(BREEDS.harrier.downFrac!);
    expect(BREEDS.galewing.downFrac!).toBeGreaterThan(BREEDS.harrier.downFrac!);
    expect(BREEDS.harrier.downFrac!).toBeGreaterThan(BREEDS.skimmer.downFrac!);
  });
});

describe('size-true wingbeats (FANIM-04: big wings beat slowly)', () => {
  /** Pennycuick's flapping frequency for a flyer's mass, span and wing area (Hz). */
  const pennycuick = (id: BreedId) => {
    const b = BREEDS[id];
    return Math.pow(b.mass, 3 / 8) * Math.sqrt(GRAVITY) * Math.pow(b.wingspan, -23 / 24) * Math.pow(b.wingArea, -1 / 3) * Math.pow(AIR_DENSITY, -3 / 8);
  };

  it('one beat lasts at least 0.85 s (harrier), 1.3 s (galewing), 0.6 s (skimmer)', () => {
    expect(1 / BREEDS.harrier.flapRate).toBeGreaterThanOrEqual(0.85);
    expect(1 / BREEDS.galewing.flapRate).toBeGreaterThanOrEqual(1.3);
    expect(1 / BREEDS.skimmer.flapRate).toBeGreaterThanOrEqual(0.6);
  });

  it('beats within 1–1.7× the scaling law for its size: the galewing slowest, the skimmer still the quick one', () => {
    for (const id of BREED_ORDER) {
      const ratio = BREEDS[id].flapRate / pennycuick(id);
      expect(ratio, id).toBeGreaterThanOrEqual(1);
      expect(ratio, id).toBeLessThanOrEqual(1.7);
    }
    expect(rank((id) => BREEDS[id].flapRate)[0]).toBe('skimmer');
    expect(rank((id) => BREEDS[id].flapRate).at(-1)).toBe('galewing');
  });
});

describe('the bigger wings (B8: "the wingspan could be scaled to be larger, which may help with the ascending")', () => {
  it('keeps the span order skimmer < harrier ≈ ironback < galewing, the galewing clearly the biggest', () => {
    const span = (id: BreedId) => BREEDS[id].wingspan;
    expect(span('skimmer')).toBeLessThan(span('harrier'));
    expect(Math.abs(span('ironback') - span('harrier')) / span('harrier')).toBeLessThan(0.05);
    expect(span('galewing')).toBeGreaterThan(1.2 * Math.max(span('harrier'), span('ironback')));
    // Spans of 13–21 m: an 11 m body under a 15.5 m wing.
    for (const id of BREED_ORDER) {
      expect(span(id), id).toBeGreaterThanOrEqual(13);
      expect(span(id), id).toBeLessThanOrEqual(21);
    }
  });

  it('climbs hard without floating: a strong held-flap climb, a light circling sink, the stall still above 12.5 m/s', () => {
    for (const id of BREED_ORDER) {
      const b = BREEDS[id];
      // The light breeds climb over 6 m/s on the flaps, the heavy and the glider near 4 (it was
      // 5.0–5.5 and 3.3–3.4 on the 13 m wings).
      expect(measureClimb(b).climb, id).toBeGreaterThan(b.mass < 700 && b.wingspan < 16 ? 6 : 3.8);
      // Circling in a thermal sinks under 3 m/s (2.9–3.5 for the harrier, skimmer and ironback before).
      expect(measureCircling(b).sink, id).toBeLessThan(3);
      // Not a feather: the wing loading barely moved.
      expect(deriveFlight(b).vStall, id).toBeGreaterThan(12.5);
    }
  }, 60_000);
});
