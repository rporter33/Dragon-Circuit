// Air streaks around the camera: thin speed lines at high speed and big soft cloud wisps tearing
// past. A fixed population lives in a box that travels with the camera; each streak sits still in
// the AIR (it drifts with the wind), and wraps to the far side of the box when it leaves, so the
// effect costs one uniform update per frame. Streaks are stretched along the air-relative
// velocity, fade near the box faces, near the camera and in the middle of the view (where the
// wyvern is).

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
import { FX_COMMON_GLSL, FX_NOISE_GLSL } from './shaders';

const VERT = /* glsl */ `
${FX_COMMON_GLSL}
attribute vec4 aSeed;
uniform vec3 uCenter;
uniform vec3 uTravel;
uniform vec3 uDir;
uniform float uSpeed;
uniform float uAmount;
uniform float uBox;
uniform float uLenTime;
uniform float uWidth;
uniform float uNearFade;
uniform float uCenterFade;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
varying vec3 vColor;

void main() {
  vec3 local = mod(aSeed.xyz * uBox - uTravel, uBox) - 0.5 * uBox;
  vec3 wp = uCenter + local;
  float len = max(uSpeed * uLenTime * (0.55 + 0.9 * aSeed.w), 0.5);
  vec3 viewV = normalize(wp - cameraPosition);
  vec3 side = cross(uDir, viewV);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  float width = uWidth * (0.55 + 0.9 * fract(aSeed.w * 7.31));
  // position.y in [-0.5, 0.5]: +0.5 = head (leading), -0.5 = tail.
  vec3 p = wp + uDir * len * (position.y - 0.5) + side * position.x * width;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);

  float edge = max(max(abs(local.x), abs(local.y)), abs(local.z)) / (0.5 * uBox);
  float boxFade = 1.0 - smoothstep(0.65, 0.98, edge);
  float nearFade = smoothstep(uNearFade, uNearFade * 2.5, length(local));
  vec4 clip = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  float centerFade = 1.0;
  if (clip.w > 0.0) centerFade = smoothstep(uCenterFade, uCenterFade + 0.45, length(clip.xy / clip.w));
  vAlpha = uAmount * boxFade * nearFade * centerFade * fxFogTransmittance(wp);
  vColor = dwApplyFog(fxLitDust(vec3(1.0), wp) * 1.35, wp, cameraPosition);
  vUv = vec2(position.x * 2.0, position.y + 0.5);
  vSeed = aSeed.w;
}
`;

const FRAG_LINE = /* glsl */ `
${FX_COMMON_GLSL}
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
varying vec3 vColor;
void main() {
  float across = 1.0 - abs(vUv.x);
  across *= across;
  // Bright, sharp head; long fading tail.
  float along = (1.0 - smoothstep(0.9, 1.0, vUv.y)) * pow(vUv.y, 1.6);
  float a = across * along * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor, a);
}
`;

const FRAG_WISP = /* glsl */ `
${FX_COMMON_GLSL}
${FX_NOISE_GLSL}
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
varying vec3 vColor;
void main() {
  // A torn, streaky tuft of cloud: soft ellipse, broken by stretched noise.
  vec2 q = vec2(vUv.x, vUv.y * 2.0 - 1.0);
  float r = length(q * vec2(1.0, 1.0));
  float n = fxNoise(vec2(vUv.x * 3.0 + vSeed * 31.0, vUv.y * 9.0 + vSeed * 7.0)) * 0.6
          + fxNoise(vec2(vUv.x * 7.0 - vSeed * 13.0, vUv.y * 21.0)) * 0.4;
  float a = (1.0 - smoothstep(0.25 + 0.3 * n, 1.0, r)) * (0.55 + 0.45 * n) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor, a);
}
`;

export interface StreakOptions {
  name: string;
  /** Max population (quality scales the drawn count). */
  count: number;
  /** Edge of the wrap box (m). */
  box: number;
  /** Streak length in seconds of travel. */
  lenTime: number;
  /** Streak width (m). */
  width: number;
  /** Fade-in distance from the camera (m). */
  nearFade: number;
  /** NDC radius around the screen center kept clear. */
  centerFade: number;
  wisp: boolean;
  seed: number;
}

export class AirStreaks {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  private geo: InstancedBufferGeometry;
  private travel = new Vector3();
  private readonly box: number;
  private readonly count: number;

  constructor(scene: Scene, o: StreakOptions) {
    this.box = o.box;
    this.count = o.count;
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const rand = mulberry32(o.seed);
    const seeds = new Float32Array(o.count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
    const a = new InstancedBufferAttribute(seeds, 4);
    a.setUsage(DynamicDrawUsage);
    geo.setAttribute('aSeed', a);
    geo.instanceCount = o.count;
    this.geo = geo;
    this.mat = new ShaderMaterial({
      uniforms: {
        ...globalUniforms,
        uPxScale: { value: 600 },
        uCenter: { value: new Vector3() },
        uTravel: { value: this.travel },
        uDir: { value: new Vector3(0, 0, 1) },
        uSpeed: { value: 0 },
        uAmount: { value: 0 },
        uBox: { value: o.box },
        uLenTime: { value: o.lenTime },
        uWidth: { value: o.width },
        uNearFade: { value: o.nearFade },
        uCenterFade: { value: o.centerFade },
      },
      vertexShader: VERT,
      fragmentShader: o.wisp ? FRAG_WISP : FRAG_LINE,
      transparent: true,
      depthWrite: false,
      // Built from cross products, so the winding can face either way.
      side: DoubleSide,
      blending: NormalBlending,
    });
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.name = o.name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /**
   * `airVel` is the camera's velocity relative to the air (m/s, world). `amount` 0..1 fades the
   * whole effect; at 0 the mesh is hidden.
   */
  update(dt: number, camPos: Vector3, airVel: Vector3, amount: number): void {
    const speed = airVel.length();
    const u = this.mat.uniforms;
    this.travel.addScaledVector(airVel, dt);
    // Exact: the shader's wrap is periodic in travel with period `box`.
    const b = this.box;
    this.travel.set(this.travel.x - b * Math.floor(this.travel.x / b), this.travel.y - b * Math.floor(this.travel.y / b), this.travel.z - b * Math.floor(this.travel.z / b));
    this.mesh.visible = amount > 0.003 && speed > 1;
    if (!this.mesh.visible) return;
    u.uCenter.value.copy(camPos);
    u.uDir.value.copy(airVel).multiplyScalar(1 / speed);
    u.uSpeed.value = speed;
    u.uAmount.value = amount;
  }

  setPxScale(v: number): void {
    this.mat.uniforms.uPxScale.value = v;
  }

  setDensity(particles: number): void {
    this.geo.instanceCount = Math.max(1, Math.min(this.count, Math.round((this.count * particles) / 1.4)));
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
