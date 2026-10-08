// Photo mode: the world holds still (the game is paused), the camera's free photo rig takes the
// sticks, and the interface steps aside except for a hint strip you can hide too.

import type { InputPresses } from '../core/types';
import type { GameView } from '../game/contracts';
import { div, fromHtml, h } from './dom';
import { ICONS } from './icons';
import { Panel, hintBar, type UiCtx } from './panel';

export class PhotoMode extends Panel {
  override hidesHud = true;
  private bar: HTMLElement;
  private frame: HTMLElement;
  private hintsHidden = false;

  constructor(ctx: UiCtx) {
    super(ctx, 'dw-photo-layer');
    this.frame = div('dw-photo-frame');
    const pad = hintBar([
      ['move', 'Move'],
      ['look', 'Look'],
      ['flap', 'Rise', 'pad'],
      ['flare', 'Sink', 'pad'],
      ['toggleHud', 'Hide'],
      ['back', 'Exit'],
    ]);
    const kb = hintBar([
      ['move', 'Move', 'keyboard'],
      ['rotateView', 'Look', 'keyboard'],
      ['flap', 'Rise', 'keyboard'],
      ['flare', 'Sink', 'keyboard'],
      ['zoom', 'Zoom', 'keyboard'],
      ['toggleHud', 'Hide', 'keyboard'],
      ['back', 'Exit', 'keyboard'],
    ]);
    // The pad strip and the keyboard strip share 'move'/'toggleHud'/'back'; show one strip per device.
    for (const el of Array.from(pad.children)) (el as HTMLElement).dataset.only ??= 'pad';
    this.bar = div('dw-photo', div('dw-photo-title', fromHtml(ICONS.camera), h('span', { text: 'PHOTO MODE' })), pad, kb);
    this.root.append(this.frame, this.bar);
    ctx.fillGlyphs(this.root);
  }

  override onShow(): void {
    this.ctx.view.camera.mode = 'photo';
  }

  override onHide(): void {
    // Leaving for another panel: hand the camera back to the game.
    if (this.ctx.view.camera.mode === 'photo') this.ctx.view.camera.mode = 'follow';
  }

  override input(p: InputPresses): void {
    if (p.toggleHud) {
      this.hintsHidden = !this.hintsHidden;
      this.bar.classList.toggle('is-hidden', this.hintsHidden);
      this.frame.classList.toggle('is-hidden', this.hintsHidden);
      return;
    }
    if (p.pause && !p.back) {
      // Start leaves photo mode and the pause menu together.
      this.close();
      this.ctx.actions.resume();
      return;
    }
    if (p.back) {
      this.ctx.sound('back');
      this.close();
    }
  }

  private close(): void {
    this.ctx.view.camera.mode = 'follow';
    this.ctx.pop(this);
  }

  override update(_dt: number, view: GameView): void {
    // Keep the rig in photo mode (a screen change elsewhere could reset it).
    if (view.camera.mode !== 'photo') view.camera.mode = 'photo';
  }
}
