// Where the 48 feathers and seven relics are. Placed by hand to reward exploring: some on foot
// (grove clearings, ruins, under the Observatory dome, the end of the Roost's launch deck),
// some only from the air (beneath islands, behind waterfalls, among Rootfall's roots, inside
// and atop the Eye of the Gale, on the arches, at the tops of thermals), and some on spire tops
// you have to land on. Positions are authored against the real layout and checked by
// collectibles.test.ts: nothing inside rock, structures, trees or water; every one reachable.
//
// Ground spots give only (x, z): the height comes from the analytic terrain (or the launch
// deck), so they sit on the surface exactly. Ids are save keys: never renumber.

import { Vector3 } from 'three';
import type { TerrainQuery } from '../core/types';
import { FEATHER_COUNT, RELICS, featherId, relicById } from './relics';

/** How a collectible sits in the world. */
export type Spot =
  /** On walkable ground (terrain or deck); found on foot or by landing. */
  | { on: 'ground'; x: number; z: number }
  /** On a built floor this far above the terrain (the Observatory, the Lantern pavilion). */
  | { on: 'floor'; x: number; z: number; lift: number }
  /** In open air (on a little floating stone, for relics): flying only. */
  | { on: 'air'; x: number; y: number; z: number };

export interface CollectibleSpec {
  id: string;
  kind: 'feather' | 'relic';
  /** Where it is, for the collection screen ("behind the Glowcap falls"). */
  where: string;
  spot: Spot;
}

export interface Collectible {
  id: string;
  kind: 'feather' | 'relic';
  name: string;
  where: string;
  /** The center of the floating feather / the relic on its pedestal (world). */
  position: Vector3;
  /** Height of the surface it stands on, or null for a floating one. */
  groundY: number | null;
  access: 'foot' | 'air';
}

const g = (x: number, z: number): Spot => ({ on: 'ground', x, z });
const air = (x: number, y: number, z: number): Spot => ({ on: 'air', x, y, z });

/** Feathers in order: feather-01 … feather-48. */
const FEATHERS: [string, Spot][] = [
  // The Windward Roost
  ['the end of the launch deck', g(153, 96)],
  ['the Roost’s western rim', g(-141, -51)],
  ['the very bottom of the Roost', air(0, 42, 0)],
  ['behind the Roost’s waterfall', air(72, 158, -125)],
  // Gull's Rest
  ['the middle of Gull’s Rest', g(560, 420)],
  ['beneath Gull’s Rest', air(560, 192, 420)],
  // Cascade Isle
  ['the summit of Cascade Isle', g(750, -470)],
  ['a stream bank on Cascade Isle', g(982, -421)],
  ['behind Cascade’s south-eastern falls', air(991, 335, -634)],
  ['behind Cascade’s western falls', air(618, 331, -436)],
  ['the tip of Cascade Isle', air(820, 115, -520)],
  // Rootfall
  ['the heart of Rootfall’s forest', g(340, 1000)],
  ['a clearing in Rootfall', g(250, 1060)],
  ['Rootfall’s forest shrine', g(488, 1019)],
  ['the tip of a hanging root', air(396, 174, 988)],
  ['among Rootfall’s roots', air(300, 332, 1172)],
  // The Old Observatory
  ['the Observatory’s shrine', g(-1415, 193)],
  ['the Observatory’s broken wall', g(-1495, 43)],
  ['the top of the broken ring', air(-1280, 532, 330)],
  // Highmoor
  ['the standing stones', g(-410, 376)],
  ['Highmoor’s fallen arch', g(-412, 567)],
  ['Highmoor’s shrine', g(-364, 459)],
  ['the summit of Highmoor', g(-525, 505)],
  // Glowcap Grove
  ['the heart of Glowcap Grove', g(-900, -350)],
  ['a glade in Glowcap Grove', g(-960, -300)],
  ['behind the Glowcap falls', air(-771, 229, -307)],
  // The Archway Reach
  ['the crown of the first arch', air(-510, 349, -833)],
  ['the crown of the middle arch', air(-773, 365, -958)],
  ['the crown of the last arch', air(-1043, 375, -1045)],
  ['the cairns of the Reach', g(-614, -874)],
  ['the last islet of the Reach', g(-1180, -1080)],
  // Mistveil Shelves
  ['the top of the Mistveil Shelves', g(1330, -1180)],
  ['the sundial on the Shelves', g(1678, -1176)],
  ['a high shelf', g(1480, -1250)],
  ['behind the Shelves’ waterfall', air(1602, 298, -1154)],
  // The Lantern Spire
  ['under the Lantern Spire’s point', air(-1150, 118, 760)],
  ['the top of the thermal by the Lantern Spire', air(-1300, 870, 480)],
  // The Needles
  ['the top of a needle', g(1120, -1420)],
  ['the top of the last needle', g(1110, -1950)],
  ['low among the Needles', air(970, 262, -1380)],
  // The Eye of the Gale
  ['the crown of the Eye', air(1339, 679, 663)],
  ['inside the Eye', air(1295, 560, 604)],
  // Thermal tops and far corners
  ['the top of Highmoor’s thermal', air(-260, 1000, 330)],
  ['the top of the thermal by Rootfall', air(150, 860, 760)],
  ['a lone high islet', g(-520, 86)],
  ['a ruined arch in the woods', g(-111, -193)],
  ['a rocky islet over the Roost', g(-498, -126)],
  ['skimming the cloud sea', air(330, 42, 230)],
];

