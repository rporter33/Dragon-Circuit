// Shaders for the race visuals: the glowing rings, the shimmering curtain in each start gate and
// the finish beacon's column of light. All include the shared height fog (FOG_PARS_GLSL /
// dwApplyFog) and read the shared uniforms, but keep part of their glow through the haze so a
// ring 600 m away still reads as a point of light.
//
// Rings must read against the white cloud sea and bright skies, where pale glow vanishes: each
// ring is a saturated body with a warm, hot core, a dark painterly contour at the tube's edges by
// day, a tube never thinner than a few pixels however far away, and (the next ring) a soft
// contrasting halo that darkens bright cloud and glows at night.

import { AdditiveBlending, Color, DoubleSide, NormalBlending, ShaderMaterial } from 'three';
import { FOG_PARS_GLSL } from '../render/painterly';
import { globalUniforms } from '../render/uniforms';

const shared = () => ({
  uTime: globalUniforms.uTime,
  uSunDir: globalUniforms.uSunDir,
  uSunColor: globalUniforms.uSunColor,
  uFogColor: globalUniforms.uFogColor,
  uFogSunColor: globalUniforms.uFogSunColor,
  uFogDensity: globalUniforms.uFogDensity,
  uFogHeightFalloff: globalUniforms.uFogHeightFalloff,
  uFogBaseY: globalUniforms.uFogBaseY,
  uNight: globalUniforms.uNight,
});

// ---------------------------------------------------------------------------------------------
// Rings
// ---------------------------------------------------------------------------------------------

/**
 * Instanced torus whose shape comes from per-instance attributes, so every ring keeps a round
 * tube whatever its radius. aAng = (angle around the ring, angle around the tube);
 * aRing = (inner radius, tube radius, brightness 0..1, burst 0..1); aTint = color.
 */
const RING_VERT = /* glsl */ `
attribute vec2 aAng;
attribute vec4 aRing;
attribute vec3 aTint;
uniform float uTime;
varying vec3 vDwWorldPos;
varying vec3 vN;
varying vec2 vAng;
varying vec4 vRing;
varying vec3 vTint;
void main() {
  float burst = aRing.w;
  float bright = aRing.z;
  // A pass bursts the ring outward while the tube thins to nothing.
  float tube = aRing.y * (1.0 - burst * 0.9) * (1.0 + 0.12 * bright * sin(uTime * 3.0 + aAng.x * 4.0));
  // Never thinner than ~3 px (at 1080 lines): far rings stay readable lines, not hairlines.
  vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float minTube = 1.6 * length(cameraPosition - center) / (540.0 * projectionMatrix[1][1]);
  tube = max(tube, minTube * (1.0 - burst));
  float R = (aRing.x + aRing.y) * (1.0 + burst * burst * 0.7);
  float cu = cos(aAng.x), su = sin(aAng.x), cv = cos(aAng.y), sv = sin(aAng.y);
  vec3 p = vec3(cu * (R + tube * cv), su * (R + tube * cv), tube * sv);
  vec3 n = vec3(cu * cv, su * cv, sv);
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vDwWorldPos = wp.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
  vAng = aAng;
  vRing = aRing;
  vTint = aTint;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const RING_FRAG = /* glsl */ `
