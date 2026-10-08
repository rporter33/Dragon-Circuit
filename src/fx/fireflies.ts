// Fireflies over the islands at night. A fixed swarm is "homed" on island ground around the
// camera (a few re-homed per frame as you move, so the CPU cost is bounded); the shader makes each
// one wander lazily around its home and blink. They fade in with uNight and bloom softly.

import {
  AdditiveBlending,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  type Scene,
} from 'three';
import { globalUniforms } from '../render/uniforms';
import { mulberry32 } from '../core/rng';
import type { IslandKind } from '../world/layout';
import { FX_COMMON_GLSL } from './shaders';

/** What the swarm needs from the terrain (Terrain implements it). */
export interface IslandLookup {
  islandAt(x: number, z: number, fromY?: number): { def: { kind: IslandKind }; topHeight(x: number, z: number): number } | null;
}

/** How welcoming each island kind is to fireflies (0..1). */
const KIND_WEIGHT: Record<IslandKind, number> = {
  grove: 1,
  forest: 0.95,
  meadow: 0.85,
  roost: 0.6,
  cascade: 0.8,
  ruin: 0.6,
  plateau: 0.3,
  rocky: 0.25,
  islet: 0.4,
};

const VERT = /* glsl */ `
${FX_COMMON_GLSL}
attribute vec4 aHome; // xyz, seed (negative = unused)
uniform float uNow;
uniform float uFade;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;

void main() {
  if (aHome.w < 0.0 || uFade <= 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float s = aHome.w;
  float t = uNow * (0.6 + 0.5 * s) + s * 91.0;
  vec3 wander = vec3(
    sin(t * 0.53) * 1.7 + sin(t * 1.37 + 2.0) * 0.45,
    sin(t * 0.41 + 1.0) * 0.6 + sin(t * 1.9) * 0.15,
    cos(t * 0.47) * 1.7 + cos(t * 1.21 + 4.0) * 0.45);
  vec3 wp = aHome.xyz + wander;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float size = 0.55;
  float px = size * uPxScale / max(-mv.z, 0.1);
  float grow = px < 3.0 ? 3.0 / max(px, 1e-3) : 1.0;
  mv.xy += position.xy * size * grow;
  gl_Position = projectionMatrix * mv;
  // Slow pulses: mostly dim, then a warm flash every few seconds.
  float pulse = smoothstep(0.55, 1.0, sin(uNow * (0.9 + 0.8 * s) + s * 37.0));
  float glow = 0.18 + 0.82 * pulse;
  vAlpha = uFade * glow * fxFogTransmittance(wp) * smoothstep(1.0, 4.0, -mv.z) / (grow * grow);
  // Mostly yellow-green; a few cooler blue-green ones.
  vColor = mix(vec3(0.85, 1.0, 0.35), vec3(0.45, 1.0, 0.85), step(0.82, fract(s * 13.7))) * 2.6;
  vUv = position.xy;
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
void main() {
  float r = length(vUv * 2.0);
  // Hot core + wide soft halo.
  float a = (exp(-r * r * 40.0) * 1.6 + exp(-r * r * 5.0) * 0.35) * (1.0 - smoothstep(0.8, 1.0, r)) * vAlpha;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor * a, a);
}
`;

export class Fireflies {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  private geo: InstancedBufferGeometry;
  private homes: InstancedBufferAttribute;
  private readonly count: number;
  private active: number;
  private cursor = 0;
  private now = 0;
  private rand = mulberry32(0xf1f1);
  /** Radius around the camera the swarm is spread over (m). */
  radius = 70;

  constructor(scene: Scene, private terrain: IslandLookup, count = 280) {
    this.count = count;
    this.active = count;
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const homes = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) homes[i * 4 + 3] = -1;
    this.homes = new InstancedBufferAttribute(homes, 4);
    this.homes.setUsage(DynamicDrawUsage);
    geo.setAttribute('aHome', this.homes);
    geo.instanceCount = count;
    this.geo = geo;
    this.mat = new ShaderMaterial({
      uniforms: { ...globalUniforms, uPxScale: { value: 600 }, uNow: { value: 0 }, uFade: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.name = 'fx-fireflies';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  setDensity(particles: number): void {
    this.active = Math.max(8, Math.min(this.count, Math.round((this.count * particles) / 1.4)));
    this.geo.instanceCount = this.active;
  }

  setPxScale(v: number): void {
    this.mat.uniforms.uPxScale.value = v;
  }

  /** Visible fireflies (homed), for tests/debug. */
  get homed(): number {
    const H = this.homes.array as Float32Array;
    let n = 0;
    for (let i = 0; i < this.active; i++) if (H[i * 4 + 3] >= 0) n++;
    return n;
  }

  /**
   * `night` 0..1. `budget` = how many fireflies may be re-homed this frame (each costs one
   * terrain lookup).
   */
  update(dt: number, cam: { x: number; y: number; z: number }, night: number, budget = 14): void {
    this.now += dt;
    const fade = Math.max(0, Math.min(1, (night - 0.3) / 0.4));
    this.mat.uniforms.uNow.value = this.now;
    this.mat.uniforms.uFade.value = fade;
    this.mesh.visible = fade > 0.001;
    if (!this.mesh.visible) return;
    const H = this.homes.array as Float32Array;
    const R = this.radius;
    let lo = Infinity;
    let hi = -1;
    for (let n = 0; n < budget; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.active;
      const hx = H[i * 4];
      const hz = H[i * 4 + 2];
      const used = H[i * 4 + 3] >= 0;
      if (used && Math.hypot(hx - cam.x, hz - cam.z) < R && Math.abs(H[i * 4 + 1] - cam.y) < 90) continue;
      // Re-home somewhere on the ground around the camera.
      const a = this.rand() * Math.PI * 2;
      const r = Math.sqrt(this.rand()) * R;
      const x = cam.x + Math.cos(a) * r;
      const z = cam.z + Math.sin(a) * r;
      const isl = this.terrain.islandAt(x, z, cam.y + 60);
      let ok = false;
      if (isl && this.rand() < KIND_WEIGHT[isl.def.kind]) {
        const gy = isl.topHeight(x, z);
        if (Math.abs(gy - cam.y) < 90) {
          H[i * 4] = x;
          H[i * 4 + 1] = gy + 0.6 + this.rand() * this.rand() * 3.5;
          H[i * 4 + 2] = z;
          H[i * 4 + 3] = this.rand();
          ok = true;
        }
      }
      if (!ok) H[i * 4 + 3] = -1;
      if (i < lo) lo = i;
      if (i > hi) hi = i;
    }
    if (hi >= 0) {
      this.homes.clearUpdateRanges();
      this.homes.addUpdateRange(lo * 4, (hi - lo + 1) * 4);
      this.homes.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
