// Wyvern materials. All are MeshToonMaterial (the shared soft toon ramp) patched by
// applyPainterly (rim light + height fog) and then by the shader code below:
//
//   body      region colors (skin, horn, claws, eyes, mouth, saddle leather/metal/cloth/wood,
//             armor plates) and the procedural skin patterns, computed per fragment from the
//             bind-pose (body-space) position, so markings stay glued to the animated body.
//   membrane  wings, sails, fans, fins and feathers: veins, darker trailing edges, a fluttering
//             trailing edge, and the signature backlight: when the sun is behind a membrane as
//             seen from the camera, light glows through it (fake subsurface transmission).
//   ghost     race ghosts: translucent bluish-white fresnel, no shadows.
//
// Colors and pattern switches are uniforms, so a color/pattern change is a uniform update rather
// than a rebuild.

import {
  NormalBlending,
  Color,
  DoubleSide,
  FrontSide,
  MeshToonMaterial,
  Vector2,
  Vector3,
  type IUniform,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { WyvernLook } from '../../core/types';
import { applyPainterly, toonRamp } from '../../render/painterly';
import { globalUniforms } from '../../render/uniforms';

export const PATTERN_IDS: Record<string, number> = {
  plain: 0,
  saddleback: 1,
  stripes: 2,
  dapple: 3,
  ember: 4,
  starfield: 5,
  gilded: 6,
};

/** Uniforms shared by the body and membrane materials of one wyvern. */
export interface WyvernUniforms {
  uPrimary: IUniform<Color>;
  uSecondary: IUniform<Color>;
  uBelly: IUniform<Color>;
  uMembrane: IUniform<Color>;
  uEyes: IUniform<Color>;
  uSaddle: IUniform<Color>;
  uCloth: IUniform<Color>;
  uHorn: IUniform<Color>;
  uPattern: IUniform<number>;
  uEyeCenter: IUniform<Vector3>;
  uEyeAxis: IUniform<Vector3>;
  uEyeRadius: IUniform<number>;
  uBlink: IUniform<number>;
  /** Membrane flutter amplitude (m) and speed (rad/s), from airspeed. */
  uFlutter: IUniform<number>;
  uFlutterRate: IUniform<number>;
  /** Wind ripple strength for sails/fans (0..1). */
  uRipple: IUniform<number>;
  /** Scale of the body (patterns are authored for a ~3.3 m torso). */
  uBodyScale: IUniform<number>;
  /**
   * Membrane billow under the air load (m at the panel's middle), left wing in x, right in y:
   * + bows the membrane up like a filled sail (power stroke, g-load), − lets it sag (recovery).
   */
  uWingLoad: IUniform<Vector2>;
  /** 0..1 how folded the wings are on the ground: bunched membranes read darker and denser. */
  uFold: IUniform<number>;
  /**
   * 0..1 dark contour where the surface turns away from the camera, so pale palettes keep a
   * silhouette against white cloud. 1 for the player's mount, 0 for ghosts and showroom extras.
   */
  uContour: IUniform<number>;
}

export function createWyvernUniforms(): WyvernUniforms {
  return {
    uPrimary: { value: new Color() },
    uSecondary: { value: new Color() },
    uBelly: { value: new Color() },
    uMembrane: { value: new Color() },
    uEyes: { value: new Color() },
    uSaddle: { value: new Color() },
    uCloth: { value: new Color() },
    uHorn: { value: new Color() },
    uPattern: { value: 0 },
    uEyeCenter: { value: new Vector3() },
    uEyeAxis: { value: new Vector3(1, 0, 0) },
    uEyeRadius: { value: 0.1 },
    uBlink: { value: 0 },
    uFlutter: { value: 0 },
    uFlutterRate: { value: 20 },
    uRipple: { value: 0 },
    uBodyScale: { value: 1 },
    uWingLoad: { value: new Vector2() },
    uFold: { value: 0 },
    uContour: { value: 1 },
  };
}

const _hsl = { h: 0, s: 0, l: 0 };
const _c = new Color();

/** Write a look's colors into the uniforms (cheap; no rebuild). */
export function applyLookUniforms(u: WyvernUniforms, look: WyvernLook): void {
  u.uPrimary.value.set(look.primary);
  u.uSecondary.value.set(look.secondary);
  u.uBelly.value.set(look.belly);
  u.uMembrane.value.set(look.membrane);
  u.uEyes.value.set(look.eyes);
  u.uSaddle.value.set(look.saddleColor);
  // Saddle cloth: a lighter, slightly warmer companion of the saddle color.
  const c = u.uCloth.value.set(look.saddleColor);
  c.getHSL(_hsl);
  c.setHSL((_hsl.h + 0.04) % 1, Math.min(1, _hsl.s * 1.05 + 0.05), Math.min(0.75, _hsl.l * 1.25 + 0.12));
  // Horn: a bone color nudged toward the secondary scales.
  u.uHorn.value.set('#d9c9a6').lerp(new Color(look.secondary), 0.18);
  u.uPattern.value = PATTERN_IDS[look.pattern] ?? 0;
}

// ---------------------------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------------------------

const NOISE_GLSL = /* glsl */ `
float dwHash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec3 dwHash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float dwVnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(dwHash13(i), dwHash13(i + vec3(1, 0, 0)), f.x), mix(dwHash13(i + vec3(0, 1, 0)), dwHash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(dwHash13(i + vec3(0, 0, 1)), dwHash13(i + vec3(1, 0, 1)), f.x), mix(dwHash13(i + vec3(0, 1, 1)), dwHash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
// Cellular noise: x = distance to the nearest feature, y = to the second nearest, z = cell id.
vec3 dwCells(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  float id = 0.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = dwHash33(i + g);
    vec3 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = dwHash13(i + g + 7.7); }
    else if (d < d2) { d2 = d; }
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}
`;

const BODY_PARS_FRAG = /* glsl */ `
uniform vec3 uPrimary;
uniform vec3 uSecondary;
uniform vec3 uBelly;
uniform vec3 uMembrane;
uniform vec3 uEyes;
uniform vec3 uSaddle;
uniform vec3 uCloth;
uniform vec3 uHorn;
uniform float uPattern;
uniform vec3 uEyeCenter;
uniform vec3 uEyeAxis;
uniform float uEyeRadius;
uniform float uBlink;
uniform float uBodyScale;
varying vec3 vBodyPos;
varying vec4 vMat;
varying vec2 vUv2;
${NOISE_GLSL}

// Returns albedo; writes the emissive part and a "gold" mask for the glint.
vec3 dwWyvernAlbedo(out vec3 emit, out float gold) {
  emit = vec3(0.0);
  gold = 0.0;
  int region = int(vMat.x + 0.5);
  vec3 bp = vBodyPos / uBodyScale;
  float n1 = dwVnoise(bp * 2.3);
  float n2 = dwVnoise(bp * 6.1 + 3.1);
  if (region == 0 || region == 8) {
    float belly = vMat.y;
    float dorsal = vMat.z;
    float s = vUv2.x / uBodyScale;
    // Countershading: a touch darker along the spine.
    vec3 col = mix(uPrimary, uSecondary, dorsal * 0.28);
    // Painterly value variation.
    col *= 0.93 + 0.12 * n1 + 0.05 * n2;
    int pat = int(uPattern + 0.5);
    if (pat == 1) {
      // Saddleback: a dark mantle over the shoulders and back, ragged edge.
      float along = smoothstep(-1.9, -1.2, bp.z) * (1.0 - smoothstep(1.2, 2.2, bp.z));
      float m = smoothstep(0.38, 0.55, dorsal * 0.85 + 0.2 * along + 0.18 * (n1 - 0.5) + 0.08 * (n2 - 0.5) + 0.12 * along - 0.12);
      m *= 1.0 - belly;
      col = mix(col, uSecondary * (0.9 + 0.1 * n2), m * (0.35 + 0.65 * along));
      // The mantle continues as a stripe down the tail.
      float tailStripe = smoothstep(0.62, 0.8, dorsal + 0.1 * (n2 - 0.5)) * smoothstep(-1.9, -2.6, bp.z);
      col = mix(col, uSecondary, tailStripe * 0.85);
    } else if (pat == 2) {
      // Tiger stripes across the body, tapering down the flanks.
      float wob = 0.55 * (n1 - 0.5) + 0.25 * (n2 - 0.5);
      float band = 0.5 + 0.5 * sin(s * 4.2 + wob * 3.0);
      float thr = mix(0.98, 0.62, clamp(dorsal * 1.15 + 0.15, 0.0, 1.0));
      float stripe = smoothstep(thr - 0.04, thr + 0.02, band) * (1.0 - smoothstep(0.2, 0.6, belly));
      col = mix(col, uSecondary * 0.8, stripe);
    } else if (pat == 3) {
      // Dapple: soft blotches, like light through leaves: big dark ones, smaller pale ones.
      float side = (1.0 - belly) * (0.5 + 0.5 * dorsal);
      vec3 c = dwCells(bp * 2.4 + n1 * 0.5);
      float dark = (1.0 - smoothstep(0.2, 0.42, c.x)) * step(0.55, c.z);
      vec3 c2 = dwCells(bp * 4.4 + 2.0 + n2 * 0.4);
      float light = (1.0 - smoothstep(0.1, 0.3, c2.x)) * step(0.4, c2.z);
      col = mix(col, uSecondary * 0.95, dark * side * 0.85);
      col = mix(col, mix(uPrimary, uBelly, 0.6) * 1.1, light * side * 0.75);
    } else if (pat == 4) {
      // Ember veins: a dark hide split by thin glowing seams that brighten after dusk.
      vec3 c = dwCells(bp * 1.5 + vec3(n1 * 0.7));
      float seam = 1.0 - smoothstep(0.012, 0.05, c.y - c.x);
      vec3 c2 = dwCells(bp * 3.4 + 5.0);
      float fine = (1.0 - smoothstep(0.008, 0.03, c2.y - c2.x)) * 0.6 * step(0.5, c2.z);
      float v = max(seam, fine) * (1.0 - belly * 0.7);
      col = mix(col * 0.5, uSecondary * 0.45, 0.5);
      float flick = 0.8 + 0.2 * sin(uTime * 1.3 + c.z * 30.0);
      vec3 ember = mix(vec3(1.0, 0.38, 0.08), vec3(1.0, 0.7, 0.25), c.z);
      col = mix(col, ember * 0.75, v * 0.7);
      emit += ember * v * (0.12 + 1.8 * uNight) * flick;
    } else if (pat == 5) {
      // Starfield: pale freckles, densest along the back, twinkling a little at night.
      vec3 c = dwCells(bp * 3.2);
      float r = 0.1 + 0.1 * c.z;
      float star = (1.0 - smoothstep(r, r + 0.04, c.x)) * step(0.5 - 0.45 * dorsal, c.z);
      vec3 c2 = dwCells(bp * 7.0 + 4.0);
      star = max(star, (1.0 - smoothstep(0.08, 0.12, c2.x)) * step(0.4, c2.z) * (0.4 + 0.6 * dorsal));
      col = mix(col * 0.82, uSecondary * 0.9, 0.3 * dorsal);
      vec3 pale = mix(uBelly, vec3(1.0), 0.65);
      col = mix(col, pale, star * (1.0 - belly));
      emit += pale * star * (1.0 - belly) * uNight * 0.7 * (0.7 + 0.3 * sin(uTime * 2.0 + c.z * 40.0));
    } else if (pat == 6) {
      // Gilded scales: overlapping fish-scale rows (free edge toward the tail), darker at the
      // base, with gold rims along the back that catch the sun.
      vec2 uv = vec2(vUv2.y * 5.5, s * 6.0);
      vec2 g = floor(uv);
      vec2 f = fract(vec2(uv.x + 0.5 * mod(g.y, 2.0), uv.y));
      float d = length(vec2(f.x - 0.5, f.y));
      float rim = smoothstep(0.38, 0.47, d) * (1.0 - smoothstep(0.5, 0.58, d));
      col *= 0.8 + 0.25 * smoothstep(0.1, 0.5, d);
      float tip = rim * smoothstep(0.1, 0.7, dorsal + 0.3 * (1.0 - belly) - 0.2);
      vec3 goldCol = vec3(1.0, 0.78, 0.32);
      col = mix(col, goldCol, tip * 0.9);
      gold = tip;
    }
    // Belly: a soft painterly boundary and faint transverse scutes.
    float bm = smoothstep(0.32, 0.68, belly + 0.18 * (n1 - 0.5));
    float scute = smoothstep(0.86, 0.97, fract(s * 2.6)) * 0.12 * bm;
    col = mix(col, uBelly * (1.0 - scute) * (0.96 + 0.06 * n2), bm);
    if (region == 8) {
      // Armor plates: secondary-toned, lighter worn rims.
      vec3 plate = mix(uSecondary, uPrimary, 0.25) * (0.88 + 0.12 * n2);
      plate = mix(plate, mix(uHorn, uPrimary, 0.5), smoothstep(0.6, 0.95, vUv2.x) * 0.55);
      col = plate;
    }
    return col;
  }
  if (region == 1) {
    // Horn: darker at the base, pale toward the tip, with faint growth rings.
    float t = vUv2.x;
    vec3 base = mix(uHorn * 0.45, uSecondary * 0.6, 0.35);
    vec3 c = mix(base, uHorn * 1.08, smoothstep(0.0, 0.85, t));
    c *= 0.92 + 0.08 * sin(t * 40.0);
    return c;
  }
  if (region == 9) {
    // Claws and teeth: ivory, darkening at the tips of claws.
    return mix(vec3(0.93, 0.88, 0.76), vec3(0.32, 0.27, 0.24), smoothstep(0.45, 1.0, vUv2.x) * 0.6);
  }
  if (region == 2) {
    // Eye: glowing iris, slit pupil, dark limbus, eyelid when blinking.
    vec3 p = vBodyPos;
    vec3 axis = uEyeAxis;
    if (p.x < 0.0) { p.x = -p.x; }
    vec3 e = (p - uEyeCenter) / uEyeRadius;
    float d = dot(normalize(e), axis);
    vec3 up = normalize(vec3(0.0, 1.0, 0.0) - axis * axis.y);
    vec3 fw = normalize(cross(axis, up));
    float ey = dot(e, up);
    if (ey > 1.0 - 2.1 * uBlink) return mix(uPrimary, uSecondary, 0.4) * 0.85;
    float ex = dot(e, fw);
    float iris = smoothstep(0.25, 0.45, d);
    float pupil = (1.0 - smoothstep(0.1, 0.17, abs(ex) / max(0.25, 1.0 - abs(ey) * 0.85))) * smoothstep(0.55, 0.7, d);
    vec3 c = mix(uEyes * 0.25, uEyes * (0.85 + 0.35 * smoothstep(0.6, 0.95, d)), iris);
    c = mix(c, vec3(0.02, 0.015, 0.02), pupil);
    float hl = smoothstep(0.93, 0.97, dot(normalize(e), normalize(axis + up * 0.55 + fw * 0.35)));
    c = mix(c, vec3(1.0), hl);
    emit += uEyes * iris * (1.0 - pupil) * (0.22 + 0.75 * uNight);
    return c;
  }
  if (region == 3) return vec3(0.32, 0.09, 0.11);
  if (region == 4) return uSaddle * (0.9 + 0.12 * n2);
  if (region == 5) {
    gold = 1.0;
    return vec3(0.86, 0.66, 0.3);
  }
  if (region == 6) return uCloth * (0.94 + 0.08 * n2);
  if (region == 7) return vec3(0.42, 0.26, 0.15) * (0.85 + 0.2 * dwVnoise(vec3(vBodyPos.x * 3.0, vBodyPos.y * 40.0, vBodyPos.z * 3.0)));
  if (region == 10) {
    emit += vec3(1.0, 0.72, 0.35) * (0.15 + 1.4 * uNight);
    return vec3(1.0, 0.85, 0.55);
  }
  if (region == 11) return mix(vec3(0.82, 0.76, 0.64), uCloth, 0.25) * (0.9 + 0.1 * n2);
  return uPrimary;
}
`;

const MEMBRANE_PARS_FRAG = /* glsl */ `
uniform vec3 uPrimary;
uniform vec3 uSecondary;
uniform vec3 uMembrane;
uniform vec3 uSaddle;
uniform vec3 uCloth;
uniform float uBodyScale;
uniform float uFold;
uniform float uContour;
varying vec3 vBodyPos;
varying vec4 vMat;
varying vec2 vUv2;
${NOISE_GLSL}

// Albedo of membranes; also returns how much light passes through (0..1).
vec3 dwMembraneAlbedo(out float trans) {
  int region = int(vMat.x + 0.5);
  float thin = vMat.y;
  float edge = vMat.z;
  float n = dwVnoise(vBodyPos * 3.0 / uBodyScale);
  if (region == 0) {
    // Wing membrane: veins fanning from the knuckle, skin-toned near the bones, a darker hem.
    float v = vUv2.y;
    float t = vUv2.x;
    float fv = fract(v * 3.0 + 0.06 * sin(t * 9.0 + v * 4.0));
    float vein = (1.0 - smoothstep(0.0, 0.045, min(fv, 1.0 - fv))) * smoothstep(0.08, 0.3, t);
    float bone = 1.0 - smoothstep(0.0, 0.07, min(fract(v), 1.0 - fract(v)));
    vec3 c = uMembrane * (0.92 + 0.12 * n);
    c = mix(c, mix(uMembrane, uSecondary, 0.6) * 0.8, vein * 0.55);
    c = mix(c, mix(uPrimary, uSecondary, 0.5), (1.0 - thin) * 0.45);
    c = mix(c, uSecondary * 0.7, smoothstep(0.93, 1.0, edge) * 0.6);
    trans = clamp(thin * (1.0 - 0.75 * vein) * (1.0 - bone * 0.5), 0.0, 1.0);
    // Folded on the ground the membrane bunches into deep pleats along the bones: darker, banded
    // light and shade, little light through.
    float pleat = 0.5 + 0.5 * sin(vUv2.y * 25.13 + vUv2.x * 3.0);
    c *= 1.0 - uFold * (0.24 + 0.1 * vein + 0.26 * pleat * thin);
    trans *= 1.0 - 0.7 * uFold;
    return c;
  }
  if (region == 1) {
    // Feather: secondary at the root, membrane color toward the tip, a pale shaft.
    float t = vUv2.x;
    float shaft = 1.0 - smoothstep(0.02, 0.08, abs(vUv2.y));
    vec3 c = mix(uSecondary, uMembrane, smoothstep(0.2, 0.95, t));
    c = mix(c, uMembrane * 0.6, smoothstep(0.8, 1.0, t) * 0.5);
    c = mix(c, vec3(0.92, 0.88, 0.8), shaft * 0.6);
    c *= 0.92 + 0.1 * n;
    trans = 0.65 * (1.0 - shaft);
    return c;
  }
  if (region == 2) {
    // Fin / sail webbing with rays.
    float ray = 1.0 - smoothstep(0.0, 0.12, abs(fract(vUv2.y) - 0.5) * 2.0 - 0.85);
    vec3 c = uMembrane * (0.9 + 0.12 * n);
    c = mix(c, mix(uSecondary, uMembrane, 0.3) * 0.8, ray * 0.6);
    c = mix(c, uSecondary * 0.75, smoothstep(0.85, 1.0, edge) * 0.5);
    trans = thin * (1.0 - 0.6 * ray);
    return c;
  }
  // Canopy cloth.
  trans = 0.55;
  return uCloth * (0.92 + 0.1 * n);
}
`;

const VERT_PARS = /* glsl */ `
uniform float uTime;
attribute vec4 aMat;
attribute vec2 aUv2;
varying vec3 vBodyPos;
varying vec4 vMat;
varying vec2 vUv2;
uniform float uFlutter;
uniform float uFlutterRate;
uniform float uRipple;
uniform vec2 uWingLoad;
uniform float uFold;
uniform float uBodyScale;
`;

const VERT_BEGIN = /* glsl */ `
vBodyPos = position;
vMat = aMat;
vUv2 = aUv2;
`;

const MEMBRANE_VERT_BEGIN = /* glsl */ `
vBodyPos = position;
vMat = aMat;
vUv2 = aUv2;
{
  // Trailing-edge flutter (speed) plus a slow wind ripple for sails and fans.
  float ph = uTime * uFlutterRate - aUv2.x * 9.0 + aUv2.y * 5.0;
  float f = aMat.w * (uFlutter * sin(ph) + uFlutter * 0.4 * sin(ph * 2.3 + 1.7));
  float r = aMat.w * uRipple * 0.08 * sin(uTime * 3.1 - position.z * 2.4 + position.y * 1.3);
  transformed += objectNormal * (f + r);
  // Wing membranes bow under the air load like a filled sail: most in the middle of each panel
  // (aMat.y, 0 at the bones), up along the bind pose's dorsal axis, per wing.
  if (aMat.x < 0.5) {
    float load = position.x > 0.0 ? uWingLoad.x : uWingLoad.y;
    transformed.y += load * aMat.y * (1.0 - 0.35 * aMat.y);
    // Folded, the skin gathers into pleats running along the bones (an accordion across v).
    transformed.y += uFold * 0.045 * uBodyScale * aMat.y * sin(aUv2.y * 25.13 + aUv2.x * 3.0);
  }
}
`;

function patchShared(shader: WebGLProgramParametersWithUniforms, u: WyvernUniforms): void {
  Object.assign(shader.uniforms, u, { uTime: globalUniforms.uTime, uNight: globalUniforms.uNight });
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_PARS);
}

