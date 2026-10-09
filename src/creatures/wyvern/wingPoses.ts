// Wing poses for flight as joint angle channels (left wing convention; the right mirrors).
//
// Every wing bone rotates relative to its parent as R = Rz(elevation) · Ry(sweep) · Rx(twist):
//   elevation  + raises the wing (outer end up)
//   sweep      + swings the outer end back (toward the tail)
//   twist      + turns the leading edge down (pronation), − pitches it up
// Bind pose = fully spread, flat. Channels are blended linearly, which is fine for these ranges.
// The ground poses (folded, settle, bask) live in anim/groundPoses.ts.

import type { BreedId } from '../../core/types';
import { DEG, clamp } from '../../core/math';
import { BREEDS, DEFAULT_DOWN_FRAC } from '../../flight/breeds';

/** Channel layout of a wing pose (radians). */
export const W = {
  humEl: 0,
  humSw: 1,
  humTw: 2,
  foreEl: 3,
  foreSw: 4,
  foreTw: 5,
  handEl: 6,
  handSw: 7,
  handTw: 8,
  // finger proximal segments: el, sw, tw for f = 0..2
  f0El: 9,
  f0Sw: 10,
  f0Tw: 11,
  f1El: 12,
  f1Sw: 13,
  f1Tw: 14,
  f2El: 15,
  f2Sw: 16,
  f2Tw: 17,
  // distal segments: el, sw
  f0bEl: 18,
  f0bSw: 19,
  f1bEl: 20,
  f1bSw: 21,
  f2bEl: 22,
  f2bSw: 23,
  clawEl: 24,
  clawSw: 25,
} as const;
export const WING_CHANNELS = 26;

export type WingPose = Float32Array;

function pose(deg: Partial<Record<keyof typeof W, number>>): WingPose {
  const p = new Float32Array(WING_CHANNELS);
  for (const k in deg) p[W[k as keyof typeof W]] = (deg[k as keyof typeof W] ?? 0) * DEG;
  return p;
}

/** Soaring: slight dihedral, tips flexing up a touch. */
export const GLIDE = pose({ humEl: 7, humSw: -2, humTw: -2, foreEl: 2, handEl: -1, f0El: -1, f1El: -2, f2El: -3, f0bEl: 3, f1bEl: 2, f2bEl: 1 });

/**
 * Stooping dive: wings folded back along the body, wrists out, tips trailing past the tail. The
 * arm runs back level with the flank, under the rider's legs (the seat is over the ribcage).
 */
export const TUCK = pose({
  humEl: -6,
  humSw: 42,
  humTw: 6,
  foreEl: -12,
  foreSw: 58,
  foreTw: 4,
  handEl: -4,
  handSw: -10,
  f0El: 2,
  f0Sw: -6,
  f1El: 3,
  f1Sw: -38,
  f2El: 4,
  f2Sw: -66,
  f0bEl: -3,
  f1bEl: -2,
  f2bEl: -2,
});

/** Air brake: wings forward and high, cupped, leading edge pitched up hard. */
export const FLARE = pose({
  humEl: 26,
  humSw: -22,
  humTw: -28,
  foreEl: 6,
  foreSw: -8,
  foreTw: -6,
  handEl: -10,
  handSw: 4,
  f0El: -12,
  f0Sw: 2,
  f1El: -14,
  f1Sw: 6,
  f2El: -14,
  f2Sw: 9,
  f0bEl: -20,
  f1bEl: -18,
  f2bEl: -14,
});

/** A wing pose from per-channel angles in degrees (missing channels are 0). */
export const wingPose = pose;

