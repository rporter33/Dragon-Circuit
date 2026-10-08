// Materials for world dressing. Everything lit is a MeshToonMaterial run through the shared
// painterly patch (toon ramp + rim + height fog), with two optional extras patched in:
//
//   sway  - vertex displacement driven by the shared wind uniforms. The per-vertex `aSway`
//           attribute is the displacement weight in meters (0 = rigid), so one material serves
//           trunks (0 at the base) and canopies (up to ~0.5 m at the top) alike.
//   glow  - an emissive mask `aGlow` (0..1) that lights the vertex color up at night
//           (lantern panes, glowcap spots, luminous flowers). Day glow stays faint.
//
// Materials are cached by option key so every tree / building shares a handful of programs.

import { Color, DoubleSide, FrontSide, MeshDepthMaterial, MeshToonMaterial, RGBADepthPacking } from 'three';
import { applyPainterly, toonRamp } from '../../render/painterly';
import { globalUniforms } from '../../render/uniforms';

export type SwayMode = 'none' | 'tree' | 'root' | 'cloth' | 'chime';

export interface DressMaterialOptions {
  sway?: SwayMode;
  /** Use the aGlow attribute for night emissive. */
  glow?: boolean;
  /** Emissive strength by day (fraction of vertex color). Default 0.12. */
  glowDay?: number;
  /** Extra emissive strength at full night. Default 2.4 (HDR, so bloom catches it). */
  glowNight?: number;
  doubleSide?: boolean;
  /**
   * For thin double-sided cards (leaves, moss, cloth): light both faces with the front normal
   * instead of flipping it, so back faces don't go black.
   */
  keepNormals?: boolean;
  rim?: number;
  /** Base color multiplier (vertex colors carry the real color). */
  color?: string;
}

/** Shared GLSL: wind sway displacement in world space. Needs uTime/uWind/uGust declared. */
export const SWAY_GLSL = /* glsl */ `
vec2 dwWindDir() {
  vec2 w = uWind.xz;
  float l = length(w);
  return l > 0.01 ? w / l : vec2(0.894, 0.447);
}

float dwWindStrength() {
  // Calm air still breathes a little; a gale bends things a lot.
  return (0.35 + 0.075 * length(uWind)) * (0.7 + 0.9 * uGust);
}

// Trees and bushes: a slow lean-and-return along the wind, a gust front rolling across the
// island, and a fast leaf flutter that varies per vertex. origin = instance root (world).
vec3 dwTreeSway(vec3 origin, vec3 wp, float w) {
  vec2 wd = dwWindDir();
  float s = dwWindStrength();
  float ph = dot(origin.xz, vec2(0.071, 0.113));
  float t = uTime;
  float lean = 0.55 + 0.45 * sin(t * 0.83 + ph);
  float osc = sin(t * 1.9 + ph * 2.3) * 0.35 + sin(t * 3.1 + ph * 1.7) * 0.12;
  float front = smoothstep(0.2, 1.0, sin(dot(origin.xz, wd) * 0.021 - t * 0.9) * 0.5 + 0.5);
  vec3 off = vec3(wd.x, 0.0, wd.y) * (lean + osc + front * 0.9 * uGust) * s;
  off.xz += vec2(-wd.y, wd.x) * sin(t * 1.3 + ph * 3.1) * 0.18 * s;
  float fl = sin(t * 7.0 + dot(wp, vec3(1.37, 2.11, 1.73))) * (0.06 + 0.08 * uGust);
  off += vec3(fl, fl * 0.5, -fl * 0.8) * min(w, 1.0);
  return off * w;
}

// Hanging things (roots, vines, moss): a slow heavy pendulum plus a wind bias.
vec3 dwRootSway(vec3 wp, float w) {
  vec2 wd = dwWindDir();
  float ph = dot(wp.xz, vec2(0.031, 0.047));
  float t = uTime;
  vec3 off = vec3(sin(t * 0.37 + ph), 0.0, cos(t * 0.29 + ph * 1.3)) * 0.6;
  off.xz += wd * (0.4 + 0.3 * sin(t * 0.21 + ph * 0.7)) * dwWindStrength() * 0.6;
  return off * w;
}
`;

const VERTEX_PARS = /* glsl */ `
uniform float uTime;
uniform vec3 uWind;
uniform float uGust;
attribute float aSway;
${SWAY_GLSL}
`;

