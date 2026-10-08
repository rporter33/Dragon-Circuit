// The six rider outfits. Each colors and shapes the base body (OutfitStyle) and adds garment
// pieces: belts, straps, collars, skirts, pauldrons. Cloth that moves (coat tails) is declared in
// accessories.ts and simulated in cloth.ts.

import { Color, Quaternion, Vector3 } from 'three';
import type { RiderLook } from '../../core/types';
import { B, type RigDims } from './rig';
import { sk, sk2 } from './meshKit';
import { torsoPoint, torsoSkin, type BodyCtx, type OutfitStyle, type Side } from './body';
import { mixSrgb, tone, type RiderPalette } from './palette';
import { armPath, block, collar, legPath, skirtPanel, strap, stud, torsoBand, torsoPath, X, Y, Z, smooth } from './garments';

const PI = Math.PI;
const HALF = PI / 2;
const front = (th: number) => Math.sin(th);

/** Collar height when there is no scarf around the neck ("collar up instead"). */
function collarUp(look: RiderLook): boolean {
  return look.scarf === 'none';
}

export function outfitStyle(look: RiderLook, pal: RiderPalette, d: RigDims): OutfitStyle {
  switch (look.outfit) {
    case 'scout':
      return scout(look, pal, d);
    case 'courier':
      return courier(look, pal, d);
    case 'racer':
      return racer(look, pal, d);
    case 'cartographer':
      return cartographer(look, pal, d);
    case 'skyknight':
      return skyknight(look, pal, d);
    case 'flight':
    default:
      return flight(look, pal, d);
  }
}

// ---------------------------------------------------------------------------------------------

function belt(ctx: BodyCtx, y0: number, y1: number, inflate: number, leather: Color, buckle: Color): void {
  torsoBand(ctx, y0, y1, inflate, leather);
  const p = new Vector3();
  const n = new Vector3();
  torsoPoint(ctx, (y0 + y1) / 2, HALF, inflate + 0.002, p, n);
  const s = torsoSkin(ctx, (y0 + y1) / 2, p);
  block(ctx, p, n, Y, new Vector3(0.05 * ctx.d.w, (y1 - y0) * 1.25, 0.012), buckle, s);
  block(ctx, p.clone().addScaledVector(n, 0.004), n, Y, new Vector3(0.026 * ctx.d.w, (y1 - y0) * 0.55, 0.012), tone(leather, 0.8), s);
}

function pouch(ctx: BodyCtx, y: number, th: number, inflate: number, color: Color, flap: Color, size = 1): void {
  const p = new Vector3();
  const n = new Vector3();
  torsoPoint(ctx, y, th, inflate, p, n);
  const s = torsoSkin(ctx, y, p);
  block(ctx, p, n, Y, new Vector3(0.07 * size, 0.08 * size, 0.035 * size), color, s);
  block(ctx, p.clone().addScaledVector(n, 0.003).addScaledVector(Y, 0.025 * size), n, Y, new Vector3(0.074 * size, 0.035 * size, 0.035 * size), flap, s);
}

/** Boot cuff ring at s (below the hip joint) on both legs. */
function bootCuff(ctx: BodyCtx, s: number, inflate: number, h: number, color: Color): void {
  for (const side of [1, -1] as const) {
    const J = side > 0 ? ctx.bp.thighL : ctx.bp.thighR;
    const r0 = ctx.legAt(s);
    const r1 = ctx.legAt(s + h);
    const tb = side > 0 ? B.thighL : B.thighR;
    const sb = side > 0 ? B.shinL : B.shinR;
    const skin = s < ctx.d.thigh + 0.05 ? sk2(tb, sb, smooth(ctx.d.thigh - 0.05, ctx.d.thigh + 0.05, s)) : sk(sb);
    ctx.b.loft(
      [
        { c: new Vector3(J.x - side * 0.006, J.y - s + 0.002, J.z), ax: X, ay: Z, rx: r0.rx + inflate * 0.4, ry: r0.rf + inflate * 0.4, ryBack: r0.rb + inflate * 0.4, skin, color },
        { c: new Vector3(J.x - side * 0.006, J.y - s, J.z), ax: X, ay: Z, rx: r0.rx + inflate, ry: r0.rf + inflate, ryBack: r0.rb + inflate, skin, color },
        { c: new Vector3(J.x - side * 0.006, J.y - s - h, J.z), ax: X, ay: Z, rx: r1.rx + inflate * 0.9, ry: r1.rf + inflate * 0.9, ryBack: r1.rb + inflate * 0.9, skin, color },
      ],
      14,
    );
  }
}

