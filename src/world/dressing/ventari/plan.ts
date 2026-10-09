// Where the Ventari built: one anchor per site in the research registry (src/research/registry.ts).
// Pure and deterministic given the terrain and the keep-outs planned before it.
//
// The anchors are shared: the antiquity dressing builds each site around its anchor, ambient life
// puts sun geckos on the warm stone, the guided opening lands at the Shrine of the First Wind, and
// the inscription spot is where the "Read" prompt appears. Two sites already stand: the Old
// Observatory is the Tower of Charts, and Highmoor's standing-stone circle is the Wind-Counters.

import type { IslandShape } from '../../islandShape';
import type { Terrain } from '../../terrain';
import type { ExclusionSet } from '../exclusions';
import type { RuinSite } from '../structures/Ruins';
import { VENTARI_SITES } from '../../../research/registry';
import type { VentariSiteAnchor } from '../../../core/types';

export type { VentariSiteAnchor };

interface Want {
  id: string;
  landmark: string;
  radius: number;
  /** Fraction-of-outline band to search. */
  band: [number, number];
  /** Prefer the side of the island facing the Roost (1), the highest ground (2), or neither (0). */
  prefer: 0 | 1 | 2;
}

const WANTS: Want[] = [
  { id: 'gullrest-shrine', landmark: 'gullrest', radius: 7, band: [0.3, 0.75], prefer: 1 },
  { id: 'gale-temple', landmark: 'highmoor', radius: 13, band: [0, 0.6], prefer: 2 },
  { id: 'reach-aqueduct', landmark: 'archway', radius: 9, band: [0.15, 0.7], prefer: 0 },
  { id: 'rootfall-colossus', landmark: 'rootfall', radius: 11, band: [0.2, 0.7], prefer: 0 },
];

/** Inscriptions stand just inside the site's edge, on the side you walk up from. */
const INSCRIPTION_INSET = 2.5;

function flatAt(shape: IslandShape, x: number, z: number, radius: number): number | null {
  const y = shape.topHeight(x, z);
  for (let k = 0; k < 8; k++) {
    const b = (k / 8) * Math.PI * 2;
    const yy = shape.topHeight(x + Math.cos(b) * radius, z + Math.sin(b) * radius);
    if (!Number.isFinite(yy) || Math.abs(yy - y) > radius * 0.2 + 0.4) return null;
  }
  return y;
}

/** Best flat, clear spot on an island for a site, searched on a fixed polar grid. */
function findSite(shape: IslandShape, exclusions: ExclusionSet, w: Want, toRoostAngle: number): { x: number; y: number; z: number } | null {
  const d = shape.def;
  let best: { x: number; y: number; z: number } | null = null;
  let bestScore = -Infinity;
  const rings = 8;
  for (let i = 0; i <= rings; i++) {
    const s = w.band[0] + ((w.band[1] - w.band[0]) * i) / rings;
    const n = i === 0 && s === 0 ? 1 : 24;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const R = shape.outlineRadius(a) * s;
      const x = d.x + Math.cos(a) * R;
      const z = d.z + Math.sin(a) * R;
      const y = flatAt(shape, x, z, w.radius);
      if (y === null || exclusions.blocked(x, z, w.radius + 2)) continue;
      const score = w.prefer === 1 ? Math.cos(a - toRoostAngle) : w.prefer === 2 ? y : -Math.abs(s - (w.band[0] + w.band[1]) / 2);
      if (score > bestScore) {
        bestScore = score;
        best = { x, y, z };
      }
    }
  }
  return best;
}

function anchor(id: string, shape: IslandShape, x: number, y: number, z: number, yaw: number, radius: number): VentariSiteAnchor {
  // The inscription faces the approach from the Roost side, just inside the footprint.
  const ix = x + Math.sin(yaw) * Math.max(1, radius - INSCRIPTION_INSET);
  const iz = z + Math.cos(yaw) * Math.max(1, radius - INSCRIPTION_INSET);
  return { id, islandId: shape.def.id, x, y, z, yaw, radius, inscription: { x: ix, y: shape.topHeight(ix, iz), z: iz } };
}

/**
 * Plan every Ventari site. Run after the Roost, the Observatory and the ruins have registered
 * their keep-outs (the Wind-Counters reuse Highmoor's stone circle), and before trees and props, so
 * those keep clear. Adds a keep-out per new site.
 */
export function planVentariSites(terrain: Terrain, exclusions: ExclusionSet, ruins: readonly RuinSite[]): VentariSiteAnchor[] {
  const out: VentariSiteAnchor[] = [];
  const roost = terrain.layout.islands[0];
  const byLandmark = (id: string) => terrain.islands.find((sh) => sh.def.landmark === id);
  const faceRoost = (x: number, z: number) => Math.atan2(roost.x - x, roost.z - z);

  const obs = byLandmark('observatory');
  if (obs) {
    const d = obs.def;
    // The Tower of Charts is the Observatory itself: plinth radius ~18, steps on the Roost side.
    out.push(anchor('observatory', obs, d.x, obs.topHeight(d.x, d.z), d.z, faceRoost(d.x, d.z), 22));
  }
  const highmoor = byLandmark('highmoor');
  const stones = highmoor ? ruins.find((r) => r.islandId === highmoor.def.id && r.kind === 'stones') : undefined;
  if (highmoor && stones) out.push(anchor('wind-counters', highmoor, stones.x, stones.y, stones.z, faceRoost(stones.x, stones.z), stones.radius));

  for (const w of WANTS) {
    const shape = byLandmark(w.landmark);
    if (!shape) continue;
    const d = shape.def;
    const p = findSite(shape, exclusions, w, Math.atan2(roost.z - d.z, roost.x - d.x));
    if (!p) continue;
    exclusions.circle(p.x, p.z, w.radius + 1);
    out.push(anchor(w.id, shape, p.x, p.y, p.z, faceRoost(p.x, p.z), w.radius));
  }
  // Registry order, so consumers can rely on it.
  const order = VENTARI_SITES.map((s) => s.id);
  return out.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}
