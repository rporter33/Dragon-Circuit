import { describe, expect, it } from 'vitest';
import type { BreedId } from '../core/types';
import { BREEDS, BREED_ORDER } from './breeds';
import { deriveFlight } from './FlightModel';
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