/** A sleeve cuff band at s (below the shoulder) on both arms. */
function sleeveCuff(ctx: BodyCtx, s: number, h: number, inflate: number, color: Color, flare = 0): void {
  for (const side of [1, -1] as const) {
    const S = side > 0 ? ctx.bp.upperArmL : ctx.bp.upperArmR;
    const fo = side > 0 ? B.foreArmL : B.foreArmR;
    const ha = side > 0 ? B.handL : B.handR;
    const a0 = ctx.armAt(s);
    const a1 = ctx.armAt(s + h);
    const L = ctx.d.upperArm + ctx.d.foreArm;
    const skin = (ss: number) => sk2(fo, ha, 0.35 * smooth(L - 0.03, L, ss));
    ctx.b.loft(
      [
        { c: new Vector3(S.x, S.y - s + 0.002, S.z), ax: X, ay: Z, rx: a0.rx + inflate * 0.3, ry: a0.rz + inflate * 0.3, skin: skin(s), color },
        { c: new Vector3(S.x, S.y - s, S.z), ax: X, ay: Z, rx: a0.rx + inflate, ry: a0.rz + inflate, skin: skin(s), color },
        { c: new Vector3(S.x, S.y - s - h, S.z), ax: X, ay: Z, rx: a1.rx + inflate + flare, ry: a1.rz + inflate + flare, skin: skin(s + h), color },
        { c: new Vector3(S.x, S.y - s - h + 0.002, S.z), ax: X, ay: Z, rx: a1.rx + inflate * 0.2, ry: a1.rz + inflate * 0.2, skin: skin(s + h), color },
      ],
      12,
    );
  }
}

// --- Flight leathers ------------------------------------------------------------------------

function flight(look: RiderLook, pal: RiderPalette, d: RigDims): OutfitStyle {
  const hem = 0.965 * d.h;
  const yoke = 1.335 * d.h;
  const bootTop = d.thigh + 0.07 * d.h;
  return {
    torso: {
      color: (y, th) => (y < hem ? pal.trousers : y > yoke ? (front(th) > -0.2 ? pal.primaryDark : pal.primary) : pal.primary),
      inflate: (y) => (y < hem ? 0.003 : 0.008),
      bounds: [hem, yoke],
    },
    arm: {
      color: (s) => (s > d.upperArm + d.foreArm - 0.06 ? pal.leatherDark : pal.primary),
      inflate: (s) => (s > d.upperArm + d.foreArm - 0.06 ? 0.011 : 0.007),
      bounds: [d.upperArm + d.foreArm - 0.06],
    },
    leg: {
      color: (s) => (s > bootTop ? pal.boot : pal.trousers),
      inflate: (s) => (s > bootTop ? 0.012 : 0.004),
      bounds: [bootTop],
    },
    hand: pal.leatherDark,
    cuff: pal.leatherDark,
    foot: { color: pal.boot, sole: pal.sole },
    extras(ctx) {
      belt(ctx, 0.975 * d.h, 1.015 * d.h, 0.012, pal.leather, pal.brass);
      pouch(ctx, 0.985 * d.h, PI + 0.55, 0.02, pal.leather, pal.leatherDark, 0.9);
      // Chest strap, left shoulder to right hip, front and back.
      const s = torsoPath(
        ctx,
        [
          [1.415 * d.h, HALF - 1.25],
          [1.33 * d.h, HALF - 0.55],
          [1.2 * d.h, HALF + 0.2],
          [1.04 * d.h, HALF + 1.05],
        ],
        0.009,
      );
      strap(ctx, s, 0.016, 0.003, pal.leather);
      const sb = torsoPath(
        ctx,
        [
          [1.415 * d.h, -HALF + 1.25],
          [1.33 * d.h, -HALF + 0.55],
          [1.2 * d.h, -HALF - 0.2],
          [1.04 * d.h, -HALF - 1.05],
        ],
        0.009,
      );
      strap(ctx, sb, 0.016, 0.003, pal.leather);
      const mid = s[Math.floor(s.length * 0.45)];
      stud(ctx, mid.p.clone().addScaledVector(mid.n, 0.005), mid.n, 0.011, pal.brass, mid.skin);
      // Shearling collar.
      collar(ctx, {
        h: (collarUp(look) ? 0.085 : 0.05) * d.h,
        r0: 0.07 * d.g + 0.01,
        flare: collarUp(look) ? 0.012 : 0.03,
        thick: 0.018,
        color: pal.cream,
        bumpy: 1,
        open: 0.25,
      });
      bootCuff(ctx, bootTop - 0.005, 0.016, 0.045, tone(pal.boot, 1.25));
      // Jacket hem flare.
      torsoBand(ctx, hem, hem + 0.035 * d.h, 0.013, pal.primary);
    },
  };
}

