// The cloud sea below the islands: a heightfield of soft billows, relief-marched in one opaque
// pass. A disc at the top of the cloud layer follows the camera; each pixel marches its view ray
// down through the layer to the billow surface, so crests occlude the troughs behind them and
// the sea has real parallax as you fly. The pixel then writes the depth of that surface, so
// islands that dip into the sea sink into the billows along their contours.
//
// Lighting: the shared cloud model (painterly bands, crest brightening, forward-scatter silver
// lining), self-shadowing marched toward the sun for long golden-hour shadows, and soft shadows
// cast by the floating islands and cloud banks above. Everything flows with the wind.

import {
  CircleGeometry,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector4,
  type Color,
  type PerspectiveCamera,
  type Scene,
  type Texture,
  type Vector3,
} from 'three';
import { FOG_PARS_GLSL } from '../render/painterly';
import { globalUniforms } from '../render/uniforms';
import { CLOUD_SHADE_GLSL, NOISE_GLSL, RAMP_GLSL } from './glsl';
import { MACRO_DRIFT, SEA_BILLOW_WEIGHT, SEA_MACRO_TILE, SEA_RANGE, SEA_TILE } from './cloudTextures';

/**
 * Lowest trough of the cloud sea (m); crests reach SEA_TOP. The average surface sits a little
 * above y = 0 and the respawn floor (layout.cloudFloor) is inside the layer.
 */
export const SEA_BASE = -72;
export const SEA_TOP = SEA_BASE + SEA_RANGE;
export const MAX_SHADOWERS = 24;

