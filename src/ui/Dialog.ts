// A small modal question ("Erase all progress?") with two or three buttons. B / Esc picks the
// cancel button.

import { div, h } from './dom';
import { Panel, type UiCtx } from './panel';

export interface DialogButton {
  label: string;
  run(): void;
  /** Focused when the dialog opens. */
  primary?: boolean;
  /** What B / Esc does. */
  cancel?: boolean;
}

export class Dialog extends Panel {
  override hidesHud = true;
  private cancelBtn: DialogButton | undefined;

  constructor(ctx: UiCtx, title: string, text: string, buttons: DialogButton[]) {
    super(ctx, 'dw-dialog-layer');
    const btns = div('dw-dialog-btns');
    let first = 0;
    buttons.forEach((b, i) => {
      const el = h('div', { class: `dw-btn${b.cancel ? ' dw-btn--quiet' : ''}`, text: b.label });
      this.scope.add({
        el,
        activate: () => {
          this.ctx.sound(b.cancel ? 'back' : 'select');
          this.ctx.pop(this);
          b.run();
        },
      });
      if (b.primary) first = i;
      btns.append(el);
    });
    this.cancelBtn = buttons.find((b) => b.cancel);
    this.root.append(div('dw-dialog-veil'), div('dw-panel dw-dialog dw-enter', h('h3', { text: title }), h('p', { text }), btns));
    this.scope.focus(first, { scroll: false });
  }

  override onBack(): void {
    this.ctx.sound('back');
    this.ctx.pop(this);
    this.cancelBtn?.run();
  }
}
