// Gamepads that don't report the W3C "standard" mapping (Firefox on Linux, many generic and
// DirectInput pads) list their axes and buttons in driver order: read with standard indices,
// RT is some other button, the triggers sit on axes, and nothing flaps (GAMEPAD-01). Every pad
// is read through a PadView in standard layout: the pad itself when it is standard, otherwise a
// best-guess remap from the common driver layouts (Linux xpad for Xbox-style pads, hid-sony for
// PlayStation pads), and the caller tells the player once that the layout was guessed.
// Pure (no DOM), so the remaps are unit-tested.

/** The parts of a Gamepad this reads (real Gamepads and test fakes both fit). */
export interface PadLike {
  id: string;
  mapping: string;
  axes: readonly number[];
  buttons: readonly ({ pressed: boolean; value: number } | undefined)[];
}

export interface PadButtonState {
  pressed: boolean;
  value: number;
}

/** A pad in standard layout: 4 stick axes (LX, LY, RX, RY) and 17 buttons. */
export interface PadView {
  axes: number[];
  buttons: PadButtonState[];
  /** True when the layout was guessed (non-standard mapping). */
  guessed: boolean;
}

export function createPadView(): PadView {
  return {
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    guessed: false,
  };
}

/**
 * Per-pad memory for trigger axes: many drivers report 0 for an axis until it first moves, then
 * −1 at rest, so a trigger axis only reads as (v + 1) / 2 once it has been seen near −1.
 */
export interface PadMapState {
  triggerRest: [boolean, boolean];
}

export function createPadMapState(): PadMapState {
  return { triggerRest: [false, false] };
}

/** Standard button indices (see scheme.ts PAD_BUTTON). */
const A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, LT = 6, RT = 7, VIEW = 8, MENU = 9, L3 = 10, R3 = 11;
const DUP = 12, DDOWN = 13, DLEFT = 14, DRIGHT = 15;

interface Layout {
  /** Driver axis index for LX, LY, RX, RY. */
  sticks: [number, number, number, number];
  /** Driver axis index for LT and RT (−1..1), or −1 when the triggers are buttons. */
  triggerAxes: [number, number];
  /** Driver axis indices for the D-pad hat (x, y), or −1. */
  hat: [number, number];
  /** standard button index → driver button index (−1 = none). */
  buttons: number[];
}

/** Linux xpad (Xbox 360 / One / most XInput clones): triggers and D-pad on axes. */
const XPAD: Layout = {
  sticks: [0, 1, 3, 4],
  triggerAxes: [2, 5],
  hat: [6, 7],
  //        A  B  X  Y  LB RB LT  RT  View Menu L3 R3  Up  Dn  Lt  Rt  Guide
  buttons: [0, 1, 2, 3, 4, 5, -1, -1, 6, 7, 9, 10, -1, -1, -1, -1, 8],
};

/** Linux hid-sony (DualShock 4 / DualSense): face buttons cross, circle, triangle, square. */
const SONY: Layout = {
  sticks: [0, 1, 3, 4],
  triggerAxes: [2, 5],
  hat: [6, 7],
  //        ✕  ○  □  △  L1 R1 L2 R2 Share Opt L3  R3  Up  Dn  Lt  Rt  PS
  buttons: [0, 1, 3, 2, 4, 5, 6, 7, 8, 9, 11, 12, -1, -1, -1, -1, 10],
};

/** Generic DirectInput: two sticks on axes 0–3, everything else as buttons in standard order. */
const GENERIC: Layout = {
  sticks: [0, 1, 2, 3],
  triggerAxes: [-1, -1],
  hat: [-1, -1],
  buttons: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
};

function layoutFor(g: PadLike): Layout {
  const id = g.id.toLowerCase();
  if (/054c|playstation|dualsense|dualshock|wireless controller/.test(id) && !/xbox|xinput|045e/.test(id)) return SONY;
  if (g.axes.length >= 6) return XPAD;
  return GENERIC;
}

/** Read `g` into `out` in standard layout. */
export function mapPad(g: PadLike, state: PadMapState, out: PadView): PadView {
  if (g.mapping === 'standard') {
    out.guessed = false;
    for (let i = 0; i < 4; i++) out.axes[i] = g.axes[i] ?? 0;
    for (let b = 0; b < out.buttons.length; b++) {
      const src = g.buttons[b];
      out.buttons[b].pressed = src ? src.pressed : false;
      out.buttons[b].value = src ? src.value : 0;
    }
    return out;
  }
  out.guessed = true;
  const L = layoutFor(g);
  for (let i = 0; i < 4; i++) out.axes[i] = g.axes[L.sticks[i]] ?? 0;
  for (let b = 0; b < out.buttons.length; b++) {
    const src = L.buttons[b] >= 0 ? g.buttons[L.buttons[b]] : undefined;
    out.buttons[b].pressed = src ? src.pressed : false;
    out.buttons[b].value = src ? src.value : 0;
  }
  // Analog triggers on axes.
  for (let k = 0; k < 2; k++) {
    const ai = L.triggerAxes[k];
    if (ai < 0 || ai >= g.axes.length) continue;
    const v = g.axes[ai] ?? 0;
    if (v < -0.6) state.triggerRest[k] = true;
    const value = state.triggerRest[k] ? Math.min(1, Math.max(0, (v + 1) / 2)) : Math.max(0, v);
    const dst = out.buttons[k === 0 ? LT : RT];
    // Some drivers report the trigger both as an axis and as a button: take the stronger.
    dst.value = Math.max(dst.value, value);
    dst.pressed = dst.pressed || value > 0.5;
  }
  // D-pad hat on axes.
  const [hx, hy] = L.hat;
  if (hx >= 0 && hy >= 0 && hy < g.axes.length) {
    const x = g.axes[hx] ?? 0;
    const y = g.axes[hy] ?? 0;
    const set = (b: number, on: boolean) => {
      out.buttons[b].pressed = out.buttons[b].pressed || on;
      out.buttons[b].value = Math.max(out.buttons[b].value, on ? 1 : 0);
    };
    set(DUP, y < -0.5);
    set(DDOWN, y > 0.5);
    set(DLEFT, x < -0.5);
    set(DRIGHT, x > 0.5);
  }
  return out;
}

// Re-exported for tests that want to name buttons.
export const STD = { A, B, X, Y, LB, RB, LT, RT, VIEW, MENU, L3, R3, DUP, DDOWN, DLEFT, DRIGHT } as const;
