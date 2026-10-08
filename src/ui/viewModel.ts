// Read helpers over GameView shared by several screens: relic names, race names, unlock
// progress. Everything goes through the contracts (RaceSystem, CollectibleSystem, SaveStore),
// so the screens work unchanged when the real systems replace the baselines.

import type { CosmeticSlot, Medal } from '../core/types';
import type { GameView, RelicInfo, SaveStore } from '../game/contracts';
import { COSMETICS, type CosmeticOption } from '../cosmetics/catalog';
import { titleCase } from './format';
import type { UnlockContext } from './unlocks';

const FALLBACK_LORE = 'Its story is still out there, somewhere in the Drift.';

/** Every relic: from the collectible system when it lists them, else derived from the catalog. */
export function relicList(view: GameView): readonly RelicInfo[] {
  const listed = view.collectibles.relics;
  if (listed && listed.length > 0) return listed;
  const ids: string[] = [];
  for (const c of COSMETICS) if (c.unlock.type === 'relic' && !ids.includes(c.unlock.relicId)) ids.push(c.unlock.relicId);
  return ids.map((id) => ({ id, name: titleCase(id.replace(/^relic-/, '')), lore: FALLBACK_LORE }));
}

export function relicName(view: GameView, id: string): string {
  return view.collectibles.relics?.find((r) => r.id === id)?.name ?? titleCase(id.replace(/^relic-/, ''));
}

export function raceName(view: GameView, id: string): string {
  return view.races.defs.find((d) => d.id === id)?.name ?? titleCase(id);
}

/** Feathers found: the collectible system's count (it owns what a "feather" is). */
export function feathersFound(view: GameView): number {
  return view.collectibles.found.feathers;
}

export function unlockContext(view: GameView): UnlockContext {
  const save = view.save;
  return {
    feathersFound: feathersFound(view),
    relicFound: (id) => save.data.collected.includes(id),
    relicName: (id) => relicName(view, id),
    raceName: (id) => raceName(view, id),
    raceMedal: (id): Medal => save.data.races[id]?.medal ?? 'none',
    medalCount: (m) => save.medalCount(m),
  };
}

/**
 * Can this option be worn? Default options always; others ask the save. The slot is passed
 * along because ids repeat across slots ('long' hair vs the 'long' scarf) — SaveStore
 * implementations that take it use it, older ones ignore the extra argument.
 */
export function isOptionUnlocked(save: SaveStore, opt: CosmeticOption): boolean {
  if (opt.unlock.type === 'default') return true;
  const isUnlocked = save.isUnlocked as (id: string, slot?: CosmeticSlot) => boolean;
  return isUnlocked.call(save, opt.id, opt.slot);
}

/** Medal counts per tier (exact tier, not "at least"). */
export function medalTally(view: GameView): Record<Exclude<Medal, 'none'>, number> {
  const out = { gold: 0, silver: 0, bronze: 0 };
  const races = view.save.data.races;
  for (const id in races) {
    const m = races[id].medal;
    if (m !== 'none') out[m]++;
  }
  return out;
}
