// The one full-resolution post pass: scene + bloom → speed blur or sharpening → exposure,
// saturation, contrast, lift/gain → cloud veil, flash, vignette, fade → ACES tone map → sRGB →
// dither. It draws straight to the canvas, so three's tone mapping and output-colorspace chunks
// apply here (the scene itself renders linear HDR into a half-float target).

import { Color, DataTexture, RGBAFormat, ShaderMaterial, Vector2 } from 'three';
import { POST_VERTEX } from './quad';

const BLACK = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat);
BLACK.needsUpdate = true;

export function gradeUniforms() {
  return {
    tDiffuse: { value: null as unknown },
    /** Seconds, wrapped (drives the cloud veil grain and the dither pattern). */
    uTime: { value: 0 },
    uExposure: { value: 1.0 },
    uSaturation: { value: 1.08 },
    uContrast: { value: 1.04 },
    uLift: { value: new Color(0.0, 0.0, 0.0) },
    uGain: { value: new Color(1.0, 1.0, 1.0) },
    uVignette: { value: 0.32 },
    /** 0..1 radial speed blur (dives). */
    uSpeedBlur: { value: 0 },
    /** 0..1 full-screen fade to uFadeColor (respawn, transitions). */
    uFade: { value: 0 },
    uFadeColor: { value: new Color(0.92, 0.95, 1.0) },
    /** 0..1 additive flash (ring passed, collectible). */
    uFlash: { value: 0 },
    uFlashColor: { value: new Color(1.0, 0.9, 0.6) },
    /** 0..1 white-out when flying through a cloud. */
    uCloudVeil: { value: 0 },
    uCloudColor: { value: new Color(0.9, 0.93, 0.97) },
    /** The bloom chain's summed halo (half resolution) and how much of it to add. */
    tBloom: { value: BLACK as unknown },
    uBloomStrength: { value: 0 },
    /** Scene texel size, for the sharpening taps. */
    uTexel: { value: new Vector2(1, 1) },
    /** 0..1 contrast-limited sharpening, raised when the canvas is upscaled by the browser. */
    uSharpen: { value: 0 },
    /** Dither amplitude in 8-bit steps (hides banding in sky gradients and night fog). */
    uDither: { value: 1 },
  };
}

export type GradeUniforms = ReturnType<typeof gradeUniforms>;

const FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform float uTime, uExposure, uSaturation, uContrast, uVignette, uSpeedBlur, uFade, uFlash, uCloudVeil;
uniform float uBloomStrength, uSharpen, uDither;
uniform vec2 uTexel;
uniform vec3 uLift, uGain, uFadeColor, uFlashColor, uCloudColor;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// Interleaved gradient noise: a stable, blue-ish pattern for dithering.
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

// Unsharp mask limited to the 4-neighbourhood's range: crisper edges after upscaling, no halos.
vec3 sharpen(vec3 col, vec2 uv) {
  vec3 n = texture2D(tDiffuse, uv + vec2(0.0, uTexel.y)).rgb;
  vec3 s = texture2D(tDiffuse, uv - vec2(0.0, uTexel.y)).rgb;
  vec3 e = texture2D(tDiffuse, uv + vec2(uTexel.x, 0.0)).rgb;
  vec3 w = texture2D(tDiffuse, uv - vec2(uTexel.x, 0.0)).rgb;
  vec3 mn = min(col, min(min(n, s), min(e, w)));
  vec3 mx = max(col, max(max(n, s), max(e, w)));
  vec3 sharp = col + (col - 0.25 * (n + s + e + w)) * (2.0 * uSharpen);
  return clamp(sharp, mn, mx);
}

void main() {
  vec2 uv = vUv;
  vec3 col = texture2D(tDiffuse, uv).rgb;
  if (uSpeedBlur > 0.001) {
    vec2 dir = uv - 0.5;
    float r = length(dir);
    float amt = uSpeedBlur * smoothstep(0.12, 0.7, r) * 0.06;
    vec3 acc = col;
    for (int i = 1; i < 8; i++) {
      acc += texture2D(tDiffuse, uv - dir * amt * float(i) / 7.0).rgb;
    }
    col = acc / 8.0;
  } else if (uSharpen > 0.001) {
    col = sharpen(col, uv);
  }
  if (uBloomStrength > 0.0) col += texture2D(tBloom, uv).rgb * uBloomStrength;
  col *= uExposure;
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, uSaturation);
  // Contrast around mid-grey, applied in linear HDR before tone mapping.
  col = max(col, 0.0);
  col = (col - 0.18) * uContrast + 0.18;
  col = max(col, 0.0);
  col = col * uGain + uLift * (1.0 - clamp(luma, 0.0, 1.0));
  col = mix(col, uCloudColor * (0.9 + 0.1 * hash(uv * 3.0 + uTime)), uCloudVeil);
  col += uFlashColor * uFlash;
  // Vignette.
  vec2 v = uv - 0.5;
  float vig = 1.0 - uVignette * smoothstep(0.25, 0.85, length(v * vec2(1.1, 1.0)) * 1.25);
  col *= vig;
  col = mix(col, uFadeColor, uFade);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // Triangular dither of about one 8-bit step, animated so it reads as fine grain, not a pattern.
  vec2 fc = gl_FragCoord.xy + vec2(fract(uTime * 7.0) * 61.0, fract(uTime * 3.0) * 37.0);
  float d = ign(fc) + ign(fc + vec2(17.0, 29.0)) - 1.0;
  gl_FragColor.rgb += d * uDither / 255.0;
}
`;

export function gradeMaterial(uniforms: GradeUniforms): ShaderMaterial {
  return new ShaderMaterial({
    name: 'DriftwingGrade',
    uniforms: uniforms as unknown as ShaderMaterial['uniforms'],
    vertexShader: POST_VERTEX,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
  });
}
