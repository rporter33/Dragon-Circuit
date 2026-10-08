// Expanding shockwave rings (ring passed, relic found): a soft glowing annulus in a given plane
// that races outward, thins and fades. A tiny pool of instanced quads; motion is analytic.

import {
  CustomBlending,
  DoubleSide,
  OneFactor,
  OneMinusSrcAlphaFactor,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  type Scene,
} from 'three';
import { globalUniforms } from '../render/uniforms';
import { FX_COMMON_GLSL } from './shaders';

const VERT = /* glsl */ `
${FX_COMMON_GLSL}
attribute vec3 aCenter;
attribute vec3 aNormal;
attribute vec4 aParams; // birth, life, r0, r1
attribute vec4 aColor;  // rgb, intensity
uniform float uNow;
varying vec2 vUv;
varying float vT;
varying vec4 vColor;

void main() {
  float age = uNow - aParams.x;
  float t = age / aParams.y;
  if (t < 0.0 || t >= 1.0 || aColor.a <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 n = normalize(aNormal);
  vec3 h = abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 u = normalize(cross(h, n));
  vec3 v = cross(n, u);
  float e = 1.0 - pow(1.0 - t, 3.0);
  float r = mix(aParams.z, aParams.w, e);
  vec3 wp = aCenter + (u * position.x + v * position.y) * r * 1.25;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  vUv = position.xy * 1.25;
  vT = t;
  vColor = vec4(aColor.rgb, aColor.a * fxFogTransmittance(aCenter));
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying float vT;
varying vec4 vColor;
void main() {
  float r = length(vUv);
  float w = mix(0.1, 0.03, vT);
  float ring = exp(-pow((r - 1.0) / w, 2.0));
  // A faint inner fill early on, like a flash of air.
  float fill = (1.0 - smoothstep(0.0, 1.0, r)) * 0.18 * (1.0 - smoothstep(0.0, 0.35, vT));
  float a = (ring + fill) * pow(1.0 - vT, 1.5) * vColor.a;
  if (a < 0.002) discard;
  // Premultiplied, partly occluding: stays golden over a bright sky.
  gl_FragColor = vec4(vColor.rgb * a, a * 0.45);
}
`;

export class ShockRings {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  private aCenter: InstancedBufferAttribute;
  private aNormal: InstancedBufferAttribute;
  private aParams: InstancedBufferAttribute;
  private aColor: InstancedBufferAttribute;
  private next = 0;
  private readonly cap: number;
  now = 0;

  constructor(scene: Scene, capacity = 8) {
    this.cap = capacity;
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (n: number) => {
      const a = new InstancedBufferAttribute(new Float32Array(capacity * n), n);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.aCenter = mk(3);
    this.aNormal = mk(3);
    this.aParams = mk(4);
    this.aColor = mk(4);
    geo.setAttribute('aCenter', this.aCenter);
    geo.setAttribute('aNormal', this.aNormal);
    geo.setAttribute('aParams', this.aParams);
    geo.setAttribute('aColor', this.aColor);
    geo.instanceCount = capacity;
    this.mat = new ShaderMaterial({
      uniforms: { ...globalUniforms, uPxScale: { value: 600 }, uNow: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      side: DoubleSide,
    });
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.name = 'fx-shock-rings';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    scene.add(this.mesh);
  }

  spawn(x: number, y: number, z: number, nx: number, ny: number, nz: number, r0: number, r1: number, life: number, r: number, g: number, b: number, intensity: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    (this.aCenter.array as Float32Array).set([x, y, z], i * 3);
    (this.aNormal.array as Float32Array).set([nx, ny, nz], i * 3);
    (this.aParams.array as Float32Array).set([this.now, life, r0, r1], i * 4);
    (this.aColor.array as Float32Array).set([r, g, b, intensity], i * 4);
    for (const a of [this.aCenter, this.aNormal, this.aParams, this.aColor]) a.needsUpdate = true;
  }

  update(dt: number): void {
    this.now += dt;
    this.mat.uniforms.uNow.value = this.now;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
