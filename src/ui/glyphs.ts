// Button and key glyphs for prompts, hint bars and the controls screen, drawn as inline SVG /
// styled keycaps so they look the same everywhere and need no icon font. Which control to show
// comes from the control scheme (scheme.ts) — never hard-coded here — so rebinding the scheme
// updates every prompt.

import type { InputDevice } from '../core/types';
import { bindingFor, keyLabel, padLabel, type Binding, type ControlAction, type PadControl, type PadStyle } from '../input/scheme';
import { esc } from './dom';

export type GlyphDevice = 'xbox' | 'playstation' | 'generic' | 'keyboard';

/** The glyph family to draw for the active device. */
export function glyphDevice(device: InputDevice, padStyle: PadStyle | null): GlyphDevice {
  if (device === 'keyboard') return 'keyboard';
  return padStyle ?? 'xbox';
}

/**
 * The physical controls to show for an action. Prompts show one control (`all = false`): the
 * first pad control or the first key. The controls screen shows every one.
 */
export function controlsFor(
  action: ControlAction,
  dev: GlyphDevice,
  all = false,
): { pad: PadControl[]; keys: string[]; hold: boolean; axis: '' | '↕' | '↔' } {
  const b = bindingFor(action);
  if (!b) return { pad: [], keys: [], hold: false, axis: '' };
  const pad = [...new Set(b.pad)];
  const keys = [...new Set(b.keys.map((k) => normalizeKey(k)))];
  const axis = b.xbox.includes('↕') ? '↕' : b.xbox.includes('↔') ? '↔' : '';
  return {
    pad: dev === 'keyboard' ? [] : all ? pad : pad.slice(0, 1),
    keys: dev === 'keyboard' ? (all ? keys : keys.slice(0, 1)) : [],
    hold: !!b.hold,
    axis,
  };
}

/** Left/right variants of a key draw the same cap. */
function normalizeKey(code: string): string {
  if (code === 'ShiftRight') return 'ShiftLeft';
  if (code === 'ControlRight') return 'ControlLeft';
  if (code === 'NumpadEnter') return 'Enter';
  return code;
}

// --- Pad glyphs -------------------------------------------------------------------------------

const FACE_COLORS: Record<'xbox' | 'generic', Record<'A' | 'B' | 'X' | 'Y', string>> = {
  xbox: { A: '#8fd16a', B: '#ff7461', X: '#6aa8ff', Y: '#ffd055' },
  generic: { A: '#f2e6cc', B: '#f2e6cc', X: '#f2e6cc', Y: '#f2e6cc' },
};

const PS_COLORS = { A: '#8fb4ff', B: '#ff8a8a', X: '#f29ad8', Y: '#62d6b0' };

const DISC = 'fill="#17110e" fill-opacity=".88" stroke="#f6e3b8" stroke-opacity=".55" stroke-width="1.1"';

function svg(w: number, body: string, cls: string): string {
  return `<svg class="dw-g ${cls}" viewBox="0 0 ${w} 24" width="${w / 24}em" height="1em" aria-hidden="true">${body}</svg>`;
}

function label(x: number, y: number, text: string, size: number, fill = '#f6e7c6'): string {
  return `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" font-weight="700" fill="${fill}" font-family="Alegreya Sans, Nunito, sans-serif">${esc(text)}</text>`;
}

function faceButton(c: 'A' | 'B' | 'X' | 'Y', style: PadStyle): string {
  const disc = `<circle cx="12" cy="12" r="10.6" ${DISC}/>`;
  if (style === 'playstation') {
    const col = PS_COLORS[c];
    const st = `fill="none" stroke="${col}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"`;
    const shape =
      c === 'A'
        ? `<path d="M8.3 8.3 L15.7 15.7 M15.7 8.3 L8.3 15.7" ${st}/>`
        : c === 'B'
          ? `<circle cx="12" cy="12" r="4.6" ${st}/>`
          : c === 'X'
            ? `<rect x="8" y="8" width="8" height="8" rx=".6" ${st}/>`
            : `<path d="M12 7.4 L16.6 15.4 L7.4 15.4 Z" ${st}/>`;
    return svg(24, disc + shape, 'dw-g-face');
  }
  return svg(24, disc + label(12, 16.6, c, 13, FACE_COLORS[style === 'generic' ? 'generic' : 'xbox'][c]), 'dw-g-face');
}

function shoulder(text: string): string {
  const w = Math.max(34, 12 + text.length * 7);
  return svg(w, `<rect x="1" y="4" width="${w - 2}" height="16" rx="7" ${DISC}/>` + label(w / 2, 16.3, text, 10.5), 'dw-g-shoulder');
}

function trigger(text: string): string {
  const w = Math.max(30, 12 + text.length * 7);
  const r = w - 3;
  return svg(w, `<path d="M3 21 L3 10 Q3 2.5 11 2.5 L${r - 8} 2.5 Q${r} 2.5 ${r} 10 L${r} 21 Z" ${DISC}/>` + label(w / 2, 16.5, text, 10.5), 'dw-g-trigger');
}