/** Linear blend a → b by t into out. */
export function blendPose(a: WingPose, b: WingPose, t: number, out: WingPose): WingPose {
  for (let i = 0; i < WING_CHANNELS; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}

// --- The wingbeat --------------------------------------------------------------------------------
//
// One beat runs phase 0 → 1 (FlightState.flapPhase): the downstroke from the top of the stroke to
// the bottom over [0, D), the recovery back up over [D, 1), where D is the breed's downstroke
// fraction (BreedStats.downFrac, 0.54–0.62: big flyers spend most of the beat driving down). The
// flight model's power curve, the 'flap' event (at D), the membrane load and the body's heave all
// run on the same clock (strokePhase); the wing's visible travel is that clock eased
// (strokeWarp), so the wing is moving fastest while it pushes hardest and reverses briskly at the
// top instead of hanging there.

/**
 * Easing of the wing's travel (cubic Béziers (0,0)–(x1,0)–(x2,1)–(1,1)). The downstroke leaves
 * the top briskly, drives at a near-constant speed through the middle (where the flight model's
 * stroke pushes hardest) and slows into the bottom; the recovery starts slowly (the wing flips
 * and folds) and arrives back at the top briskly: a quick reversal up there, a loaded one below.
 */
const EASE_DOWN_X1 = 0.1;
const EASE_DOWN_X2 = 0.72;
const EASE_UP_X1 = 0.55;
const EASE_UP_X2 = 0.9;

/**
 * Stroke plane tilt: over the downstroke the shoulder sweeps forward by this fraction of the
 * elevation range, so the wing drives down AND forward and the wingtip traces a tilted loop in
 * side view (about 23° from the body's vertical), not a hinge. TILT_BACK of that sweep lies
 * behind the shoulder's neutral (the raised wing at the top), the rest ahead of it (the reach at
 * the bottom): the raised wing stays clear of the rider's legs and out of the chase camera's line
 * to the rider.
 */
const STROKE_TILT = 0.54;
const TILT_BACK = 0.25;

/**
 * Leading-edge twist of the arm (degrees, + pronated): pronated through the downstroke so the
 * wing bites as it drives down, flipped to supination within the first 15 % of the recovery
 * (the quick flip at the bottom), held while the wing rises, and flipped back to pronation
 * through the top reversal: from the last PRON_OUT of the recovery to the first PRON_IN of the
 * downstroke. The arm passes the top near neutral rather than already pronated, so the raised
 * wing root doesn't roll its trailing edge up into the rider's legs.
 */
const PRONATE = 15;
const SUPINATE = -22;
const SUP_FLIP = 0.15;
const PRON_OUT = 0.2;
const PRON_IN = 0.1;

/** Samples of a style's strokeWarp over one beat (the hot path reads these, see flapPose). */
const WARP_N = 256;

/** y of the cubic Bézier ease (0,0)–(x1,0)–(x2,1)–(1,1) at x (Newton on x(t)). */
function bezierEase(x: number, x1: number, x2: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // x(t) = a·t³ + b·t² + c·t
  const c = 3 * x1;
  const b = 3 * (x2 - x1) - c;
  const a = 1 - c - b;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const xt = ((a * t + b) * t + c) * t - x;
    const dx = (3 * a * t + 2 * b) * t + c;
    if (Math.abs(xt) < 1e-7 || Math.abs(dx) < 1e-7) break;
    t = clamp(t - xt / dx, 0, 1);
  }
  return t * t * (3 - 2 * t);
}

const frac = (x: number) => x - Math.floor(x);

/**
 * The beat's shared clock: phase 0..1 → 0..0.5 over the downstroke [0, D) and 0.5..1 over the
 * recovery [D, 1), linear within each. The flight model's power curve, the membrane load and the
 * heave are functions of this, so they peak together.
 */
export function strokePhase(phase: number, down: number): number {
  const p = frac(phase);
  return p < down ? (0.5 * p) / down : 0.5 + (0.5 * (p - down)) / (1 - down);
}

/**
 * Where the wing is in its stroke as a warped phase: 0 at the top, 0.5 at the bottom (reached
 * exactly at phase D, when the 'flap' event fires), eased so the wing moves fastest mid-stroke.
 * (The exact curve; flapPose reads the style's precomputed table of it.)
 */
export function strokeWarp(phase: number, down: number): number {
  const p = frac(phase);
  if (p < down) return 0.5 * bezierEase(p / down, EASE_DOWN_X1, EASE_DOWN_X2);
  return 0.5 + 0.5 * bezierEase((p - down) / (1 - down), EASE_UP_X1, EASE_UP_X2);
}

/** Stroke travel: 0 with the wings at the top … 1 at the bottom of the downstroke. */
export function strokeTravel(phase: number, down: number): number {
  const w = strokeWarp(phase, down);
  return w < 0.5 ? 2 * w : 2 - 2 * w;
}

