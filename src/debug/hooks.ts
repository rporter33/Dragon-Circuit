// window.__dw: a handle for headless automation (screenshots, scripted flights, smoke tests).
// Installed in development builds, and in production only with ?manual=1 or ?debug=1 (main.ts
// loads this module on demand, so a normal production load carries none of it).

import type { InputFrame } from '../core/types';
import type { Game } from '../game/Game';
import { FIXED_DT } from '../game/Game';
import type { RenderStats, WarmupStats } from '../render/renderer';
import { wyvernPenetration, type Penetration } from '../creatures/wyvern/collision';

export interface BootTimings {
  /** ms since navigation start. */
  scriptStart: number;
  constructStart: number;
  constructEnd: number;
  warmupEnd: number;
  firstFrame: number;
  warmup?: WarmupStats;
}

export interface DebugHandle {
  game: Game;
  /** False while the boot warmup runs (automation should wait for true). */
  ready: boolean;
  /** Advance simulation + presentation by `seconds` in fixed steps, then render once. */
  advance(seconds: number, input?: Partial<InputFrame>): void;
  /** Render one frame without advancing time. */
  render(): void;
  /** Collected console errors and unhandled rejections. */
  errors: string[];
  /** Draw calls, triangles, programs and buffer size of the last frame. */
  stats(): RenderStats;
  /** Boot phase timings (filled in by main.ts). */
  boot: Partial<BootTimings>;
  /** The player's wyvern's deepest self-penetration per part pair as last posed (m; Q17). */
  wyvernPenetration(): Penetration | null;
}

export function installDebugHooks(game: Game): DebugHandle {
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  // Errors the frame guard contains never reach window.onerror; collect them too.
  const consoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    errors.push(args.map((a) => String((a as Error)?.message ?? a)).join(' '));
    consoleError(...args);
  };
  const handle: DebugHandle = {
    game,
    ready: true,
    errors,
    boot: {},
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
    stats() {
      return game.renderer.stats;
    },
    wyvernPenetration() {
      return wyvernPenetration(game.wyvern);
    },
  };
  (window as unknown as { __dw: DebugHandle }).__dw = handle;
  return handle;
}
