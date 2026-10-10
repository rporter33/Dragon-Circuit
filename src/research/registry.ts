// The research registry: every thing in the Drift worth a journal page, what it's worth, and the
// Codex build stages research pays for. Ids are save keys — never rename one.
//
// Content is shared by several modules: the life system places the species, the antiquity
// dressing builds the Ventari sites (and their inscriptions), the research system turns
// 'catalogue' / 'survey' / thermal / pickup events into entries, and Quintus talks about all of it.
// Positions live with the module that builds the thing; this file holds identity and lore.

import type { ResearchBranch } from '../core/types';
import { FIRST_LEAD_TRANSLATION } from './firstLeadText';

export interface SpeciesDef {
  id: string;
  name: string;
  kind: 'creature' | 'plant';
  /** Where it lives, for placement and for the journal. */
  habitat: string;
  /** One or two sentences for the journal page (Quintus's notes). */
  notes: string;
  points: number;
}

/**
 * The Drift's life. Wyverns are reptiles, and so is much of what shares the sky with them:
 * cold-blooded, sun-loving, scaled.
 */
export const SPECIES: readonly SpeciesDef[] = [
  {
    id: 'skyling',
    name: 'Skyling',
    kind: 'creature',
    habitat: 'Flocks wheeling around island rims in daylight',
    notes: 'Hand-sized reptiles with membrane wings, cousins of the wyverns, and twice as nosy. A flock scatters like thrown seed when a wyvern passes, then regroups to follow at a polite distance.',
    points: 5,
  },
  {
    id: 'driftray',
    name: 'Driftray',
    kind: 'creature',
    habitat: 'Circling inside thermals, all day',
    notes: 'A broad, slow glider that never seems to flap. It rides rising air for hours; where you see one circling, there is lift. Vellum follows them shamelessly.',
    points: 5,
  },
  {
    id: 'sun-gecko',
    name: 'Sun Gecko',
    kind: 'creature',
    habitat: 'Basking on warm stone and Ventari ruins',
    notes: 'Cold-blooded like every wyvern, so it spends the morning flattened against sun-warmed stone and bolts the moment a shadow falls on it. The old masonry holds the heat best.',
    points: 5,
  },
  {
    id: 'woolback',
    name: 'Woolback',
    kind: 'creature',
    habitat: 'Grazing the meadow islands in small herds',
    notes: 'Placid, shaggy grazers whose ancestors must have been carried up here on purpose. They lift their heads when a wyvern lands, decide it is not their problem, and go back to eating.',
    points: 5,
  },
  {
    id: 'windharp-reed',
    name: 'Windharp Reed',
    kind: 'plant',
    habitat: 'Windward island edges',
    notes: 'Hollow reeds that hum when a gust runs through them. The Ventari planted rows of them on purpose; the chord tells you which way the wind has turned.',
    points: 5,
  },
  {
    id: 'dawnbloom',
    name: 'Dawnbloom',
    kind: 'plant',
    habitat: 'Meadows and terraces',
    notes: 'Opens with the first light and folds shut at dusk. Fields of them turn gold at sunrise, which is the only reason Quintus has ever been up that early.',
    points: 5,
  },
  {
    id: 'glowcap',
    name: 'Glowcap',
    kind: 'plant',
    habitat: 'Glowcap Grove, after dark',
    notes: 'Giant mushrooms that light up at night. Moths and skylings alike navigate by them; so, it seems, did the Ventari.',
    points: 5,
  },
];

export type SiteKind = 'shrine' | 'observatory' | 'temple' | 'aqueduct' | 'colossus' | 'stones';

export interface VentariSiteDef {
  id: string;
  name: string;
  kind: SiteKind;
  /** The landmark (src/world/layout.ts) the site is on or near. */
  landmark: string;
  /** What walking the site tells you (survey part 'site'). */
  notes: string;
  /** The inscription's translation (survey part 'inscription'). */
  inscription: string;
  /** Points for walking the site; reading the inscription is worth INSCRIPTION_POINTS more. */
  points: number;
}

export const INSCRIPTION_POINTS = 10;

