// Pure input shaping: stick deadzones, response curves, keyboard ramps, menu auto-repeat and
// controller-family detection. No DOM access here, so every rule is unit-tested in node.

import { clamp, clamp01, responseCurve } from '../core/math';

export interface Vec2 {
  x: number;
  y: number;
}

/** Tuning shared by Input.ts and the tests. Times are seconds. */
export const SHAPING = {
  /** Stick radius treated as rest (covers worn-stick drift). */
  stickInner: 0.13,
  /** Outer band treated as full deflection (many sticks never report exactly 1.0). */
  stickOuter: 0.05,
  /** Trigger travel ignored at rest, and the top of travel that already counts as fully pulled. */
  triggerInner: 0.06,
  triggerOuter: 0.04,
  /** Expo on pitch/roll: 0 linear, 1 cubic. 0.5 keeps the centre precise without a dead feel. */
  flightExpo: 0.5,
  /** Expo on camera look: gentle, so slow pans are easy but a full push still whips round. */
  lookExpo: 0.35,
  /** Keyboard flight keys ramp to full deflection over this long… */
  keyAttack: 0.12,
  /** …and settle back to centre (or start reversing) over this long. */
  keyRelease: 0.08,
  /**
   * Keyboard PITCH is shaped further (a big body doesn't bunt): a key press eases in over
   * keyPitchAttack to keyPitchSoft of full deflection, and only after keyPitchHold seconds held
   * does it grow to full over keyPitchGrow — taps trim, a held key commits.
   */
  keyPitchAttack: 0.25,
  keyPitchSoft: 0.6,
  keyPitchHold: 0.55,
  keyPitchGrow: 0.6,
  /** Tap-to-flap: the trigger travel that counts as a press, and the weakest beat a press gives. */
  tapPressAt: 0.18,
  tapMinStrength: 0.3,
  /** Pad chord (LB + RB = tuck): a lone bumper becomes rudder only after this long alone. */
  chordWindow: 0.09,
  /** Mouse steering: stick travel per pixel (×look sensitivity), and re-centring (1/s). */
  mouseStickPerPx: 0.0045,
  mouseStickReturn: 2.6,
  mouseStickReturnMoving: 0.6,
  /** Menu navigation auto-repeat. */
  repeatDelay: 0.38,
  repeatInterval: 0.09,
  /** Stick → digital direction thresholds (with hysteresis so noise can't chatter). */
  navOn: 0.55,
  navOff: 0.35,
} as const;

/**
 * Radial (circular) deadzone with rescale. The direction is preserved and the live range is
 * stretched so output still spans 0..1 in magnitude: a stick resting at 0.1 reads 0, and
 * pushing past `1 - outer` reads exactly 1. Writes into and returns `out`.
 */
export function radialDeadzone(x: number, y: number, inner: number, outer: number, out: Vec2): Vec2 {
  const mag = Math.hypot(x, y);
  if (mag <= inner || mag === 0) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const scaled = clamp01((mag - inner) / Math.max(1e-6, 1 - inner - outer));
  out.x = (x / mag) * scaled;
  out.y = (y / mag) * scaled;
  return out;
}

/**
 * Map a circular stick onto a square so a full diagonal reads (±1, ±1) instead of (±0.71,
 * ±0.71). Flight wants this: pulling up-and-right should give full roll AND full pitch. Pure
 * axis deflections are unchanged. In place.
 */
export function circleToSquare(v: Vec2): Vec2 {
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);
  const m = Math.max(ax, ay);
  if (m < 1e-6) return v;
  const mag = Math.hypot(v.x, v.y);
  const k = mag / m;
  v.x = clamp(v.x * k, -1, 1);
  v.y = clamp(v.y * k, -1, 1);
  return v;
}

/** Analog trigger with a small rest deadzone and a top band that counts as fully pulled. */
export function triggerDeadzone(v: number, inner = SHAPING.triggerInner, outer = SHAPING.triggerOuter): number {
  if (!(v > inner)) return 0;
  return clamp01((v - inner) / Math.max(1e-6, 1 - inner - outer));
}

/** Expo response on one signed axis (alias of core's responseCurve, kept here for discoverability). */
export function expo(v: number, k: number): number {
  return responseCurve(clamp(v, -1, 1), k);
}

/**
 * Move a keyboard-driven axis toward `target` so digital keys feel analog: rising to full
 * deflection takes `attack` seconds; easing off — or the first half of a reversal, back to zero —
 * takes `release` seconds per unit. A tap shorter than `attack` yields a partial deflection,
 * which is what makes fine corrections possible on a keyboard.
 */
