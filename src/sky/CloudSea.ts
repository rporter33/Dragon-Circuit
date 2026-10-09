// The cloud sea below the islands: a heightfield of soft billows, relief-marched in one opaque
// full-screen pass. Each pixel clips its view ray to the cloud layer and marches it to the billow
// surface, so crests occlude the troughs behind them and the sea has real parallax as you fly —
// from high above, or skimming through the tops inside the layer. The pixel then writes the depth of that surface, so
// islands that dip into the sea sink into the billows along their contours.
//
// Lighting: the shared cloud model (painterly bands, crest brightening, forward-scatter silver
// lining), self-shadowing marched toward the sun for long golden-hour shadows, and soft shadows
// cast by the floating islands and cloud banks above. Everything flows with the wind.
//
// Cost (the sea is the biggest single GPU item): every quality level sets the march steps, the
// secant refinements, the self-shadow steps, how many island/bank shadows are tested and whether
// the fine detail normal and cavity terms are fetched (SeaQuality). Low and medium march at half
// resolution into a small target (colour + hit distance) and a cheap full-screen composite
// upsamples it with validity-weighted bilinear taps and writes the depth, so a quarter of the
// pixels pay for the march. Rays that enter the layer near the far plane skip the march: their
// colour has already faded to the far-field look.

import {
  BufferAttribute,
  BufferGeometry,
  FloatType,
  HalfFloatType,
  Mesh,
  NearestFilter,
  RGBAFormat,
  Scene as ThreeScene,
  ShaderMaterial,
  Vector2,
  Vector4,
  WebGLRenderTarget,
  type Camera,
  type Color,
  type PerspectiveCamera,
  type Scene,
  type Texture,
  type Vector3,
  type WebGLRenderer,
} from 'three';
import { FOG_PARS_GLSL } from '../render/painterly';
import { globalUniforms } from '../render/uniforms';
import { CLOUD_SHADE_GLSL, FAR_SEA_GLSL, NOISE_GLSL, RAMP_GLSL } from './glsl';
import { MACRO_DRIFT, SEA_BILLOW_WEIGHT, SEA_MACRO_TILE, SEA_RANGE, SEA_TILE } from './cloudTextures';

/**
 * Lowest trough of the cloud sea (m); crests reach SEA_TOP. The average surface sits a little
 * above y = 0 and the respawn floor (layout.cloudFloor) is inside the layer.
 */
export const SEA_BASE = -72;
export const SEA_TOP = SEA_BASE + SEA_RANGE;
export const MAX_SHADOWERS = 24;

/** How much work the sea does per pixel (Sky picks one per quality level). */
export interface SeaQuality {
  /** Relief-march steps to the billow surface. */
  steps: number;
  /** Secant refinements at the crossing. */
  secant: number;
  /** Self-shadow steps toward the sun (0 = none). */
  shadowSteps: number;
  /** Fetch the fine detail normal and the cavity term. */
  detail: boolean;
  /** Island/bank shadows tested per pixel (<= MAX_SHADOWERS). */
  shadowers: number;
  /** March at half resolution and upsample. */
  half: boolean;
}

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  // A full-screen triangle; each pixel gets its world-space view ray from the camera matrices,
  // so the sea is marched correctly whether the camera is above, inside or below the layer.
  vec2 ndc = position.xy;
  vec3 view = vec3((ndc.x + projectionMatrix[2][0]) / projectionMatrix[0][0], (ndc.y + projectionMatrix[2][1]) / projectionMatrix[1][1], -1.0);
  vDir = transpose(mat3(viewMatrix)) * view;
  gl_Position = vec4(ndc, 0.0, 1.0);
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
uniform float uMaxDist;
uniform float uSeaMean01;
uniform vec4 uShadowers[${MAX_SHADOWERS}];
uniform int uShadowerCount;
uniform float uShadowerStrength;
// The player's wyvern: xyz its centre, w its wingspan as spread (0 = no shadow); axis xy its
// heading on the ground plane, z the shadow's strength.
uniform vec4 uCreature;
uniform vec4 uCreatureAxis;
varying vec3 vDir;
${FAR_SEA_GLSL}

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

// Mip level for a ray sample at distance t: the pixel's footprint on the layer (geometric mean
// of its two axes, so grazing rays blur along the view a little but not across it).
float lodAt(float t, float ry, float tile) {
  return lodFor(max(t, 1.0) * uPixelAngle / sqrt(max(abs(ry), 0.03)), tile);
}