/**
 * The Ventari: the wind-riders who built on these islands before anyone now alive, in a style
 * the scholars call Greco-Roman for want of a better word — columns, arches, colossi, mosaics.
 * Their sites tell one story: they charted the winds, they kept wyverns, and then they left.
 */
export const VENTARI_SITES: readonly VentariSiteDef[] = [
  {
    id: 'gullrest-shrine',
    name: 'Shrine of the First Wind',
    kind: 'shrine',
    landmark: 'gullrest',
    notes: 'Two columns, an altar stone, and a bronze wind-vane fallen in the grass. Small, but the stones are cut as finely as anything at the Observatory.',
    inscription: FIRST_LEAD_TRANSLATION,
    points: 5,
  },
  {
    id: 'observatory',
    name: 'The Tower of Charts',
    kind: 'observatory',
    landmark: 'observatory',
    notes: 'The Old Observatory was a Ventari building long before it was ours. The armillary still turns if you push it; the floor mosaic is a map of thermals that no longer stand where it says.',
    inscription: '"We have counted every wind of the Drift. The last one we followed does not return."',
    points: 5,
  },
  {
    id: 'gale-temple',
    name: 'Temple of the Gale',
    kind: 'temple',
    landmark: 'highmoor',
    notes: 'A ring of columns on the highest ground in the Drift, open to every wind. Votive wyvern scales are still wedged between the stones.',
    inscription: '"To the wind that lifts, the wind that turns, and the wind that takes us home."',
    points: 5,
  },
  {
    id: 'reach-aqueduct',
    name: 'The Broken Aqueduct',
    kind: 'aqueduct',
    landmark: 'archway',
    notes: 'Channels laid along the stone arches of the Reach once carried water from island to island. Someone built islands into a city here.',
    inscription: '"Water to the Reach, wind to the riders, and to the Drift our thanks."',
    points: 5,
  },
  {
    id: 'rootfall-colossus',
    name: 'The Sleeping Colossus',
    kind: 'colossus',
    landmark: 'rootfall',
    notes: 'A rider and wyvern carved three times the height of the stable, swallowed by Rootfall\'s trees. The rider is looking west, past the edge of every chart.',
    inscription: '"She flew west with the last of us. Keep her saddle oiled."',
    points: 5,
  },
  {
    id: 'wind-counters',
    name: 'The Wind-Counters',
    kind: 'stones',
    landmark: 'highmoor',
    notes: 'Standing stones notched with tally marks, one row for each season\'s winds. The last row stops halfway.',
    inscription: '"Counted by the keepers of the Gale. Counting stops when the counters leave."',
    points: 5,
  },
];

/** Points for riding a thermal to its top the first time ('Winds' branch). */
export const THERMAL_POINTS = 5;
/** Existing finds fold into research as entries too. */
export const RELIC_POINTS = 10;
export const LANDMARK_POINTS = 3;
export const FEATHER_POINTS = 1;

export interface CodexStageDef {
  stage: number;
  name: string;
  description: string;
  /** Total research points needed to reach this stage. */
  threshold: number;
}

/**
 * The Codex: Quintus's airship, a flying library, built in the dock at the Roost. Research is
 * what finishes her; she won't sail in this release, but every stage is visible in the dock.
 */
export const CODEX_STAGES: readonly CodexStageDef[] = [
  { stage: 0, name: 'Keel laid', description: 'A keel on the slipway and a great deal of optimism.', threshold: 0 },
  { stage: 1, name: 'Ribs raised', description: 'The frame stands. Quintus has started calling her "she".', threshold: 15 },
  { stage: 2, name: 'Hull planked', description: 'Planked and caulked. The library shelves go in next.', threshold: 45 },
  { stage: 3, name: 'Envelope stitched', description: 'The lift envelope is sewn and laid out along the dock.', threshold: 90 },
  { stage: 4, name: 'Rigging strung', description: 'Rigging, rudder and a figurehead of Vellum (do not tell her).', threshold: 150 },
  { stage: 5, name: 'Ready to sail', description: 'Finished. Where she sails is a story for another day.', threshold: 220 },
];

export const BRANCH_NAMES: Record<ResearchBranch, string> = {
  nature: 'Natural History',
  antiquity: 'Antiquities',
  winds: 'Winds',
};
