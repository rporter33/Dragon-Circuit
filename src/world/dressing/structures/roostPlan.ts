// Site plan for the Windward Roost: where the stable, rookery towers, banners, lanterns, paddock
// and launch deck stand. Pure data from the layout and terrain, so tests can check nothing blocks
// the spawn points or the stable door.

import type { Terrain } from '../../terrain';
import type { WorldLayout } from '../../layout';

export interface TowerPlan {
  x: number;
  z: number;
  y: number;
  radius: number;
  height: number;
  /** Yaw of the door (faces the plaza). */
  doorYaw: number;
}

export interface RoostPlan {
  islandId: number;
  ground: number;
  stable: { x: number; z: number; yaw: number; width: number; depth: number };
  towers: TowerPlan[];
  /** Launch deck: root on land, extends outward over the rim along `dir`. */
  deck: { x: number; z: number; y: number; dirX: number; dirZ: number; yaw: number; length: number; halfWidth: number; rimDist: number };
  banners: { x: number; z: number; yaw: number; color: 'blue' | 'red' }[];
  lanterns: { x: number; z: number; yaw: number }[];
  /** Paddock fence polygon (closed loop with a gate gap between the last and first post). */
  paddock: { x: number; z: number }[];
  /** Flagstone path points from the plaza edge to the deck root. */
  path: { x: number; z: number }[];
  /** Spots that must stay clear: spawn, wyvern spawn, stable door apron. */
  clear: { x: number; z: number; r: number }[];
}

/** Direction from the Roost toward Gull's Rest — the launch deck points at the first glide. */
const DECK_ANGLE = (37 * Math.PI) / 180;

export function roostPlan(layout: WorldLayout, terrain: Terrain): RoostPlan | null {
  const roost = terrain.islands.find((s) => s.def.kind === 'roost');
  if (!roost) return null;
  const d = roost.def;
  const st = layout.stable;
  const ground = roost.topHeight(st.x, st.z);
  // Stable frame: door at (st.x, st.z), facing (sin yaw, cos yaw); the building runs behind.
  const fx = Math.sin(st.yaw);
  const fz = Math.cos(st.yaw);
  const rx = Math.cos(st.yaw);
  const rz = -Math.sin(st.yaw);
  const local = (lx: number, lz: number) => ({ x: st.x + rx * lx + fx * lz, z: st.z + rz * lx + fz * lz });

  const towerDefs: [number, number, number, number][] = [
    // local x, local z (negative = behind the door line), height, radius
    [-30, -14, 25, 4.2],
    [36, -30, 20, 3.8],
    [-46, 30, 16, 3.4],
  ];
  const towers: TowerPlan[] = towerDefs.map(([lx, lz, h, r]) => {
    const p = local(lx, lz);
    return { x: p.x, z: p.z, y: roost.topHeight(p.x, p.z), radius: r, height: h, doorYaw: Math.atan2(d.x - p.x, d.z - p.z) };
  });

  // Launch deck root sits on the flat, a little inside the rim.
  const dirX = Math.cos(DECK_ANGLE);
  const dirZ = Math.sin(DECK_ANGLE);
  const rim = roost.outlineRadius(DECK_ANGLE);
  const rootR = rim - 12;
  const rootX = d.x + dirX * rootR;
  const rootZ = d.z + dirZ * rootR;
  const deckY = Math.max(roost.topHeight(rootX, rootZ), roost.topHeight(d.x + dirX * (rim - 4), d.z + dirZ * (rim - 4))) + 0.8;
  const deck = {
    x: rootX,
    z: rootZ,
    y: deckY,
    dirX,
    dirZ,
    yaw: Math.atan2(dirX, dirZ),
    length: 12 + 18,
    halfWidth: 3.5,
    rimDist: 12,
  };

  // Banners flank the stable front and line the walk to the deck.
  const banners: RoostPlan['banners'] = [
    { ...local(-15, -1), yaw: st.yaw, color: 'blue' },
    { ...local(15, -1), yaw: st.yaw, color: 'blue' },
  ];
  const path: { x: number; z: number }[] = [];
  const pathStart = 52;
  const pathEnd = rootR - 1;
  for (let r = pathStart; r <= pathEnd; r += 2.4) {
    const wob = Math.sin(r * 0.11) * 2.5;
    path.push({ x: d.x + dirX * r - dirZ * wob, z: d.z + dirZ * r + dirX * wob });
  }
  const lanterns: RoostPlan['lanterns'] = [];
  for (let i = 0, r = pathStart + 4; r < pathEnd - 2; r += 13, i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const wob = Math.sin(r * 0.11) * 2.5;
    lanterns.push({ x: d.x + dirX * r - dirZ * (wob + side * 3.2), z: d.z + dirZ * r + dirX * (wob + side * 3.2), yaw: Math.atan2(-dirZ * -side, dirX * -side) });
  }
  // Banner pairs at the start and end of the path.
  for (const r of [pathStart + 1, pathEnd - 1]) {
    const wob = Math.sin(r * 0.11) * 2.5;
    for (const side of [-1, 1]) {
      banners.push({
        x: d.x + dirX * r - dirZ * (wob + side * 4.5),
        z: d.z + dirZ * r + dirX * (wob + side * 4.5),
        yaw: Math.atan2(dirX, dirZ),
        color: 'red',
      });
    }
  }
  // Lanterns at the stable front corners and around the plaza.
  lanterns.push({ ...local(-11, 4), yaw: st.yaw }, { ...local(11, 4), yaw: st.yaw });
  for (const a of [0.15, 1.6, 3.5, 5.9]) {
    lanterns.push({ x: d.x + Math.cos(a) * 49, z: d.z + Math.sin(a) * 49, yaw: a + Math.PI });
  }

  // Paddock beside the stable (to its right as you face the door).
  const paddock = [local(16, -6), local(28, -6), local(28, -21), local(16, -21)];

  const clear = [
    { x: layout.spawn.position[0], z: layout.spawn.position[2], r: 5 },
    { x: layout.wyvernSpawn.position[0], z: layout.wyvernSpawn.position[2], r: 13 },
    { ...local(0, 7), r: 8 },
  ];
  return {
    islandId: d.id,
    ground,
    stable: { x: st.x, z: st.z, yaw: st.yaw, width: 24, depth: 20 },
    towers,
    deck,
    banners,
    lanterns,
    paddock,
    path,
    clear,
  };
}
