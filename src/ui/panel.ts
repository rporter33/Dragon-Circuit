// Base class for every menu screen (pause, settings, the stable, results...), and the services
// the Ui hands them. Panels live on a stack: the top one gets the frame's input.

import type { GameEventBus } from '../core/events';
import type { InputPresses, Settings } from '../core/types';
import type { GameActions, GameView } from '../game/contracts';
import type { ControlAction } from '../input/scheme';
import { div, h } from './dom';
import { FocusScope, type FocusHost } from './focus';
import type { GlyphDevice } from './glyphs';

export type UiSound = 'move' | 'select' | 'back' | 'locked' | 'tab';

export interface UiCtx extends FocusHost {
  readonly actions: GameActions;
  readonly events: GameEventBus;
  /** The latest view (updated every frame before panels update). */
  readonly view: GameView;
  push(panel: Panel): void;
  /** Close a panel (default: the top one). */
  pop(panel?: Panel): void;
  settings(): Settings;
  applySettings(patch: Partial<Settings>): void;
  device(): GlyphDevice;
  /** Fill every [data-glyph] element under `root` for the current device. */
  fillGlyphs(root: Element): void;
}

export abstract class Panel {
  readonly root: HTMLElement;
  readonly scope: FocusScope;
  /** Hide the gameplay HUD while this panel is open. */
  hidesHud = true;

  constructor(
    protected ctx: UiCtx,
    cls: string,
  ) {
    this.root = div(`dw-layer ${cls}`);
    this.scope = new FocusScope(ctx);
  }

  /** Called after the panel is attached (and again when it becomes the top panel). */
  onShow(): void {}
  onHide(): void {}

  /** One frame of presses while this panel is on top. */
  input(p: InputPresses): void {
    if (p.back) {
      this.onBack();
      return;
    }
    if (p.tabPrev || p.tabNext) {
      if (this.onTab(p.tabPrev ? -1 : 1)) return;
    }
    this.scope.handle(p);
  }

  onBack(): void {
    this.ctx.sound('back');
    this.ctx.pop(this);
  }

  /** LB / RB. Return true if the panel has tabs. */
  onTab(_dir: -1 | 1): boolean {
    return false;
  }

  update(_dt: number, _view: GameView): void {}

  dispose(): void {
    this.root.remove();
  }
}

/** A footer strip of button hints: [[action, label], ...]. Glyphs fill in per device. */
export function hintBar(items: [ControlAction | 'adjust', string, ('pad' | 'keyboard')?][]): HTMLElement {
  const bar = div('dw-hints');
  for (const [action, label, only] of items) {
    // 'adjust' = left/right on a focused row (sliders, choices): drawn as ← → or the D-pad.
    const attrs: Record<string, string> = action === 'adjust' ? { 'data-glyph': 'navigate', 'data-axis': 'h' } : { 'data-glyph': action };
    const g = h('span', { class: 'dw-hint-g', attrs });
    const hint = h('span', { class: 'dw-hint' }, g, h('span', { class: 'dw-hint-l', text: label }));
    if (only) hint.dataset.only = only;
    bar.append(hint);
  }
  return bar;
}

/** The standard menu sheet: a centered panel with a title, optional tabs, a body and hints. */
export function sheet(title: string, kicker = ''): { root: HTMLElement; head: HTMLElement; body: HTMLElement; foot: HTMLElement } {
  const head = div('dw-sheet-head');
  if (kicker) head.append(h('div', { class: 'dw-kicker', text: kicker }));
  head.append(h('h2', { class: 'dw-sheet-title', text: title }));
  const body = div('dw-sheet-body');
  const foot = div('dw-sheet-foot');
  const root = div('dw-panel dw-sheet', head, body, foot);
  return { root, head, body, foot };
}
