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
/** Reserved attachment sockets only: occupancy, ropes and multiplayer are future systems. */
export const WINDHAVEN_HITCHES = [-1, 1].flatMap(side => [-4, 10].map((z, i) => ({
  id: `${side < 0 ? 'starboard' : 'port'}-${i + 1}`, x: side * 13.35, y: 1.35, z, side, capacity: 1,
})));
export const CABIN_WALLS = [
  { id: 'front', x: 0, z: 26, yaw: 0, length: 8, windows: [-2.5, 0, 2.5], width: 1.45 },
  ...[-1, 1].map(side => ({ id: `side-${side}`, x: side * 4, z: 21, yaw: side * Math.PI / 2, length: 10, windows: [-3, 0, 3], width: 1.45 })),
  ...[-1, 1].map(side => ({ id: `door-${side}`, x: side * 2.8, z: 16, yaw: Math.PI, length: 2.4, windows: [0], width: 1.2 })),
];
export const WINDOW_SILL = 0.95, WINDOW_SHOULDER = 2.9;
/** Rounded stern corners and an elliptical bow; overall 72 x 28 m envelope is unchanged. */
export function windhavenDeckHalfWidth(z: number): number {
  if (z < -36 || z > 36) return 0;
  if (z < -34.8) return 12.8 + Math.sqrt(Math.max(0, 1.44 - (z + 34.8) ** 2));
  if (z <= 14) return 14;
  return 14 * Math.sqrt(Math.max(0, 1 - ((z - 14) / 22) ** 2));
}
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
  const add = (id: string, finish: Finish, x: number, y: number, z: number, w: number, h: number, d: number, yaw = 0, roundXZ = 0) => {
    parts.push({ id, finish, box: { kind: 'box', x, y, z, hx: w / 2, hy: h / 2, hz: d / 2, yaw, surface: 'wood', ...(roundXZ > 0 ? { roundXZ } : {}) } });
  };
  // Broad usable middle stays intact. Only perimeter corners/bow are reshaped.
  // Bow slices overlap the forward rounding so no inward notch interrupts the side route.
  add('deck-main', 'deck', 0, -0.4, -10.525, 28, 0.8, 50.95, 0, 1.2);
  for (let z = 13.875; z < 36; z += 0.25) {
    add(`deck-bow-${z}`, 'deck', 0, -0.4, z, 2 * windhavenDeckHalfWidth(z), 0.8, 0.25);
  }
  for (let z = -7; z < 35; z += 1) {
    const beam = 2 * windhavenDeckHalfWidth(z);
    for (const side of [-1, 1]) {
      // Rails stop before the landing terrace. Both side approaches and the stern stay open.
      if (z >= -7) {
        if (z < 35) {
          const nextBeam = 2 * windhavenDeckHalfWidth(z + 1);
          const dx = side * (nextBeam - beam) / 2;
          add(`rail-${side}-${z}`, 'timber', side * (beam / 2 - 0.15) + dx / 2, 1.12, z + 0.5, 0.3, 0.16, Math.hypot(dx, 1) + 0.03, Math.atan2(dx, 1), 0.14);
        }
        if ((z + 7) % 4 === 0) add(`baluster-${side}-${z}`, 'cream', side * (beam / 2 - 0.15), 0.52, z, 0.3, 1.04, 0.3, 0, 0.14);
      }
    }
  }
  // Fine overlapping strakes make the rounded underbody from the SAME boxes used by
  // collision. No smooth decorative hull hides a differently shaped collision proxy.
  for (let z = -35.75; z < 36; z += 0.5) {
    const beam = 2 * windhavenDeckHalfWidth(z);
    const fullness = Math.pow(Math.max(0, Math.sin((z + 36) / 72 * Math.PI)), 0.65);
    const depth = 1.2 + 5.2 * fullness;
    for (let row = 0; row < 12; row++) {
      const t = row / 12;
      const width = beam * 0.99 * Math.sqrt(1 - Math.pow(t, 1.4));
      const height = depth / 12;
      add(`strake-${z}-${row}`, row === 1 || row === 2 ? 'blue' : row === 11 ? 'timber' : 'cream',
        0, -0.8 - (row + 0.5) * height, z, width, height, 0.5);
    }
  }
  // Shelter faces aft: no gate, threshold or centre post across the dragon route.
  for (const x of [-7.3, 7.3]) {
    for (const z of [-9.5, 5.5]) add(`shelter-post-${x}-${z}`, 'bronze', x, 4.8, z, 0.4, 9.6, 0.4, 0, 0.19);
  }
  add('shelter-roof', 'cream', 0, 9.8, -2, 15.2, 0.4, 16);
  add('shelter-back', 'blue', 0, 3, 6, 14.8, 6, 0.3);
  // Cabin has a 3 m aft doorway and side routes. Floors remain flush throughout the ship.
  for (const wall of CABIN_WALLS) {
    let piece = 0;
    const rect = (u: number, y: number, width: number, height: number) => {
      if (width <= 0.0001) return;
      add(`cabin-${wall.id}-${piece++}`, 'cream', wall.x + Math.cos(wall.yaw) * u, y, wall.z - Math.sin(wall.yaw) * u, width, height, 0.3, wall.yaw);
    };
    const r = wall.width / 2, top = WINDOW_SHOULDER + r;
    rect(0, WINDOW_SILL / 2, wall.length, WINDOW_SILL);
    rect(0, (4.4 + top) / 2, wall.length, 4.4 - top);
    let edge = -wall.length / 2;
    for (const centre of wall.windows) {
      rect((edge + centre - r) / 2, (WINDOW_SILL + top) / 2, centre - r - edge, top - WINDOW_SILL);
      // Small explicit masonry slices shape the arch and the collision hole identically.
      for (let row = 0; row < 24; row++) {
        const low = r * Math.sin(row / 24 * Math.PI / 2);
        const high = r * Math.sin((row + 1) / 24 * Math.PI / 2);
        const y = WINDOW_SHOULDER + (low + high) / 2;
        const gap = Math.sqrt(Math.max(0, r * r - ((low + high) / 2) ** 2));
        for (const side of [-1, 1]) rect(centre + side * (r + gap) / 2, y, r - gap, high - low);
      }
      edge = centre + r;
    }
    rect((edge + wall.length / 2) / 2, (WINDOW_SILL + top) / 2, wall.length / 2 - edge, top - WINDOW_SILL);
  }
  add('cabin-roof', 'blue', 0, 4.6, 21, 8.8, 0.4, 11, 0, 0.5);
  for (const hitch of WINDHAVEN_HITCHES) {
    add(`hitch-${hitch.id}`, 'timber', hitch.x, 0.65, hitch.z, 0.7, 1.3, 0.7, 0, 0.34);
    add(`hitch-base-${hitch.id}`, 'bronze', hitch.x, 0.12, hitch.z, 1, 0.24, 1, 0, 0.35);
  }
  for (const x of [-10.5, 10.5]) {
    add(`worktable-${x}`, 'timber', x, 0.6, 10, 2.5, 1.2, 3, 0, 0.15);
    add(`storage-${x}`, 'blue', x, 0.65, 5.5, 2.5, 1.3, 1.6, 0, 0.15);
  }
  add('chart-table', 'bronze', 0, 0.65, 30, 2.6, 1.3, 1.6);
  // Masts stand outside the centre passage, forward of the dragon shelter.
  for (const x of [-6, 6]) add(`mast-${x}`, 'bronze', x, 10, 14, 0.6, 20, 0.6, 0, 0.29);
  return parts;
}

export function windhavenColliders(parts = windhavenPlan(), origin = WINDHAVEN_ORIGIN): BoxCollider[] {
  return parts.map(({ box }) => ({ ...box, x: box.x + origin.x, y: box.y + origin.y, z: box.z + origin.z }));
}
