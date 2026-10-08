import { Game } from './game/Game';
import { installDebugHooks } from './debug/hooks';

const app = document.getElementById('app')!;
const ui = document.getElementById('ui')!;

try {
  const game = new Game(app, ui);
  installDebugHooks(game);
  game.start();
} catch (err) {
  console.error(err);
  ui.innerHTML = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font:16px system-ui;text-align:center;padding:24px">
    Driftwing could not start: ${String((err as Error)?.message ?? err)}.<br/>It needs a browser with WebGL 2.</div>`;
}