/** Replaces #include <begin_vertex>: displaces `transformed` in object space from a world offset. */
const SWAY_BEGIN = /* glsl */ `
vec3 transformed = vec3( position );
{
  mat4 dwModel = modelMatrix;
  #ifdef USE_INSTANCING
    dwModel = modelMatrix * instanceMatrix;
  #endif
  vec3 dwWorld = (dwModel * vec4(position, 1.0)).xyz;
  vec3 dwOff = vec3(0.0);
  #if defined(DW_SWAY_TREE)
    dwOff = dwTreeSway(dwModel[3].xyz, dwWorld, aSway);
  #elif defined(DW_SWAY_ROOT)
    dwOff = dwRootSway(dwWorld, aSway);
  #elif defined(DW_SWAY_CLOTH)
    // aSway = distance from the pole (m). A wave runs down the cloth, growing toward the free end.
    vec3 dwN = normalize(mat3(dwModel) * objectNormal);
    float dwPh = dot(dwModel[3].xyz, vec3(0.13, 0.0, 0.29));
    float dwAmp = (0.12 + 0.05 * length(uWind)) * (0.7 + 0.8 * uGust);
    float dwWave = sin(aSway * 1.15 - uTime * (3.2 + uGust * 2.0) + dwPh) + 0.4 * sin(aSway * 2.3 - uTime * 5.1 + dwPh * 2.0);
    dwOff = dwN * dwWave * dwAmp * min(aSway, 3.0) * 0.6;
    dwOff.xz += dwWindDir() * aSway * 0.06 * dwAmp;
  #elif defined(DW_SWAY_CHIME)
    vec2 dwWd = dwWindDir();
    float dwPh2 = dot(dwModel[3].xyz, vec3(1.7, 0.0, 2.9)) + dot(position, vec3(3.1, 0.0, 5.7));
    float dwSw = sin(uTime * 2.4 + dwPh2) * 0.5 + sin(uTime * 3.7 + dwPh2 * 1.9) * 0.25;
    dwOff = vec3(dwWd.x, 0.0, dwWd.y) * (dwSw + 0.3) * dwWindStrength() * 0.35 * aSway;
  #endif
  mat3 dwM = mat3(dwModel);
  float dwS2 = max(dot(dwM[0], dwM[0]), 1e-6);
  transformed += (transpose(dwM) * dwOff) / dwS2;
}
`;

const GLOW_VERTEX_PARS = /* glsl */ `
attribute float aGlow;
varying float vDwGlow;
`;

const GLOW_FRAGMENT_PARS = /* glsl */ `
varying float vDwGlow;
uniform float uDwGlowDay;
uniform float uDwGlowNight;
`;

const cache = new Map<string, MeshToonMaterial>();

function keyOf(o: DressMaterialOptions): string {
  return [
    o.sway ?? 'none',
    o.glow ? 'g' : '',
    o.glowDay ?? '',
    o.glowNight ?? '',
    o.doubleSide ? 'ds' : '',
    o.keepNormals ? 'kn' : '',
    o.rim ?? 1,
    o.color ?? '',
  ].join('|');
}

/** A vertex-colored painterly toon material with optional sway / glow (cached). */
export function dressMaterial(opts: DressMaterialOptions = {}): MeshToonMaterial {
  const key = keyOf(opts);
  const hit = cache.get(key);
  if (hit) return hit;
  const sway = opts.sway ?? 'none';
  const m = new MeshToonMaterial({
    gradientMap: toonRamp(),
    vertexColors: true,
    side: opts.doubleSide ? DoubleSide : FrontSide,
    color: new Color(opts.color ?? '#ffffff'),
  });
  m.name = `dress:${key}`;
  const defines: Record<string, string> = {};
  if (sway !== 'none') defines[`DW_SWAY_${sway.toUpperCase()}`] = '';
  m.defines = defines;
  const glowDay = opts.glowDay ?? 0.12;
  const glowNight = opts.glowNight ?? 2.4;
  m.onBeforeCompile = (shader) => {
    if (sway !== 'none') {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
        .replace('#include <begin_vertex>', SWAY_BEGIN);
    }
    if (opts.glow) {
      shader.uniforms.uDwGlowDay = { value: glowDay };
      shader.uniforms.uDwGlowNight = { value: glowNight };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${GLOW_VERTEX_PARS}`)
        .replace('#include <color_vertex>', '#include <color_vertex>\nvDwGlow = aGlow;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GLOW_FRAGMENT_PARS}`)
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          totalEmissiveRadiance += vColor.rgb * vDwGlow * (uDwGlowDay + uNight * uDwGlowNight);`,
        );
    }
    if (opts.keepNormals) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        `float faceDirection = 1.0;
        vec3 normal = normalize( vNormal );
        vec3 nonPerturbedNormal = normal;`,
      );
    }
  };
  m.customProgramCacheKey = () => `dress-${key}`;
  applyPainterly(m, { rim: opts.rim ?? 1 });
  cache.set(key, m);
  return m;
}

const depthCache = new Map<SwayMode, MeshDepthMaterial>();

/**
 * Shadow-pass material that sways like the visible one, so a swaying canopy's shadow moves with
 * it. Assign as `mesh.customDepthMaterial`.
 */
export function swayDepthMaterial(sway: SwayMode): MeshDepthMaterial {
  const hit = depthCache.get(sway);
  if (hit) return hit;
  const m = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  if (sway !== 'none') {
    m.defines = { [`DW_SWAY_${sway.toUpperCase()}`]: '' };
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        uTime: globalUniforms.uTime,
        uWind: globalUniforms.uWind,
        uGust: globalUniforms.uGust,
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
        .replace('#include <begin_vertex>', `vec3 objectNormal = vec3(normal);\n${SWAY_BEGIN}`);
    };
    m.customProgramCacheKey = () => `dress-depth-${sway}`;
  }
  depthCache.set(sway, m);
  return m;
}
