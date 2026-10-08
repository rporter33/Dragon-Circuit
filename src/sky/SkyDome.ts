// The sky dome: a stylized, physically-inspired gradient keyed by the palette, the sun disk and
// its halo, a moon with soft glow, twinkling stars and a faint milky way at night, high cirrus
// (thickening to an overcast deck) drifting with the wind, and lightning glow in storms.
//
// The horizon is seamless by construction: above it, the sky is fogged with the same height fog
// as the world integrated to infinity; below it, the dome draws the far cloud sea with the same
// shading and fog as the real one. Both converge to the fog color at the horizon.

import {
  BackSide,
  Color,
  Matrix3,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  type Scene,
  type Texture,
} from 'three';
import { FOG_PARS_GLSL } from '../render/painterly';
import { globalUniforms } from '../render/uniforms';
import { CLOUD_SHADE_GLSL, FAR_SEA_GLSL, NOISE_GLSL, RAMP_GLSL } from './glsl';

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + position * 1000.0, 1.0);
  gl_Position = p.xyww;
}
`;

const FRAGMENT = /* glsl */ `
${FOG_PARS_GLSL}
${NOISE_GLSL}
${RAMP_GLSL}
${CLOUD_SHADE_GLSL}
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uHorizonSun;
uniform vec3 uSunDisk;
uniform vec3 uBeltColor;
uniform vec3 uTrueSunDir;
uniform vec3 uMoonDir;
uniform float uGlow;
uniform float uBelt;
uniform float uStars;
uniform float uMoonLight;
uniform float uCirrus;
uniform float uDeck;
uniform vec2 uCloudOffset;
uniform vec2 uWindDir;
uniform mat3 uStarRot;
uniform float uSeaY;
uniform float uSeaMean01;
uniform sampler2D uSeaTex;
uniform vec2 uScrollMacro;
${FAR_SEA_GLSL}
uniform vec3 uFlashDir;
varying vec3 vDir;

const float SUN_R = 0.022;
const float MOON_R = 0.036;

vec3 skyGradient(vec3 d) {
  float h = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uSkyZenith, uSkyHorizon, pow(1.0 - h, 2.7));
  // Toward the sun the low sky warms (dawn gold, sunset fire).
  vec2 dh = normalize(d.xz + vec2(1e-5, 0.0));
  vec2 sh = normalize(uTrueSunDir.xz + vec2(1e-5, 0.0));
  float az = dot(dh, sh) * 0.5 + 0.5;
  float sunUp = smoothstep(-0.28, 0.0, uTrueSunDir.y);
  float sunSide = pow(az, 2.2) * pow(1.0 - h, 2.6) * sunUp;
  col = mix(col, uHorizonSun, clamp(sunSide * uGlow, 0.0, 1.0));
  // Twilight: the Belt of Venus (pink) above the earth's shadow (deep blue) opposite the sun.
  float anti = pow(1.0 - az, 1.6);
  float belt = smoothstep(0.0, 0.07, h) * (1.0 - smoothstep(0.1, 0.34, h));
  col = mix(col, uBeltColor, anti * belt * uBelt * 0.75);
  float shade = 1.0 - smoothstep(0.0, 0.06, h);
  col = mix(col, uSkyZenith * 0.85, anti * shade * uBelt * 0.45);
  // Halo around the sun.
  float cs = max(dot(d, uTrueSunDir), 0.0);
  col += uHorizonSun * uGlow * sunUp * (pow(cs, 9.0) * 0.32 + pow(cs, 90.0) * 0.55);
  return col;
}

vec3 starLayer(vec2 uv, float face, float cells, float seed, float density) {
  vec2 g = uv * cells;
  vec2 cell = floor(g);
  vec2 f = fract(g);
  vec2 id = cell + vec2(face * 517.0 + seed, seed * 3.1);
  float h = dwHash12(id);
  if (h > density) return vec3(0.0);
  vec2 pos = 0.2 + 0.6 * dwHash22(id + 7.7);
  float px = fwidth(g.x) + fwidth(g.y);
  float r = max(px * 0.7, 0.03);
  float dist = length(f - pos);
  float core = smoothstep(r, 0.0, dist);
  core *= core;
  // Magnitudes: a handful of bright stars, a crowd of faint ones.
  float k = h / density;
  float bright = 0.12 + 2.6 * pow(1.0 - k, 7.0);
  // Faint stars twinkle harder (the eye catches them flickering in and out).
  float tw = 1.0 - (0.25 + 0.45 * k) * (0.5 + 0.5 * sin(uTime * (1.3 + 3.5 * fract(h * 91.7)) + h * 40.0));
  vec3 tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.86, 0.7), fract(h * 53.3));
  return tint * core * bright * tw;
}