// --- Scout's tunic --------------------------------------------------------------------------

function scout(look: RiderLook, pal: RiderPalette, d: RigDims): OutfitStyle {
  const waist = 1.0 * d.h;
  const vestBot = 1.04 * d.h;
  const sleeve = d.upperArm + 0.02;
  const bracer = d.upperArm + 0.07;
  const bootTop = d.thigh + 0.17 * d.h;
  const vest = mixSrgb(pal.secondary, pal.leather, 0.35);
  const wraps = mixSrgb(pal.cloth, pal.secondary, 0.2);
  return {
    torso: {
      color: (y, th, p) => {
        if (y < 0.93 * d.h) return pal.trousers;
        if (y > vestBot && y < 1.395 * d.h) {
          const side = Math.abs(Math.cos(th)) > 0.93;
          const vneck = front(th) > 0 && Math.abs(p.x) < 0.012 + (y - 1.2 * d.h) * 0.45 && y > 1.2 * d.h;
          if (!side && !vneck) return vest;
        }
        return pal.primary;
      },
      inflate: (y) => (y > vestBot && y < 1.395 * d.h ? 0.012 : 0.007),
      bounds: [0.93 * d.h, vestBot, 1.395 * d.h],
    },
    arm: {
      color: (s) => (s < sleeve ? pal.primary : s < bracer ? pal.skin : s < d.upperArm + d.foreArm - 0.02 ? pal.leather : pal.skin),
      inflate: (s) => (s < sleeve ? 0.009 : s < bracer ? 0 : s < d.upperArm + d.foreArm - 0.02 ? 0.01 : 0),
      bounds: [sleeve, bracer, d.upperArm + d.foreArm - 0.02],
    },
    leg: {
      color: (s, th) => {
        if (s > bootTop) return pal.leather;
        if (s > bootTop - 0.16 * d.h) return Math.floor((s - bootTop) / 0.028) % 2 === 0 ? wraps : tone(wraps, 0.85);
        return pal.trousers;
      },
      inflate: (s) => (s > bootTop ? 0.01 : s > bootTop - 0.16 * d.h ? 0.008 : 0.003),
      bounds: [bootTop, bootTop - 0.16 * d.h],
    },
    hand: pal.skin,
    foot: { color: pal.leather, sole: pal.sole },
    extras(ctx) {
      // Tunic skirt in four panels with a contrasting hem.
      const hem = (u: number, v: number) => (v > 0.84 ? pal.secondary : pal.primary);
      const panels: [number, number, number][] = [
        [HALF + 0.08, HALF + 1.5, 0.8],
        [HALF - 1.5, HALF - 0.08, 0.8],
        [-HALF + 0.08, -HALF + 1.5, 0.6],
        [-HALF - 1.5, -HALF - 0.08, 0.6],
      ];
      for (const [a, b, f] of panels) {
        skirtPanel(ctx, { th0: a, th1: b, yTop: waist, yBot: 0.66 * d.h, inflate: 0.01, flare: 0.12, thickness: 0.008, follow: f, color: hem });
      }
      belt(ctx, 0.985 * d.h, 1.02 * d.h, 0.022, pal.leather, pal.brass);
      pouch(ctx, 0.99 * d.h, PI + 0.5, 0.03, pal.leather, pal.leatherDark);
      pouch(ctx, 0.99 * d.h, -0.45, 0.03, pal.leather, pal.leatherDark, 0.85);
      pouch(ctx, 0.99 * d.h, -HALF - 0.6, 0.03, tone(pal.leather, 0.9), pal.leatherDark, 0.8);
      // Lacing at the V-neck.
      for (let i = 0; i < 3; i++) {
        const y = (1.26 + i * 0.035) * d.h;
        const p = new Vector3();
        const n = new Vector3();
        torsoPoint(ctx, y, HALF, 0.012, p, n);
        stud(ctx, p, n, 0.006, pal.cream, torsoSkin(ctx, y, p), 0.6);
      }
      collar(ctx, { h: (collarUp(look) ? 0.075 : 0.03) * d.h, r0: 0.064 * d.g + 0.008, flare: 0.01, thick: 0.01, color: pal.primary, open: 0.5 });
      sleeveCuff(ctx, sleeve - 0.025, 0.03, 0.012, pal.primaryDark);
    },
  };
}