${FOG_PARS_GLSL}
varying vec3 vDwWorldPos;
varying vec3 vN;
varying vec2 vAng;
varying vec4 vRing;
varying vec3 vTint;
void main() {
  float bright = vRing.z;
  float burst = vRing.w;
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vDwWorldPos);
  // Painterly body: a soft two-band light from the sun so the ring has form, not just glow.
  float ndl = dot(N, uSunDir) * 0.5 + 0.5;
  float band = smoothstep(0.35, 0.45, ndl) * 0.35 + smoothstep(0.7, 0.8, ndl) * 0.2 + 0.45;
  // Light running around the ring: two bands chasing each other, brushed by a slow wobble.
  float run = vAng.x * 6.0 - uTime * 3.2 + sin(vAng.x * 2.0 + uTime * 0.7) * 1.5;
  float shimmer = 0.5 + 0.5 * sin(run);
  shimmer = smoothstep(0.25, 1.0, shimmer);
  // The inner face (toward the opening) glows hottest.
  float inner = 1.0 - smoothstep(-0.9, 0.2, cos(vAng.y));
  float facing = abs(dot(N, V));
  vec3 tint = vTint;
  vec3 hot = mix(tint, vec3(1.0, 0.8, 0.45), 0.5);
  // Day: a saturated body (darker than the cloud it crosses: that's what reads on white), lit in
  // two painterly bands, with warm stripes of light running round it, hottest on the inner face.
  vec3 body = tint * (0.4 + 0.5 * band) * (0.75 + 0.25 * uSunColor);
  float stripe = shimmer * (0.3 + 0.45 * inner) * (0.35 + 0.65 * bright);
  vec3 day = mix(body, hot * 1.25, stripe);
  // Night: the whole ring glows (a little HDR for the bloom on the next one).
  vec3 glow = mix(tint * (0.75 + 0.55 * shimmer), hot * 1.4, clamp(inner * 0.6 + shimmer * 0.3, 0.0, 1.0));
  vec3 night = glow * mix(0.6, 1.5, bright * bright);
  vec3 col = mix(day, night, uNight);
  // A dark painterly contour where the tube turns away from view (by day).
  float edge = smoothstep(0.32, 0.62, 1.0 - facing);
  col = mix(col, tint * 0.18, edge * 0.85 * (1.0 - uNight) * (1.0 - burst));
  col += tint * burst * 3.0;
  // Haze softens distant rings but never swallows them.
  vec3 fogged = dwApplyFog(col, vDwWorldPos, cameraPosition);
  col = mix(fogged, col, 0.55 + 0.45 * bright);
  float alpha = mix(0.8, 1.0, bright) * (1.0 - burst);
  gl_FragColor = vec4(col, alpha);
}
`;

export function ringMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'race-ring',
    uniforms: shared(),
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    transparent: true,
    depthWrite: true,
    blending: NormalBlending,
  });
}

/** The faint membrane in the next ring's opening (and a halo that keeps it findable far off). */
const DISC_VERT = /* glsl */ `
varying vec3 vDwWorldPos;
varying vec2 vUv2;
void main() {
  vUv2 = position.xy;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDwWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** The disc mesh reaches this far beyond the ring's inner radius (room for the halo). */
export const DISC_REACH = 1.6;

const DISC_FRAG = /* glsl */ `
${FOG_PARS_GLSL}
uniform vec3 uTint;
uniform float uOpacity;
uniform float uTubeOut;
varying vec3 vDwWorldPos;
varying vec2 vUv2;
void main() {
  // r = 1 at the ring's inner radius.
  float r = length(vUv2) * ${DISC_REACH.toFixed(2)};
  float a = atan(vUv2.y, vUv2.x);
  // Ripples drifting inward plus a slow swirl; strongest near the rim.
  float ripple = 0.5 + 0.5 * sin(r * 14.0 + uTime * 2.4 + sin(a * 3.0 - uTime) * 0.8);
  float rim = smoothstep(0.55, 1.0, r) * (1.0 - smoothstep(0.96, 1.0, r));
  float glowA = (0.015 + 0.09 * rim + 0.03 * ripple * max(0.0, 1.0 - r)) * step(r, 1.0);
  vec3 glow = uTint * (0.9 + ripple * 0.5);
  // Fog may only take light away from the glow (adding fog color would wash the sky out).
  vec3 att = dwApplyFog(glow, vDwWorldPos, cameraPosition) - dwApplyFog(vec3(0.0), vDwWorldPos, cameraPosition);
  glow = mix(max(att, 0.0), glow, 0.5) * glowA;
  // The halo: a soft band just outside the tube that darkens bright cloud and sky by day (a
  // watercolor bleed of the ring's color) and glows by night.
  float out0 = uTubeOut;
  float halo = smoothstep(out0 - 0.02, out0 + 0.04, r) * (1.0 - smoothstep(out0 + 0.04, ${DISC_REACH.toFixed(2)}, r));
  halo *= halo * (0.85 + 0.15 * sin(a * 5.0 + uTime * 1.3));
  float haloA = halo * 0.32 * (1.0 - uNight);
  vec3 haloCol = uTint * 0.22;
  glow += uTint * halo * 0.35 * uNight;
  // Premultiplied: additive glow plus a darkening halo, in one pass.
  gl_FragColor = vec4((glow + haloCol * haloA) * uOpacity, haloA * uOpacity);
}
`;

export function discMaterial(tint: Color): ShaderMaterial {
  return new ShaderMaterial({
    name: 'race-ring-disc',
    uniforms: { ...shared(), uTint: { value: tint.clone() }, uOpacity: { value: 1 }, uTubeOut: { value: 1.2 } },
    vertexShader: DISC_VERT,
    fragmentShader: DISC_FRAG,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    premultipliedAlpha: true,
    side: DoubleSide,
  });
}

// ---------------------------------------------------------------------------------------------
// Start gate curtain
// ---------------------------------------------------------------------------------------------

const CURTAIN_VERT = /* glsl */ `
varying vec3 vDwWorldPos;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDwWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const CURTAIN_FRAG = /* glsl */ `
${FOG_PARS_GLSL}
uniform vec3 uTint;
uniform float uArmed;
uniform float uFlash;
uniform float uSeed;
varying vec3 vDwWorldPos;
varying vec2 vUv;
float h1(float x) { return fract(sin(x * 127.1 + uSeed) * 43758.5453); }
float n1(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
void main() {
  // Vertical folds of light, like an aurora hung between the pillars, drifting sideways.
  float x = vUv.x * 9.0;
  float folds = n1(x + uTime * 0.35) * 0.6 + n1(x * 2.3 - uTime * 0.6) * 0.4;
  folds = smoothstep(0.3, 0.8, folds);
  // Light rising up the folds.
  float rise = 0.5 + 0.5 * sin(vUv.y * 10.0 - uTime * 1.8 + n1(x * 1.7) * 6.0);
  // Brightest near the bottom, fading toward the lintel, and feathered at the pillars.
  float vfade = mix(1.0, 0.3, smoothstep(0.0, 1.0, vUv.y)) * smoothstep(0.0, 0.06, vUv.y) * (1.0 - smoothstep(0.9, 1.0, vUv.y));
  float hfade = smoothstep(0.0, 0.08, vUv.x) * (1.0 - smoothstep(0.92, 1.0, vUv.x));
  // Sparkles drifting up the folds.
  vec2 cell = floor(vec2(vUv.x * 40.0, vUv.y * 30.0 - uTime * 1.2));
  float spark = step(0.985, fract(sin(dot(cell, vec2(12.9898, 78.233)) + uSeed) * 43758.5453));
  float a = (0.2 + 0.45 * folds * (0.5 + 0.5 * rise)) * vfade * hfade;
  a *= 0.75 + 0.4 * uArmed;
  a = min(0.9, a + spark * 0.5 * vfade * hfade + uFlash * hfade * 0.5 * (0.4 + 0.6 * folds));
  // A veil of colored light: deep in the troughs, bright on the folds, glowing after dusk.
  vec3 deep = uTint * 0.8;
  vec3 col = mix(deep, uTint * 1.7 + 0.25, folds * (0.6 + 0.4 * rise)) * (1.0 + 0.8 * uNight);
  col += vec3(1.0, 0.95, 0.8) * (uFlash + spark * 0.8);
  col = mix(dwApplyFog(col, vDwWorldPos, cameraPosition), col, 0.5);
  gl_FragColor = vec4(col, a);
}
`;

export function curtainMaterial(tint: Color, seed: number): ShaderMaterial {
  return new ShaderMaterial({
    name: 'race-gate-curtain',
    uniforms: { ...shared(), uTint: { value: tint.clone() }, uArmed: { value: 0 }, uFlash: { value: 0 }, uSeed: { value: seed } },
    vertexShader: CURTAIN_VERT,
    fragmentShader: CURTAIN_FRAG,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

// ---------------------------------------------------------------------------------------------
// Finish beacon
// ---------------------------------------------------------------------------------------------

const BEACON_VERT = /* glsl */ `
varying vec3 vDwWorldPos;
varying vec3 vN;
varying float vH;
void main() {
  vH = uv.y;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDwWorldPos = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const BEACON_FRAG = /* glsl */ `
${FOG_PARS_GLSL}
uniform vec3 uTint;
uniform float uOpacity;
uniform float uCore;
varying vec3 vDwWorldPos;
varying vec3 vN;
varying float vH;
void main() {
  vec3 V = normalize(cameraPosition - vDwWorldPos);
  // Facing the viewer = the middle of the column: bright core, soft edges.
  float facing = abs(dot(normalize(vN), V));
  float body = pow(facing, uCore);
  // Bands of light climbing the column.
  float bands = 0.65 + 0.35 * sin(vH * 90.0 - uTime * 2.5) * sin(vH * 23.0 - uTime * 0.9);
  // Bright at the ring, thinning upward into the sky.
  float fade = (1.0 - smoothstep(0.0, 1.0, vH)) * smoothstep(0.0, 0.015, vH);
  float a = body * bands * fade * uOpacity;
  vec3 col = uTint * (1.4 + 1.2 * body);
  // Keep most of the glow through the haze: this is what you steer by from a kilometer out.
  vec3 att = dwApplyFog(col, vDwWorldPos, cameraPosition) - dwApplyFog(vec3(0.0), vDwWorldPos, cameraPosition);
  col = mix(max(att, 0.0), col, 0.65);
  gl_FragColor = vec4(col * a, 1.0);
}
`;

export function beaconMaterial(tint: Color, core: number, opacity: number): ShaderMaterial {
  return new ShaderMaterial({
    name: 'race-beacon',
    uniforms: { ...shared(), uTint: { value: tint.clone() }, uOpacity: { value: opacity }, uCore: { value: core } },
    vertexShader: BEACON_VERT,
    fragmentShader: BEACON_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}
