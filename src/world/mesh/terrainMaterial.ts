// The terrain material: the shared painterly toon (soft ramp, rim light, height fog) with a
// procedural world-space "brush" layer on top of the vertex colors. No textures: everything is
// hashed value noise evaluated in world space, so it is seamless across islands and LODs.
//
// Driven by the per-vertex surface mask (aSurf, see MeshBuilder):
//   x rock  -> sedimentary bands by world height (ochre / terracotta / cream / grey), seams,
//              weathering streaks, grain
//   y grass -> anisotropic brush strokes, warm/cool hue drift
//   z pave  -> irregular flagstones with mossy mortar
//   w moss  -> hanging moss and root streaks just under a rim
// High-frequency detail fades with distance so far islands read as calm painted shapes rather
// than shimmering noise.

import type { MeshToonMaterial, WebGLProgramParametersWithUniforms } from 'three';
import { toonMaterial } from '../../render/painterly';
import { STRATA_BAND, STRATA_PACKET } from './strata';

/** GLSL twins of strata.ts (hash12, valueNoise2, strataCoord). Keep in sync. */
export const NOISE_GLSL = /* glsl */ `
float dwHash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float dwHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 dwHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float dwHash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float dwNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = dwHash12(i);
  float b = dwHash12(i + vec2(1.0, 0.0));
  float c = dwHash12(i + vec2(0.0, 1.0));
  float d = dwHash12(i + vec2(1.0, 1.0));
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}
float dwNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = dwHash13(i);
  float n100 = dwHash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = dwHash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = dwHash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = dwHash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = dwHash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = dwHash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = dwHash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z);
}
float dwStrataHeight(vec3 wp) {
  float wobble = (dwNoise2(wp.xz * 0.011) - 0.5) * 7.0 + (dwNoise2(wp.xz * 0.05 + vec2(13.1, -7.7)) - 0.5) * 1.6;
  return wp.y + wobble;
}
float dwStrataCoord(float sy) {
  return sy / ${STRATA_BAND.toFixed(3)} + 0.3 * sin(sy * 0.9);
}
float dwPacketCoord(float sy) {
  return sy / ${STRATA_PACKET.toFixed(3)} + 0.25 * sin(sy * 0.13);
}
`;

