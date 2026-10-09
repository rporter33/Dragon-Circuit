// Boot: paint the splash, build the game, compile its shaders behind the splash, then start the
// loop and reveal the world once the first frames have landed.

import { Game } from './game/Game';
import type { DebugHandle } from './debug/hooks';
import { loadShowcases } from './debug/showcase';

const app = document.getElementById('app')!;
const ui = document.getElementById('ui')!;
const boot = document.getElementById('boot');
const params = new URLSearchParams(location.search);
/** window.__dw is for development and automation (?manual=1 / ?debug=1), not normal play. */
const wantHandle = import.meta.env.DEV || params.get('manual') === '1' || params.has('debug');
const scriptStart = performance.now();

function hideBoot(): void {
  if (!boot) return;
  boot.classList.add('done');
  setTimeout(() => boot.remove(), 900);
}

function bootStatus(text: string): void {
  const small = boot?.querySelector('small');
  if (small) small.textContent = text;
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

/** Frames keep failing: say so (the loop keeps trying underneath, in case it recovers). */
function showFatal(err: unknown): void {
  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  box.style.cssText =
    'position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:20;max-width:min(560px,90vw);padding:14px 18px;border-radius:10px;background:#1b2a3fe6;color:#f3e3bf;font:15px system-ui;text-align:center;pointer-events:auto;box-shadow:0 6px 24px #0006';
  const msg = document.createElement('div');
  msg.textContent = 'Something went wrong. Reloading should fix it.';
  const detail = document.createElement('div');
  detail.style.cssText = 'margin-top:4px;font-size:12px;opacity:0.6';
  detail.textContent = String((err as Error)?.message ?? err).slice(0, 120);
  const btn = document.createElement('button');
  btn.textContent = 'Reload';
  btn.style.cssText = 'margin-top:10px;padding:6px 18px;border-radius:6px;border:1px solid #f3e3bf88;background:#f3e3bf22;color:inherit;font:inherit;cursor:pointer';
  btn.addEventListener('click', () => location.reload());
  box.append(msg, detail, btn);
  document.body.appendChild(box);
}

async function start(): Promise<void> {
  try {
    if (params.has('view')) await loadShowcases();
    const constructStart = performance.now();
    const game = new Game(app, ui);
    const constructEnd = performance.now();
    game.loop.onFatal = showFatal;
    let handle: DebugHandle | null = null;
    if (wantHandle) handle = (await import('./debug/hooks')).installDebugHooks(game);

    // Compile every shader (and upload every mesh) while the splash still covers the screen, so
    // the first minutes of play don't stall the first time something new comes into view.
    // Automation (?manual=1) skips it unless asked (?warmup=1): captures draw on demand anyway.
    let warmup;
    if (!game.debug.manual || params.get('warmup') === '1') {
      if (handle) handle.ready = false;
      bootStatus('Lighting the lanterns…');
      // Let the splash repaint with the new line before the main thread is busy again.
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      try {
        warmup = await game.renderer.prepare(game.scene, game.camera);
      } catch (err) {
        // Not fatal: anything left uncompiled links on first use instead.
        console.warn('Driftwing: shader warmup failed', err);
      }
      if (handle) handle.ready = true;
    }
    const warmupEnd = performance.now();
    if (handle) handle.boot = { scriptStart, constructStart, constructEnd, warmupEnd, warmup };

    game.start();
    if (game.debug.manual) {
      // Automation draws on demand and captures right away: no fade to wait out.
      boot?.remove();
      if (handle) handle.boot.firstFrame = performance.now();
      return;
    }
    // Let the first frames land before revealing the world.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (handle) handle.boot.firstFrame = performance.now();
        hideBoot();
      }),
    );
  } catch (err) {
    showError(err);
  }
}

// Building the archipelago blocks the main thread for a moment; paint the splash first.
requestAnimationFrame(() => setTimeout(() => void start(), 0));
