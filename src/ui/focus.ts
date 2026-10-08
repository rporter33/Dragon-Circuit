// Focus handling for controller-first menus. A FocusScope owns the focusable items of one panel:
// the D-pad / stick / arrow keys move between them spatially (nav.ts), A / Enter activates, and
// items can take left/right themselves (sliders, choices). The mouse drives the same focus:
// hovering focuses, clicking activates, so there is one highlighted thing on screen at a time.

import type { InputPresses } from '../core/types';
import { pickSpatial, pickWrap, type NavDir, type Rect } from './nav';

export interface FocusItem {
  el: HTMLElement;
  /** A / Enter / click. */
  activate?(): void;
  /** Left / right while focused (sliders, choices, steppers). Return true if the press was used. */
  adjust?(dir: -1 | 1): boolean;
  /** Called when the item gains focus (detail panes, camera framing). */
  onFocus?(): void;
}

export interface FocusHost {
  sound(kind: 'move' | 'select' | 'back' | 'locked' | 'tab'): void;
  reducedMotion(): boolean;
}

/** Time of the last real mouse movement: hover only steals focus from a pad after the mouse moves. */
let lastMouseMove = -1e9;
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.movementX !== 0 || e.movementY !== 0) lastMouseMove = performance.now();
    },
    { passive: true },
  );
}

export class FocusScope {
  items: FocusItem[] = [];
  index = -1;
  /** Wrap from the bottom of a list to the top (simple vertical menus). */
  wrap = false;
  private rects: (Rect | null)[] = [];

  constructor(private host: FocusHost) {}

  get current(): FocusItem | null {
    return this.items[this.index] ?? null;
  }

  add(item: FocusItem): FocusItem {
    const i = this.items.length;
    this.items.push(item);
    item.el.classList.add('dw-focusable');
    item.el.addEventListener('pointerenter', () => {
      if (performance.now() - lastMouseMove > 250) return; // layout moved under a still mouse
      if (this.items[i] === item && this.index !== i) this.focus(i, { sound: true, scroll: false });
    });
    item.el.addEventListener('click', (e) => {
      if (this.items[i] !== item) return;
      e.stopPropagation();
      if (this.index !== i) this.focus(i, { sound: false, scroll: false });
      item.activate?.();
    });
    return item;
  }

  clear(): void {
    this.items = [];
    this.index = -1;
  }

  /** Focus item i (−1 clears). */
  focus(i: number, opts: { sound?: boolean; scroll?: boolean } = {}): void {
    const prev = this.items[this.index];
    if (prev) prev.el.classList.remove('is-focus');
    this.index = i;
    const it = this.items[i];
    if (!it) return;
    it.el.classList.add('is-focus');
    if (opts.scroll !== false) it.el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: this.host.reducedMotion() ? 'auto' : 'smooth' });
    if (opts.sound) this.host.sound('move');
    it.onFocus?.();
  }

  focusEl(el: HTMLElement, opts: { sound?: boolean; scroll?: boolean } = {}): void {
    const i = this.items.findIndex((it) => it.el === el);
    if (i >= 0) this.focus(i, opts);
  }

  /** Move focus in a direction. Returns true if it moved. */
  move(dir: NavDir): boolean {
    if (this.items.length === 0) return false;
    if (this.index < 0) {
      this.focus(0, { sound: true });
      return true;
    }
    const rects = this.rects;
    rects.length = this.items.length;
    for (let i = 0; i < this.items.length; i++) {
      const el = this.items[i].el;
      if (!el.isConnected || el.offsetParent === null) {
        rects[i] = null;
        continue;
      }
      const r = el.getBoundingClientRect();
      rects[i] = { x: r.left, y: r.top, w: r.width, h: r.height };
    }
    const from = rects[this.index];
    if (!from) {
      this.focus(0, { sound: true });
      return true;
    }
    let next = pickSpatial(from, rects, dir, this.index);
    if (next < 0 && this.wrap) next = pickWrap(from, rects, dir, this.index);
    if (next < 0 || next === this.index) return false;
    this.focus(next, { sound: true });
    return true;
  }

  /** Route one frame of presses. Returns true if something happened. */
  handle(p: InputPresses): boolean {
    const cur = this.current;
    if (p.confirm) {
      if (cur?.activate) {
        cur.activate();
        return true;
      }
      return false;
    }
    if (p.navLeft || p.navRight) {
      const dir = p.navLeft ? -1 : 1;
      if (cur?.adjust?.(dir)) return true;
      return this.move(p.navLeft ? 'left' : 'right');
    }
    if (p.navUp) return this.move('up');
    if (p.navDown) return this.move('down');
    return false;
  }
}