// --- Courier's coat -------------------------------------------------------------------------

function courier(look: RiderLook, pal: RiderPalette, d: RigDims): OutfitStyle {
  const bootTop = d.thigh + 0.04 * d.h;
  const cuffS = d.upperArm + d.foreArm - 0.1;
  return {
    torso: {
      color: (y) => (y < 0.9 * d.h ? pal.trousers : pal.primary),
      inflate: (y) => (y < 0.9 * d.h ? 0.004 : 0.014),
      bounds: [0.9 * d.h],
    },
    arm: {
      color: () => pal.primary,
      inflate: (s) => 0.012 + 0.004 * smooth(d.upperArm, cuffS, s),
      bounds: [],
    },
    leg: {
      color: (s) => (s > bootTop ? pal.boot : pal.trousers),
      inflate: (s) => (s > bootTop ? 0.013 : 0.005),
      bounds: [bootTop],
    },
    hand: pal.leatherDark,
    cuff: pal.leatherDark,
    foot: { color: pal.boot, sole: pal.sole },
    extras(ctx) {
      // Front skirt of the coat: two panels that part over the legs. The back is cloth (tails).
      const col = (u: number, v: number, inner: boolean) => (inner ? pal.secondaryDark : v > 0.9 ? pal.primaryDark : pal.primary);
      skirtPanel(ctx, { th0: HALF + 0.06, th1: HALF + 1.62, yTop: 0.99 * d.h, yBot: 0.5 * d.h, inflate: 0.016, flare: 0.1, thickness: 0.01, follow: 0.92, color: col, rows: 7 });
      skirtPanel(ctx, { th0: HALF - 1.62, th1: HALF - 0.06, yTop: 0.99 * d.h, yBot: 0.5 * d.h, inflate: 0.016, flare: 0.1, thickness: 0.01, follow: 0.92, color: col, rows: 7 });
      // Sash.
      torsoBand(ctx, 0.985 * d.h, 1.035 * d.h, 0.024, pal.secondary);
      // Double row of buttons.
      for (let i = 0; i < 4; i++) {
        const y = (1.08 + i * 0.075) * d.h;
        for (const o of [-0.32, 0.32]) {
          const p = new Vector3();
          const n = new Vector3();
          torsoPoint(ctx, y, HALF + o * (1 - i * 0.12), 0.016, p, n);
          stud(ctx, p, n, 0.0095, pal.brass, torsoSkin(ctx, y, p), 0.5);
        }
      }
      // Lapel line: a raised placket down the front.
      strap(ctx, torsoPath(ctx, [
        [1.4 * d.h, HALF - 0.55],
        [1.24 * d.h, HALF - 0.1],
        [1.04 * d.h, HALF - 0.08],
      ], 0.016), 0.012, 0.003, pal.primaryDark);
      // High standing collar, lined.
      collar(ctx, {
        h: (collarUp(look) ? 0.12 : 0.085) * d.h,
        r0: 0.07 * d.g + 0.012,
        flare: 0.035,
        thick: 0.008,
        color: pal.primary,
        inner: pal.secondary,
        open: 0.55,
      });
      // Turned-back cuffs.
      sleeveCuff(ctx, cuffS, 0.075, 0.022, pal.secondary, 0.008);
      bootCuff(ctx, bootTop - 0.004, 0.018, 0.05, tone(pal.boot, 1.2));
      // Epaulettes.
      for (const side of [1, -1] as const) {
        const S = side > 0 ? ctx.bp.upperArmL : ctx.bp.upperArmR;
        const p = new Vector3(S.x - side * 0.05, S.y + 0.045, S.z - 0.005);
        ctx.b.bar(p.clone().add(new Vector3(side * 0.045, -0.008, 0)), p.clone().add(new Vector3(-side * 0.05, 0.008, 0)), Z, 0.032, 0.007, sk2(B.chest, side > 0 ? B.clavL : B.clavR, 0.6), pal.secondary, { exp: 3 });
      }
    },
  };
}