/** How folded the recovery is: 0 on the downstroke, rising to 1 mid-recovery and back. */
export function recoveryFold(phase: number, down: number): number {
  const w = strokeWarp(phase, down);
  return w > 0.5 ? Math.sin((w - 0.5) * 2 * Math.PI) : 0;
}

/**
 * How a breed beats its wings (angles in degrees, left wing convention). The shoulder sets the
 * size of the stroke, the elbow and wrist fold the wing on the recovery, the fingers flex and
 * trail the arm. Big wings beat shallow and let the tips do the work; small ones beat deep.
 */
export interface FlapStyle {
  /** Downstroke fraction of the beat (the breed's BreedStats.downFrac). */
  readonly down: number;
  /** Shoulder elevation at the top and at the bottom of the stroke. */
  readonly humTop: number;
  readonly humBot: number;
  /** Shoulder sweep at the height of the downstroke (− reaches forward) and the recovery (+ draws back). */
  readonly sweepDown: number;
  readonly sweepUp: number;
  /** How far the elbow and wrist fold on the recovery (1 = the full M-fold). */
  readonly fold: number;
  /** How far the fingertips bend under the stroke (degrees) and how far they trail the arm (phase). */
  readonly tipFlex: number;
  readonly tipLag: number;
  /**
   * How far (phase) the arm runs ahead of the beat's clock. The bend runs out along the wing, so
   * the tip reaches the bottom after the shoulder does; leading the arm by that much centres the
   * wingtip's short dwell at the bottom on the 'flap' event, when the flight model's power stroke
   * ends (measured on the rig with the chest's beat pitch: wyvern.flight.test.ts).
   */
  readonly lead: number;
  /** strokeWarp(i / WARP_N, down) for i = 0..WARP_N (derived; built by flapStyle). */
  readonly warp: Float32Array;
}

/** A FlapStyle for a downstroke fraction, with its warp table. */
export function flapStyle(down: number, s: Omit<FlapStyle, 'down' | 'warp'>): FlapStyle {
  const warp = new Float32Array(WARP_N + 1);
  for (let i = 0; i < WARP_N; i++) warp[i] = strokeWarp(i / WARP_N, down);
  warp[WARP_N] = 1;
  return { down, ...s, warp };
}

const breedStyle = (id: BreedId, s: Omit<FlapStyle, 'down' | 'warp'>) => flapStyle(BREEDS[id].downFrac ?? DEFAULT_DOWN_FRAC, s);

/**
 * The breeds' strokes. The skimmer beats deep and quick with a full fold; the harrier is the
 * all-rounder; the galewing's long, high-aspect wing beats shallow from the shoulder, its hand
 * never fully folds and the flexing tips do the work (an albatross, not a bat); the ironback
 * drives a deep, heavy downstroke on stiff tips.
 */
export const FLAP_STYLES: Readonly<Record<BreedId, FlapStyle>> = {
  skimmer: breedStyle('skimmer', { humTop: 46, humBot: -36, sweepDown: -14, sweepUp: 18, fold: 1.0, tipFlex: 16, tipLag: 0.12, lead: 0.05 }),
  harrier: breedStyle('harrier', { humTop: 38, humBot: -36, sweepDown: -16, sweepUp: 20, fold: 0.9, tipFlex: 18, tipLag: 0.15, lead: 0.064 }),
  galewing: breedStyle('galewing', { humTop: 24, humBot: -22, sweepDown: -8, sweepUp: 10, fold: 0.55, tipFlex: 24, tipLag: 0.2, lead: 0.093 }),
  ironback: breedStyle('ironback', { humTop: 32, humBot: -44, sweepDown: -14, sweepUp: 16, fold: 0.8, tipFlex: 14, tipLag: 0.18, lead: 0.056 }),
};

/**
 * How hard the air pushes on the wing over a beat (0 slack … 1 peak of the power stroke, slightly
 * negative while the wing feathers up through the recovery). Runs on the shared clock, so the
 * fingers bend and the membrane billows exactly when the flight model's stroke pushes hardest.
 */
