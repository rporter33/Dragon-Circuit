// Leaves and petals drifting in the wind near vegetation. A small CPU-simulated population
// (cheap: ~150 bodies) spawns around the camera over wooded or flowering ground, rides the wind
// with gusts and a side-to-side flutter, tumbles, settles on the ground and fades. A wyvern
// passing close and fast blows them about.

import {
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
import type { IslandKind } from '../world/layout';
import { FX_COMMON_GLSL } from './shaders';

export interface DrifterIslandLookup {
  islandAt(x: number, z: number, fromY?: number): { def: { kind: IslandKind; trees: number; grass: number }; topHeight(x: number, z: number): number } | null;
}

const LEAF = 0;
const PETAL = 1;

const LEAF_COLORS: [number, number, number][] = [
  [0.42, 0.62, 0.2],
  [0.55, 0.7, 0.22],
  [0.78, 0.68, 0.22],
  [0.86, 0.5, 0.18],
  [0.35, 0.52, 0.18],
];
const PETAL_COLORS: [number, number, number][] = [
  [1.0, 0.82, 0.88],
  [1.0, 0.96, 0.9],
  [1.0, 0.86, 0.45],
  [0.86, 0.74, 1.0],
  [1.0, 0.7, 0.62],
];

const VERT = /* glsl */ `
${FX_COMMON_GLSL}
attribute vec4 aPose;  // xyz, tumble phase
attribute vec4 aLook;  // size, kind, alpha, yaw
attribute vec3 aColor;
varying vec2 vUv;
varying float vAlpha;
varying float vKind;
varying vec3 vColor;

void main() {
  vec4 mv = viewMatrix * vec4(aPose.xyz, 1.0);
  float size = aLook.x;
  // Tumbling: the card flips about its long axis (x scale = cos) while it turns.
  float flip = cos(aPose.w);
  float rot = aLook.w + aPose.w * 0.35;
  vec2 c = position.xy * vec2(max(abs(flip), 0.12), 1.0);
  float cs = cos(rot);
  float sn = sin(rot);
  mv.xy += vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;
  gl_Position = projectionMatrix * mv;
  // Front faces catch the sun, backs are a little darker and translucent-warm.
  vec3 base = aColor * (flip > 0.0 ? 1.0 : 0.78);
  vColor = dwApplyFog(fxLitDust(base, aPose.xyz) * 1.25, aPose.xyz, cameraPosition);
  vAlpha = aLook.z * smoothstep(0.4, 2.0, -mv.z);
  vKind = aLook.y;
  vUv = position.xy;
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
varying float vKind;
varying vec3 vColor;
void main() {
  vec2 p = vUv * 2.0; // -1..1
  float a;
  vec3 col = vColor;
  if (vKind < 0.5) {
    // Leaf: pointed ellipse with a midrib.
    float w = 0.62 * (1.0 - p.y * p.y) * (1.0 - 0.25 * p.y);
    a = 1.0 - smoothstep(w - 0.08, w + 0.02, abs(p.x));
    col *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.06, abs(p.x)));
  } else {
    // Petal: a rounded teardrop.
    vec2 q = vec2(p.x, p.y + 0.25);
    float w = 0.75 * sqrt(max(0.0, 1.0 - q.y * q.y * 0.7)) * (0.55 + 0.45 * smoothstep(-1.0, 0.6, q.y));
    a = (1.0 - smoothstep(w - 0.1, w + 0.02, abs(q.x))) * (1.0 - smoothstep(0.85, 1.0, abs(p.y)));
  }
  a *= vAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(col, a);
}
`;

export class Drifters {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  private geo: InstancedBufferGeometry;
  private aPose: InstancedBufferAttribute;
  private aLook: InstancedBufferAttribute;
  private aColor: InstancedBufferAttribute;
  private readonly cap: number;
  private target: number;
  private alive = 0;
  // Simulation state (structure of arrays).
  private px: Float32Array;
  private py: Float32Array;
  private pz: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private vz: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private ground: Float32Array;
  private phase: Float32Array;
  private spin: Float32Array;
  private kind: Uint8Array;
  private size: Float32Array;
  private settled: Float32Array;
  private rand = mulberry32(0x1eaf);
  private time = 0;
  /** Radius around the camera to spawn in (m). */
  radius = 30;

  constructor(scene: Scene, private terrain: DrifterIslandLookup, capacity = 220) {
    this.cap = capacity;
    this.target = capacity;
    const f = () => new Float32Array(capacity);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.age = f();
    this.life = f();
    this.ground = f();
    this.phase = f();
    this.spin = f();
    this.size = f();
    this.settled = f();
    this.kind = new Uint8Array(capacity);
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (n: number) => {
      const a = new InstancedBufferAttribute(new Float32Array(capacity * n), n);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.aPose = mk(4);
    this.aLook = mk(4);
    this.aColor = mk(3);
    geo.setAttribute('aPose', this.aPose);
    geo.setAttribute('aLook', this.aLook);
    geo.setAttribute('aColor', this.aColor);
    geo.instanceCount = 0;
    this.geo = geo;
    this.mat = new ShaderMaterial({
      uniforms: { ...globalUniforms, uPxScale: { value: 600 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.name = 'fx-drifters';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
  }

  setDensity(particles: number): void {
    this.target = Math.max(0, Math.min(this.cap, Math.round((this.cap * particles) / 1.4)));
  }

  get count(): number {
    return this.alive;
  }

  /** Try to spawn one drifter near the camera, mostly in the half it is looking at. */
  private spawn(cam: Vector3, fwd: Vector3): void {
    let a = this.rand() * Math.PI * 2;
    if (this.rand() < 0.7) a = Math.atan2(fwd.z, fwd.x) + (this.rand() - 0.5) * 2.2;
    const r = 3 + Math.pow(this.rand(), 0.8) * this.radius;
    const x = cam.x + Math.cos(a) * r;
    const z = cam.z + Math.sin(a) * r;
    const isl = this.terrain.islandAt(x, z, cam.y + 40);
    if (!isl) return;
    const d = isl.def;
    const leafy = d.kind === 'forest' || d.kind === 'grove' || d.trees > 0.35;
    const flowery = (d.kind === 'meadow' || d.kind === 'roost' || d.kind === 'cascade' || d.kind === 'ruin') && d.grass > 0.6;
    if (!leafy && !flowery) return;
    const gy = isl.topHeight(x, z);
    if (Math.abs(gy - cam.y) > 70) return;
    const k = leafy && (!flowery || this.rand() < 0.65) ? LEAF : PETAL;
    const i = this.alive++;
    this.px[i] = x;
    this.pz[i] = z;
    this.py[i] = gy + (k === LEAF ? 2.5 + this.rand() * 10 : 0.6 + this.rand() * 3.5);
    this.vx[i] = 0;
    this.vy[i] = 0;
    this.vz[i] = 0;
    this.ground[i] = gy;
    this.age[i] = 0;
    this.life[i] = 7 + this.rand() * 7;
    this.phase[i] = this.rand() * Math.PI * 2;
    this.spin[i] = (2.5 + this.rand() * 4) * (this.rand() < 0.5 ? -1 : 1);
    this.kind[i] = k;
    // Stylized: a little larger than life so they read at a glance.
    this.size[i] = k === LEAF ? 0.24 + this.rand() * 0.14 : 0.16 + this.rand() * 0.08;
    this.settled[i] = 0;
    const pal = k === LEAF ? LEAF_COLORS : PETAL_COLORS;
    const c = pal[Math.floor(this.rand() * pal.length)];
    const C = this.aColor.array as Float32Array;
    C[i * 3] = c[0];
    C[i * 3 + 1] = c[1];
    C[i * 3 + 2] = c[2];
    const L = this.aLook.array as Float32Array;
    L[i * 4 + 3] = this.rand() * Math.PI * 2;
  }

  /**
   * A burst of leaves shaken loose at (x, y, z) — a wyvern brushing through a canopy. They scatter
   * from `vel` (the brusher's velocity, partly carried) and then flutter down with the wind.
   * Returns how many were spawned (capacity permitting).
   */
  burst(x: number, y: number, z: number, vx: number, vy: number, vz: number, count: number): number {
    const isl = this.terrain.islandAt(x, z, y + 5);
    const gy = isl ? Math.min(y - 0.5, isl.topHeight(x, z)) : y - 40;
    let n = 0;
    for (; n < count && this.alive < this.cap; n++) {
      const i = this.alive++;
      const a = this.rand() * Math.PI * 2;
      const up = this.rand();
      const sp = 2 + this.rand() * 5;
      this.px[i] = x + (this.rand() - 0.5) * 3;
      this.py[i] = y + (this.rand() - 0.5) * 2;
      this.pz[i] = z + (this.rand() - 0.5) * 3;
      this.vx[i] = vx * 0.3 + Math.cos(a) * sp;
      this.vy[i] = vy * 0.2 + 1.5 + up * 3;
      this.vz[i] = vz * 0.3 + Math.sin(a) * sp;
      this.ground[i] = gy;
      this.age[i] = 0.6; // skip most of the fade-in: they're torn off, not appearing
      this.life[i] = 4 + this.rand() * 4;
      this.phase[i] = this.rand() * Math.PI * 2;
      this.spin[i] = (4 + this.rand() * 6) * (this.rand() < 0.5 ? -1 : 1);
      this.kind[i] = LEAF;
      this.size[i] = 0.22 + this.rand() * 0.16;
      this.settled[i] = 0;
      const c = LEAF_COLORS[Math.floor(this.rand() * LEAF_COLORS.length)];
      const C = this.aColor.array as Float32Array;
      C[i * 3] = c[0];
      C[i * 3 + 1] = c[1];
      C[i * 3 + 2] = c[2];
      const L = this.aLook.array as Float32Array;
      L[i * 4 + 3] = this.rand() * Math.PI * 2;
    }
    return n;
  }

  private kill(i: number): void {
    // Swap-remove with the last live drifter.
    const j = --this.alive;
    if (i === j) return;
    this.px[i] = this.px[j];
    this.py[i] = this.py[j];
    this.pz[i] = this.pz[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.vz[i] = this.vz[j];
    this.age[i] = this.age[j];
    this.life[i] = this.life[j];
    this.ground[i] = this.ground[j];
    this.phase[i] = this.phase[j];
    this.spin[i] = this.spin[j];
    this.kind[i] = this.kind[j];
    this.size[i] = this.size[j];
    this.settled[i] = this.settled[j];
    const C = this.aColor.array as Float32Array;
    C[i * 3] = C[j * 3];
    C[i * 3 + 1] = C[j * 3 + 1];
    C[i * 3 + 2] = C[j * 3 + 2];
    const L = this.aLook.array as Float32Array;
    L[i * 4 + 3] = L[j * 4 + 3];
  }

  /**
   * `wind` is the world wind (m/s). `body`/`bodyVel` is the wyvern, which blows nearby drifters
   * aside when it passes fast.
   */
  update(dt: number, cam: Vector3, camFwd: Vector3, wind: Vector3, gust: number, body: Vector3, bodyVel: Vector3, enabled: boolean): void {
    this.time += dt;
    if (dt <= 0) return;
    // Spawn a few per frame toward the target population.
    if (enabled) {
      for (let n = 0; n < 4 && this.alive < this.target; n++) this.spawn(cam, camFwd);
    }
    const bodySpeed = bodyVel.length();
    const R2 = (this.radius + 25) * (this.radius + 25);
    for (let i = this.alive - 1; i >= 0; i--) {
      this.age[i] += dt;
      const dx = this.px[i] - cam.x;
      const dz = this.pz[i] - cam.z;
      if (this.age[i] > this.life[i] || dx * dx + dz * dz > R2 || (!enabled && this.settled[i] === 0 && this.age[i] > 1)) {
        this.kill(i);
        continue;
      }
      if (this.settled[i] > 0) {
        this.settled[i] += dt;
        continue;
      }
      const leaf = this.kind[i] === LEAF;
      const t = this.time + i * 1.7;
      // Gusty wind plus a lazy side-to-side flutter across it.
      const g = 0.75 + 0.5 * gust + 0.3 * Math.sin(t * 0.9);
      const flutter = Math.sin(t * (leaf ? 2.2 : 3.1)) * (leaf ? 0.9 : 0.6);
      const wl = Math.hypot(wind.x, wind.z) || 1;
      const tx = wind.x * 0.85 * g - (wind.z / wl) * flutter;
      const tz = wind.z * 0.85 * g + (wind.x / wl) * flutter;
      const ty = -(leaf ? 0.55 : 0.32) + Math.sin(t * 1.3) * 0.35;
      const k = 1 - Math.exp(-1.6 * dt);
      this.vx[i] += (tx - this.vx[i]) * k;
      this.vy[i] += (ty - this.vy[i]) * k;
      this.vz[i] += (tz - this.vz[i]) * k;
      // Wake of a passing wyvern.
      if (bodySpeed > 8) {
        const bx = this.px[i] - body.x;
        const by = this.py[i] - body.y;
        const bz = this.pz[i] - body.z;
        const d2 = bx * bx + by * by + bz * bz;
        if (d2 < 100) {
          const s = ((1 - d2 / 100) * bodySpeed * 0.9 * dt) / Math.sqrt(d2 + 0.5);
          this.vx[i] += bx * s + bodyVel.x * 0.04;
          this.vy[i] += Math.abs(by) * s + 1.5 * s;
          this.vz[i] += bz * s + bodyVel.z * 0.04;
        }
      }
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.phase[i] += this.spin[i] * dt;
      if (this.py[i] < this.ground[i] + 0.04) {
        this.py[i] = this.ground[i] + 0.04;
        this.settled[i] = 1e-3;
        this.life[i] = Math.min(this.life[i], this.age[i] + 2.5);
      }
    }
    this.upload();
  }

  private upload(): void {
    const P = this.aPose.array as Float32Array;
    const L = this.aLook.array as Float32Array;
    const n = this.alive;
    for (let i = 0; i < n; i++) {
      P[i * 4] = this.px[i];
      P[i * 4 + 1] = this.py[i];
      P[i * 4 + 2] = this.pz[i];
      // Settled ones lie flat-ish: stop the tumble mid-flip.
      P[i * 4 + 3] = this.settled[i] > 0 ? Math.PI * 0.5 - 0.35 : this.phase[i];
      L[i * 4] = this.size[i];
      L[i * 4 + 1] = this.kind[i];
      const fadeIn = Math.min(1, this.age[i] / 0.8);
      const fadeOut = Math.min(1, (this.life[i] - this.age[i]) / 1.5);
      L[i * 4 + 2] = Math.max(0, Math.min(fadeIn, fadeOut));
    }
    for (const a of [this.aPose, this.aLook, this.aColor]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, n) * a.itemSize);
      a.needsUpdate = true;
    }
    this.geo.instanceCount = n;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