export function rampAxis(
  current: number,
  target: number,
  dt: number,
  attack: number = SHAPING.keyAttack,
  release: number = SHAPING.keyRelease,
): number {
  if (current === target || dt <= 0) return current;
  let cur = current;
  let time = dt;
  const reversing = cur !== 0 && Math.sign(target) !== Math.sign(cur);
  const easing = !reversing && Math.abs(target) < Math.abs(cur);
  if (reversing || easing) {
    const goal = reversing ? 0 : target;
    const dist = Math.abs(goal - cur);
    const reach = time / release;
    if (reach < dist) return cur + Math.sign(goal - cur) * reach;
    time -= dist * release;
    cur = goal;
    if (cur === target) return cur;
  }
  const dist = Math.abs(target - cur);
  const reach = time / attack;
  return reach >= dist ? target : cur + Math.sign(target - cur) * reach;
}

/**
 * Menu auto-repeat for a held direction: fires on the press, again after `delay`, then every
 * `interval` while held. At most one repeat per update, so a long frame can't skip items.
 */
export class RepeatTimer {
  private held = -1;
  private next = 0;
  constructor(
    readonly delay: number = SHAPING.repeatDelay,
    readonly interval: number = SHAPING.repeatInterval,
  ) {}

  update(down: boolean, dt: number): boolean {
    if (!down) {
      this.held = -1;
      return false;
    }
    if (this.held < 0) {
      this.held = 0;
      this.next = this.delay;
      return true;
    }
    this.held += dt;
    if (this.held + 1e-9 >= this.next) {
      // Schedule from the nominal time, but never let a hitch queue up a burst of repeats.
      this.next = Math.max(this.next + this.interval, this.held + this.interval * 0.5);
      return true;
    }
    return false;
  }

  reset(): void {
    this.held = -1;
  }
}

export type NavDir = 'up' | 'down' | 'left' | 'right' | null;

/**
 * Turns a stick into a single digital menu direction with hysteresis: engages past `on`,
 * releases below `off`, and only ever reports the dominant axis (no accidental diagonals).
 */
export class StickNav {
  dir: NavDir = null;
  constructor(
    readonly on: number = SHAPING.navOn,
    readonly off: number = SHAPING.navOff,
  ) {}

  /** x right +, y DOWN + (raw gamepad convention). */
  update(x: number, y: number): NavDir {
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const mag = Math.max(ax, ay);
    if (this.dir === null) {
      if (mag > this.on) this.dir = ax > ay ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up';
    } else if (mag < this.off) {
      this.dir = null;
    } else {
      // Allow a deliberate swing to another direction without passing through centre.
      const want: NavDir = ax > ay ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up';
      if (want !== this.dir && mag > this.on && Math.abs(ax - ay) > 0.25) this.dir = want;
    }
    return this.dir;
  }
}

export type PadStyle = 'xbox' | 'playstation' | 'generic';

/**
 * Controller family from Gamepad.id. Chrome reports e.g. "Xbox 360 Controller (XInput STANDARD
 * GAMEPAD)" or "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)"; Firefox
 * "054c-0ce6-DualSense Wireless Controller". 054c is Sony's USB vendor id, 045e Microsoft's.
 */
export function detectPadStyle(id: string): PadStyle {
  const s = id.toLowerCase();
  // Xbox first: "Xbox Wireless Controller" would otherwise match Sony's bare "Wireless Controller".
  if (/xbox|xinput|045e|x-box/.test(s)) return 'xbox';
  if (/054c|playstation|dualsense|dualshock|wireless controller|\bps[345]\b/.test(s)) return 'playstation';
  return 'generic';
}

/** Mouse wheel event → zoom notches (+ = zoom in / scroll away from you). */
export function wheelNotches(deltaY: number, deltaMode: number): number {
  // deltaMode: 0 pixels (~100 per notch in Chrome), 1 lines (~3 per notch in Firefox), 2 pages.
  const perNotch = deltaMode === 1 ? 3 : deltaMode === 2 ? 1 : 100;
  return clamp(-deltaY / perNotch, -5, 5);
}

/**
 * Tap-to-flap (Settings.holdToFlap = false): each press of the flap control produces one pulse
 * long enough for the flight model to start a wingbeat (it always finishes a beat it started).
 * The pulse carries the PEAK strength reached during it, so a hard trigger squeeze that rises
 * over a few frames still gives a strong beat. Holding does not repeat; release and press again.
 */