export function strokeLoad(phase: number, style: FlapStyle = FLAP_STYLES.harrier): number {
  const p = phase - Math.floor(phase);
  const D = style.down;
  if (p < D) return Math.pow(Math.sin((Math.PI * p) / D), 1.4);
  return -0.35 * Math.sin((Math.PI * (p - D)) / (1 - D));
}

// Phase lags the pose reads the stroke at (the wave running out along the wing): shoulder, elbow,
// wrist, the three fingers, the forearm/finger twist; the tips' lag is the style's. flapPose
// samples the warp table for all of them in one loop: no helper calls in the hot path (a double
// passed to or returned from a call the JIT doesn't inline is boxed on the heap, every frame).
const LAGS = new Float64Array([0, 0.03, 0.05, 0.07, 0.085, 0.1, 0.02, 0]);
const TIP = 7;
const _w = new Float64Array(LAGS.length);
const _tw = new Float64Array(2);

/**
 * The flapping wing at a phase, in the breed's style: a fully extended downstroke driving down
 * and forward with the leading edge pronated, a quick supination flip at the bottom, then a
 * recovery with the elbow and wrist flexed (the M-fold) drawing the wing up and back. Distal
 * joints lag the shoulder, so the wave runs out to the tips, which bend up under the load and
 * trail low on the way up. `labor` (fatigue) deepens the stroke and droops the tips.
 * Allocation-free.
 */
export function flapPose(beatPhase: number, labor: number, out: WingPose, style: FlapStyle = FLAP_STYLES.harrier): WingPose {
  const D = style.down;
  const fold = style.fold;
  const lut = style.warp;
  const base = beatPhase + style.lead;
  // The warped phase at each lag (linear in the table).
  for (let i = 0; i < LAGS.length; i++) {
    let p = base - (i === TIP ? style.tipLag : LAGS[i]);
    p -= Math.floor(p);
    const f = p * WARP_N;
    const j = Math.min(WARP_N - 1, f | 0);
    _w[i] = lut[j] + (lut[j + 1] - lut[j]) * (f - j);
  }
  // Arm twist now and 0.04 earlier (the hand trails the flip).
  for (let i = 0; i < 2; i++) {
    let p = base - 0.04 * i;
    p -= Math.floor(p);
    let tw = PRONATE;
    const r = p >= D ? (p - D) / (1 - D) : -1;
    if (r >= 0 && r < SUP_FLIP) {
      // The supination flip at the bottom.
      const t = r / SUP_FLIP;
      tw = PRONATE + (SUPINATE - PRONATE) * t * t * (3 - 2 * t);
    } else if (r >= 0 && r < 1 - PRON_OUT) {
      tw = SUPINATE;
    } else if (r >= 0 || p < PRON_IN * D) {
      // The pronation flip through the top: time from the top, the recovery counted negative.
      const q = r >= 0 ? p - 1 : p;
      const q0 = -PRON_OUT * (1 - D);
      const t = (q - q0) / (PRON_IN * D - q0);
      tw = SUPINATE + (PRONATE - SUPINATE) * t * t * (3 - 2 * t);
    }
    _tw[i] = tw;
  }
  const w0 = _w[0];
  const s = w0 < 0.5 ? 2 * w0 : 2 - 2 * w0;
  // The recovery's fold, read a little behind the shoulder.
  const wf = _w[1];
  const u = wf > 0.5 ? Math.sin((wf - 0.5) * 2 * Math.PI) * fold : 0;
  // Distal elevations scale with the size of the stroke: a shallow shoulder stroke keeps the wing flat.
  const k = style.humTop / 50;
  const top = style.humTop + 6 * labor;
  const bottom = style.humBot - 4 * labor;
  out.fill(0);
  out[W.humEl] = (top + (bottom - top) * s) * DEG;
  // Sweep: the tilted stroke plane (a little back at the top, forward at the bottom), plus a forward reach
  // late in the downstroke and a draw back through the recovery: a loop, not a hinge.
  const loop = w0 < 0.5 ? style.sweepDown * Math.sin(Math.PI * Math.pow(s, 1.94)) : style.sweepUp * Math.sin(Math.PI * s);
  out[W.humSw] = (STROKE_TILT * (TILT_BACK - s) * (style.humTop - style.humBot) + loop) * DEG;
  out[W.humTw] = _tw[0] * DEG;
  const sw = Math.sin(2 * Math.PI * _w[6]);
  out[W.foreEl] = k * (12 - 22 * (wf < 0.5 ? 2 * wf : 2 - 2 * wf)) * DEG;
  out[W.foreSw] = -34 * u * DEG;
  out[W.foreTw] = 4 * sw * DEG;
  const wh = _w[2];
  out[W.handEl] = (k * (10 - 22 * (wh < 0.5 ? 2 * wh : 2 - 2 * wh)) - 6 * u) * DEG;
  out[W.handSw] = 46 * u * DEG;
  // The hand's twist trails the arm's flip by a moment.
  out[W.handTw] = (0.6 * (_tw[1] - _tw[0]) - 8 * u) * DEG;
  // The tips trail the arm: bent up while the arm drives down, flicking through at the bottom,
  // trailing low on the way up.
  const tipEl = (style.tipFlex * Math.sin(2 * Math.PI * _w[TIP]) - 8 * labor * (fold > 0 ? u / fold : 0)) * DEG;
  for (let f = 0; f < 3; f++) {
    const wg = _w[3 + f];
    out[W.f0El + f * 3] = k * (10 - 20 * (wg < 0.5 ? 2 * wg : 2 - 2 * wg)) * DEG;
    out[W.f0Sw + f * 3] = -(10 + 12 * f) * u * DEG;
    out[W.f0Tw + f * 3] = 4 * sw * DEG;
    out[W.f0bEl + f * 2] = tipEl * (1 - 0.2 * f) - 10 * u * DEG;
    out[W.f0bSw + f * 2] = 6 * u * DEG;
  }
  return out;
}