function stick(text: string, axis: '' | '↕' | '↔'): string {
  const arrows =
    axis === '↕'
      ? '<path d="M12 .9 L14.2 3.4 L9.8 3.4 Z M12 23.1 L14.2 20.6 L9.8 20.6 Z" fill="#f6e3b8"/>'
      : axis === '↔'
        ? '<path d="M.9 12 L3.4 9.8 L3.4 14.2 Z M23.1 12 L20.6 9.8 L20.6 14.2 Z" fill="#f6e3b8"/>'
        : '';
  const body = `<circle cx="12" cy="12" r="9.2" ${DISC}/><circle cx="12" cy="12" r="5.6" fill="#f6e3b8" fill-opacity=".14" stroke="#f6e3b8" stroke-opacity=".5" stroke-width=".9"/>`;
  return svg(24, body + arrows + label(12, 15.4, text, text.length > 1 ? 7.2 : 9), 'dw-g-stick');
}

function dpad(dir: 'up' | 'down' | 'left' | 'right' | null): string {
  const plus = 'M9 2.5 H15 V9 H21.5 V15 H15 V21.5 H9 V15 H2.5 V9 H9 Z';
  const hi = { up: 'M9.6 3.2 H14.4 V9 H9.6 Z', down: 'M9.6 15 H14.4 V20.8 H9.6 Z', left: 'M3.2 9.6 H9 V14.4 H3.2 Z', right: 'M15 9.6 H20.8 V14.4 H15 Z' };
  const arm = dir ? `<path d="${hi[dir]}" fill="#f6d68a"/>` : '';
  return svg(24, `<path d="${plus}" ${DISC} stroke-linejoin="round"/>${arm}`, 'dw-g-dpad');
}

function menuButton(control: 'View' | 'Menu', style: PadStyle): string {
  if (style === 'xbox') {
    const icon =
      control === 'Menu'
        ? '<path d="M8 8.5 H16 M8 12 H16 M8 15.5 H16" stroke="#f6e7c6" stroke-width="1.6" stroke-linecap="round"/>'
        : '<rect x="7" y="7" width="7" height="6" rx="1" fill="none" stroke="#f6e7c6" stroke-width="1.3"/><rect x="10" y="10.5" width="7" height="6" rx="1" fill="#17110e" stroke="#f6e7c6" stroke-width="1.3"/>';
    return svg(24, `<circle cx="12" cy="12" r="10" ${DISC}/>${icon}`, 'dw-g-menu');
  }
  const text = padLabel(control, style);
  const w = 14 + text.length * 6.2;
  return svg(w, `<rect x="1" y="4.5" width="${w - 2}" height="15" rx="7.5" ${DISC}/>` + label(w / 2, 15.8, text, 9.5), 'dw-g-menu');
}

/** One gamepad control as an SVG glyph. */
export function padGlyph(control: PadControl, style: PadStyle, axis: '' | '↕' | '↔' = ''): string {
  switch (control) {
    case 'A':
    case 'B':
    case 'X':
    case 'Y':
      return faceButton(control, style);
    case 'LB':
    case 'RB':
      return shoulder(padLabel(control, style));
    case 'LT':
    case 'RT':
      return trigger(padLabel(control, style));
    case 'LS':
    case 'RS':
      return stick(style === 'playstation' ? padLabel(control, style) : control[0], axis);
    case 'L3':
    case 'R3':
      return stick(control, '');
    case 'DUp':
      return dpad('up');
    case 'DDown':
      return dpad('down');
    case 'DLeft':
      return dpad('left');
    case 'DRight':
      return dpad('right');
    case 'DPad':
      return dpad(null);
    case 'View':
    case 'Menu':
      return menuButton(control, style);
  }
}

// --- Keyboard / mouse glyphs ------------------------------------------------------------------

function mouse(part: 'left' | 'right' | 'middle' | 'wheel' | 'move' | 'drag'): string {
  const body = 'M12 2.5 C7.6 2.5 5.5 5.4 5.5 9.5 V15 C5.5 19 8.3 21.5 12 21.5 C15.7 21.5 18.5 19 18.5 15 V9.5 C18.5 5.4 16.4 2.5 12 2.5 Z';
  const hi =
    part === 'left'
      ? '<path d="M12 2.9 C8 2.9 5.9 5.6 5.9 9.5 V10.2 H12 Z" fill="#f6d68a"/>'
      : part === 'right'
        ? '<path d="M12 2.9 C16 2.9 18.1 5.6 18.1 9.5 V10.2 H12 Z" fill="#f6d68a"/>'
        : part === 'middle' || part === 'wheel'
          ? '<rect x="10.6" y="4.6" width="2.8" height="4.6" rx="1.4" fill="#f6d68a"/>'
          : '';
  const extra =
    part === 'drag' || part === 'move'
      ? '<path d="M1 12 L3.4 10 V14 Z M23 12 L20.6 10 V14 Z" fill="#f6e3b8"/>'
      : '';
  return svg(
    24,
    `<path d="${body}" ${DISC}/><path d="M5.8 10.2 H18.2 M12 3 V10.2" stroke="#f6e3b8" stroke-opacity=".5" stroke-width=".9"/>${hi}${extra}`,
    'dw-g-mouse',
  );
}

