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
  /** A well on the plaza and a feeding trough near the wyvern's waiting spot. */
  well: { x: number; z: number };
  trough: { x: number; z: number; yaw: number };
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

  // If the terrain paints a worn track out to a launch point, follow it; otherwise use our own.
  const track = (roost as unknown as { track?: [number, number][] | null }).track ?? null;
  const deckAngle = track && track.length >= 2 ? Math.atan2(track[track.length - 1][1] - d.z, track[track.length - 1][0] - d.x) : DECK_ANGLE;
  // Launch deck root sits on the flat, a little inside the rim.
  const dirX = Math.cos(deckAngle);
  const dirZ = Math.sin(deckAngle);
  const rim = roost.outlineRadius(deckAngle);
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
  const pathStart = 52;
  const pathEnd = rootR - 1;
  // Centerline of the walk from the plaza to the deck: (x, z) at radius r from the center.
  const centerAt = (r: number): { x: number; z: number; tx: number; tz: number } => {
    if (track && track.length >= 2) {
      // Walk the terrain's track polyline to the point at radius r.
      for (let k = 0; k < track.length - 1; k++) {
        const ra = Math.hypot(track[k][0] - d.x, track[k][1] - d.z);
        const rb = Math.hypot(track[k + 1][0] - d.x, track[k + 1][1] - d.z);
        if (r <= rb || k === track.length - 2) {
          const u = Math.max(0, Math.min(1, (r - ra) / Math.max(1e-3, rb - ra)));
          const x = track[k][0] + (track[k + 1][0] - track[k][0]) * u;
          const z = track[k][1] + (track[k + 1][1] - track[k][1]) * u;
          const tl = Math.hypot(track[k + 1][0] - track[k][0], track[k + 1][1] - track[k][1]) || 1;
          return { x, z, tx: (track[k + 1][0] - track[k][0]) / tl, tz: (track[k + 1][1] - track[k][1]) / tl };
        }
      }
    }
    const wob = Math.sin(r * 0.11) * 2.5;
    return { x: d.x + dirX * r - dirZ * wob, z: d.z + dirZ * r + dirX * wob, tx: dirX, tz: dirZ };
  };
  const path: { x: number; z: number }[] = [];
  for (let r = pathStart; r <= pathEnd; r += 2.4) {
    const c = centerAt(r);
    path.push({ x: c.x, z: c.z });
  }
  const lanterns: RoostPlan['lanterns'] = [];
  for (let i = 0, r = pathStart + 4; r < pathEnd - 2; r += 13, i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const c = centerAt(r);
    // Posts stand beside the walk with their arms reaching over it.
    lanterns.push({ x: c.x - c.tz * side * 3.2, z: c.z + c.tx * side * 3.2, yaw: Math.atan2(c.tz * side, -c.tx * side) });
  }
  // Banner pairs at the start and end of the path.
  for (const r of [pathStart + 1, pathEnd - 1]) {
    const c = centerAt(r);
    for (const side of [-1, 1]) {
      banners.push({ x: c.x - c.tz * side * 4.5, z: c.z + c.tx * side * 4.5, yaw: Math.atan2(c.tx, c.tz), color: 'red' });
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
  // The well sits off to the right of the walk from the spawn to the stable door; the trough
  // stands a few strides from where the wyvern waits, facing it.
  const well = local(23, 22);
  const ws = layout.wyvernSpawn.position;
  const awayX = ws[0] - d.x;
  const awayZ = ws[2] - d.z;
  const al = Math.hypot(awayX, awayZ) || 1;
  const trough = { x: ws[0] - (awayZ / al) * 17, z: ws[2] + (awayX / al) * 17, yaw: Math.atan2(awayX, awayZ) };
  return {
    islandId: d.id,
    well,
    trough,
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
