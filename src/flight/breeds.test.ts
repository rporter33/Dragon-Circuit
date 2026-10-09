import { describe, expect, it } from 'vitest';
import type { BreedId } from '../core/types';
import { BREEDS, BREED_ORDER } from './breeds';
import { AIR_DENSITY, GRAVITY, deriveFlight } from './FlightModel';
import { measureBestGlide, measureClimb, measureDive, measureRoll } from './telemetry';

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

  it('stall speeds sit in the 12–17 m/s band and cruise in 22–30', () => {
    for (const id of BREED_ORDER) {
      const d = deriveFlight(BREEDS[id]);
      expect(d.vStall, id).toBeGreaterThan(12);
      expect(d.vStall, id).toBeLessThan(17);
      expect(d.vCruise, id).toBeGreaterThan(22);
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
    expect(rank((id) => BREEDS[id].flapRate)[3]).toBe('galewing');
  });
});
