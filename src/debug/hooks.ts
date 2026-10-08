// window.__dw: a handle for headless automation (screenshots, scripted flights, smoke tests).

import type { InputFrame } from '../core/types';
import type { Game } from '../game/Game';
import { FIXED_DT } from '../game/Game';

export interface DebugHandle {
  game: Game;
  ready: boolean;
  /** Advance simulation + presentation by `seconds` in fixed steps, then render once. */
  advance(seconds: number, input?: Partial<InputFrame>): void;
  /** Render one frame without advancing time. */
  render(): void;
  /** Collected console errors and unhandled rejections. */
  errors: string[];
}

export function installDebugHooks(game: Game): DebugHandle {
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  const handle: DebugHandle = {
    game,
    ready: true,
    errors,
    advance(seconds, input) {
      game.input.setScripted(input ?? null);
      // Simulate at 30 presentation frames per second without rendering; render() draws.
      const frames = Math.max(1, Math.round(seconds / (FIXED_DT * 4)));
      for (let i = 0; i < frames; i++) game.frame(FIXED_DT * 4, false);
      game.input.setScripted(null);
    },
    render() {
      game.frame(0);
    },
  };
  (window as unknown as { __dw: DebugHandle }).__dw = handle;
  return handle;
}
