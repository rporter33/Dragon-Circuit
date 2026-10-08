// GLSL shared by the effect shaders. Effects that are alpha-blended fog their color with the
// shared height fog (dwApplyFog); additive ones fade by the fog's transmittance instead, so a
// distant glow sinks into the haze rather than brightening it.

import { FOG_PARS_GLSL } from '../render/painterly';

/** Common helpers. Include after FOG_PARS_GLSL (it uses dwApplyFog). */
export const FX_COMMON_GLSL = /* glsl */ `
${FOG_PARS_GLSL}
uniform vec3 uSkyHorizon;
uniform vec3 uSkyZenith;
uniform vec3 uWind;
/** Viewport height in pixels / (2 tan(fov/2)): world size → pixels at depth z is size·uPxScale/z. */
uniform float uPxScale;

float fxHash(float n) { return fract(sin(n) * 43758.5453123); }
float fxHash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

/** Fraction of light that survives the fog between the camera and worldPos (1 = clear). */
float fxFogTransmittance(vec3 worldPos) {
  return clamp(dwApplyFog(vec3(1.0), worldPos, cameraPosition).g - dwApplyFog(vec3(0.0), worldPos, cameraPosition).g, 0.0, 1.0);
}

/**
 * Soft painterly lighting for dust and puffs: sky ambient plus sun, with a forward-scattering
 * glow when looking toward the sun through the particle.
 */
vec3 fxLitDust(vec3 base, vec3 worldPos) {
  vec3 v = normalize(worldPos - cameraPosition);
  float fwd = pow(max(dot(v, uSunDir), 0.0), 5.0);
  vec3 amb = mix(uSkyHorizon, uSkyZenith, 0.35) * 0.55;
  vec3 sun = uSunColor * (0.55 + 0.9 * fwd);
  return base * (amb + sun * max(uSunDir.y + 0.25, 0.0) * 0.9);
}
`;

/** Value noise for breaking up round sprite edges into brushy blobs. */
export const FX_NOISE_GLSL = /* glsl */ `
float fxNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = fxHash2(i);
  float b = fxHash2(i + vec2(1.0, 0.0));
  float c = fxHash2(i + vec2(0.0, 1.0));
  float d = fxHash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;