export class TapPulse {
  private timer = 0;
  private peak = 0;
  private armed = true;
  constructor(
    readonly seconds = 0.14,
    readonly pressAt: number = SHAPING.tapPressAt,
    readonly releaseAt = 0.1,
    /** Every pulse is at least this strong: the Player accepts beats from 0.3, so a light squeeze is a soft beat, never a lost one. */
    readonly minStrength: number = SHAPING.tapMinStrength,
  ) {}

  update(raw: number, dt: number): number {
    if (raw > this.pressAt && this.armed) {
      this.armed = false;
      this.timer = this.seconds;
      this.peak = raw;
    } else if (raw < this.releaseAt) {
      this.armed = true;
    }
    if (this.timer > 0) {
      this.timer -= dt;
      this.peak = Math.max(this.peak, raw);
      return Math.max(this.minStrength, this.peak);
    }
    return 0;
  }

  reset(): void {
    this.timer = 0;
    this.peak = 0;
    this.armed = true;
  }
}

/** Pick whichever of two sources is deflected further (keyboard ramp vs stick), keeping sign. */
export function dominant(a: number, b: number): number {
  return Math.abs(a) >= Math.abs(b) ? a : b;
}

/**
 * Keyboard pitch, shaped for a heavy body: where a digital pitch key should be heading after it
 * has been held `heldFor` seconds (0 when released). Soft at first (a tap or a short hold trims
 * the path), growing to full deflection only once the key is clearly held. Feed the result to
 * rampAxis with SHAPING.keyPitchAttack.
 */
export function keyPitchTarget(dir: number, heldFor: number): number {
  if (dir === 0) return 0;
  const S = SHAPING;
  const grow = clamp01((heldFor - S.keyPitchHold) / S.keyPitchGrow);
  const k = S.keyPitchSoft + (1 - S.keyPitchSoft) * grow * grow * (3 - 2 * grow);
  return Math.sign(dir) * k;
}

/** Output of BumperChord: tuck (both held) or a rudder direction (one held on its own). */
export interface ChordOut {
  tuck: boolean;
  left: boolean;
  right: boolean;
}

/**
 * The pad's shoulder buttons: either one alone is rudder; both together fold the wings (tuck), so
 * a dive never takes the right thumb off the camera stick. A lone bumper waits `window` seconds
 * before it counts as rudder (the second finger is usually a few frames behind), and after a
 * chord the bumper still held is ignored until it is let go — no rudder blip either side of a dive.
 */
export class BumperChord {
  private aliveFor = 0;
  private chord = false;
  private ignoreLeft = false;
  private ignoreRight = false;
  readonly out: ChordOut = { tuck: false, left: false, right: false };
  constructor(readonly window: number = SHAPING.chordWindow) {}

  update(left: boolean, right: boolean, dt: number): ChordOut {
    if (!left) this.ignoreLeft = false;
    if (!right) this.ignoreRight = false;
    const o = this.out;
    if (left && right) {
      this.chord = true;
      this.aliveFor = 0;
      o.tuck = true;
      o.left = o.right = false;
      return o;
    }
    if (this.chord) {
      // Chord released (one or both): whatever is still held stays quiet until let go.
      this.chord = false;
      this.ignoreLeft = left;
      this.ignoreRight = right;
    }
    o.tuck = false;
    const l = left && !this.ignoreLeft;
    const r = right && !this.ignoreRight;
    if (l || r) this.aliveFor += dt;
    else this.aliveFor = 0;
    const ready = this.aliveFor >= this.window;
    o.left = l && ready;
    o.right = r && ready;
    return o;
  }

  reset(): void {
    this.aliveFor = 0;
    this.chord = this.ignoreLeft = this.ignoreRight = false;
    this.out.tuck = this.out.left = this.out.right = false;
  }
}

/**
 * Mouse steering (optional, Settings.mouseFlight): mouse travel moves a virtual stick that eases
 * back to centre — quickly when the mouse is still, slowly while it moves — so proportional,
 * analog corrections are possible on a keyboard + mouse. x = roll (right +), y = pitch (+ = pulled
 * back / nose up: moving the mouse toward you).
 */
export class MouseStick {
  x = 0;
  y = 0;

  update(dxPx: number, dyPx: number, sensitivity: number, dt: number): this {
    const S = SHAPING;
    const k = S.mouseStickPerPx * sensitivity;
    const moving = dxPx !== 0 || dyPx !== 0;
    const ret = Math.exp(-(moving ? S.mouseStickReturnMoving : S.mouseStickReturn) * Math.max(0, dt));
    this.x = clamp(this.x * ret + dxPx * k, -1, 1);
    this.y = clamp(this.y * ret + dyPx * k, -1, 1);
    return this;
  }

  reset(): void {
    this.x = this.y = 0;
  }
}