/**
 * Bend the fingers under the air load (`load` ≈ −0.4 slack … 1.5 hard power stroke): loaded
 * fingers bow up toward their tips like fishing rods, the wrist gives a little and the tips
 * spread; slack fingers droop. Added on top of a blended pose.
 */
export function loadPose(out: WingPose, load: number): void {
  out[W.handEl] += 3 * load * DEG;
  for (let f = 0; f < 3; f++) {
    const k = 1 - 0.18 * f;
    out[W.f0El + f * 3] += 4.5 * load * k * DEG;
    out[W.f0bEl + f * 2] += 8 * load * k * DEG;
    // Spread under load: the outer finger sweeps forward, the inner ones back.
    out[W.f0Sw + f * 3] += (f - 1) * 2 * Math.max(0, load) * DEG;
  }
}

/**
 * Per-frame adjustments on top of a blended pose:
 *  - g-load bends the outer wing up (dihedral grows, tips flex),
 *  - roll/turn asymmetry: the rising (outer) wing reaches forward with more angle of attack,
 *    the inner wing sweeps a little and unloads,
 *  - stall buffet: noisy shudder in elevation and twist.
 * `asym` > 0 means this wing is the outer/rising one.
 */
export function adjustPose(out: WingPose, gLoad: number, asym: number, buffet: number, buffetTw: number, spreadAmt: number): void {
  const g = clamp(gLoad - 1, -1.5, 4) * spreadAmt;
  out[W.humEl] += g * 1.6 * DEG;
  out[W.foreEl] += g * 1.2 * DEG;
  out[W.handEl] += g * 1.0 * DEG;
  for (let f = 0; f < 3; f++) out[W.f0bEl + f * 2] += g * (3.2 - 0.6 * f) * DEG;
  const a = clamp(asym, -1, 1) * spreadAmt;
  out[W.humTw] += -7 * a * DEG;
  out[W.humSw] += (a > 0 ? -5 * a : -9 * a) * DEG;
  out[W.handSw] += (a < 0 ? -10 * a : 0) * DEG;
  out[W.humEl] += (a < 0 ? 4 * a : 2 * a) * DEG;
  out[W.humEl] += buffet * 7 * DEG;
  out[W.humTw] += buffetTw * 10 * DEG;
  out[W.handEl] += buffet * 6 * DEG;
  for (let f = 0; f < 3; f++) out[W.f0bEl + f * 2] += buffet * (8 + 3 * f) * DEG;
}