// --- Racing suit ----------------------------------------------------------------------------

function racer(look: RiderLook, pal: RiderPalette, d: RigDims): OutfitStyle {
  const dark = mixSrgb(new Color('#26262c'), pal.primaryDark, 0.25);
  const bootTop = d.thigh + 0.2 * d.h;
  const glove = d.upperArm + d.foreArm - 0.05;
  return {
    torso: {
      color: (y, th) => {
        if (Math.abs(Math.cos(th)) > 0.94 && y > 0.88 * d.h) return pal.secondary;
        if (y > 1.36 * d.h && front(th) < 0.3) return pal.primaryDark;
        return pal.primary;
      },
      inflate: () => 0.002,
      bounds: [1.36 * d.h],
    },
    arm: {
      color: (s) => (s > glove ? dark : pal.primary),
      inflate: (s) => (s > glove ? 0.008 : 0.002),
      bounds: [glove],
    },
    leg: {
      color: (s) => (s > bootTop ? dark : s > bootTop - 0.03 ? pal.secondary : pal.primary),
      inflate: (s) => (s > bootTop - 0.03 ? 0.008 : 0.002),
      bounds: [bootTop, bootTop - 0.03],
    },
    hand: dark,
    cuff: pal.secondary,
    foot: { color: dark, sole: pal.secondary },
    extras(ctx) {
      // Chevron across the chest and a matching one on the back.
      for (const sgn of [1, -1]) {
        const c = sgn * HALF;
        for (const k of [-1, 1]) {
          strap(ctx, torsoPath(ctx, [
            [1.33 * d.h, c + k * 0.95],
            [1.2 * d.h, c + k * 0.02],
          ], 0.003, 0.02), 0.017, 0.0022, pal.secondary);
        }
      }
      // Stripes down the outside of the arms and legs.
      for (const side of [1, -1] as const) {
        const th = side > 0 ? 0 : PI;
        strap(ctx, armPath(ctx, side, 0.02, d.upperArm + d.foreArm - 0.06, th, 0.003), 0.009, 0.0018, pal.secondary);
        strap(ctx, legPath(ctx, side, 0.0, d.thigh + 0.18 * d.h, th, 0.003), 0.011, 0.0018, pal.secondary);
      }
      collar(ctx, { h: (collarUp(look) ? 0.07 : 0.035) * d.h, r0: 0.058 * d.g + 0.004, flare: 0.004, thick: 0.006, color: pal.primaryDark });
      belt(ctx, 0.985 * d.h, 1.01 * d.h, 0.006, dark, pal.secondary);
      // Number patch on the left breast.
      const p = new Vector3();
      const n = new Vector3();
      torsoPoint(ctx, 1.27 * d.h, HALF - 0.62, 0.004, p, n);
      block(ctx, p, n, Y, new Vector3(0.05, 0.04, 0.004), pal.primaryLight, torsoSkin(ctx, 1.27 * d.h, p));
    },
  };
}

// --- Cartographer's robes -------------------------------------------------------------------

