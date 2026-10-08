import { Game } from './game/Game';
import { installDebugHooks } from './debug/hooks';

const app = document.getElementById('app')!;
const ui = document.getElementById('ui')!;
const boot = document.getElementById('boot');

function hideBoot(): void {
  if (!boot) return;
  boot.classList.add('done');
  setTimeout(() => boot.remove(), 900);
}

function showError(err: unknown): void {
  console.error(err);
  const box = document.createElement('div');
  box.style.cssText =
    'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font:16px system-ui;text-align:center;padding:24px;pointer-events:auto';
  box.textContent = `Driftwing could not start: ${String((err as Error)?.message ?? err)}. It needs a browser with WebGL 2.`;
  ui.replaceChildren(box);
  hideBoot();
}

function start(): void {
  try {
    const game = new Game(app, ui);
    installDebugHooks(game);
    game.start();
    // Let the first frame (and its shader compiles) land before revealing the world.
    requestAnimationFrame(() => requestAnimationFrame(hideBoot));
  } catch (err) {
    showError(err);
  }
}

// Building the archipelago blocks the main thread for a moment; paint the splash first.
requestAnimationFrame(() => setTimeout(start, 0));
