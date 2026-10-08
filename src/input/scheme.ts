// The control scheme as data: what the controls screen lists and how prompts name buttons.
// The input module owner keeps this in sync with Input.ts.

import type { InputDevice } from '../core/types';

export type ControlAction =
  | 'pitch' | 'roll' | 'yaw' | 'flap' | 'tuck' | 'flare' | 'look' | 'recenter'
  | 'move' | 'jump' | 'sprint' | 'interact' | 'mount' | 'dismount' | 'stable'
  | 'pause' | 'restart' | 'toggleHud' | 'confirm' | 'back' | 'tabPrev' | 'tabNext';

export type PadStyle = 'xbox' | 'playstation' | 'generic';

export interface Binding {
  action: ControlAction;
  /** Human description for the controls screen. */
  label: string;
  /** Which context the binding belongs to. */
  context: 'flight' | 'ground' | 'menu' | 'general';
  xbox: string;
  playstation: string;
  keyboard: string;
}

export const SCHEME: Binding[] = [
  { action: 'pitch', label: 'Pitch (nose up / down)', context: 'flight', xbox: 'LS ↕', playstation: 'L ↕', keyboard: 'W / S' },
  { action: 'roll', label: 'Bank left / right', context: 'flight', xbox: 'LS ↔', playstation: 'L ↔', keyboard: 'A / D' },
  { action: 'yaw', label: 'Rudder', context: 'flight', xbox: 'LB / RB', playstation: 'L1 / R1', keyboard: 'Q / E' },
  { action: 'flap', label: 'Beat wings (costs stamina)', context: 'flight', xbox: 'RT', playstation: 'R2', keyboard: 'Space' },
  { action: 'flare', label: 'Flare — brake and land', context: 'flight', xbox: 'LT', playstation: 'L2', keyboard: 'Ctrl / C' },
  { action: 'tuck', label: 'Tuck wings — dive', context: 'flight', xbox: 'A', playstation: '✕', keyboard: 'Shift' },
  { action: 'look', label: 'Look around', context: 'general', xbox: 'RS', playstation: 'R', keyboard: 'Mouse' },
  { action: 'recenter', label: 'Recenter camera', context: 'general', xbox: 'R3', playstation: 'R3', keyboard: 'V' },
  { action: 'move', label: 'Walk', context: 'ground', xbox: 'LS', playstation: 'L', keyboard: 'WASD' },
  { action: 'jump', label: 'Jump', context: 'ground', xbox: 'A', playstation: '✕', keyboard: 'Space' },
  { action: 'sprint', label: 'Run', context: 'ground', xbox: 'B (hold)', playstation: '○ (hold)', keyboard: 'Shift' },
  { action: 'interact', label: 'Interact', context: 'ground', xbox: 'Y', playstation: '△', keyboard: 'F' },
  { action: 'mount', label: 'Mount your wyvern', context: 'ground', xbox: 'Y', playstation: '△', keyboard: 'F' },
  { action: 'dismount', label: 'Dismount (when landed)', context: 'ground', xbox: 'Y', playstation: '△', keyboard: 'F' },
  { action: 'stable', label: 'Open the Stable', context: 'ground', xbox: 'Y', playstation: '△', keyboard: 'F' },
  { action: 'restart', label: 'Restart race', context: 'general', xbox: 'View', playstation: 'Create', keyboard: 'R' },
  { action: 'toggleHud', label: 'Hide HUD', context: 'general', xbox: 'D-pad ↑', playstation: 'D-pad ↑', keyboard: 'H' },
  { action: 'pause', label: 'Pause menu', context: 'general', xbox: 'Menu', playstation: 'Options', keyboard: 'Esc' },
  { action: 'confirm', label: 'Select', context: 'menu', xbox: 'A', playstation: '✕', keyboard: 'Enter' },
  { action: 'back', label: 'Back', context: 'menu', xbox: 'B', playstation: '○', keyboard: 'Esc' },
  { action: 'tabPrev', label: 'Previous tab', context: 'menu', xbox: 'LB', playstation: 'L1', keyboard: 'Q' },
  { action: 'tabNext', label: 'Next tab', context: 'menu', xbox: 'RB', playstation: 'R1', keyboard: 'E' },
];

/** The button name to show in a prompt for this action on the current device. */
export function glyph(action: ControlAction, device: InputDevice, padStyle: PadStyle | null): string {
  const b = SCHEME.find((s) => s.action === action);
  if (!b) return '?';
  if (device === 'keyboard') return b.keyboard;
  return padStyle === 'playstation' ? b.playstation : b.xbox;
}