function cartographer(look: RiderLook, pal: RiderPalette, d: RigDims): OutfitStyle {
  const trim = pal.secondary;
  const motif = mixSrgb(pal.primary, pal.secondary, 0.55);
  // Wind-chart embroidery: wavy isobar lines near the hem.
  const embroidery = (u: number, v: number) => {
    if (v > 0.9) return trim;
    if (v > 0.6) {
      const w = Math.sin(u * 20 + Math.sin(v * 26) * 1.2) * 0.5 + 0.5;
      if (Math.abs(v - 0.75 - 0.05 * Math.sin(u * 14)) < 0.02 || w > 0.93) return motif;
    }
    return pal.primary;
  };
  const bootTop = d.thigh + 0.2 * d.h;
  return {
    torso: {
      color: (y, th, p) => {
        if (y < 0.93 * d.h) return pal.trousers;
        // Embroidered front opening.
        if (front(th) > 0.85 && Math.abs(p.x) < 0.03) return trim;
        return pal.primary;
      },
      inflate: (y) => (y < 0.93 * d.h ? 0.004 : 0.014),
      bounds: [0.93 * d.h],
    },
    arm: {
      color: () => pal.primary,
      inflate: (s) => 0.012 + 0.012 * smooth(0.1, 0.4, s),
      bounds: [],
    },
    leg: {
      color: (s) => (s > bootTop ? pal.leather : pal.trousers),
      inflate: (s) => (s > bootTop ? 0.009 : 0.006),
      bounds: [bootTop],
    },
    hand: pal.skin,
    foot: { color: pal.leather, sole: pal.sole },
    extras(ctx) {
      // Four long robe panels with slits at the sides, front and back.
      const panels: [number, number, number][] = [
        [HALF + 0.05, HALF + 1.52, 0.92],
        [HALF - 1.52, HALF - 0.05, 0.92],
        [-HALF + 0.05, -HALF + 1.52, 0.6],
        [-HALF - 1.52, -HALF - 0.05, 0.6],
      ];
      for (const [a, b, f] of panels) {
        skirtPanel(ctx, { th0: a, th1: b, yTop: 1.0 * d.h, yBot: 0.36 * d.h, inflate: 0.016, flare: 0.13, thickness: 0.009, follow: f, rows: 8, color: (u, v, inner) => (inner ? pal.primaryDark : embroidery(u, v)) });
      }
      // Sash with hanging ends.
      torsoBand(ctx, 0.98 * d.h, 1.04 * d.h, 0.026, trim);
      for (const [o, len] of [
        [0.18, 0.2],
        [0.3, 0.16],
      ]) {
        const pts = [];
        for (let i = 0; i <= 4; i++) {
          const y = 0.99 * d.h - (len * i) / 4;
          const p = new Vector3();
          const n = new Vector3();
          torsoPoint(ctx, Math.max(y, 0.93 * d.h), PI + o, 0.04, p, n);
          p.y = y;
          pts.push({ p, n, skin: sk2(B.hips, B.thighR, 0.3 * (i / 4)) });
        }
        strap(ctx, pts, 0.022, 0.003, tone(trim, 0.9));
      }
      // Mantle collar with a compass-star clasp.
      collar(ctx, { h: (collarUp(look) ? 0.08 : 0.04) * d.h, r0: 0.075 * d.g + 0.012, flare: 0.06, thick: 0.01, color: trim, inner: pal.primaryDark, open: 0.45 });
      const p = new Vector3();
      const n = new Vector3();
      torsoPoint(ctx, 1.35 * d.h, HALF, 0.018, p, n);
      const s = torsoSkin(ctx, 1.35 * d.h, p);
      const rot = new Quaternion();
      for (let i = 0; i < 4; i++) {
        rot.setFromAxisAngle(n, (i * PI) / 4);
        const dir = new Vector3(0, 1, 0).applyQuaternion(rot);
        const len = i % 2 === 0 ? 0.026 : 0.016;
        ctx.b.bar(p.clone().addScaledVector(dir, len), p.clone().addScaledVector(dir, -len), n, 0.0035, 0.003, s, pal.brass, { exp: 2 });
      }
      // Bell sleeves.
      for (const side of [1, -1] as const) {
        const S = side > 0 ? ctx.bp.upperArmL : ctx.bp.upperArmR;
        const fo = side > 0 ? B.foreArmL : B.foreArmR;
        const up = side > 0 ? B.upperArmL : B.upperArmR;
        const rings = [];
        const s0 = d.upperArm - 0.02;
        const s1 = d.upperArm + d.foreArm + 0.01;
        for (let i = 0; i <= 5; i++) {
          const f = i / 5;
          const ss = s0 + (s1 - s0) * f;
          const a = ctx.armAt(Math.min(ss, s1 - 0.02));
          const r = a.rx + 0.026 + 0.05 * f * f;
          rings.push({ c: new Vector3(S.x + side * 0.004 * f, S.y - ss, S.z - 0.012 * f), ax: X, ay: Z, rx: r, ry: r * 1.08 + 0.008 * f, skin: i === 0 ? sk2(up, fo, 0.5) : sk(fo), color: i === 5 ? trim : pal.primary });
        }
        const inner = rings
          .slice()
          .reverse()
          .map((r, i) => ({ ...r, rx: r.rx - 0.006, ry: r.ry - 0.006, color: i < 1 ? trim : pal.primaryDark }));
        ctx.b.loft([...rings, ...inner], 14);
      }
      // A map case slung across the back.
      const a = torsoPoint(ctx, 1.06 * d.h, -HALF - 0.75, 0.06, new Vector3());
      const b = torsoPoint(ctx, 1.37 * d.h, -HALF + 0.75, 0.06, new Vector3());
      const dir = b.clone().sub(a).normalize();
      const caseSkin = sk2(B.spine, B.chest, 0.6);
      ctx.b.bar(a, b, X, 0.035, 0.035, caseSkin, pal.leather, { exp: 2, seg: 12 });
      ctx.b.bar(a.clone().addScaledVector(dir, -0.012), a.clone().addScaledVector(dir, 0.03), X, 0.039, 0.039, caseSkin, pal.brass, { exp: 2, seg: 12 });
      ctx.b.bar(b.clone().addScaledVector(dir, -0.03), b.clone().addScaledVector(dir, 0.012), X, 0.039, 0.039, caseSkin, pal.brass, { exp: 2, seg: 12 });
      strap(ctx, torsoPath(ctx, [
        [1.41 * d.h, -HALF + 1.15],
        [1.33 * d.h, HALF - 0.6],
        [1.15 * d.h, HALF + 0.35],
        [1.0 * d.h, HALF + 1.2],
      ], 0.016), 0.013, 0.003, pal.leather);
    },
  };
}

