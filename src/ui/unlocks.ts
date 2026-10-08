// What a locked cosmetic asks of the player, and how far along they are. Computed from the
// catalog's Unlock rules plus save data and collectible counts. Pure, unit-tested.

import type { Medal } from '../core/types';
import type { Unlock } from '../cosmetics/catalog';
import { MEDAL_RANK, medalName } from './format';

export interface UnlockContext {
  feathersFound: number;
  relicFound(relicId: string): boolean;
  relicName(relicId: string): string;
  raceName(raceId: string): string;
  /** Best medal so far in a race. */
  raceMedal(raceId: string): Medal;
  /** Races with at least this medal. */
  medalCount(medal: Exclude<Medal, 'none'>): number;
}

export interface Requirement {
  /** "Find 10 feathers", "Gold in Roost Loop", "Relic: The Ember Heart". */
  text: string;
  /** Progress toward it (have ≤ need), for a bar and an "x/y" label. */
  have: number;
  need: number;
  /** Short progress label, e.g. "4/10", "Best: Silver", "Not found". */
  progress: string;
  met: boolean;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function describeUnlock(u: Unlock, ctx: UnlockContext): Requirement {
  switch (u.type) {
    case 'default':
      return { text: 'Available from the start', have: 1, need: 1, progress: '', met: true };
    case 'feathers': {
      const have = Math.min(ctx.feathersFound, u.count);
      return {
        text: `Find ${u.count} ${plural(u.count, 'feather', 'feathers')}`,
        have,
        need: u.count,
        progress: `${have}/${u.count}`,
        met: have >= u.count,
      };
    }
    case 'relic': {
      const found = ctx.relicFound(u.relicId);
      return {
        text: `Relic: ${ctx.relicName(u.relicId)}`,
        have: found ? 1 : 0,
        need: 1,
        progress: found ? 'Found' : 'Not found',
        met: found,
      };
    }
    case 'medal': {
      const best = ctx.raceMedal(u.raceId);
      const have = Math.min(MEDAL_RANK[best], MEDAL_RANK[u.medal]);
      return {
        text: `${medalName(u.medal)} in ${ctx.raceName(u.raceId)}`,
        have,
        need: MEDAL_RANK[u.medal],
        progress: best === 'none' ? 'Not yet raced' : `Best: ${medalName(best)}`,
        met: MEDAL_RANK[best] >= MEDAL_RANK[u.medal],
      };
    }
    case 'medals': {
      const have = Math.min(ctx.medalCount(u.medal), u.count);
      return {
        text: `Earn ${u.count} ${medalName(u.medal).toLowerCase()} ${plural(u.count, 'medal', 'medals')}`,
        have,
        need: u.count,
        progress: `${have}/${u.count}`,
        met: have >= u.count,
      };
    }
  }
}
