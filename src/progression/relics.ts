// The named things you can find in the Drift: 48 feathers and seven relics. Ids are stable save
// keys (the cosmetic catalog references the relic ids), so never rename one.

export interface RelicDef {
  id: string;
  name: string;
  /** One line of lore for the toast and the collection screen. */
  lore: string;
}

export const RELICS: readonly RelicDef[] = [
  {
    id: 'relic-ember',
    name: 'Ember Scale',
    lore: 'Shed by a fire-veined wyvern that nested behind the falls, where no spray could reach it.',
  },
  {
    id: 'relic-antler',
    name: 'Old Bull’s Antler',
    lore: 'The great wyvern of Highmoor shed its tines here every spring; the herders built a cairn around this one.',
  },
  {
    id: 'relic-mane',
    name: 'Gale Plume',
    lore: 'A tuft of feathered mane, caught in the stone of the Eye where the wind has never once stopped.',
  },
  {
    id: 'relic-ribbon',
    name: 'Winner’s Ribbon',
    lore: 'Tied to the tail of the first rider to thread Rootfall’s roots, and snagged on them on the way home.',
  },
  {
    id: 'relic-howdah',
    name: 'Howdah Finial',
    lore: 'A carved finial from a queen’s howdah, left behind when her wyvern rested on a Needle and would not leave.',
  },
  {
    id: 'relic-charts',
    name: 'Wind Charts',
    lore: 'Every thermal in the Drift, inked by hand and left beneath the Observatory’s broken dome.',
  },
  {
    id: 'relic-circlet',
    name: 'Keeper’s Circlet',
    lore: 'Worn by the keeper of the Lantern Spire. Its stone still glows with the lantern’s flame.',
  },
];

export const FEATHER_COUNT = 48;

/** feather-01 … feather-48. */
export function featherId(index: number): string {
  return `feather-${String(index + 1).padStart(2, '0')}`;
}

const FEATHER_RE = /^feather-(\d\d)$/;

export function isFeatherId(id: string): boolean {
  const m = FEATHER_RE.exec(id);
  if (!m) return false;
  const n = Number(m[1]);
  return n >= 1 && n <= FEATHER_COUNT;
}

export function relicById(id: string): RelicDef | undefined {
  return RELICS.find((r) => r.id === id);
}

export function isCollectibleId(id: string): boolean {
  return isFeatherId(id) || relicById(id) !== undefined;
}
