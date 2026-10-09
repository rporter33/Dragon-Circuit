// Wing poses for flight as joint angle channels (left wing convention; the right mirrors).
//
// Every wing bone rotates relative to its parent as R = Rz(elevation) · Ry(sweep) · Rx(twist):
//   elevation  + raises the wing (outer end up)
//   sweep      + swings the outer end back (toward the tail)
//   twist      + turns the leading edge down (pronation), − pitches it up
// Bind pose = fully spread, flat. Channels are blended linearly, which is fine for these ranges.

import { DEG, clamp, smoothstep } from '../../core/math';

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

/** Raised half-fold: the settle after landing, a resting shuffle. */
export const SETTLE = pose({
  humEl: 38,
  humSw: 38,
  humTw: -10,
  foreEl: 10,
  foreSw: -110,
  foreTw: 0,
  handEl: -20,
  handSw: 120,
  f0El: 6,
  f0Sw: 8,
  f1El: 6,
  f1Sw: -18,
  f2El: 6,
  f2Sw: -42,
  f0bEl: -6,
  f1bEl: -6,
  f2bEl: -6,
});

/** Folded on the ground (used where IK is not driving the arm). */
export const FOLDED = pose({
  humEl: -55,
  humSw: 55,
  humTw: 20,
  foreEl: -40,
  foreSw: -120,
  handEl: 75,
  handSw: 150,
  f0Sw: 6,
  f1Sw: -28,
  f2Sw: -58,
});

/** Linear blend a → b by t into out. */
export function blendPose(a: WingPose, b: WingPose, t: number, out: WingPose): WingPose {
  for (let i = 0; i < WING_CHANNELS; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}

/** Stroke position 0 (wings high) … 1 (bottom of the downstroke). */
export function stroke(phase: number): number {
  return 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
}

/** How folded the upstroke is: 0 on the downstroke, peaking mid-upstroke. */
export function upstrokeFold(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  return p > 0.5 ? Math.sin(((p - 0.5) / 0.5) * Math.PI) : 0;
}

/**
 * Stroke position of a heavy wing: like `stroke` (0 high, 1 at the bottom, same timing at 0 and
 * 0.5 so the flap event still lands on the bottom), but the wing hangs at the top while it
 * loads, then drives through the middle of the downstroke; the recovery is quicker. `heft`
 * (0 light … 1 heaviest breed) deepens the hang.
 */
export function heavyStroke(phase: number, heft: number): number {
  let p = phase - Math.floor(phase);
  if (p < 0.5) {
    const x = p * 2;
    return 0.5 - 0.5 * Math.cos(Math.PI * Math.pow(x, 1.25 + 0.35 * heft));
  }
  p = (p - 0.5) * 2;
  return 0.5 + 0.5 * Math.cos(Math.PI * Math.pow(p, 0.85));
}

/**
 * How hard the air pushes on the wing over a beat (0 slack … 1 peak of the power stroke, slightly
 * negative while the wing feathers up through the recovery). Peaks in the second half of the
 * downstroke, when the heavy wing is moving fastest.
 */
export function strokeLoad(phase: number): number {
  const p = phase - Math.floor(phase);
  if (p < 0.5) return Math.pow(Math.sin(Math.PI * Math.pow(p * 2, 1.15)), 1.4);
  return -0.35 * Math.sin(Math.PI * (p - 0.5) * 2);
}

/**
 * The flapping wing at a phase: a powerful, fully extended downstroke with the leading edge
 * pronated, then an upstroke with the elbow and wrist flexed so the tips fold and trail.
 * Distal joints lag the shoulder, so the wave runs out to the tips. `labor` (fatigue) deepens
 * the stroke and droops the tips; `heft` (0 light … 1 heaviest) makes the stroke bigger, the
 * hang at the top longer and the tips lag further behind the arm.
 */
export function flapPose(phase: number, labor: number, out: WingPose, heft = 0.4): WingPose {
  const u = upstrokeFold(phase - 0.03);
  const s2 = Math.sin((phase - 0.02) * Math.PI * 2);
  out.fill(0);
  const top = 50 + 6 * labor + 5 * heft;
  const bottom = -34 - 4 * labor - 4 * heft;
  out[W.humEl] = (top + (bottom - top) * heavyStroke(phase, heft)) * DEG;
  out[W.humSw] = (-7 * s2 + 10 * u) * DEG;
  out[W.humTw] = (13 * s2) * DEG;
  out[W.foreEl] = (12 - 22 * heavyStroke(phase - 0.05, heft)) * DEG;
  out[W.foreSw] = (-34 * u) * DEG;
  out[W.foreTw] = (4 * s2) * DEG;
  out[W.handEl] = (10 - 22 * heavyStroke(phase - 0.09, heft) - 6 * u) * DEG;
  out[W.handSw] = (46 * u) * DEG;
  out[W.handTw] = (6 * s2 - 8 * u) * DEG;
  // The tips trail the arm: bent up while the arm drives down, flicking through at the bottom,
  // trailing low on the way up. Heavier wings lag more.
  const lag = 0.14 + 0.04 * heft;
  const tipEl = ((14 + 9 * heft) * Math.sin((phase - lag) * Math.PI * 2) - 8 * labor * u) * DEG;
  for (let f = 0; f < 3; f++) {
    const el = (10 - 20 * heavyStroke(phase - 0.13 - 0.02 * f - 0.03 * heft, heft)) * DEG;
    out[W.f0El + f * 3] = el;
    out[W.f0Sw + f * 3] = (-(10 + 12 * f) * u) * DEG;
    out[W.f0Tw + f * 3] = (4 * s2) * DEG;
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

/**
 * Basking (the end of a reptile's stretch after resting): wings spread wide and raised toward
 * the sun like a cormorant drying out — arms up and out, the leading edge turned up so the
 * membrane faces the light, fingers splayed and their tips drooping. Blend weight is the caller's.
 */
export const BASK = pose({
  humEl: 30,
  humSw: 4,
  humTw: -12,
  foreEl: -6,
  foreSw: -12,
  foreTw: -6,
  handEl: -10,
  handSw: 10,
  f0El: -10,
  f0Sw: 2,
  f1El: -12,
  f1Sw: 6,
  f2El: -14,
  f2Sw: 12,
  f0bEl: -12,
  f1bEl: -10,
  f2bEl: -8,
});

/** Ease for the takeoff/landing opening of the wings on the ground. */
export const openEase = (x: number) => smoothstep(0, 1, x);
