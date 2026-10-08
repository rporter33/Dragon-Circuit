// Shared staging for the UI showcases (?view=ui-hud / ui-menu / ui-stable): the fake device,
// fake systems, a mid-game save, and a helper that freezes CSS animations at a chosen moment so
// headless screenshots (which drive time through __dw.advance, not the wall clock) are stable.

import type { InputDevice } from '../../core/types';
import type { GameView } from '../../game/contracts';
import type { Game } from '../../game/Game';
import { fakeProgress, installFakes, type FakeCollectibles, type FakeRaces } from './fakes';

export interface UiStage {
  races: FakeRaces;
  collectibles: FakeCollectibles;
  /** What the UI sees instead of the real systems; change it and call game.ui.setDebugView(patch). */
  patch: Partial<GameView>;
  device: InputDevice;
  /** Seconds since the showcase started (simulated). */
  t: number;
  /** One-shot actions keyed by name, so update() runs each once. */
  done: Set<string>;
}

export function stageUi(game: Game, params: URLSearchParams): UiStage {
  const device = (params.get('device') as InputDevice) ?? 'keyboard';
  const pad = (params.get('pad') as 'xbox' | 'playstation' | null) ?? 'xbox';
  const { races, collectibles, patch } = installFakes(game, {
    device,
    pad: device === 'gamepad' ? pad : null,
    pointer: params.get('pointer') === '1' ? { wanted: true, locked: false } : undefined,
  });
  if (params.get('progress') !== '0') fakeProgress(game);
  if (typeof window !== 'undefined') {
    (window as unknown as { __uiFreeze: (ms: number) => void }).__uiFreeze = freezeAnimations;
  }
  return { races, collectibles, patch, device, t: 0, done: new Set() };
}

/** Run `fn` once, the first frame `cond` holds. */
export function once(stage: UiStage, key: string, cond: boolean, fn: () => void): void {
  if (!cond || stage.done.has(key)) return;
  stage.done.add(key);
  fn();
}

/**
 * Freeze every running CSS animation `ms` into its active phase (after its delay) and finish
 * every transition, so a screenshot shows a deterministic moment.
 */
export function freezeAnimations(ms: number): void {
  for (const a of document.getAnimations()) {
    const isTransition = typeof CSSTransition !== 'undefined' && a instanceof CSSTransition;
    if (isTransition) {
      a.finish();
      continue;
    }
    const delay = Number(a.effect?.getTiming().delay ?? 0);
    a.pause();
    a.currentTime = delay + ms;
  }
}
