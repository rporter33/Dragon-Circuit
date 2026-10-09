// The launch-wind gust at the end of the Roost's launch deck: ribbons of air flowing off the end
// of the deck and curling up over the cliff edge — a visible invitation to run and jump. Purely
// analytic and looping in the vertex shader; drawn only when the camera is within range.

import {
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Vector3,
  type Scene,
} from 'three';
import { globalUniforms } from '../render/uniforms';
import { mulberry32 } from '../core/rng';
import { smoothstep } from '../core/math';
import { FX_COMMON_GLSL } from './shaders';

const VERT = /* glsl */ `
${FX_COMMON_GLSL}
attribute vec4 aSeed;
uniform vec3 uOrigin;
uniform vec3 uDir;
uniform float uNow;
uniform float uAmount;
uniform float uHalfWidth;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
varying float vSeed;

vec3 pathAt(float s, vec4 seed, vec3 side) {
  // Out along the deck, then lifting ever more steeply past the end (the updraft at the rim).
  float past = max(s, 0.0);
  float lift = past * past * 0.016 + seed.y * 2.6 + 0.5;
  float lateral = (seed.z - 0.5) * 2.0 * uHalfWidth * (1.0 + past * 0.03);
  float wave = sin(s * 0.35 + seed.x * 40.0 + uNow * 1.3) * (0.25 + past * 0.03);
  return uOrigin + uDir * s + vec3(0.0, lift + wave * 0.5, 0.0) + side * (lateral + wave);
}

void main() {
  float ph = fract(uNow * (0.16 + 0.08 * aSeed.w) + aSeed.x);
  vec3 side = normalize(vec3(uDir.z, 0.0, -uDir.x));
  float s = ph * 46.0 - 14.0;
  float len = 3.0 + aSeed.w * 4.0;
  // position.y in [-0.5, 0.5] → along the streak (tail .. head), sampled on the curved path.
  float u = position.y + 0.5;
  vec3 p = pathAt(s - (1.0 - u) * len, aSeed, side);
  vec3 ahead = pathAt(s - (1.0 - u) * len + 0.5, aSeed, side);
  vec3 tan = normalize(ahead - p);
  vec3 viewV = normalize(p - cameraPosition);
  vec3 w = cross(tan, viewV);
  float wl = length(w);
  w = wl > 1e-4 ? w / wl : vec3(0.0, 1.0, 0.0);
  // Fine ribbons of moving air, tapered to points at both ends. At least ~1.5 px wide; lines
  // thinner than that widen and fade instead of aliasing away.
  float width = (0.08 + 0.07 * aSeed.y) * sin(u * 3.14159);
  float dist = length(p - cameraPosition);
  float minW = 1.5 * dist / uPxScale;
  float thin = min(1.0, width / max(minW, 1e-4));
  p += w * position.x * max(width, minW * sin(u * 3.14159));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  float life = sin(ph * 3.14159);
  // Never a plank across the lens: fade out close to the camera.
  float nearFade = smoothstep(3.0, 12.0, dist);
  vAlpha = 0.8 * uAmount * pow(life, 1.4) * thin * nearFade * fxFogTransmittance(p);
  // A touch of sky blue so the lines still read against white cloud.
  vec3 tint = mix(vec3(1.0), normalize(uSkyZenith + 0.05) * 1.2, 0.35);
  vColor = dwApplyFog(fxLitDust(tint, p) * 1.3, p, cameraPosition);
  vUv = vec2(position.x * 2.0, u);
  vSeed = aSeed.x * 53.0;
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
varying float vSeed;
void main() {
  float across = 1.0 - abs(vUv.x);
  float along = smoothstep(0.0, 0.5, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
  // A dry brush stroke: bright core, cooler and darker edges (reads on white cloud and on blue
  // sky alike), and the paint breaking up along its length.
  float brush = 0.5 + 0.5 * sin(vUv.y * 23.0 + vSeed) * sin(vUv.y * 9.0 + vSeed * 0.7);
  vec3 col = mix(vColor * vec3(0.7, 0.78, 0.92), vColor, smoothstep(0.25, 0.75, across));
  float a = smoothstep(0.0, 0.9, across) * along * (0.45 + 0.55 * smoothstep(0.15, 0.8, brush)) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}
`;

export interface DeckEnd {
  /** Center of the deck's outer end, on its surface. */
  x: number;
  y: number;
  z: number;
  /** Outward direction (horizontal unit vector). */
  dirX: number;
  dirZ: number;
  halfWidth: number;
}

export class LaunchGust {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  private now = 0;
  private origin = new Vector3();

  constructor(scene: Scene, private deck: DeckEnd, count = 60) {
    const geo = new InstancedBufferGeometry();
    // A strip of 8 segments along the streak so it can follow the curve.
    const pos: number[] = [];
    const idx: number[] = [];
    const segs = 8;
    for (let i = 0; i <= segs; i++) {
      const y = i / segs - 0.5;
      pos.push(-0.5, y, 0, 0.5, y, 0);
      if (i < segs) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const rand = mulberry32(0x6a57);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
    const a = new InstancedBufferAttribute(seeds, 4);
    a.setUsage(DynamicDrawUsage);
    geo.setAttribute('aSeed', a);
    geo.instanceCount = count;
    this.origin.set(deck.x, deck.y + 0.2, deck.z);
    this.mat = new ShaderMaterial({
      uniforms: {
        ...globalUniforms,
        uPxScale: { value: 600 },
        uOrigin: { value: this.origin },
        uDir: { value: new Vector3(deck.dirX, 0, deck.dirZ).normalize() },
        uNow: { value: 0 },
        uAmount: { value: 0 },
        uHalfWidth: { value: deck.halfWidth },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      // Built from cross products, so the winding can face either way.
      side: DoubleSide,
      blending: NormalBlending,
    });
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.name = 'fx-launch-gust';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
  }

  setPxScale(v: number): void {
    this.mat.uniforms.uPxScale.value = v;
  }

  update(dt: number, cam: Vector3, strength = 1): void {
    this.now += dt;
    const d = cam.distanceTo(this.origin);
    const amount = strength * (1 - smoothstep(180, 320, d));
    this.mat.uniforms.uNow.value = this.now;
    this.mat.uniforms.uAmount.value = amount;
    this.mesh.visible = amount > 0.003;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
