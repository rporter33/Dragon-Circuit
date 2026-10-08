// Shaders for moving water: the streams on island tops, the falls pouring off the rims, and the
// spray/mist billboards around them. Lit from the shared sun/sky uniforms (the sky module writes
// them) so water follows the day/night cycle with everything else, and fogged with dwApplyFog.

import { DoubleSide, FrontSide, NormalBlending, ShaderMaterial } from 'three';
import { FOG_PARS_GLSL } from '../../../render/painterly';
import { globalUniforms } from '../../../render/uniforms';

const NOISE_GLSL = /* glsl */ `
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
// Hash without sine (Dave Hoskins): stable for large inputs.
float dwHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float dwNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dwHash(i), dwHash(i + vec2(1.0, 0.0)), u.x), mix(dwHash(i + vec2(0.0, 1.0)), dwHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Wrapped clock: keeps noise coordinates small over long sessions.
float dwClock(float rate) { return mod(uTime * rate, 977.0); }
vec3 dwAmbient() { return mix(uSkyHorizon, uSkyZenith, 0.45) * 0.62; }
`;

// ---------------------------------------------------------------------------------------------
// Falls
// ---------------------------------------------------------------------------------------------

const FALL_VERTEX = /* glsl */ `
attribute vec3 aFall; // u around the column, t = seconds of flight, drop fraction 0..1
varying vec3 vFall;
varying vec3 vN;
varying vec3 vDwWorldPos;
void main() {
  vFall = aFall;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vDwWorldPos = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FALL_FRAGMENT = /* glsl */ `
