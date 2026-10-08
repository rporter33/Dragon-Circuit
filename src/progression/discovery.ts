// Landmark discovery: each landmark has a vicinity (circles around its parts, with a height
// band), and entering it the first time records it in the save and announces it. Pure data from
// the layout, so tests can check every landmark is discoverable and zones don't overlap absurdly.

import type { WorldLayout } from '../world/layout';

export interface DiscoveryZone {
  landmarkId: string;
  name: string;
  /** Horizontal circles (x, z, r) and a height band [y0, y1]: inside any circle within the band. */
  circles: { x: number; z: number; r: number }[];
  y0: number;
  y1: number;
}

/** Build a vicinity for every landmark from the shapes that make it up. */
export function discoveryZones(layout: WorldLayout): DiscoveryZone[] {
  const zones: DiscoveryZone[] = [];
  for (const lm of layout.landmarks) {
    const circles: DiscoveryZone['circles'] = [];
    let y0 = Infinity;
    let y1 = -Infinity;
    const grow = (lo: number, hi: number) => {
      y0 = Math.min(y0, lo);
      y1 = Math.max(y1, hi);
    };
    const island = layout.islands.find((i) => i.landmark === lm.id);
    const spire = layout.spires.find((s) => s.landmark === lm.id);
    const arch = layout.arches.find((a) => a.landmark === lm.id && a.arcEnd - a.arcStart >= Math.PI * 2 - 1e-6);
    if (lm.id === 'archway') {
      // The whole chain: its four islets and three arches.
      for (const a of layout.arches.filter((a) => a.arcEnd - a.arcStart < Math.PI * 2 - 1e-6 && Math.hypot(a.x - lm.position[0], a.z - lm.position[2]) < 600)) {
        circles.push({ x: a.x, z: a.z, r: a.radius + 40 });
        grow(a.y - 120, a.y + a.radius + 120);
      }
      for (const i of layout.islands.filter((i) => Math.hypot(i.x - lm.position[0], i.z - lm.position[2]) < 600 && (i.kind === 'rocky' || i.landmark === 'archway'))) {
        circles.push({ x: i.x, z: i.z, r: i.radius + 40 });
        grow(i.y - i.depth - 40, i.y + 200);
      }
    } else if (lm.id === 'shelves') {
      for (const i of layout.islands.filter((i) => Math.hypot(i.x - lm.position[0], i.z - lm.position[2]) < 450 && (i.kind === 'islet' || i.kind === 'meadow'))) {
        circles.push({ x: i.x, z: i.z, r: i.radius + 50 });
        grow(i.y - i.depth - 40, i.y + 200);
      }
    } else if (lm.id === 'needles') {
      for (const s of layout.spires.filter((s) => !s.lantern)) {
        circles.push({ x: s.x, z: s.z, r: s.bellyRadius + 70 });
        grow(s.tipY - 60, s.topY + 160);
      }
    } else if (island) {
      circles.push({ x: island.x, z: island.z, r: island.radius * 1.1 + 50 });
      grow(island.y - island.depth - 60, island.y + 220);
    } else if (spire) {
      circles.push({ x: spire.x, z: spire.z, r: spire.bellyRadius + 110 });
      grow(spire.tipY - 80, spire.topY + 200);
    } else if (arch) {
      circles.push({ x: arch.x, z: arch.z, r: arch.radius + arch.tube + 90 });
      grow(arch.y - arch.radius - 160, arch.y + arch.radius + 160);
    } else {
      circles.push({ x: lm.position[0], z: lm.position[2], r: 220 });
      grow(lm.position[1] - 250, lm.position[1] + 250);
    }
    // The landmark's own point of interest always counts too.
    circles.push({ x: lm.position[0], z: lm.position[2], r: 150 });
    grow(lm.position[1] - 200, lm.position[1] + 200);
    zones.push({ landmarkId: lm.id, name: lm.name, circles, y0, y1 });
  }
  return zones;
}

/** True when (x, y, z) is inside the zone. */
export function inZone(z: DiscoveryZone, x: number, y: number, zz: number): boolean {
  if (y < z.y0 || y > z.y1) return false;
  for (const c of z.circles) if ((x - c.x) ** 2 + (zz - c.z) ** 2 <= c.r * c.r) return true;
  return false;
}

/** PURE: landmarks newly entered at this point, given what's already discovered. */
export function newlyDiscovered(zones: readonly DiscoveryZone[], discovered: readonly string[], x: number, y: number, z: number): DiscoveryZone[] {
  const out: DiscoveryZone[] = [];
  for (const zone of zones) if (!discovered.includes(zone.landmarkId) && inZone(zone, x, y, z)) out.push(zone);
  return out;
}
