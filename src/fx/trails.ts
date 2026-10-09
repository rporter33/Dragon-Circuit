// Wingtip vortex ribbons. Each wingtip leaves a ribbon of recent tip positions; the head follows
// the tip every frame and a new sample is committed every `spacing` meters. The shader twists
// each sample around the ribbon's axis as it ages (the vortex core corkscrewing), widens and
// sinks it, and fades it out, so the trail reads as a curling thread of condensed air rather
// than a flat stripe.

import {
  DoubleSide,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Vector3,
  type Scene,
} from 'three';
import { globalUniforms } from '../render/uniforms';
import { FX_COMMON_GLSL, FX_NOISE_GLSL } from './shaders';

const VERT = /* glsl */ `
${FX_COMMON_GLSL}
attribute vec3 aTangent;
attribute vec4 aData; // side (-1/1), birth, intensity, spin phase
uniform float uNow;
uniform float uLife;
uniform float uWidth;
uniform float uCurl;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;

void main() {
  float age = max(uNow - aData.y, 0.0);
  float t = clamp(age / uLife, 0.0, 1.0);
  vec3 tan = aTangent;
  float tl = length(tan);
  tan = tl > 1e-4 ? tan / tl : vec3(0.0, 0.0, 1.0);
  vec3 up = abs(tan.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 b1 = normalize(cross(tan, up));
  vec3 b2 = cross(tan, b1);
  float ph = age * 11.0 + aData.w;
  float rad = uCurl * (0.08 + 0.9 * t);
  vec3 wp = position + (cos(ph) * b1 + sin(ph) * b2) * rad + vec3(0.0, -0.9 * age, 0.0);
  vec3 viewV = normalize(wp - cameraPosition);
  vec3 side = cross(tan, viewV);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : b1;
  // Strong samples (a wingbeat's burst) roll up into a thicker vortex.
  float w = uWidth * (0.45 + 2.4 * t) * (0.7 + 0.6 * clamp(aData.z, 0.0, 1.0));
  float minW = 2.0 * length(wp - cameraPosition) / uPxScale;
  float thin = min(1.0, w / max(minW, 1e-4));
  wp += side * aData.x * max(w, minW);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  // Fade in over the first few centimeters so the ribbon grows out of the tip, out with age.
  float a = aData.z * smoothstep(0.0, 0.03, age) * pow(1.0 - t, 1.7) * thin;
  vAlpha = a * fxFogTransmittance(wp);
  vColor = dwApplyFog(fxLitDust(vec3(1.0), wp) * 1.2, wp, cameraPosition);
  vUv = vec2(aData.x, aData.y * 23.0);
}
`;

const FRAG = /* glsl */ `
${FX_COMMON_GLSL}
${FX_NOISE_GLSL}
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
void main() {
  float across = 1.0 - vUv.x * vUv.x;
  // Streaky along the ribbon, pinned to the air (birth time), so it shears like real vapor.
  float n = fxNoise(vec2(vUv.y, vUv.x * 1.7 + 3.0)) * 0.65 + 0.35;
  // Cooler, darker edges (the shaded side of the rolled-up vapor): the thread still reads
  // against bright cloud, golden-hour peach included.
  vec3 col = mix(vColor * vec3(0.5, 0.58, 0.78), vColor, smoothstep(0.45, 0.9, across));
  float a = smoothstep(0.0, 0.5, across) * n * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}
`;

class Ribbon {
  readonly mesh: Mesh;
  private pos: Float32Array;
  private birth: Float32Array;
  private inten: Float32Array;
  private count = 0;
  private aPosition: BufferAttribute;
  private aTangent: BufferAttribute;
  private aData: BufferAttribute;
  private readonly n: number;
  private readonly spin: number;

  constructor(n: number, mat: ShaderMaterial, spin: number, name: string) {
    this.n = n;
    this.spin = spin;
    this.pos = new Float32Array(n * 3);
    this.birth = new Float32Array(n);
    this.inten = new Float32Array(n);
    const geo = new BufferGeometry();
    this.aPosition = new BufferAttribute(new Float32Array(n * 2 * 3), 3);
    this.aTangent = new BufferAttribute(new Float32Array(n * 2 * 3), 3);
    this.aData = new BufferAttribute(new Float32Array(n * 2 * 4), 4);
    for (const a of [this.aPosition, this.aTangent, this.aData]) a.setUsage(DynamicDrawUsage);
    geo.setAttribute('position', this.aPosition);
    geo.setAttribute('aTangent', this.aTangent);
    geo.setAttribute('aData', this.aData);
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    this.mesh = new Mesh(geo, mat);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
  }

  /** Clear the trail (teleports, mode changes). */
  reset(): void {
    this.count = 0;
    this.mesh.geometry.setDrawRange(0, 0);
  }

  /** Shift every sample's birth time (the clock wrapped, see WingTrails.wrapTime). */
  shiftBirth(by: number): void {
    for (let i = 0; i < this.n; i++) this.birth[i] -= by;
  }