// Marches this pixel's view ray to the billow surface. False when the ray sees no cloud here (sky
// above the layer, or beyond the far plane where the dome draws the far field).
bool seaMarch(vec3 ro, vec3 rd, out vec3 col, out float tHit) {
  col = vec3(0.0);
  tHit = 0.0;
  // Clip the ray to the cloud layer [uSeaBase, uSeaTop].
  float t0 = 0.0;
  if (ro.y > uSeaTop) {
    if (rd.y > -1e-4) return false;
    t0 = (uSeaTop - ro.y) / rd.y;
  } else if (ro.y < uSeaBase) {
    if (rd.y < 1e-4) return false;
    t0 = (uSeaBase - ro.y) / rd.y;
  }
  // Beyond the far plane the sky dome draws the far field.
  if (t0 > uMaxDist) return false;
  // Entering the layer near the far plane: the marched sea has already faded into the far-field
  // look there, so skip the march (a wide band along the horizon from any height).
  if (t0 > uMaxDist * 0.97 && rd.y < -1e-4) {
    float tm = min((uSeaBase + uSeaMean01 * RANGE - ro.y) / rd.y, uMaxDist);
    vec3 hm = ro + rd * max(tm, t0);
    col = dwFarSea(hm, rd) + dwFlashGlow(hm) * (0.4 + 0.6 * uSeaMean01);
    col = dwApplyFog(col, hm, ro);
    tHit = max(tm, t0);
    return true;
  }
  float tExit = rd.y < -1e-4 ? (uSeaBase - ro.y) / rd.y : (rd.y > 1e-4 ? (uSeaTop - ro.y) / rd.y : 1e9);
  float t1 = min(tExit, uMaxDist);
  float span = t1 - t0;

  // Relief march, then a secant refinement at the crossing. Long, grazing spans (skimming the
  // tops, or inside the layer) put their steps close to the eye where detail matters.
  float kDist = 1.0 + 1.2 * smoothstep(250.0, 2500.0, span);
  float lodM = lodAt(t0, rd.y, TILE_MAIN);
  float lodC = lodAt(t0, rd.y, TILE_MACRO);
  float tPrev = t0;
  float dPrev = (ro.y + rd.y * t0) - seaHeightCoarse((ro + rd * t0).xz, lodM, lodC);
  tHit = t1;
  // Starting under the surface (the camera is inside the billows): the cloud is right here. Keep
  // the hit just past the near plane so the written depth stays finite.
  bool found = dPrev < 0.0;
  if (found) tHit = max(t0, 0.75);
  for (int i = 1; i <= SEA_STEPS; i++) {
    if (found) break;
    float t = t0 + span * pow(float(i) / float(SEA_STEPS), kDist);
    lodM = lodAt(t, rd.y, TILE_MAIN);
    lodC = lodAt(t, rd.y, TILE_MACRO);
    vec3 p = ro + rd * t;
    float dd = p.y - seaHeightCoarse(p.xz, lodM, lodC);
    if (dd < 0.0) {
      float tA = tPrev;
      float tB = t;
      float dA = dPrev;
      float dB = dd;
      for (int j = 0; j < SEA_SECANT; j++) {
        float tm = tA + (tB - tA) * dA / max(dA - dB, 1e-4);
        float dm = (ro.y + rd.y * tm) - seaHeightCoarse((ro + rd * tm).xz, lodM, lodC);
        if (dm < 0.0) { tB = tm; dB = dm; } else { tA = tm; dA = dm; }
      }
      tHit = tA + (tB - tA) * dA / max(dA - dB, 1e-4);
      found = true;
    }
    tPrev = t;
    dPrev = dd;
  }
  // Looking up and out of the layer past every crest: the sky shows.
  if (!found && rd.y > 0.0) return false;
  float foot = max(tHit, 1.0) * uPixelAngle / sqrt(max(abs(rd.y), 0.03));
  lodM = lodFor(foot, TILE_MAIN);
  lodC = lodFor(foot, TILE_MACRO);
  vec3 hit = ro + rd * tHit;
  float swell;
  float hy = seaHeight(hit.xz, lodM, lodC, swell);
  float h01 = clamp((hit.y - uSeaBase) / RANGE, 0.0, 1.0);

  // Normal: billows at the main scale plus finer cauliflower detail; flattened with distance.
  vec2 uvM = hit.xz / TILE_MAIN + uScrollMain;
  vec2 nM = textureLod(uSeaTex, uvM, lodM).ba * 2.0 - 1.0;
  // Painterly exaggeration: shading carries more relief than the geometry, like brushed form.
  float amp = 2.7 * (0.55 + 0.45 * swell) / 0.78;
  vec2 nxz = nM * amp;
  float cavity = 0.0;
#if SEA_DETAIL == 1
  vec2 nD = textureLod(uSeaTex, hit.xz / TILE_DETAIL + uScrollDetail, lodFor(foot, TILE_DETAIL)).ba * 2.0 - 1.0;
  nxz += nD * 0.4;
  // Cavity: this point against its neighbourhood (a coarse mip) — crevices darken, bulges lift.
  float bHere = textureLod(uSeaTex, uvM, lodM).r;
  float bAround = textureLod(uSeaTex, uvM, lodM + 3.0).r;
  cavity = (bHere - bAround) * 2.2 * (1.0 - smoothstep(1.0, 4.0, lodM));
#endif
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
    // The wyvern's own shadow racing over the billows: wings and body as two soft ellipses in
    // the creature's plane, a tight penumbra that softens with the height it falls from.
    if (uCreature.w > 0.0) {
      float k = (uCreature.y - hit.y) / max(L.y, 0.05);
      if (k > 0.0) {
        vec2 c = hit.xz + L.xz * k - uCreature.xz;
        vec2 fw = uCreatureAxis.xy;
        float u = dot(c, vec2(fw.y, -fw.x));
        float v = dot(c, fw);
        float span = uCreature.w;
        float pen = span * 0.06 + k * 0.01;
        float dw = length(vec2(u / (0.5 * span + pen), v / (0.13 * span + pen)));
        float db = length(vec2(u / (0.08 * span + pen), (v + 0.12 * span) / (0.5 * span + pen)));
        float occ = 1.0 - smoothstep(0.55, 1.0, min(dw, db));
        sh *= 1.0 - occ * uCreatureAxis.z * uShadowerStrength;
      }
    }
  }

  col = dwCloudShade(n, h01, cavity, sh, rd);
  // Toward the far plane detail gives way to the far-field look the dome continues.
  col = mix(col, dwFarSea(hit, rd), smoothstep(uMaxDist * 0.5, uMaxDist * 0.98, tHit));
  col += dwFlashGlow(hit) * (0.4 + 0.6 * h01);
  col = dwApplyFog(col, hit, ro);
  return true;
}

