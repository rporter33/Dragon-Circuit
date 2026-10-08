// HTML overlay: title, HUD, menus, the stable. (Baseline: a title card and a text HUD. The UI
// module owner builds the real interface.)

import type { GameActions, GameScreen, GameView, UiSystem } from '../game/contracts';
import type { GameEventBus } from '../core/events';

export interface UiDeps {
  root: HTMLElement;
  actions: GameActions;
  events: GameEventBus;
}

export class Ui implements UiSystem {
  screen: GameScreen = 'loading';
  capturesInput = false;
  private root: HTMLElement;
  private actions: GameActions;
  private title: HTMLDivElement;
  private hud: HTMLDivElement;

  constructor(deps: UiDeps) {
    this.root = deps.root;
    this.actions = deps.actions;
    this.title = document.createElement('div');
    this.title.style.cssText =
      'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font:600 64px Georgia,serif;text-shadow:0 2px 12px #0008;letter-spacing:0.08em';
    this.title.innerHTML = '<div>DRIFTWING</div><div style="font:400 18px system-ui;margin-top:16px;opacity:.85">Press Enter or (A) to fly</div>';
    this.hud = document.createElement('div');
    this.hud.style.cssText = 'position:absolute;left:16px;bottom:16px;color:#fff;font:14px ui-monospace,monospace;text-shadow:0 1px 3px #000a;white-space:pre';
    this.root.append(this.title, this.hud);
    this.setScreen('title');
  }

  setScreen(screen: GameScreen): void {
    this.screen = screen;
    this.title.style.display = screen === 'title' ? 'flex' : 'none';
    this.hud.style.display = screen === 'play' ? 'block' : 'none';
    this.capturesInput = screen !== 'play';
  }

  update(_dt: number, view: GameView): void {
    const input = view.input.frame;
    if (this.screen === 'title' && input.pressed.confirm) this.actions.startGame();
    else if (this.screen === 'pause' && (input.pressed.pause || input.pressed.back)) this.actions.resume();
    if (this.screen === 'play') {
      const f = view.player.flight;
      this.hud.textContent =
        `${view.player.mode}  speed ${f.airspeed.toFixed(1)} m/s  alt ${f.position.y.toFixed(0)} m\n` +
        `stamina ${(f.stamina * 100).toFixed(0)}%  stall ${(f.stall * 100).toFixed(0)}%` +
        (view.prompt ? `\n${view.prompt.text}` : '');
    }
  }
}
