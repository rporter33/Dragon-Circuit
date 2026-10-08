// Home: where the stable is and where to fall back to when nowhere else is safe.
//
// Today home is the Roost, fixed in the layout. A later release adds an airship that carries the
// stable around the far regions, so nothing in gameplay reads the layout's stable or spawn
// constants directly: prompts, the stable door, a new game's spawn and the last-resort respawn
// all ask a HomeAnchor, every time, and a moving home simply answers differently each frame.

import { Vector3 } from 'three';
import type { TerrainQuery } from '../core/types';
import type { WorldLayout } from '../world/layout';

export interface HomeAnchor {
  /** True when `p` (world) is within reach of the stable door. */
  nearStable(p: Vector3): boolean;
  /** The stable door on the ground (world). */
  stableDoor(out: Vector3): Vector3;
  /** Where the rider starts a new game (a point on the ground); returns the facing yaw. */
  riderStart(out: Vector3): number;
  /** Where the wyvern waits at a new game (a point on the ground); returns the facing yaw. */
  wyvernStart(out: Vector3): number;
  /**
   * The last-resort respawn: a point on solid ground (the wyvern returns gliding above it) and
   * a facing yaw. Used when the last place the player stood safely is gone or unusable.
   */
  respawn(out: Vector3): number;
}

/** The Roost: home as the layout places it (it never moves). */
export class FixedHome implements HomeAnchor {
  constructor(
    private readonly layout: WorldLayout,
    private readonly terrain: TerrainQuery,
  ) {}

  nearStable(p: Vector3): boolean {
    const st = this.layout.stable;
    return Math.hypot(p.x - st.x, p.z - st.z) < st.interactRadius;
  }

  stableDoor(out: Vector3): Vector3 {
    const st = this.layout.stable;
    return this.ground(st.x, st.z, out);
  }

  riderStart(out: Vector3): number {
    const sp = this.layout.spawn;
    this.ground(sp.position[0], sp.position[2], out);
    return sp.yaw;
  }

  wyvernStart(out: Vector3): number {
    const ws = this.layout.wyvernSpawn;
    this.ground(ws.position[0], ws.position[2], out);
    return ws.yaw;
  }

  respawn(out: Vector3): number {
    return this.wyvernStart(out);
  }

  private ground(x: number, z: number, out: Vector3): Vector3 {
    const g = this.terrain.groundAt(x, z, 1e6);
    return out.set(x, g ? g.y : 300, z);
  }
}
