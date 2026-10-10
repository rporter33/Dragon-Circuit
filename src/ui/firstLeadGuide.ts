import type { SaveData } from '../game/contracts';
import type { PlayerMode } from '../core/types';

type GuideSave = Pick<SaveData, 'tutorialDone' | 'tips' | 'firstLeadGuide' | 'research'>;

export function inscriptionRead(save: GuideSave): boolean {
  return !!save.research?.entries.includes('survey:gullrest-shrine:inscription');
}

/** Landing is taught on arrival; requiring its lesson here would delay the destination. */
export function readyForShrine(save: GuideSave): boolean {
  return !inscriptionRead(save) && !save.firstLeadGuide &&
    (save.tutorialDone || ['walk', 'takeoff', 'flap', 'pitch'].every((id) => save.tips?.includes(id)));
}

export function guidingToShrine(save: GuideSave): boolean {
  return save.firstLeadGuide === 'active' && !inscriptionRead(save);
}

export function shrineInstruction(mode: PlayerMode, distance: number): string {
  if (distance > 100) return 'Fly toward the Shrine of the First Wind. Open the tutorial map from Pause to check your route.';
  if (mode === 'landed') return 'Dismount with {dismount}, then walk to the inscription beneath the stone gateway.';
  if (mode === 'onFoot') return 'Walk to the inscription beneath the stone gateway. Press {interact} when “Read the inscription” appears.';
  return 'Approach low and slow. Hold {flare} just above clear ground to land beside the shrine.';
}