const ARROWS: Record<string, string> = {
  ArrowUp: 'M12 7 L16.5 14 H7.5 Z',
  ArrowDown: 'M12 17 L16.5 10 H7.5 Z',
  ArrowLeft: 'M7 12 L14 7.5 V16.5 Z',
  ArrowRight: 'M17 12 L10 7.5 V16.5 Z',
};

/** One keyboard key or mouse control as a glyph. */
export function keyGlyph(code: string): string {
  switch (code) {
    case 'Mouse0':
      return mouse('left');
    case 'Mouse1':
      return mouse('middle');
    case 'Mouse2':
      return mouse('right');
    case 'Wheel':
      return mouse('wheel');
    case 'MouseMove':
      return mouse('move');
    case 'MouseDrag':
      return mouse('drag');
  }
  const arrow = ARROWS[code];
  if (arrow) return `<span class="dw-key dw-key--icon"><svg viewBox="0 0 24 24" width="0.9em" height="0.9em" aria-hidden="true"><path d="${arrow}" fill="currentColor"/></svg></span>`;
  const text = keyLabel(code);
  return `<span class="dw-key${text.length > 1 ? ' dw-key--wide' : ''}">${esc(text)}</span>`;
}

/** A display word from the scheme's keyboard text ("Left click", "Mouse wheel", "Q") as a glyph. */
function keyWordGlyph(word: string): string {
  const w = word.trim();
  const byLabel: Record<string, string> = {
    'Left click': 'Mouse0',
    'Middle click': 'Mouse1',
    'Right click': 'Mouse2',
    'Mouse wheel': 'Wheel',
    Mouse: 'MouseMove',
    Drag: 'MouseDrag',
    '↑': 'ArrowUp',
    '↓': 'ArrowDown',
    '←': 'ArrowLeft',
    '→': 'ArrowRight',
  };
  if (byLabel[w]) return keyGlyph(byLabel[w]);
  if (w.length <= 9 && !w.includes(' ')) return `<span class="dw-key${w.length > 1 ? ' dw-key--wide' : ''}">${esc(w)}</span>`;
  return `<span class="dw-glyph-text">${esc(w)}</span>`;
}

const SEP = '<span class="dw-glyph-sep">/</span>';

/** Glyph markup for an action on a device: one control for prompts, all for the controls screen. */
export function glyphHtml(action: ControlAction, dev: GlyphDevice, all = false): string {
  // Menu navigation reads better as the pair you actually press than as "LS" or a lone arrow.
  if (action === 'navigate' && !all) return dev === 'keyboard' ? keyGlyph('ArrowUp') + keyGlyph('ArrowDown') : padGlyph('DPad', dev);
  const c = controlsFor(action, dev, all);
  if (dev === 'keyboard') {
    const b = bindingFor(action);
    if (all) return bindingKeyboardHtml(b);
    // A cluster the scheme names as one word ("WASD") reads better than its first key ("W").
    if (b && /^[A-Z]{3,5}$/.test(b.keyboard)) return keyWordGlyph(b.keyboard);
    return c.keys.map(keyGlyph).join(SEP);
  }
  return c.pad.map((p) => padGlyph(p, dev, c.axis)).join(SEP);
}

/** The controls screen's keyboard column: the scheme's display text, as keycaps where possible. */
export function bindingKeyboardHtml(b: Binding | undefined): string {
  if (!b) return '';
  return b.keyboard
    .split(' / ')
    .map((part) => {
      // "Mouse (click to capture)" style annotations stay as text after the glyph.
      const m = /^(.*?)\s*\((.*)\)$/.exec(part);
      if (m) return `${keyWordGlyph(m[1])}<span class="dw-glyph-note">${esc(m[2])}</span>`;
      return keyWordGlyph(part);
    })
    .join(SEP);
}

/** The controls screen's gamepad column for a binding. */
export function bindingPadHtml(b: Binding, style: PadStyle): string {
  const axis = b.xbox.includes('↕') ? '↕' : b.xbox.includes('↔') ? '↔' : '';
  const glyphs = [...new Set(b.pad)].map((p) => padGlyph(p, style, axis)).join(SEP);
  return b.xbox.includes('(hold)') ? `${glyphs}<span class="dw-glyph-note">hold</span>` : glyphs;
}

/** Pad controls a label might mention (a note that only makes sense with a controller). */
const PAD_WORDS = /\b(L3|R3|LS|RS|LB|RB|LT|RT|D-pad|stick)\b/;

/**
 * A control's description for one device: notes that name gamepad controls are dropped on the
 * keyboard page ("Run (hold, or click L3 to keep running)" → "Run (hold)").
 */
export function controlLabel(label: string, dev: GlyphDevice): string {
  if (dev !== 'keyboard') return label;
  return label
    .replace(/\s*\(([^)]*)\)/g, (_all, inner: string) => {
      const kept = inner
        .split(/,\s*/)
        .filter((part) => !PAD_WORDS.test(part))
        .join(', ');
      return kept ? ` (${kept})` : '';
    })
    .trim();
}