/** Relics, by id. */
const RELIC_SPOTS: Record<string, [string, Spot]> = {
  'relic-ember': ['behind Cascade’s northern falls', air(744, 331, -335)],
  'relic-antler': ['a cairn on Highmoor', g(-572, 514)],
  'relic-mane': ['inside the Eye of the Gale', air(1356, 490, 642)],
  'relic-ribbon': ['the lowest of Rootfall’s roots', air(319, 171, 937)],
  'relic-howdah': ['the tallest of the Needles', g(1050, -1700)],
  'relic-charts': ['under the Observatory’s dome', { on: 'floor', x: -1498.5, z: 144.8, lift: 1.48 }],
  'relic-circlet': ['the Lantern Spire’s pavilion', { on: 'floor', x: -1146.6, z: 758.9, lift: 1.0 }],
};

export const COLLECTIBLE_SPECS: CollectibleSpec[] = [
  ...FEATHERS.map(([where, spot], i): CollectibleSpec => ({ id: featherId(i), kind: 'feather', where, spot })),
  ...RELICS.map((r): CollectibleSpec => ({ id: r.id, kind: 'relic', where: RELIC_SPOTS[r.id][0], spot: RELIC_SPOTS[r.id][1] })),
];

if (FEATHERS.length !== FEATHER_COUNT) throw new Error(`expected ${FEATHER_COUNT} feathers, have ${FEATHERS.length}`);

/** How high a feather floats above the ground (m). */
export const FEATHER_HOVER = 1.3;
/** A relic's pedestal height: the artifact sits on top. */
export const PEDESTAL_HEIGHT = 0.95;

export interface PlacementWorld {
  terrain: TerrainQuery;
  /** Built walkable surfaces (the Roost's launch deck). */
  deckAt?: (x: number, z: number, fromY: number) => { y: number } | null;
}

/** Height of walkable ground at (x, z): the highest of terrain and decks. */
export function groundHeight(world: PlacementWorld, x: number, z: number): number | null {
  const t = world.terrain.groundAt(x, z, 1e5);
  const d = world.deckAt?.(x, z, 1e5) ?? null;
  if (!t && !d) return null;
  return Math.max(t ? t.y : -Infinity, d ? d.y : -Infinity);
}

/** Resolve every collectible to a world position (deterministic). */
export function placeCollectibles(world: PlacementWorld, specs: readonly CollectibleSpec[] = COLLECTIBLE_SPECS): Collectible[] {
  return specs.map((s) => {
    const name = s.kind === 'relic' ? relicById(s.id)!.name : 'Feather';
    const above = s.kind === 'feather' ? FEATHER_HOVER : PEDESTAL_HEIGHT + 0.45;
    let position: Vector3;
    let groundY: number | null = null;
    if (s.spot.on === 'air') {
      position = new Vector3(s.spot.x, s.spot.y, s.spot.z);
    } else {
      const y = groundHeight(world, s.spot.x, s.spot.z);
      if (y === null) {
        // Only without the dressing (no launch deck): float it where the deck would be.
        position = new Vector3(s.spot.x, 243 + above, s.spot.z);
      } else {
        groundY = y + (s.spot.on === 'floor' ? s.spot.lift : 0);
        position = new Vector3(s.spot.x, groundY + above, s.spot.z);
      }
    }
    return { id: s.id, kind: s.kind, name, where: s.where, position, groundY, access: s.spot.on === 'air' ? 'air' : 'foot' };
  });
}