void main() {
  vec3 col;
  float tHit;
  vec3 rd = normalize(vDir);
  bool hit = seaMarch(cameraPosition, rd, col, tHit);
#ifdef SEA_HALF
  // Half-resolution march: colour and hit distance; a negative distance marks "no cloud here".
  gl_FragColor = hit ? vec4(col, tHit) : vec4(0.0, 0.0, 0.0, -1.0);
#else
  if (!hit) discard;
  vec4 clip = projectionMatrix * viewMatrix * vec4(cameraPosition + rd * tHit, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(col, 1.0);
#endif
}
`;

/**
 * Full-resolution composite of the half-resolution march: validity-weighted bilinear taps of
 * colour and hit distance, then the depth of that hit (islands still sink into the billows).
 */
const COMPOSITE_FRAGMENT = /* glsl */ `
uniform mat4 projectionMatrix;
uniform highp sampler2D uHalf;
uniform vec2 uHalfScale;
uniform vec2 uHalfMax;
varying vec3 vDir;

void main() {
  vec2 hp = gl_FragCoord.xy * uHalfScale - 0.5;
  vec2 fl = floor(hp);
  vec2 f = hp - fl;
  ivec2 i0 = ivec2(fl);
  ivec2 mx = ivec2(uHalfMax);
  vec4 a = texelFetch(uHalf, clamp(i0, ivec2(0), mx), 0);
  vec4 b = texelFetch(uHalf, clamp(i0 + ivec2(1, 0), ivec2(0), mx), 0);
  vec4 c = texelFetch(uHalf, clamp(i0 + ivec2(0, 1), ivec2(0), mx), 0);
  vec4 d = texelFetch(uHalf, clamp(i0 + ivec2(1, 1), ivec2(0), mx), 0);
  vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  w *= step(0.0, vec4(a.a, b.a, c.a, d.a));
  float sw = w.x + w.y + w.z + w.w;
  // Mostly sky at this pixel: let the dome draw it.
  if (sw < 0.3) discard;
  vec4 s = (a * w.x + b * w.y + c * w.z + d * w.w) / sw;
  vec4 clip = projectionMatrix * viewMatrix * vec4(cameraPosition + normalize(vDir) * s.a, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(s.rgb, 1.0);
}
`;

export interface SeaShared {
  uCloudLit: { value: Color };
  uCloudShade: { value: Color };
  uFlashPos: { value: Vector3 };
  uFlash: { value: number };
  uCloudDirect: { value: number };
}

export class CloudSea {
  /** What the scene draws: the march itself (full resolution) or the half-resolution composite. */
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  readonly shadowers: Vector4[];
  /** Uniforms the dome's far field shares with the sea. */
  get farField(): { uSeaTex: { value: Texture }; uScrollMacro: { value: Vector2 }; uSeaMean01: { value: number } } {
    return { uSeaTex: this.uniforms.uSeaTex, uScrollMacro: this.uniforms.uScrollMacro, uSeaMean01: this.uniforms.uSeaMean01 };
  }
  /** Current per-pixel work (read by tests and the perf probes). */
  get quality(): Readonly<SeaQuality> {
    return this.q;
  }

  private uniforms: {
    uSeaTex: { value: Texture };
    uScrollMain: { value: Vector2 };
    uScrollMacro: { value: Vector2 };
    uScrollDetail: { value: Vector2 };
    uSeaBase: { value: number };
    uSeaTop: { value: number };
    uMaxDist: { value: number };
    uSeaMean01: { value: number };
    uPixelAngle: { value: number };
    uTexSize: { value: number };
    uShadowers: { value: Vector4[] };
    uShadowerCount: { value: number };
    uShadowerStrength: { value: number };
    uCreature: { value: Vector4 };
    uCreatureAxis: { value: Vector4 };
  };
  private q: SeaQuality;
  private viewportHeight = 720;
  /** Half-resolution path: the march renders into `half` from a private scene. */
  private composite: ShaderMaterial;
  private marchScene = new ThreeScene();
  private marchMesh: Mesh;
  private halfTarget: WebGLRenderTarget | null = null;
  private halfUniforms = {
    uHalf: { value: null as Texture | null },
    uHalfScale: { value: new Vector2(0.5, 0.5) },
    uHalfMax: { value: new Vector2(0, 0) },
  };
  private fullSize = new Vector2();

  constructor(scene: Scene, texture: Texture, texSize: number, shared: SeaShared, quality: SeaQuality) {
    this.q = { ...quality };
    this.shadowers = Array.from({ length: MAX_SHADOWERS }, () => new Vector4());
    this.uniforms = {
      uSeaTex: { value: texture },
      uScrollMain: { value: new Vector2() },
      uScrollMacro: { value: new Vector2() },
      uScrollDetail: { value: new Vector2() },
      uSeaBase: { value: SEA_BASE },
      uSeaTop: { value: SEA_TOP },
      uMaxDist: { value: 6000 },
      uSeaMean01: { value: 0.5 },
      uPixelAngle: { value: 0.001 },
      uTexSize: { value: texSize },
      uShadowers: { value: this.shadowers },
      uShadowerCount: { value: 0 },
      uShadowerStrength: { value: 1 },
      uCreature: { value: new Vector4() },
      uCreatureAxis: { value: new Vector4(0, 1, 0, 0) },
    };
    this.material = new ShaderMaterial({
      name: 'DriftwingCloudSea',
      uniforms: { ...globalUniforms, ...shared, ...this.uniforms },
      depthTest: true,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      defines: this.defines(false),
    });
    this.composite = new ShaderMaterial({
      name: 'DriftwingCloudSeaComposite',
      uniforms: this.halfUniforms,
      depthTest: true,
      vertexShader: VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
    });
    // One full-screen triangle: the fragment shader finds the sea along each pixel's view ray.
    const tri = new BufferGeometry();
    tri.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mesh = new Mesh(tri, this.material);
    this.mesh.name = 'cloudSea';
    this.mesh.frustumCulled = false;
    // Before the world (islands below the billows are then depth-rejected early); the dome draws
    // after every opaque object.
    this.mesh.renderOrder = -5;
    scene.add(this.mesh);

    this.marchMesh = new Mesh(tri, this.material);
    this.marchMesh.frustumCulled = false;
    this.marchScene.add(this.marchMesh);
    this.mesh.onBeforeRender = (renderer, _scene, camera) => {
      if (this.q.half) this.renderHalf(renderer, camera);
    };
    this.applyQuality();
  }

  /** Change the per-pixel work (recompiles the sea's shaders when the defines change). */
  setQuality(quality: SeaQuality): void {
    this.q = { ...quality, shadowers: Math.max(0, Math.min(MAX_SHADOWERS, quality.shadowers)) };
    this.applyQuality();
  }

  /**
   * @param drift  integral of the wind (m) — the billows ride it.
   * @param count  shadowers written into `shadowers` this frame.
   */
  update(camera: PerspectiveCamera, drift: Vector3, count: number, shadowStrength: number, viewportHeight: number): void {
    const u = this.uniforms;
    this.viewportHeight = Math.max(1, viewportHeight);
    // Stay inside the far plane (the depth written must be in range); the dome draws the rest.
    u.uMaxDist.value = camera.far * 0.94;
    const march = this.q.half ? Math.ceil(this.viewportHeight / 2) : this.viewportHeight;
    u.uPixelAngle.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / march;
    // Wrap the offsets (tiles repeat) so uv precision never degrades over a long session.
    u.uScrollMain.value.set(fract(-drift.x / SEA_TILE), fract(-drift.z / SEA_TILE));
    // The swell travels slower than the billows on it, so the sea slowly reshapes as it flows.
    u.uScrollMacro.value.set(fract((-drift.x * MACRO_DRIFT) / SEA_MACRO_TILE), fract((-drift.z * MACRO_DRIFT) / SEA_MACRO_TILE));
    u.uScrollDetail.value.set(fract((-drift.x * 1.25 * 4.7) / SEA_TILE + 0.37), fract((-drift.z * 1.25 * 4.7) / SEA_TILE + 0.61));
    u.uShadowerCount.value = Math.min(count, this.q.shadowers);
    u.uShadowerStrength.value = shadowStrength;
  }

  /**
   * The player's wyvern's shadow on the sea (one dedicated slot, every frame: the island and bank
   * slots refresh only every 0.2 s). `span` 0 removes it.
   */
  setCreatureShadow(x: number, y: number, z: number, headingX: number, headingZ: number, span: number, strength: number): void {
    const l = Math.hypot(headingX, headingZ);
    this.uniforms.uCreature.value.set(x, y, z, strength > 0 ? span : 0);
    this.uniforms.uCreatureAxis.value.set(l > 1e-6 ? headingX / l : 0, l > 1e-6 ? headingZ / l : 1, strength, 0);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.composite.dispose();
    this.halfTarget?.dispose();
  }

  // --- Internals ----------------------------------------------------------------------------

  private defines(half: boolean): Record<string, number | string> {
    const d: Record<string, number | string> = {
      SEA_STEPS: Math.max(2, Math.round(this.q.steps)),
      SEA_SECANT: Math.max(1, Math.round(this.q.secant)),
      SEA_SHADOW_STEPS: Math.max(0, Math.round(this.q.shadowSteps)),
      SEA_DETAIL: this.q.detail ? 1 : 0,
    };
    if (half) d.SEA_HALF = '';
    return d;
  }

  private applyQuality(): void {
    this.material.defines = this.defines(this.q.half);
    this.material.needsUpdate = true;
    this.mesh.material = this.q.half ? this.composite : this.material;
    if (!this.q.half && this.halfTarget) {
      this.halfTarget.dispose();
      this.halfTarget = null;
    }
  }

  /** Called as the composite is about to draw: march the sea into the half-resolution target. */
  private renderHalf(renderer: WebGLRenderer, camera: Camera): void {
    const prev = renderer.getRenderTarget();
    if (prev) this.fullSize.set(prev.width, prev.height);
    else renderer.getDrawingBufferSize(this.fullSize);
    const w = Math.max(1, Math.ceil(this.fullSize.x / 2));
    const h = Math.max(1, Math.ceil(this.fullSize.y / 2));
    if (!this.halfTarget) {
      // Float keeps the hit distance exact for the depth the composite writes; half float would
      // quantize it to ~1/2000 of the distance.
      const float = renderer.extensions.has('EXT_color_buffer_float');
      this.halfTarget = new WebGLRenderTarget(w, h, {
        type: float ? FloatType : HalfFloatType,
        format: RGBAFormat,
        minFilter: NearestFilter,
        magFilter: NearestFilter,
        depthBuffer: false,
        generateMipmaps: false,
      });
      this.halfTarget.texture.name = 'cloudSeaHalf';
    } else if (this.halfTarget.width !== w || this.halfTarget.height !== h) {
      this.halfTarget.setSize(w, h);
    }
    const hu = this.halfUniforms;
    hu.uHalf.value = this.halfTarget.texture;
    hu.uHalfScale.value.set(w / this.fullSize.x, h / this.fullSize.y);
    hu.uHalfMax.value.set(w - 1, h - 1);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.halfTarget);
    renderer.render(this.marchScene, camera);
    renderer.setRenderTarget(prev);
    renderer.autoClear = autoClear;
  }
}

function fract(v: number): number {
  return v - Math.floor(v);
}