/** Opaque toon body with region colors and patterns. */
export function createBodyMaterial(u: WyvernUniforms): MeshToonMaterial {
  const m = new MeshToonMaterial({ gradientMap: toonRamp(), side: FrontSide });
  applyPainterly(m, {
    rim: 1.1,
    onBeforeCompile: (shader) => {
      patchShared(shader, u);
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BEGIN);
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', BODY_PARS_FRAG + '\nvoid main() {')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec3 dwEmit;
          float dwGold;
          diffuseColor.rgb = dwWyvernAlbedo(dwEmit, dwGold);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          totalEmissiveRadiance += dwEmit;
          if (dwGold > 0.0) {
            // Gold catches the sun: a tight view-dependent glint.
            vec3 gL = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
            vec3 gV = normalize(vViewPosition);
            vec3 gH = normalize(gL + gV);
            float g = pow(max(dot(normal, gH), 0.0), 40.0) * 1.6 + pow(max(dot(normal, gH), 0.0), 6.0) * 0.18;
            totalEmissiveRadiance += vec3(1.0, 0.8, 0.45) * uSunColor * g * dwGold * (1.0 - uNight);
          }`,
        );
    },
  });
  m.customProgramCacheKey = ((prev) => () => prev() + '-wyvern-body')(m.customProgramCacheKey.bind(m));
  return m;
}

/** Double-sided membrane with the backlit glow. */
export function createMembraneMaterial(u: WyvernUniforms): MeshToonMaterial {
  const m = new MeshToonMaterial({ gradientMap: toonRamp(), side: DoubleSide, shadowSide: DoubleSide });
  applyPainterly(m, {
    rim: 0.6,
    onBeforeCompile: (shader) => {
      patchShared(shader, u);
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + MEMBRANE_VERT_BEGIN);
      const idx = shader.fragmentShader.lastIndexOf('#include <opaque_fragment>');
      let frag = shader.fragmentShader;
      frag =
        frag.slice(0, idx) +
        /* glsl */ `
        {
          // Light through the membrane: looking toward the sun, or the far side is sunlit.
          vec3 mV = normalize(vDwWorldPos - cameraPosition);
          vec3 mN = normalize(inverseTransformDirection(normal, viewMatrix));
          float toward = pow(max(dot(mV, uSunDir), 0.0), 3.0);
          float back = max(dot(-mN, uSunDir), 0.0);
          float sunUp = smoothstep(-0.08, 0.12, uSunDir.y);
          // Saturate toward the membrane's own hue (thin skin glows deeper than it looks lit).
          vec3 glowCol = pow(uMembrane, vec3(1.45)) * 1.9 + vec3(0.04, 0.02, 0.0);
          vec3 glow = glowCol * uSunColor * (back * 0.55 + toward * 2.0) * dwTrans * sunUp;
          outgoingLight += glow * 0.85;
        }
        ` +
        frag.slice(idx);
      shader.fragmentShader = frag
        .replace('void main() {', MEMBRANE_PARS_FRAG + '\nvoid main() {')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float dwTrans;
          diffuseColor.rgb = dwMembraneAlbedo(dwTrans);`,
        );
    },
  });
  m.customProgramCacheKey = ((prev) => () => prev() + '-wyvern-membrane')(m.customProgramCacheKey.bind(m));
  return m;
}