const VERTEX = /* glsl */ `
uniform float uRadius;
uniform float uSeaTop;
varying vec3 vWorld;
void main() {
  vec3 w = vec3(cameraPosition.x + position.x * uRadius, uSeaTop, cameraPosition.z - position.y * uRadius);
  vWorld = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
${FOG_PARS_GLSL}
${NOISE_GLSL}
${RAMP_GLSL}
${CLOUD_SHADE_GLSL}
uniform mat4 projectionMatrix;
uniform sampler2D uSeaTex;
uniform vec2 uScrollMain;
uniform vec2 uScrollMacro;
uniform vec2 uScrollDetail;
uniform float uSeaBase;
uniform float uSeaTop;
uniform float uPixelAngle;
uniform float uTexSize;
uniform vec4 uShadowers[${MAX_SHADOWERS}];
uniform int uShadowerCount;
uniform float uShadowerStrength;
varying vec3 vWorld;

const float TILE_MAIN = ${SEA_TILE.toFixed(1)};
const float TILE_MACRO = ${SEA_MACRO_TILE.toFixed(1)};
const float TILE_DETAIL = ${(SEA_TILE / 4.7).toFixed(1)};
const float RANGE = ${SEA_RANGE.toFixed(1)};
const float BILLOW_W = ${SEA_BILLOW_WEIGHT.toFixed(3)};

float lodFor(float footprint, float tile) {
  // Slightly sharp: the billows should read as sculpted, not blurred.
  return max(0.0, log2(footprint / (tile / uTexSize)) - 0.5);
}

// Height of the cloud surface (m) at xz; also returns the swell for shading.
float seaHeight(vec2 xz, float lodMain, float lodMacro, out float swell) {
  float b = textureLod(uSeaTex, xz / TILE_MAIN + uScrollMain, lodMain).r;
  swell = textureLod(uSeaTex, xz / TILE_MACRO + uScrollMacro, lodMacro).g;
  float h01 = swell * (1.0 - BILLOW_W) + b * BILLOW_W * (0.55 + 0.45 * swell);
  return uSeaBase + h01 * RANGE;
}

float seaHeightCoarse(vec2 xz, float lodMain, float lodMacro) {
  float s;
  return seaHeight(xz, lodMain, lodMacro, s);
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - ro);
  float t0 = 0.0;
  if (ro.y > uSeaTop) {
    if (rd.y > -1e-4) discard;
    t0 = (uSeaTop - ro.y) / rd.y;
  }
  float t1 = rd.y < -1e-4 ? (uSeaBase - ro.y) / rd.y : t0 + 2000.0;
  t1 = min(t1, t0 + 3500.0);

  // Mip level from the pixel's footprint on the layer (geometric mean of its two axes).
  float foot = t0 * uPixelAngle / sqrt(max(abs(rd.y), 0.03));
  float lodM = lodFor(foot, TILE_MAIN);
  float lodC = lodFor(foot, TILE_MACRO);

  // Relief march: uniform steps, then a secant refinement at the crossing.
  float dt = (t1 - t0) / float(SEA_STEPS);
  float tPrev = t0;
  float dPrev = (ro.y + rd.y * t0) - seaHeightCoarse((ro + rd * t0).xz, lodM, lodC);
  float tHit = t1;
  for (int i = 1; i <= SEA_STEPS; i++) {
    float t = t0 + dt * float(i);
    vec3 p = ro + rd * t;
    float dd = p.y - seaHeightCoarse(p.xz, lodM, lodC);
    if (dd < 0.0) {
      float tA = tPrev;
      float tB = t;
      float dA = dPrev;
      float dB = dd;
      for (int j = 0; j < 3; j++) {
        float tm = tA + (tB - tA) * dA / max(dA - dB, 1e-4);
        float dm = (ro.y + rd.y * tm) - seaHeightCoarse((ro + rd * tm).xz, lodM, lodC);
        if (dm < 0.0) { tB = tm; dB = dm; } else { tA = tm; dA = dm; }
      }
      tHit = tA + (tB - tA) * dA / max(dA - dB, 1e-4);
      break;
    }
    tPrev = t;
    dPrev = dd;
  }
  vec3 hit = ro + rd * tHit;
  float swell;
  float hy = seaHeight(hit.xz, lodM, lodC, swell);
  float h01 = clamp((hit.y - uSeaBase) / RANGE, 0.0, 1.0);

  // Normal: billows at the main scale plus finer cauliflower detail; flattened with distance.
  vec2 nM = textureLod(uSeaTex, hit.xz / TILE_MAIN + uScrollMain, lodM).ba * 2.0 - 1.0;
  vec2 nD = textureLod(uSeaTex, hit.xz / TILE_DETAIL + uScrollDetail, lodFor(foot, TILE_DETAIL)).ba * 2.0 - 1.0;
  // Painterly exaggeration: shading carries more relief than the geometry, like brushed form.
  float amp = 2.7 * (0.55 + 0.45 * swell) / 0.78;
  vec2 nxz = nM * amp + nD * 0.4;
  vec3 n = normalize(vec3(nxz.x, 1.0, nxz.y));

  // Self-shadow: march toward the light; a crest between us and the sun shades this trough.
  vec3 L = uSunDir;
  float sh = 1.0;
  if (L.y > 0.0) {
    float s = 10.0;
    for (int i = 0; i < SEA_SHADOW_STEPS; i++) {
      vec3 q = hit + L * s;
      float occ = seaHeightCoarse(q.xz, lodM, lodC) - q.y;
      sh *= 1.0 - 0.55 * smoothstep(0.0, 12.0, occ);
      s *= 2.3;
    }
    // Islands and cloud banks above cast soft shadows across the sea.
    for (int i = 0; i < ${MAX_SHADOWERS}; i++) {
      if (i >= uShadowerCount) break;
      vec4 o = uShadowers[i];
      float k = (o.y - hit.y) / max(L.y, 0.05);
      vec2 c = hit.xz + L.xz * k;
      float r = abs(o.w);
      float pen = r * 0.3 + k * 0.03;
      float occ = 1.0 - smoothstep(r - pen, r + pen, length(c - o.xz));
      sh *= 1.0 - occ * (o.w > 0.0 ? 0.72 : 0.45) * uShadowerStrength;
    }
  }

  // Cavity: this point against its neighbourhood (a coarse mip) — crevices darken, bulges lift.
  vec2 uvM = hit.xz / TILE_MAIN + uScrollMain;
  float bHere = textureLod(uSeaTex, uvM, lodM).r;
  float bAround = textureLod(uSeaTex, uvM, lodM + 3.0).r;
  float cavity = (bHere - bAround) * 2.2 * (1.0 - smoothstep(1.0, 4.0, lodM));

  vec3 col = dwCloudShade(n, h01, cavity, sh, rd);
  col += dwFlashGlow(hit) * (0.4 + 0.6 * h01);
  col = dwApplyFog(col, hit, ro);

  vec4 clip = projectionMatrix * viewMatrix * vec4(hit, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(col, 1.0);
}
`;

