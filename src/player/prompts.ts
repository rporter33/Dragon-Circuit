// Context prompts: the one hint the HUD shows for what the player can do right now ("Flare now",
// "Mount", "Open the Stable"...). Game calls computePrompt once per frame during play.
//
// The glyph the HUD draws comes from `action`, so the action must be the control the text asks
// for: a stall is flown out of with a beat, and low stamina asks for no button at all ('rest').

import type { Vector3 } from 'three';
import type { PromptAction } from '../game/contracts';
import type { WorldLayout } from '../world/layout';
import type { Player } from './Player';
import { PLAYER_TUNING as P } from './tuning';

export interface Prompt {
  action: PromptAction;
  text: string;
}

/** True when `p` is within reach of the Roost's stable door (prefer `player.home.nearStable`). */
export function nearStable(p: Vector3, layout: WorldLayout): boolean {
  const st = layout.stable;
  return Math.hypot(p.x - st.x, p.z - st.z) < st.interactRadius;
}

/** "Flare now": low, slow, coming down and about to arrive (time to the ground, seconds). */
const FLARE_NOW_HEIGHT = 10;
const FLARE_NOW_TIME = 1.6;
/** A heads-up earlier in the approach: low and still quick. */
const APPROACH_HEIGHT = 25;
const APPROACH_SPEED = 20;
const LANDING_MAX_SPEED = 30;
/** Low stamina: suggest a rest while the meter is nearly dry and the wings are still working. */
const LOW_STAMINA = 0.2;

// Every prompt is a constant: computePrompt runs every frame and must not allocate.
const STALL: Prompt = { action: 'flap', text: 'Stalling — ease off and beat your wings' };
const LOW_STAMINA_REST: Prompt = { action: 'rest', text: 'Low on stamina — glide or land to rest' };
const FLARE_NOW: Prompt = { action: 'flare', text: 'Flare now' };
const SLOW_FOR_LANDING: Prompt = { action: 'flare', text: 'Slow down for landing' };
const OPEN_STABLE: Prompt = { action: 'stable', text: 'Open the Stable' };
const DISMOUNT: Prompt = { action: 'dismount', text: 'Dismount' };
const DISMOUNT_RACING: Prompt = { action: 'dismount', text: 'Dismount (ends the race)' };
const TAKE_OFF: Prompt = { action: 'flap', text: 'Take off (hold to climb)' };
const MOUNT: Prompt = { action: 'mount', text: 'Mount' };
const CALL_WYVERN: Prompt = { action: 'interact', text: 'Call your wyvern' };

export function computePrompt(player: Player, _layout?: WorldLayout, racing = false): Readonly<Prompt> | null {
  const home = player.home;
  switch (player.mode) {
    case 'flying': {
      const f = player.flight;
      if (f.stall > 0.5) return STALL;
      if (f.stamina < LOW_STAMINA && (f.flapStrength > 0.1 || f.stamina < 0.05)) return LOW_STAMINA_REST;
      // Low, slow and coming down (not just after a takeoff, not while beating to climb away).
      const h = player.heightAboveGround;
      const sink = -f.velocity.y;
      const descending = sink > 1 && f.flapStrength < 0.2 && player.modeTime > 3;
      if (h === null || !descending || f.flare > 0.5 || f.airspeed > LANDING_MAX_SPEED) return null;
      const legs = h - player.breed.standHeight;
      if (legs < FLARE_NOW_HEIGHT && legs / Math.max(1, sink) < FLARE_NOW_TIME) return FLARE_NOW;
      if (legs < APPROACH_HEIGHT && f.airspeed > APPROACH_SPEED) return SLOW_FOR_LANDING;
      return null;
    }
    case 'landed':
      if (home.nearStable(player.riderPosition)) return OPEN_STABLE;
      // Moving (or just landed): taking off is the likely next move; standing still, getting off.
      if (player.groundStillTime > 1.2) return racing ? DISMOUNT_RACING : DISMOUNT;
      return TAKE_OFF;
    case 'onFoot':
      if (player.canMount) return MOUNT;
      if (home.nearStable(player.riderPosition)) return OPEN_STABLE;
      if (player.wyvernDistance > P.followDistance + 10) return CALL_WYVERN;
      return null;
    default:
      return null;
  }
}