vec3 stars(vec3 d) {
  vec3 s = uStarRot * d;
  vec3 a = abs(s);
  vec2 uv;
  float face;
  if (a.x > a.y && a.x > a.z) { uv = s.yz / a.x; face = s.x > 0.0 ? 0.0 : 1.0; }
  else if (a.y > a.z) { uv = s.xz / a.y; face = s.y > 0.0 ? 2.0 : 3.0; }
  else { uv = s.xy / a.z; face = s.z > 0.0 ? 4.0 : 5.0; }
  // The milky way: a soft clumpy band along a tilted great circle.
  float band = dot(s, normalize(vec3(0.35, 0.25, 0.9)));
  float mw = exp(-band * band / 0.035);
  float clumps = dwFbm5(uv * 3.0 + face * 13.0);
  float dust = smoothstep(0.45, 0.75, dwFbm3(uv * 7.0 - face * 5.0));
  vec3 col = vec3(0.30, 0.34, 0.58) * mw * (0.2 + 0.8 * clumps) * (1.0 - 0.65 * dust) * 0.38;
  col += starLayer(uv, face, 55.0, 1.0, 0.035 + 0.05 * mw);
  col += starLayer(uv, face, 140.0, 2.0, 0.012 + 0.07 * mw) * 0.5;
  return col;
}

vec3 moon(vec3 d, inout vec3 col) {
  float cm = dot(d, uMoonDir);
  if (cm < 0.0) return vec3(0.0);
  float ang = acos(clamp(cm, -1.0, 1.0));
  float aa = fwidth(ang) * 1.5 + 1e-5;
  float disk = smoothstep(MOON_R + aa, MOON_R - aa, ang);
  vec3 right = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-5, 0.0, 0.0));
  vec3 up = cross(right, uMoonDir);
  vec2 mp = vec2(dot(d, right), dot(d, up)) / MOON_R;
  float maria = dwFbm3(mp * 1.6 + vec2(3.1, 7.4));
  float limb = sqrt(max(0.0, 1.0 - dot(mp, mp)));
  vec3 face = vec3(0.92, 0.95, 1.0) * mix(0.62, 1.0, smoothstep(0.36, 0.6, maria)) * (0.7 + 0.3 * limb);
  // Seen in daylight the moon is a pale wash; at night it is the brightest thing in the sky, but
  // kept below the bloom threshold's blow-out so its face still reads.
  col = mix(col, face * mix(0.42, 0.62, uMoonLight), disk * mix(0.25, 1.0, uMoonLight));
  vec3 glow = vec3(0.55, 0.65, 1.0) * (pow(cm, 2500.0) * 0.25 + pow(cm, 60.0) * 0.1 + pow(cm, 6.0) * 0.05);
  return glow * uMoonLight;
}

vec4 highClouds(vec3 d) {
  if (d.y <= 0.0) return vec4(0.0);
  vec2 p = d.xz / (d.y + 0.12);
  vec2 w = uWindDir;
  vec2 q = vec2(dot(p, w), dot(p, vec2(-w.y, w.x)));
  // Cirrus: patches of fine fibres combed along the wind, with gentle bends.
  vec2 cq = q * vec2(0.8, 2.4) + vec2(uCloudOffset.x * 1.6, 0.0);
  cq.y += 0.45 * dwVnoise(cq * vec2(0.35, 0.5) + 3.0);
  float n = dwFbm5(cq * 0.7);
  float fibre = dwFbm3(vec2(cq.x * 0.9, cq.y * 6.5) + 11.0);
  float sheet = smoothstep(0.5 - 0.22 * uCirrus, 0.78 - 0.12 * uCirrus, n);
  float wisp = sheet * mix(0.35, 1.0, smoothstep(0.3, 0.75, fibre)) * (0.22 + 0.68 * uCirrus);
  // Overcast deck: broad billows that close up as cover rises.
  vec2 dq = q * 0.55 + vec2(uCloudOffset.x * 0.5, 4.0);
  float m = dwFbm5(dq);
  float cover = smoothstep(1.02 - uDeck, 1.25 - uDeck * 0.95, m + 0.12 * n) * smoothstep(0.0, 0.25, uDeck);
  // Wisps thin out toward the horizon; a closed deck runs right down to it.
  float a = max(wisp * 0.8 * smoothstep(0.0, 0.2, d.y), cover * smoothstep(-0.02, 0.08, d.y));
  float cs = max(dot(d, uTrueSunDir), 0.0);
  float sunUp = smoothstep(-0.25, 0.02, uTrueSunDir.y);
  vec3 lit = mix(uCloudShade, uCloudLit, 0.55 + 0.45 * smoothstep(0.4, 0.9, n));
  // Wisps near the sun catch its fire; at twilight they stay lit after the ground goes dark.
  lit += uHorizonSun * (pow(cs, 5.0) * 0.9 + 0.25 * (1.0 - d.y)) * uGlow * sunUp;
  // The deck's underside is darker where it is thickest.
  lit = mix(lit, uCloudShade * 0.95, cover * smoothstep(0.55, 1.0, m) * uDeck * 0.8);
  return vec4(lit, clamp(a, 0.0, 1.0));
}