const VERTEX_PARS = /* glsl */ `
attribute vec4 aSurf;
varying vec4 vSurf;
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec4 vSurf;
${NOISE_GLSL}

// Sedimentary palette, as multipliers on the vertex color.
const vec3 DW_OCHRE = vec3(1.08, 0.97, 0.80);
const vec3 DW_TERRA = vec3(1.10, 0.86, 0.72);
const vec3 DW_CREAM = vec3(1.16, 1.12, 1.03);
const vec3 DW_GREY = vec3(0.90, 0.91, 0.95);
const vec3 DW_UMBER = vec3(0.80, 0.74, 0.70);
const vec3 DW_STRATA_AVG = vec3(1.02, 0.94, 0.86);
const vec3 DW_MOSS = vec3(0.075, 0.13, 0.04);
const vec3 DW_MOSS_LIGHT = vec3(0.15, 0.24, 0.07);
const vec3 DW_ROOT = vec3(0.07, 0.045, 0.03);
const vec3 DW_MORTAR = vec3(0.14, 0.15, 0.09);

vec3 dwStrataTint(float packet) {
  float h = dwHash11(packet * 3.71 + 9.2);
  vec3 c = h < 0.3 ? DW_OCHRE : (h < 0.5 ? DW_TERRA : (h < 0.75 ? DW_CREAM : (h < 0.9 ? DW_GREY : DW_UMBER)));
  // Softer packets (recessed in the geometry) are a touch darker.
  float hard = dwHash11(packet * 7.13 + 1.7);
  return c * (0.92 + 0.1 * hard);
}

vec3 dwTerrainPaint(vec3 col, vec3 wp, vec3 wn, float dist) {
  float fine = 1.0 - smoothstep(50.0, 200.0, dist);
  float mid = 1.0 - smoothstep(200.0, 900.0, dist);

  // Broad painterly blotches on everything.
  float blot = dwNoise3(wp * 0.03);
  col *= 0.9 + 0.2 * blot;

  // --- Grass: soft dabs ------------------------------------------------------------------------
  if (vSurf.y > 0.01) {
    vec2 p = wp.xz;
    // Dabs share a slowly turning direction, like strokes laid down by one hand.
    float ang = dwNoise2(p * 0.008) * 3.2 + 0.6;
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 q = vec2(dot(p, dir), dot(p, vec2(-dir.y, dir.x)));
    float dab = dwNoise2(q * vec2(0.3, 0.9));
    float dab2 = dwNoise2(q * vec2(1.4, 4.2) + 17.0);
    float dab3 = dwNoise2(q * vec2(3.5, 11.0) - 31.0);
    float s = mix(0.5, dab * 0.5 + mix(0.5, dab2 * 0.6 + dab3 * 0.4, fine) * 0.5, mid);
    vec3 g = col * (0.88 + 0.24 * s);
    float hue = dwNoise2(p * 0.016 + 5.0);
    g = mix(g, g * vec3(1.08, 1.04, 0.8), smoothstep(0.55, 0.85, hue) * 0.5);
    g = mix(g, g * vec3(0.86, 0.98, 1.06), smoothstep(0.45, 0.15, hue) * 0.4);
    col = mix(col, g, vSurf.y);
  }

  // --- Rock: strata bands ----------------------------------------------------------------------
  if (vSurf.x > 0.01) {
    float sy = dwStrataHeight(wp);
    float v = dwPacketCoord(sy);
    float u = dwStrataCoord(sy);
    float dv = max(fwidth(v), 1e-4);
    float du = max(fwidth(u), 1e-4);
    float packet = floor(v);
    float pf = v - packet;
    float uf = fract(u);
    // Packets blur to their average once several fall inside one pixel (no moire at distance);
    // fine beds fade much sooner.
    float aaP = smoothstep(0.2, 0.7, dv);
    float aaU = smoothstep(0.15, 0.5, du);
    vec3 tint = mix(dwStrataTint(packet), DW_STRATA_AVG, aaP);
    // Fine beds: small value steps within the packet.
    tint *= mix(0.95 + 0.1 * dwHash11(floor(u) * 1.37 + 4.1), 1.0, aaU);
    vec3 rc = col * tint;
    // Bedding planes: a dark seam under each packet, fainter ones under each bed.
    float seamP = mix(0.62, 1.0, smoothstep(0.0, max(0.025, dv * 1.5), pf));
    rc *= mix(seamP, 1.0, aaP);
    float seamU = mix(0.85, 1.0, smoothstep(0.0, max(0.06, du * 1.5), uf));
    rc *= mix(seamU, 1.0, aaU);
    // A lit lip along the top of each packet.
    rc *= 1.0 + 0.09 * smoothstep(0.9, 1.0, pf) * (1.0 - aaP);
    // Vertical joints and weathering streaks on steep faces.
    float steep = smoothstep(0.35, 0.8, 1.0 - abs(wn.y));
    float jn = dwNoise3(vec3(wp.x * 0.11, wp.y * 0.018, wp.z * 0.11));
    float jw = max(fwidth(jn) * 1.5, 0.012);
    float joint = 1.0 - smoothstep(0.0, jw, abs(jn - 0.5));
    rc *= 1.0 - 0.35 * joint * steep * fine;
    float streak = dwNoise3(vec3(wp.x * 0.35, wp.y * 0.03, wp.z * 0.35));
    rc *= 1.0 - 0.2 * smoothstep(0.5, 0.85, streak) * steep * mid;
    // Grain.
    rc *= 0.93 + 0.14 * dwNoise3(wp * 0.55) * fine;
    // Upward-facing rock catches moss in its cracks.
    float mossUp = smoothstep(0.6, 0.9, wn.y) * smoothstep(0.45, 0.7, dwNoise3(wp * 0.15));
    rc = mix(rc, DW_MOSS_LIGHT * 1.6, mossUp * 0.5);
    col = mix(col, rc, vSurf.x);
  }

  // --- Paving: irregular flagstones ------------------------------------------------------------
  if (vSurf.z > 0.01) {
    vec2 p = wp.xz / 1.6;
    vec2 ip = floor(p);
    vec2 fp = p - ip;
    float f1 = 8.0;
    float f2 = 8.0;
    vec2 cellId = vec2(0.0);
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 o = vec2(float(i), float(j));
        vec2 r = o + 0.15 + 0.7 * dwHash22(ip + o) - fp;
        float d = dot(r, r);
        if (d < f1) { f2 = f1; f1 = d; cellId = ip + o; }
        else if (d < f2) { f2 = d; }
      }
    }
    float edge = sqrt(f2) - sqrt(f1);
    float h = dwHash12(cellId * 1.7 + 3.1);
    vec3 st = col * (0.84 + 0.24 * h) * mix(vec3(1.0), vec3(1.05, 1.0, 0.9), step(0.62, h));
    st *= 0.93 + 0.1 * dwNoise2(wp.xz * 1.3) * fine;
    float ew = max(0.05, fwidth(edge) * 1.5);
    float mortar = (1.0 - smoothstep(ew, ew + 0.07, edge)) * mid;
    st = mix(st, DW_MORTAR + col * 0.25, mortar * 0.8);
    // At the paving's edge whole stones drop out, so it frays stone by stone into the turf.
    float keep = step(dwHash12(cellId * 0.37 + 11.0) * 0.8 + 0.1, vSurf.z);
    col = mix(col, st, keep);
  }

  // --- Hanging moss and roots under the rim ------------------------------------------------------
  if (vSurf.w > 0.01) {
    float m = dwNoise3(vec3(wp.x * 0.3, wp.y * 0.07, wp.z * 0.3));
    float m2 = dwNoise3(vec3(wp.x * 1.1, wp.y * 0.12, wp.z * 1.1));
    float cover = m * 0.75 + m2 * 0.25;
    float th = 1.0 - vSurf.w * 0.5;
    float drip = smoothstep(th, th + 0.12, cover);
    vec3 moss = mix(DW_MOSS, DW_MOSS_LIGHT, m2);
    col = mix(col, moss, drip * 0.85);
    float r = dwNoise3(vec3(wp.x * 1.8, wp.y * 0.11, wp.z * 1.8));
    float root = smoothstep(0.78, 0.9, r) * vSurf.w * fine;
    col = mix(col, DW_ROOT, root * 0.8);
  }

  // Rain darkens everything a little.
  col *= 1.0 - 0.22 * uWetness;
  return col;
}
`;

let shared: MeshToonMaterial | null = null;

/** Patches a toon material's shaders with the terrain paint. */
export function patchTerrainShader(shader: WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + VERTEX_PARS)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = aSurf;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uWetness;\n' + FRAGMENT_PARS)
    .replace(
      '#include <normal_fragment_begin>',
      /* glsl */ `#include <normal_fragment_begin>
      {
        vec3 dwWN = inverseTransformDirection(normal, viewMatrix);
        diffuseColor.rgb = dwTerrainPaint(diffuseColor.rgb, vDwWorldPos, dwWN, length(vDwWorldPos - cameraPosition));
      }`,
    );
}

/** The shared terrain material (islands, spires, arches). */
export function terrainMaterial(): MeshToonMaterial {
  if (shared) return shared;
  const m = toonMaterial({ vertexColors: true, rim: 0.85 });
  const prev = m.onBeforeCompile.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    patchTerrainShader(shader);
  };
  // Painterly materials share one cache key; ours compiles a different program.
  const prevKey = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => prevKey() + '|dw-terrain';
  m.name = 'dw-terrain';
  shared = m;
  return m;
}
