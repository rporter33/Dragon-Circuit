// Colors for one rider look: the player's picks plus the fixed materials (leathers, brass,
// steel) every outfit shares, all as linear Colors ready for vertex colors.

import { Color } from 'three';
import type { RiderLook } from '../../core/types';

export interface RiderPalette {
  skin: Color;
  skinShade: Color;
  blush: Color;
  lip: Color;
  eye: Color;
  eyeShine: Color;
  hair: Color;
  hairDark: Color;
  brow: Color;
  primary: Color;
  primaryDark: Color;
  primaryLight: Color;
  secondary: Color;
  secondaryDark: Color;
  scarf: Color;
  cape: Color;
  leather: Color;
  leatherDark: Color;
  boot: Color;
  sole: Color;
  brass: Color;
  steel: Color;
  steelDark: Color;
  cream: Color;
  cloth: Color;
  trousers: Color;
  glow: Color;
}

const c = (hex: string) => new Color(hex);

/** Perceptual-ish mix in sRGB space so color picks blend the way artists expect. */
export function mixSrgb(a: Color, b: Color, t: number): Color {
  const x = a.clone().convertLinearToSRGB();
  const y = b.clone().convertLinearToSRGB();
  return x.lerp(y, t).convertSRGBToLinear();
}

/** Darken/lighten in sRGB space (k < 1 darker). */
export function tone(a: Color, k: number): Color {
  const x = a.clone().convertLinearToSRGB();
  x.r = Math.min(1, x.r * k);
  x.g = Math.min(1, x.g * k);
  x.b = Math.min(1, x.b * k);
  return x.convertSRGBToLinear();
}

export function riderPalette(look: RiderLook): RiderPalette {
  const skin = c(look.skin);
  const hair = c(look.hairColor);
  const primary = c(look.outfitPrimary);
  const secondary = c(look.outfitSecondary);
  return {
    skin,
    skinShade: mixSrgb(tone(skin, 0.86), c('#a0503c'), 0.12),
    blush: mixSrgb(skin, c('#e06a60'), 0.22),
    lip: mixSrgb(tone(skin, 0.8), c('#a04040'), 0.35),
    eye: c('#1c1512'),
    eyeShine: c('#fff8ec'),
    hair,
    hairDark: tone(hair, 0.72),
    brow: tone(hair, 0.8),
    primary,
    primaryDark: tone(primary, 0.68),
    primaryLight: mixSrgb(primary, c('#fff4e0'), 0.25),
    secondary,
    secondaryDark: tone(secondary, 0.7),
    scarf: c(look.scarfColor),
    cape: c(look.capeColor),
    leather: c('#6a4630'),
    leatherDark: c('#3c2a20'),
    boot: c('#45301f'),
    sole: c('#241a14'),
    brass: c('#d8aa58'),
    steel: c('#9aa6b2'),
    steelDark: c('#5c6672'),
    cream: c('#eadcc0'),
    cloth: c('#d8c8a8'),
    trousers: mixSrgb(tone(primary, 0.5), c('#4a3e34'), 0.55),
    glow: c('#9ff0ff'),
  };
}
