// Tiny DOM helpers for the overlay. No framework: screens are built once and updated in place,
// and the HUD only touches the DOM when a displayed value actually changes.

type Child = Node | string | null | undefined | false;

export interface ElProps {
  class?: string;
  text?: string;
  html?: string;
  attrs?: Record<string, string>;
  style?: Partial<CSSStyleDeclaration> | Record<string, string>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (e: HTMLElementEventMap[K]) => void }>;
}

/** Create an element: h('div', { class: 'a b' }, child, 'text'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: ElProps = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.html !== undefined) el.innerHTML = props.html;
  if (props.attrs) for (const k in props.attrs) el.setAttribute(k, props.attrs[k]);
  if (props.style) Object.assign(el.style, props.style);
  if (props.on) {
    for (const k in props.on) {
      const fn = props.on[k as keyof HTMLElementEventMap];
      if (fn) el.addEventListener(k, fn as EventListener);
    }
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** Shorthand for a div with classes. */
export function div(cls: string, ...children: Child[]): HTMLDivElement {
  return h('div', { class: cls }, ...children);
}

/** An element built from trusted, module-authored markup (icons, glyphs). */
export function fromHtml(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

/**
 * A text node whose content is only written when it changes, so per-frame HUD updates cost
 * nothing while a value holds steady.
 */
export class LiveText {
  readonly el: HTMLElement;
  private last: string | number | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  set(v: string | number): void {
    if (v === this.last) return;
    this.last = v;
    this.el.textContent = String(v);
  }
}

/** Toggle a class only when the state changes (classList.toggle is cheap, but this skips it). */
export class LiveClass {
  private state: boolean | null = null;
  constructor(private el: Element, private cls: string) {}
  set(on: boolean): void {
    if (on === this.state) return;
    this.state = on;
    this.el.classList.toggle(this.cls, on);
  }
}

/** Write a style property only when the (quantized) value changes. */
export class LiveStyle {
  private last = '';
  constructor(private el: HTMLElement | SVGElement, private prop: string) {}
  set(v: string): void {
    if (v === this.last) return;
    this.last = v;
    (this.el as HTMLElement).style.setProperty(this.prop, v);
  }
}

/** Remove every child. */
export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Escape text for use inside module-built HTML strings. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