${FOG_PARS_GLSL}
${NOISE_GLSL}
varying vec3 vFall;
varying vec3 vN;
varying vec3 vDwWorldPos;
void main() {
  float u = vFall.x;
  float t = vFall.y;
  float drop = vFall.z;
  float flow = t - dwClock(1.0);
  // Streaks stretch as the water accelerates because they're laid out in flight time.
  float n1 = dwNoise(vec2(u * 26.0, flow * 2.6));
  float n2 = dwNoise(vec2(u * 8.0 + 3.0, flow * 0.95));
  float n3 = dwNoise(vec2(u * 70.0, flow * 7.0));
  // Fine vertical threads running the length of the fall.
  float thread = dwNoise(vec2(u * 120.0, flow * 0.35 + u * 3.0));
  float streak = n1 * 0.55 + n2 * 0.45;
  float aer = smoothstep(0.3, 3.5, t);
  float glassy = 1.0 - smoothstep(0.0, 0.8, t);
  // Surges: broad white pulses that ride down the column with the water.
  float surge = smoothstep(0.58, 0.9, dwNoise(vec2(u * 3.0 + 11.0, flow * 0.55)));
  float foam = clamp(smoothstep(0.42, 0.82, streak) * mix(1.0, 0.3, glassy) + surge * 0.45 * aer, 0.0, 1.0);
  vec3 water = mix(vec3(0.1, 0.34, 0.44), vec3(0.42, 0.66, 0.76), aer * 0.6);
  water *= 0.85 + 0.3 * thread;
  vec3 col = mix(water, vec3(0.9, 0.95, 1.0), clamp(foam * 0.8 + aer * 0.25, 0.0, 1.0));

  vec3 N = normalize(vN);
  vec3 V = normalize(vDwWorldPos - cameraPosition);
  if (dot(N, V) > 0.0) N = -N;
  float wrap = clamp(dot(N, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
  // Water is lit by the sky as much as by the sun: a cool ambient keeps it water-colored even
  // under a low orange sun (no beige sheets at golden hour).
  vec3 sky = mix(uSkyHorizon, uSkyZenith, 0.5);
  vec3 lit = col * (dwAmbient() * 1.1 + vec3(0.04, 0.07, 0.1) + uSunColor * (0.22 + 0.45 * wrap));
  float fres = pow(1.0 - abs(dot(N, V)), 2.0);
  lit = mix(lit, sky * 1.05, fres * 0.45 * (1.0 - foam * 0.7));
  // Keep a cool cast: pull 30% toward a pale water blue, scaled by how bright it is.
  lit = mix(lit, vec3(0.81, 0.9, 1.0) * dot(lit, vec3(0.3, 0.45, 0.25)) * 1.1, 0.3);
  // Light through the sheet when looking toward the sun.
  float trans = pow(max(dot(V, uSunDir), 0.0), 3.0);
  lit += uSunColor * vec3(0.4, 0.85, 0.9) * trans * 0.75 * (1.0 - foam * 0.6);
  // Sun glints on the broken surface.
  float glint = smoothstep(0.9, 0.97, n3) * pow(max(dot(reflect(V, N), uSunDir), 0.0), 6.0);
  lit += uSunColor * glint * 2.2 * (1.0 - uNight * 0.7);

  // Translucent where glassy and thin, opaque where it's white water.
  float a = mix(0.42, 0.95, foam) * (1.0 - fres * 0.45);
  a *= 0.85 + 0.15 * thread;
  // Near the bottom the column frays into streaks, then into nothing.
  float fray = smoothstep(0.45, 1.0, drop);
  a *= smoothstep(fray * 0.9, fray * 0.9 + 0.2, streak);
  a *= 1.0 - smoothstep(0.82, 1.0, drop);
  // Falls cut through the haze: within a few hundred meters only part of the fog applies.
  vec3 fogged = dwApplyFog(lit, vDwWorldPos, cameraPosition);
  float keep = 0.3 * (1.0 - smoothstep(500.0, 1800.0, distance(vDwWorldPos, cameraPosition)));
  gl_FragColor = vec4(mix(fogged, lit, keep), a);
}
`;

// ---------------------------------------------------------------------------------------------
// Streams and spring pools
// ---------------------------------------------------------------------------------------------

const STREAM_VERTEX = /* glsl */ `
attribute vec3 aStream; // across 0..1, along (m), rapids 0..1
varying vec3 vStream;
varying vec3 vDwWorldPos;
void main() {
  vStream = aStream;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vDwWorldPos = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const STREAM_FRAGMENT = /* glsl */ `
${FOG_PARS_GLSL}
${NOISE_GLSL}
uniform float uFlow;
varying vec3 vStream;
varying vec3 vDwWorldPos;
void main() {
  float across = vStream.x;
  float along = vStream.y;
  float rapid = vStream.z;
  float sp = uFlow * (1.0 + rapid * 1.5);
  float a1 = dwNoise(vec2(across * 5.0, along * 0.32 - dwClock(sp * 0.32)));
  float a2 = dwNoise(vec2(across * 13.0 + 5.0, along * 0.9 - dwClock(sp * 1.15)));
  float ripple = a1 * 0.6 + a2 * 0.4;
  float edge = abs(across - 0.5) * 2.0;
  vec3 deep = vec3(0.05, 0.22, 0.3);
  vec3 shallow = vec3(0.28, 0.56, 0.52);
  // Painted flow bands: darker troughs and lighter crests running downstream.
  float bands = dwNoise(vec2(across * 3.0 + 7.0, along * 0.12 - dwClock(sp * 0.12)));
  vec3 col = mix(deep, shallow, smoothstep(0.2, 1.0, edge) * 0.75 + ripple * 0.25 + (bands - 0.5) * 0.3);

  vec3 V = normalize(vDwWorldPos - cameraPosition);
  vec3 N = normalize(vec3((a1 - 0.5) * 0.35, 1.0, (a2 - 0.5) * 0.35));
  float fres = pow(1.0 - clamp(-V.y, 0.0, 1.0), 4.0);
  vec3 sky = mix(uSkyHorizon, uSkyZenith, 0.35);
  float foam = smoothstep(0.66, 0.92, ripple) * 0.55 + smoothstep(0.78, 1.0, edge) * 0.45 + rapid * smoothstep(0.35, 0.75, ripple) * 0.9;
  foam = clamp(foam, 0.0, 1.0);
  vec3 lit = col * (dwAmbient() + uSunColor * 0.45 * max(uSunDir.y, 0.0) + 0.05);
  lit = mix(lit, sky * 0.9, fres * 0.55);
  lit = mix(lit, vec3(0.9, 0.94, 0.96) * (dwAmbient() + uSunColor * 0.6), foam);
  float spec = pow(max(dot(reflect(V, N), uSunDir), 0.0), 80.0);
  lit += uSunColor * spec * 1.8 * (1.0 - foam);
  float alpha = (1.0 - smoothstep(0.82, 1.0, edge)) * 0.88 + foam * 0.12;
  lit = dwApplyFog(lit, vDwWorldPos, cameraPosition);
  gl_FragColor = vec4(lit, alpha);
}
`;

// ---------------------------------------------------------------------------------------------
// Spray and mist billboards (fully GPU-animated: each particle loops through its life by uTime)
// ---------------------------------------------------------------------------------------------

const MIST_VERTEX = /* glsl */ `
uniform float uTime;
uniform vec3 uWind;
attribute vec3 aOrigin;
attribute vec4 aParams; // seed, size, life rate, opacity
attribute vec4 aDrift;  // dir xyz, distance over a life
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
varying vec3 vDwWorldPos;
void main() {
  float life = fract(uTime * aParams.z + aParams.x);
  vec3 p = aOrigin + aDrift.xyz * aDrift.w * life + uWind * life * (2.0 + aDrift.w * 0.08);
  float size = aParams.y * (0.55 + 0.75 * life);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  // Spray falling with the column streaks vertically; slow puffs tumble.
  float fall = clamp(-aDrift.y * 1.4 - 0.4, 0.0, 1.0);
  float ang = (aParams.x * 6.2831 + life * 0.6) * (1.0 - fall);
  vec2 c = position.xy * vec2(1.0 - 0.35 * fall, 1.0 + 1.3 * fall);
  c = vec2(c.x * cos(ang) - c.y * sin(ang), c.x * sin(ang) + c.y * cos(ang));
  mv.xy += c * size;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy + 0.5;
  vAlpha = sin(life * 3.14159) * aParams.w;
  vSeed = aParams.x;
  vDwWorldPos = p;
}
`;

const MIST_FRAGMENT = /* glsl */ `
${FOG_PARS_GLSL}
${NOISE_GLSL}
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
varying vec3 vDwWorldPos;
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  // Lumpy, painterly puff edge.
  float lump = dwNoise(d * 5.0 + vSeed * 40.0) * 0.35;
  float a = (1.0 - smoothstep(0.35 - lump * 0.5, 1.0 - lump, r)) * vAlpha;
  if (a < 0.004) discard;
  vec3 col = vec3(0.95, 0.98, 1.0) * (dwAmbient() * 1.45 + vec3(0.05, 0.08, 0.11) + uSunColor * 0.6);
  // Spray is water: keep it cool and pale under a warm low sun.
  col = mix(col, vec3(0.85, 0.92, 1.0) * dot(col, vec3(0.3, 0.45, 0.25)) * 1.1, 0.35);
  vec3 V = normalize(vDwWorldPos - cameraPosition);
  // Sunlit spray glows when you look toward the sun.
  col += uSunColor * pow(max(dot(V, uSunDir), 0.0), 4.0) * 0.7;
  vec3 fogged = dwApplyFog(col, vDwWorldPos, cameraPosition);
  col = mix(fogged, col, 0.25 * (1.0 - smoothstep(400.0, 1500.0, distance(vDwWorldPos, cameraPosition))));
  gl_FragColor = vec4(col, a);
}
`;

let fallMat: ShaderMaterial | null = null;
let streamMat: ShaderMaterial | null = null;
let mistMat: ShaderMaterial | null = null;

export function fallMaterial(): ShaderMaterial {
  return (fallMat ??= new ShaderMaterial({
    name: 'water-fall',
    uniforms: { ...globalUniforms },
    vertexShader: FALL_VERTEX,
    fragmentShader: FALL_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: FrontSide,
  }));
}

export function streamMaterial(): ShaderMaterial {
  return (streamMat ??= new ShaderMaterial({
    name: 'water-stream',
    uniforms: { ...globalUniforms, uFlow: { value: 1.6 } },
    vertexShader: STREAM_VERTEX,
    fragmentShader: STREAM_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  }));
}

export function mistMaterial(): ShaderMaterial {
  return (mistMat ??= new ShaderMaterial({
    name: 'water-mist',
    uniforms: { ...globalUniforms },
    vertexShader: MIST_VERTEX,
    fragmentShader: MIST_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
  }));
}
