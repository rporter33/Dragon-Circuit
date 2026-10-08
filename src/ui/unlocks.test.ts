import { describe, expect, it } from 'vitest';
import type { Medal } from '../core/types';
import { COSMETICS } from '../cosmetics/catalog';
import { describeUnlock, type UnlockContext } from './unlocks';

function ctx(over: Partial<UnlockContext> = {}): UnlockContext {
  const medals: Record<string, Medal> = { 'roost-loop': 'silver' };
  return {
    feathersFound: 4,
    relicFound: (id) => id === 'relic-charts',
    relicName: (id) => (id === 'relic-ember' ? 'The Ember Heart' : 'Wind Charts'),
    raceName: (id) => (id === 'roost-loop' ? 'Roost Loop' : id),
    raceMedal: (id) => medals[id] ?? 'none',
    medalCount: (m) => (m === 'bronze' ? 2 : m === 'silver' ? 1 : 0),
    ...over,
  };
}

describe('describeUnlock', () => {
  it('feathers: count and progress', () => {
    const r = describeUnlock({ type: 'feathers', count: 10 }, ctx());
    expect(r).toMatchObject({ text: 'Find 10 feathers', have: 4, need: 10, progress: '4/10', met: false });
    expect(describeUnlock({ type: 'feathers', count: 1 }, ctx()).text).toBe('Find 1 feather');
    expect(describeUnlock({ type: 'feathers', count: 3 }, ctx()).met).toBe(true);
  });
  it('relic: names the relic', () => {
    expect(describeUnlock({ type: 'relic', relicId: 'relic-ember' }, ctx())).toMatchObject({ text: 'Relic: The Ember Heart', progress: 'Not found', met: false });
    expect(describeUnlock({ type: 'relic', relicId: 'relic-charts' }, ctx()).met).toBe(true);
  });
  it('medal in a race: names the race and your best so far', () => {
    const r = describeUnlock({ type: 'medal', raceId: 'roost-loop', medal: 'gold' }, ctx());
    expect(r).toMatchObject({ text: 'Gold in Roost Loop', have: 2, need: 3, progress: 'Best: Silver', met: false });
    expect(describeUnlock({ type: 'medal', raceId: 'other', medal: 'bronze' }, ctx()).progress).toBe('Not yet raced');
    expect(describeUnlock({ type: 'medal', raceId: 'roost-loop', medal: 'bronze' }, ctx()).met).toBe(true);
  });
  it('medal counts', () => {
    expect(describeUnlock({ type: 'medals', medal: 'gold', count: 3 }, ctx())).toMatchObject({ text: 'Earn 3 gold medals', progress: '0/3', met: false });
    expect(describeUnlock({ type: 'medals', medal: 'bronze', count: 2 }, ctx()).met).toBe(true);
  });
  it('describes every unlock in the catalog without throwing', () => {
    for (const c of COSMETICS) {
      const r = describeUnlock(c.unlock, ctx());
      expect(r.text.length).toBeGreaterThan(0);
      expect(r.have).toBeLessThanOrEqual(r.need);
    }
  });
});