  /**
   * Move the head to `tip`; commit it as a new sample once it is `spacing` from the previous
   * one. `intensity` is stored per sample, so the trail keeps its history as you slow down.
   */
  push(tip: Vector3, now: number, intensity: number, spacing: number): void {
    const P = this.pos;
    if (this.count === 0) {
      for (let k = 0; k < 2; k++) {
        P[k * 3] = tip.x;
        P[k * 3 + 1] = tip.y;
        P[k * 3 + 2] = tip.z;
        this.birth[k] = now;
        this.inten[k] = intensity;
      }
      this.count = 2;
    }
    const dx = tip.x - P[3];
    const dy = tip.y - P[4];
    const dz = tip.z - P[5];
    if (dx * dx + dy * dy + dz * dz > spacing * spacing) {
      // Commit: shift everything one slot older; slot 0 becomes the new head.
      P.copyWithin(3, 0, (this.n - 1) * 3);
      this.birth.copyWithin(1, 0, this.n - 1);
      this.inten.copyWithin(1, 0, this.n - 1);
      this.count = Math.min(this.n, this.count + 1);
    }
    P[0] = tip.x;
    P[1] = tip.y;
    P[2] = tip.z;
    this.birth[0] = now;
    this.inten[0] = intensity;
  }

  /** Rebuild the vertex attributes from the samples. */
  upload(life: number, now: number): void {
    // Drop samples that have fully faded.
    let live = this.count;
    while (live > 2 && now - this.birth[live - 1] > life) live--;
    this.count = live;
    const P = this.pos;
    const VP = this.aPosition.array as Float32Array;
    const VT = this.aTangent.array as Float32Array;
    const VD = this.aData.array as Float32Array;
    for (let i = 0; i < live; i++) {
      // Tangent from neighbors (central difference where possible).
      const a = Math.max(0, i - 1);
      const b = Math.min(live - 1, i + 1);
      const tx = P[a * 3] - P[b * 3];
      const ty = P[a * 3 + 1] - P[b * 3 + 1];
      const tz = P[a * 3 + 2] - P[b * 3 + 2];
      for (let s = 0; s < 2; s++) {
        const v = i * 2 + s;
        VP[v * 3] = P[i * 3];
        VP[v * 3 + 1] = P[i * 3 + 1];
        VP[v * 3 + 2] = P[i * 3 + 2];
        VT[v * 3] = tx;
        VT[v * 3 + 1] = ty;
        VT[v * 3 + 2] = tz;
        VD[v * 4] = s === 0 ? -1 : 1;
        VD[v * 4 + 1] = this.birth[i];
        VD[v * 4 + 2] = this.inten[i];
        VD[v * 4 + 3] = this.spin;
      }
    }
    for (const attr of [this.aPosition, this.aTangent, this.aData]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, live * 2 * attr.itemSize);
      attr.needsUpdate = true;
    }
    this.mesh.geometry.setDrawRange(0, Math.max(0, (live - 1) * 6));
  }

  /** Highest intensity still visible (to skip work when the trail has died out). */
  get alive(): boolean {
    return this.count > 2;
  }
}

export class WingTrails {
  private mat: ShaderMaterial;
  private left: Ribbon;
  private right: Ribbon;
  private now = 0;
  private active = false;
  /** Seconds a sample lives. */
  life = 1.3;
  /** Meters between committed samples. */
  spacing = 1.4;

  constructor(scene: Scene, samples = 64) {
    this.mat = new ShaderMaterial({
      uniforms: {
        ...globalUniforms,
        uPxScale: { value: 600 },
        uNow: { value: 0 },
        uLife: { value: this.life },
        uWidth: { value: 0.22 },
        uCurl: { value: 0.35 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      // Built from cross products, so the winding can face either way.
      side: DoubleSide,
      blending: NormalBlending,
    });
    // Opposite spin: the two tip vortices rotate in opposite directions.
    this.left = new Ribbon(samples, this.mat, 0, 'fx-trail-left');
    this.right = new Ribbon(samples, this.mat, Math.PI, 'fx-trail-right');
    scene.add(this.left.mesh, this.right.mesh);
  }

  setPxScale(v: number): void {
    this.mat.uniforms.uPxScale.value = v;
  }

  reset(): void {
    this.left.reset();
    this.right.reset();
  }

  /** Step the clock back by `by` seconds; samples keep their age (see Fx). */
  wrapTime(by: number): void {
    this.now -= by;
    this.mat.uniforms.uNow.value = this.now;
    this.left.shiftBirth(by);
    this.right.shiftBirth(by);
  }

  update(dt: number, tipL: Vector3, tipR: Vector3, intensity: number): void {
    this.now += dt;
    this.mat.uniforms.uNow.value = this.now;
    this.mat.uniforms.uLife.value = this.life;
    if (intensity > 0.01) this.active = true;
    if (!this.active) return;
    this.left.push(tipL, this.now, intensity, this.spacing);
    this.right.push(tipR, this.now, intensity, this.spacing);
    this.left.upload(this.life, this.now);
    this.right.upload(this.life, this.now);
    // Go idle once both trails have faded and nothing new is being drawn.
    if (intensity <= 0.01 && !this.left.alive && !this.right.alive) {
      this.active = false;
      this.reset();
    }
  }

  dispose(): void {
    this.left.mesh.removeFromParent();
    this.right.mesh.removeFromParent();
    this.left.mesh.geometry.dispose();
    this.right.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