vec3 haze(vec3 col, vec3 d) {
  // The world's height fog, integrated to infinity along the view ray: matches dwApplyFog.
  float b = uFogHeightFalloff;
  float a = uFogDensity * exp(-max(cameraPosition.y - uFogBaseY, 0.0) * b);
  float ry = max(d.y, 1e-4);
  float fog = 1.0 - exp(-a / (ry * b));
  float sunAmt = max(dot(d, uSunDir), 0.0);
  vec3 fogCol = mix(uFogColor, uFogSunColor, pow(sunAmt, 6.0) * (1.0 - 0.7 * uNight));
  return mix(col, fogCol, fog);
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col;
  if (d.y >= 0.0) {
    col = skyGradient(d);
    vec4 hc = highClouds(d);
    col += stars(d) * uStars * (1.0 - hc.a);
    vec3 moonGlow = moon(d, col);
    col = mix(col, hc.rgb, hc.a);
    col += moonGlow * (1.0 - 0.7 * hc.a);
    col = haze(col, d);
    // The sun disk punches through the haze (reddened by the palette) but not the deck.
    float cs = dot(d, uTrueSunDir);
    float ang = acos(clamp(cs, -1.0, 1.0));
    float aa = fwidth(ang) * 1.5 + 1e-5;
    float disk = smoothstep(SUN_R + aa, SUN_R - aa, ang);
    float low = mix(0.45, 1.0, smoothstep(0.0, 0.15, d.y));
    col += uSunDisk * disk * 9.0 * low * (1.0 - hc.a * 0.92);
  } else {
    // Below the horizon: the far cloud sea, flat-shaded like the mipmapped real one.
    float t = (uSeaY - cameraPosition.y) / d.y;
    if (t > 0.0) {
      vec3 hit = cameraPosition + d * min(t, 1e6);
      col = dwFarSea(hit, d) + dwFlashGlow(hit);
      col = dwApplyFog(col, hit, cameraPosition);
    } else {
      col = mix(uFogColor, uCloudShade, 0.4);
    }
  }
  // Distant lightning lights the sky around the strike.
  float fl = max(dot(d, uFlashDir), 0.0);
  col += vec3(0.7, 0.75, 1.0) * uFlash * (pow(fl, 10.0) * 1.4 + pow(fl, 2.0) * 0.12 + 0.03);
  gl_FragColor = vec4(col, 1.0);
}
`;

export interface DomeUniforms {
  uHorizonSun: { value: Color };
  uSunDisk: { value: Color };
  uBeltColor: { value: Color };
  uTrueSunDir: { value: Vector3 };
  uMoonDir: { value: Vector3 };
  uGlow: { value: number };
  uBelt: { value: number };
  uStars: { value: number };
  uMoonLight: { value: number };
  uCirrus: { value: number };
  uDeck: { value: number };
  uCloudOffset: { value: Vector2 };
  uWindDir: { value: Vector2 };
  uStarRot: { value: Matrix3 };
  uSeaY: { value: number };
  uSeaMean01: { value: number };
  uSeaTex: { value: Texture };
  uScrollMacro: { value: Vector2 };
  uFlashDir: { value: Vector3 };
  uCloudLit: { value: Color };
  uCloudShade: { value: Color };
  uFlashPos: { value: Vector3 };
  uFlash: { value: number };
  uCloudDirect: { value: number };
}

export class SkyDome {
  readonly mesh: Mesh;
  readonly uniforms: DomeUniforms;

  /** Cloud uniforms are shared with the cloud sea so both shade identically. */
  constructor(
    scene: Scene,
    shared: Pick<DomeUniforms, 'uCloudLit' | 'uCloudShade' | 'uFlashPos' | 'uFlash' | 'uCloudDirect' | 'uSeaTex' | 'uScrollMacro' | 'uSeaMean01'>,
  ) {
    this.uniforms = {
      uHorizonSun: { value: new Color() },
      uSunDisk: { value: new Color() },
      uBeltColor: { value: new Color() },
      uTrueSunDir: { value: new Vector3(0, 1, 0) },
      uMoonDir: { value: new Vector3(0, -1, 0) },
      uGlow: { value: 0 },
      uBelt: { value: 0 },
      uStars: { value: 0 },
      uMoonLight: { value: 0 },
      uCirrus: { value: 0.3 },
      uDeck: { value: 0 },
      uCloudOffset: { value: new Vector2() },
      uWindDir: { value: new Vector2(1, 0) },
      uStarRot: { value: new Matrix3() },
      uSeaY: { value: 0 },
      uFlashDir: { value: new Vector3(1, 0, 0) },
      ...shared,
    };
    const material = new ShaderMaterial({
      name: 'DriftwingSkyDome',
      side: BackSide,
      depthWrite: false,
      depthTest: true,
      uniforms: { ...globalUniforms, ...this.uniforms },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    });
    this.mesh = new Mesh(new SphereGeometry(1, 64, 32), material);
    this.mesh.name = 'skyDome';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);
  }
}
