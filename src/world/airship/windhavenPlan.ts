// Stationary art study. Ship-local +Z points toward the bow; deck top is y=0.
// Every solid box is shared by the renderer and terrain queries. Cloth is visual-only.
import type { BoxCollider } from '../../core/types';

export type Finish = 'deck' | 'cream' | 'blue' | 'bronze' | 'timber';
export interface ShipPart {
  id: string;
  finish: Finish;
  box: BoxCollider;
}
export interface DeckZone {
  id: 'landing' | 'stable' | 'workshop-port' | 'workshop-starboard' | 'cabin' | 'helm';
  label: string;
  x: number;
  z: number;
  width: number;
  length: number;
}
export const WINDHAVEN_ORIGIN = { x: 400, y: 650, z: 0 };
export const WINDHAVEN_ZONES: readonly DeckZone[] = [
  { id: 'landing', label: 'Landing terrace', x: 0, z: -23, width: 28, length: 26 },
  { id: 'stable', label: 'Dragon shelter', x: 0, z: -2, width: 14, length: 16 },
  { id: 'workshop-port', label: 'Crafting area', x: 9.5, z: 9, width: 5, length: 10 },
  { id: 'workshop-starboard', label: 'Storage and crafting', x: -9.5, z: 9, width: 5, length: 10 },
  { id: 'cabin', label: 'Living cabin', x: 0, z: 21, width: 8, length: 10 },
  { id: 'helm', label: 'Chart deck', x: 0, z: 30, width: 7, length: 6 },
];

export function windhavenPlan(): ShipPart[] {
  const parts: ShipPart[] = [];
  const add = (id: string, finish: Finish, x: number, y: number, z: number, w: number, h: number, d: number, yaw = 0) => {
    parts.push({ id, finish, box: { kind: 'box', x, y, z, hx: w / 2, hy: h / 2, hz: d / 2, yaw, surface: 'wood' } });
  };
  // Narrow ends, broad working middle, and an intentionally generous open stern.
  for (let z = -35; z <= 35; z += 2) {
    const beam = z <= 15 ? 28 : Math.max(3, 28 - (z - 15) * 1.15);
    add(`deck-${z}`, 'deck', 0, -0.4, z, beam, 0.8, 2);
    for (const side of [-1, 1]) {
      // Rails stop before the landing terrace. Both side approaches and the stern stay open.
      if (z >= -7) {
        if (z < 35) {
          const nextBeam = z + 2 <= 15 ? 28 : Math.max(3, 28 - (z + 2 - 15) * 1.15);
          const dx = side * (nextBeam - beam) / 2;
          add(`rail-${side}-${z}`, 'timber', side * (beam / 2 - 0.15) + dx / 2, 1.12, z + 1, 0.3, 0.16, Math.hypot(dx, 2) + 0.03, Math.atan2(dx, 2));
        }
        if ((z + 7) % 4 === 0) add(`baluster-${side}-${z}`, 'cream', side * (beam / 2 - 0.15), 0.52, z, 0.3, 1.04, 0.3);
      }
    }
  }
  // Fine overlapping strakes make the rounded underbody from the SAME boxes used by
  // collision. No smooth decorative hull hides a differently shaped collision proxy.
  // The original deck rectangles above stay byte-for-byte dimensionally unchanged.
  for (let z = -35.5; z < 36; z += 1) {
    const deckZ = Math.floor((z + 36) / 2) * 2 - 35;
    const beam = deckZ <= 15 ? 28 : Math.max(3, 28 - (deckZ - 15) * 1.15);
    const fullness = Math.pow(Math.max(0, Math.sin((z + 36) / 72 * Math.PI)), 0.65);
    const depth = 1.2 + 5.2 * fullness;
    for (let row = 0; row < 12; row++) {
      const t = row / 12;
      const width = beam * 0.99 * Math.sqrt(1 - Math.pow(t, 1.4));
      const height = depth / 12;
      add(`strake-${z}-${row}`, row === 1 || row === 2 ? 'blue' : row === 11 ? 'timber' : 'cream',
        0, -0.8 - (row + 0.5) * height, z, width, height, 1);
    }
  }
  // Shelter faces aft: no gate, threshold or centre post across the dragon route.
  for (const x of [-7.3, 7.3]) {
    for (const z of [-9.5, 5.5]) add(`shelter-post-${x}-${z}`, 'bronze', x, 4.8, z, 0.4, 9.6, 0.4);
  }
  add('shelter-roof', 'cream', 0, 9.8, -2, 15.2, 0.4, 16);
  add('shelter-back', 'blue', 0, 3, 6, 14.8, 6, 0.3);
  // Cabin has a 3 m aft doorway and side routes. Floors remain flush throughout the ship.
  add('cabin-front', 'cream', 0, 2.2, 26, 8, 4.4, 0.3);
  for (const x of [-4, 4]) add(`cabin-side-${x}`, 'cream', x, 2.2, 21, 0.3, 4.4, 10);
  for (const x of [-2.8, 2.8]) add(`cabin-door-${x}`, 'cream', x, 2.2, 16, 2.4, 4.4, 0.3);
  add('cabin-roof', 'blue', 0, 4.6, 21, 8.8, 0.4, 11);
  for (const x of [-10.5, 10.5]) {
    add(`worktable-${x}`, 'timber', x, 0.6, 10, 2.5, 1.2, 3);
    add(`storage-${x}`, 'blue', x, 0.65, 5.5, 2.5, 1.3, 1.6);
  }
  add('chart-table', 'bronze', 0, 0.65, 30, 2.6, 1.3, 1.6);
  // Masts stand outside the centre passage, forward of the dragon shelter.
  for (const x of [-6, 6]) add(`mast-${x}`, 'bronze', x, 10, 14, 0.6, 20, 0.6);
  return parts;
}

export function windhavenColliders(parts = windhavenPlan(), origin = WINDHAVEN_ORIGIN): BoxCollider[] {
  return parts.map(({ box }) => ({ ...box, x: box.x + origin.x, y: box.y + origin.y, z: box.z + origin.z }));
}