/** Race ghost: additive bluish-white fresnel shell. */
export function createGhostMaterial(u: WyvernUniforms, membrane: boolean): MeshToonMaterial {
  const m = new MeshToonMaterial({
    gradientMap: toonRamp(),
    side: membrane ? DoubleSide : FrontSide,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    premultipliedAlpha: true,
  });
  m.onBeforeCompile = (shader) => {
    patchShared(shader, u);
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n' + (membrane ? MEMBRANE_VERT_BEGIN : VERT_BEGIN),
    );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vBodyPos;\nvarying vec4 vMat;\nvarying vec2 vUv2;')
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        {
          vec3 gV = normalize(vViewPosition);
          float gF = pow(1.0 - abs(dot(normal, gV)), 2.2);
          float band = 0.5 + 0.5 * sin(vBodyPos.z * 3.0 - uTime * 4.0);
          vec3 gc = mix(vec3(0.42, 0.66, 1.0), vec3(0.9, 0.96, 1.0), gF) * (1.15 + 0.25 * band);
          float a = clamp(${membrane ? '0.2' : '0.16'} + 0.62 * gF + 0.06 * band, 0.0, 0.9);
          gl_FragColor = vec4(gc * a, a);
        }`,
      );
  };
  m.customProgramCacheKey = () => `wyvern-ghost-${membrane}`;
  return m;
}