// --- Skyknight plate ------------------------------------------------------------------------

function skyknight(look: RiderLook, pal: RiderPalette, d: RigDims): OutfitStyle {
  const mail = mixSrgb(new Color('#6a6e78'), pal.primaryDark, 0.15);
  const steel = pal.steel;
  const trim = pal.secondary;
  const bootTop = d.thigh - 0.02 * d.h;
  const vambrace = d.upperArm + 0.02;
  const glove = d.upperArm + d.foreArm - 0.035;
  return {
    torso: {
      color: (y, th) => {
        if (y < 0.93 * d.h) return mail;
        if (y > 1.36 * d.h && Math.abs(Math.cos(th)) > 0.6) return steel;
        return pal.primary;
      },
      inflate: (y) => (y < 0.93 * d.h ? 0.006 : 0.016),
      bounds: [0.93 * d.h, 1.36 * d.h],
    },
    arm: {
      color: (s) => (s > glove ? steel : s > vambrace ? steel : mail),
      inflate: (s) => (s > glove ? 0.012 : s > vambrace ? 0.014 : 0.006),
      bounds: [vambrace, glove],
    },
    leg: {
      color: (s) => (s > bootTop ? steel : mail),
      inflate: (s) => (s > bootTop ? 0.016 : 0.006),
      bounds: [bootTop],
    },
    hand: pal.steelDark,
    cuff: steel,
    foot: { color: pal.steelDark, sole: pal.sole },
    extras(ctx) {
      // Tabard skirt front and back, edged in the trim color.
      const tab = (u: number, v: number, inner: boolean) => (inner ? pal.primaryDark : u < 0.07 || u > 0.93 || v > 0.9 ? trim : pal.primary);
      skirtPanel(ctx, { th0: HALF - 0.7, th1: HALF + 0.7, yTop: 0.99 * d.h, yBot: 0.6 * d.h, inflate: 0.02, flare: 0.05, thickness: 0.008, follow: 0.6, color: tab });
      skirtPanel(ctx, { th0: -HALF - 0.7, th1: -HALF + 0.7, yTop: 0.99 * d.h, yBot: 0.6 * d.h, inflate: 0.02, flare: 0.05, thickness: 0.008, follow: 0.35, color: tab });
      // Faulds (hip plates).
      for (const side of [1, -1] as const) {
        skirtPanel(ctx, {
          th0: side > 0 ? -0.62 : PI - 0.62,
          th1: side > 0 ? 0.62 : PI + 0.62,
          yTop: 0.98 * d.h,
          yBot: 0.78 * d.h,
          inflate: 0.018,
          flare: 0.1,
          thickness: 0.01,
          follow: 0.6,
          rows: 3,
          cols: 5,
          color: (u, v) => (v > 0.66 ? trim : steel),
        });
      }
      belt(ctx, 0.98 * d.h, 1.02 * d.h, 0.026, pal.leatherDark, pal.brass);
      // Emblem on the chest: a stylized wing.
      const p = new Vector3();
      const n = new Vector3();
      torsoPoint(ctx, 1.22 * d.h, HALF, 0.017, p, n);
      const s = torsoSkin(ctx, 1.22 * d.h, p);
      for (let i = 0; i < 4; i++) {
        for (const k of [-1, 1]) {
          const a = 0.35 + i * 0.28;
          const dir = new Vector3(k * Math.sin(a), Math.cos(a), 0);
          const len = 0.06 - i * 0.009;
          ctx.b.bar(p.clone().addScaledVector(dir, 0.012), p.clone().addScaledVector(dir, 0.012 + len), n, 0.007 - i * 0.0008, 0.0025, s, trim, { exp: 2 });
        }
      }
      stud(ctx, p, n, 0.014, trim, s, 0.5);
      // Gorget.
      collar(ctx, { h: (collarUp(look) ? 0.07 : 0.045) * d.h, r0: 0.07 * d.g + 0.016, flare: 0.012, thick: 0.01, color: steel, inner: pal.steelDark });
      // Pauldrons: three overlapping lames, the last trimmed.
      for (const side of [1, -1] as const) {
        const S = side > 0 ? ctx.bp.upperArmL : ctx.bp.upperArmR;
        const clav = side > 0 ? B.clavL : B.clavR;
        const up = side > 0 ? B.upperArmL : B.upperArmR;
        for (let i = 0; i < 3; i++) {
          const r = (0.088 - i * 0.008) * (0.6 + 0.4 * d.w);
          const c = new Vector3(S.x + side * (0.008 + i * 0.01), S.y + 0.03 - i * 0.042, S.z - 0.004);
          const rot = new Quaternion().setFromAxisAngle(Z, side * (0.35 + i * 0.12));
          ctx.b.ellipsoid(c, new Vector3(r, r * 0.62, r * 1.05), i === 0 ? sk(clav) : sk2(clav, up, 0.3 + i * 0.2), i === 2 ? trim : steel, {
            rot,
            lat: 8,
            lon: 14,
            deform: (u) => {
              // Hollow the underside so the lames read as shells.
              if (u.y < 0) u.y *= 0.25;
            },
          });
        }
      }
      // Knee cops.
      for (const side of [1, -1] as const) {
        const J = side > 0 ? ctx.bp.thighL : ctx.bp.thighR;
        const r = ctx.legAt(d.thigh);
        ctx.b.ellipsoid(
          new Vector3(J.x - side * 0.006, J.y - d.thigh + 0.01, J.z + r.rf * 0.55),
          new Vector3(r.rx * 1.05, 0.05, r.rf * 0.75),
          sk2(side > 0 ? B.thighL : B.thighR, side > 0 ? B.shinL : B.shinR, 0.5),
          steel,
          { lat: 6, lon: 10 },
        );
      }
      sleeveCuff(ctx, vambrace - 0.005, 0.02, 0.018, trim);
      bootCuff(ctx, bootTop - 0.004, 0.022, 0.03, trim);
    },
  };
}
