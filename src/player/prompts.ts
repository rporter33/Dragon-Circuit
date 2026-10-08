// Context prompts: the one hint the HUD shows for what the player can do right now ("Flare to
// land", "Mount", "Open the Stable"...). Game calls computePrompt once per frame during play.

import type { Vector3 } from 'three';
import type { PromptAction } from '../game/contracts';
import type { WorldLayout } from '../world/layout';
import type { Player } from './Player';
import { PLAYER_TUNING as P } from './tuning';

export interface Prompt {
  action: PromptAction;
  text: string;
}

/** True when `p` is within reach of the stable door. */
export function nearStable(p: Vector3, layout: WorldLayout): boolean {
  const st = layout.stable;
  return Math.hypot(p.x - st.x, p.z - st.z) < st.interactRadius;
}

/** Heights and speeds under which "flare to land" is worth suggesting. */
const FLARE_HINT_HEIGHT = 25;
const FLARE_HINT_SPEED = 30;

export function computePrompt(player: Player, layout: WorldLayout): Prompt | null {
  switch (player.mode) {
    case 'flying': {
      const f = player.flight;
      if (f.stall > 0.5) return { action: 'tuck', text: 'Stalling — lower the nose to recover' };
      if (f.winded) return { action: 'flap', text: 'Winded — glide to catch your breath' };
      // Low, slow and coming down (not just after a takeoff, not while beating to climb away).
      const h = player.heightAboveGround;
      const descending = f.velocity.y < -1 && f.flapStrength < 0.2 && player.modeTime > 3;
      if (h !== null && h < FLARE_HINT_HEIGHT && f.airspeed < FLARE_HINT_SPEED && f.flare < 0.5 && descending) {
        return { action: 'flare', text: 'Flare to land' };
      }
      return null;
    }
    case 'landed':
      if (nearStable(player.riderPosition, layout)) return { action: 'stable', text: 'Open the Stable' };
      // Moving (or just landed): taking off is the likely next move; standing still, getting off.
      if (player.groundStillTime > 1.2) return { action: 'dismount', text: 'Dismount' };
      return { action: 'flap', text: 'Take off' };
    case 'onFoot':
      if (player.wyvernDistance <= P.mountRange) return { action: 'mount', text: 'Mount' };
      if (nearStable(player.riderPosition, layout)) return { action: 'stable', text: 'Open the Stable' };
      if (player.wyvernDistance > P.followDistance + 10) return { action: 'interact', text: 'Call your wyvern' };
      return null;
    default:
      return null;
  }
}