export interface SeaShared {
  uCloudLit: { value: Color };
  uCloudShade: { value: Color };
  uFlashPos: { value: Vector3 };
  uFlash: { value: number };
}

export class CloudSea {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  readonly shadowers: Vector4[];
  private uniforms: {
    uSeaTex: { value: Texture };
    uScrollMain: { value: Vector2 };
    uScrollMacro: { value: Vector2 };
    uScrollDetail: { value: Vector2 };
    uSeaBase: { value: number };
    uSeaTop: { value: number };
    uRadius: { value: number };
    uPixelAngle: { value: number };
    uTexSize: { value: number };
    uShadowers: { value: Vector4[] };
    uShadowerCount: { value: number };
    uShadowerStrength: { value: number };
  };

  constructor(scene: Scene, texture: Texture, texSize: number, shared: SeaShared, steps: number) {
    this.shadowers = Array.from({ length: MAX_SHADOWERS }, () => new Vector4());
    this.uniforms = {
      uSeaTex: { value: texture },
      uScrollMain: { value: new Vector2() },
      uScrollMacro: { value: new Vector2() },
      uScrollDetail: { value: new Vector2() },
      uSeaBase: { value: SEA_BASE },
      uSeaTop: { value: SEA_TOP },
      uRadius: { value: 6000 },
      uPixelAngle: { value: 0.001 },
      uTexSize: { value: texSize },
      uShadowers: { value: this.shadowers },
      uShadowerCount: { value: 0 },
      uShadowerStrength: { value: 1 },
    };
    this.material = new ShaderMaterial({
      name: 'DriftwingCloudSea',
      side: DoubleSide,
      uniforms: { ...globalUniforms, ...shared, ...this.uniforms },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      defines: { SEA_STEPS: steps, SEA_SHADOW_STEPS: 4 },
    });
    // A disc (in its XY plane; the vertex shader lays it flat) around the camera.
    this.mesh = new Mesh(new CircleGeometry(1, 96), this.material);
    this.mesh.name = 'cloudSea';
    this.mesh.frustumCulled = false;
    // After the dome, before the world: islands below the billows are then depth-rejected early.
    this.mesh.renderOrder = -5;
    scene.add(this.mesh);
  }

  setSteps(steps: number, shadowSteps: number): void {
    this.material.defines.SEA_STEPS = steps;
    this.material.defines.SEA_SHADOW_STEPS = shadowSteps;
    this.material.needsUpdate = true;
  }

  /**
   * @param drift  integral of the wind (m) — the billows ride it.
   * @param count  shadowers written into `shadowers` this frame.
   */
  update(camera: PerspectiveCamera, drift: Vector3, count: number, shadowStrength: number, viewportHeight: number): void {
    const u = this.uniforms;
    // Stay inside the far plane, so the disc is never clipped; the dome draws the rest.
    u.uRadius.value = camera.far * 0.94;
    u.uPixelAngle.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, viewportHeight);
    // Wrap the offsets (tiles repeat) so uv precision never degrades over a long session.
    u.uScrollMain.value.set(fract(-drift.x / SEA_TILE), fract(-drift.z / SEA_TILE));
    // The swell travels slower than the billows on it, so the sea slowly reshapes as it flows.
    u.uScrollMacro.value.set(fract((-drift.x * MACRO_DRIFT) / SEA_MACRO_TILE), fract((-drift.z * MACRO_DRIFT) / SEA_MACRO_TILE));
    u.uScrollDetail.value.set(fract((-drift.x * 1.25 * 4.7) / SEA_TILE + 0.37), fract((-drift.z * 1.25 * 4.7) / SEA_TILE + 0.61));
    u.uShadowerCount.value = count;
    u.uShadowerStrength.value = shadowStrength;
  }
}

function fract(v: number): number {
  return v - Math.floor(v);
}
