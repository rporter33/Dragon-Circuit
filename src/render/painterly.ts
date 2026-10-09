// The painterly look, applied to ordinary three.js materials:
//   - soft toon banding (MeshToonMaterial + a smoothed gradient ramp),
//   - a warm rim light so silhouettes glow against the sky,
//   - height fog with sun-tinted forward scattering (aerial perspective — distant islands go
//     blue and soft, islands toward the sun go gold).
// Custom ShaderMaterials can include FOG_PARS_GLSL / FOG_APPLY_GLSL for identical fog.

import {
  Color,
  DataTexture,
  LinearFilter,
  MeshToonMaterial,
  RedFormat,
  type ColorRepresentation,
  type Material,
  type MeshToonMaterialParameters,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { globalUniforms } from './uniforms';

/** GLSL uniform declarations + fog function. Safe to include in any fragment shader. */
export const FOG_PARS_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform float uFogDensity;
uniform float uFogHeightFalloff;
uniform float uFogBaseY;
uniform float uNight;
uniform float uTime;

// Analytic exponential height fog (after Inigo Quilez), tinted toward the sun.
vec3 dwApplyFog(vec3 col, vec3 worldPos, vec3 camPos) {
  vec3 rd = worldPos - camPos;
  float dist = length(rd);
  rd /= max(dist, 1e-4);
  float b = uFogHeightFalloff;
  float a = uFogDensity * exp(-max(camPos.y - uFogBaseY, 0.0) * b);
  float ry = rd.y;
  float fog = (abs(ry) < 1e-4) ? a * dist : a * (1.0 - exp(-dist * ry * b)) / (ry * b);
  fog = clamp(1.0 - exp(-fog), 0.0, 1.0);
  float sunAmt = max(dot(rd, uSunDir), 0.0);
  vec3 fogCol = mix(uFogColor, uFogSunColor, pow(sunAmt, 6.0) * (1.0 - 0.7 * uNight));
  return mix(col, fogCol, fog);
}
`;

/** Apply to `gl_FragColor` given a varying world position named vDwWorldPos. */
export const FOG_APPLY_GLSL = /* glsl */ `
gl_FragColor.rgb = dwApplyFog(gl_FragColor.rgb, vDwWorldPos, cameraPosition);
`;

const WORLDPOS_VERTEX_GLSL = /* glsl */ `
{
  vec4 dwWorld = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    dwWorld = batchingMatrix * dwWorld;
  #endif
  #ifdef USE_INSTANCING
    dwWorld = instanceMatrix * dwWorld;
  #endif
  dwWorld = modelMatrix * dwWorld;
  vDwWorldPos = dwWorld.xyz;
}
`;

/**
 * The painterly "rim" as injected before `#include <opaque_fragment>`. Exported so creature
 * materials can swap it for their own light (render/creatureLight via materials.ts) by exact
 * text, without touching what the world compiles.
 *
 * Note: vViewPosition points from the surface to the camera, so dot(normal, -dwV) is <= 0 on
 * every front face and dwFres is 1 everywhere: in practice this is a sun-side-weighted,
 * albedo-scaled lift over the whole surface (a soft wrap fill), not a silhouette rim. The
 * world's palettes are tuned with it as it is.
 */
export const PAINTERLY_RIM_GLSL = /* glsl */ `
        {
          vec3 dwV = normalize(vViewPosition);
          float dwFres = pow(1.0 - clamp(dot(normal, -dwV), 0.0, 1.0), 3.0);
          // Brighter on the side lit by the sun, a cool sky rim on the shadow side.
          vec3 dwSunView = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
          float dwSunSide = 0.35 + 0.65 * clamp(dot(normal, dwSunView) * 0.5 + 0.5, 0.0, 1.0);
          outgoingLight += dwFres * uRimStrength * uDwRim * dwSunSide * mix(uSunColor, vec3(0.55, 0.65, 0.9), 0.35) * diffuseColor.rgb * 1.6;
        }
        `;

let rampCache: DataTexture | null = null;

/**
 * A soft 4-band light ramp. Bands are smoothed (linear filtering over a small texture) so the
 * toon steps read as brushwork rather than hard cel lines.
 */
export function toonRamp(): DataTexture {
  if (rampCache) return rampCache;
  const steps = [0.32, 0.55, 0.8, 1.0];
  const size = 16;
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1);
    const band = Math.min(steps.length - 1, Math.floor(t * steps.length));
    data[i] = Math.round(steps[band] * 255);
  }
  const tex = new DataTexture(data, size, 1, RedFormat);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  rampCache = tex;
  return tex;
}

export interface PainterlyOptions {
  /** Rim light multiplier (0 disables). Default 1. */
  rim?: number;
  /** Apply the shared height fog. Default true. */
  fog?: boolean;
  /** Extra uniforms/defines hook for callers that patch further. Runs after ours. */
  onBeforeCompile?: (shader: WebGLProgramParametersWithUniforms) => void;
}

/**
 * Patch any built-in lit material (toon, lambert, standard, physical) with the painterly rim and
 * fog. Returns the same material. Idempotent per material.
 */
export function applyPainterly<T extends Material>(material: T, opts: PainterlyOptions = {}): T {
  const rim = opts.rim ?? 1;
  const fog = opts.fog ?? true;
  const flag = material as unknown as { __dwPainterly?: boolean };
  if (flag.__dwPainterly) return material;
  flag.__dwPainterly = true;
  (material as unknown as { fog?: boolean }).fog = false;
  const prev = material.onBeforeCompile?.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    Object.assign(shader.uniforms, globalUniforms);
    shader.uniforms.uDwRim = { value: rim };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDwWorldPos;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n' + WORLDPOS_VERTEX_GLSL);
    let frag = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDwWorldPos;\nuniform float uDwRim;\nuniform float uRimStrength;\n' + FOG_PARS_GLSL);
    if (rim > 0) frag = frag.replace('#include <opaque_fragment>', PAINTERLY_RIM_GLSL + '#include <opaque_fragment>');
    if (fog) {
      frag = frag.replace('#include <fog_fragment>', '#include <fog_fragment>\n' + FOG_APPLY_GLSL);
    }
    shader.fragmentShader = frag;
    opts.onBeforeCompile?.(shader);
  };
  // Distinct programs for distinct rim/fog settings.
  const key = `dw-painterly-${rim}-${fog}`;
  const prevKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}${key}`;
  material.needsUpdate = true;
  return material;
}

export interface ToonOptions extends MeshToonMaterialParameters {
  rim?: number;
  fog?: boolean;
}

/** The workhorse material: soft toon shading + rim + fog. */
export function toonMaterial(opts: ToonOptions = {}): MeshToonMaterial {
  const { rim, fog, ...params } = opts;
  const m = new MeshToonMaterial({ gradientMap: toonRamp(), ...params });
  return applyPainterly(m, { rim, fog });
}

/** Shorthand for a vertex-colored toon material (terrain, rocks, foliage). */
export function vertexColorToon(opts: ToonOptions = {}): MeshToonMaterial {
  return toonMaterial({ vertexColors: true, ...opts });
}

/** Parse "#rrggbb" or any ColorRepresentation into a linear Color. */
export function color(c: ColorRepresentation): Color {
  return new Color(c);
}
