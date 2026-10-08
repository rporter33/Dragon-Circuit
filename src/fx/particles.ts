// Fire-and-forget GPU particles. Each particle is written ONCE when emitted (start position,
// velocity, drag, gravity, size, color, shape); the vertex shader evaluates its motion in closed
// form from its age, so there is no per-frame CPU work besides one uniform. A ring buffer of
// instanced quads holds every particle; emitting overwrites the oldest slot.
//
// Motion with linear drag k and gravity g (exact):
//   v(t) = v0·e^(−kt) + (g/k)(1 − e^(−kt))
//   p(t) = p0 + v0(1 − e^(−kt))/k + (g/k)(t − (1 − e^(−kt))/k) + wind·windCoupling·t
//
// Shapes: 0 soft painterly puff (dust, breath), 1 spark (stretched along screen velocity),
// 2 star glint, 3 round glow.

import {
  Color,
  CustomBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Float32BufferAttribute,
  type Scene,
} from 'three';
import { globalUniforms } from '../render/uniforms';
import { FX_COMMON_GLSL, FX_NOISE_GLSL } from './shaders';

export const SHAPE_PUFF = 0;
export const SHAPE_SPARK = 1;
export const SHAPE_GLINT = 2;
export const SHAPE_GLOW = 3;

/** Everything about one particle at emission. Reused by callers (no allocation per emit). */
export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds. */
  life: number;
  /** Linear drag (1/s). */
  drag: number;
  /** Multiplier on -9.81 m/s² (negative rises). */
  gravity: number;
  /** World size (m) at birth and at death. */
  size0: number;
  size1: number;
  rotation: number;
  spin: number;
  r: number;
  g: number;
  b: number;
  /** Peak opacity (or intensity for additive layers). */
  a: number;
  shape: number;
  /** Spark stretch: seconds of screen-space velocity the streak spans. */
  stretch: number;
  /** Fraction of life spent fading in. */
  fadeIn: number;
  /** How much the global wind carries it (0..1). */
  wind: number;
}

export function blankSpec(): ParticleSpec {
  return {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, drag: 1, gravity: 0, size0: 1, size1: 1,
    rotation: 0, spin: 0, r: 1, g: 1, b: 1, a: 1, shape: 0, stretch: 0, fadeIn: 0.1, wind: 0,
  };
}

const VERT = /* glsl */ `
${FX_COMMON_GLSL}
attribute vec3 aPos0;
attribute vec3 aVel0;
attribute vec4 aTime;   // birth, life, drag, gravity
attribute vec4 aSize;   // size0, size1, rotation, spin
attribute vec4 aColor;  // rgb, peak alpha
attribute vec4 aExtra;  // shape, stretch, fadeIn, wind
uniform float uNow;
uniform float uLit;     // 1 = sun-lit dust (normal blending), 0 = emissive glow (additive)
varying vec2 vUv;
varying vec4 vColor;
varying float vShape;
varying float vSeed;
varying float vRot;

void main() {
  float age = uNow - aTime.x;
  float life = aTime.y;
  if (age < 0.0 || age >= life || aColor.a <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float k = max(aTime.z, 1e-3);
  float e = exp(-k * age);
  vec3 g = vec3(0.0, -9.81 * aTime.w, 0.0);
  vec3 wp = aPos0 + aVel0 * (1.0 - e) / k + g / k * (age - (1.0 - e) / k) + uWind * aExtra.w * age;
  vec3 vel = aVel0 * e + g / k * (1.0 - e) + uWind * aExtra.w;
  float t = age / life;
  // Grow fast early, slow late, like a puff that spends its energy.
  float size = mix(aSize.x, aSize.y, 1.0 - (1.0 - t) * (1.0 - t));

  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vec2 c = position.xy;
  vec2 off;
  if (aExtra.x == 1.0) {
    vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz;
    vec2 dir = vv.xy;
    float vlen = length(dir);
    dir = vlen > 1e-4 ? dir / vlen : vec2(0.0, 1.0);
    float len = size + vlen * aExtra.y;
    off = dir * c.y * len + vec2(-dir.y, dir.x) * c.x * size;
  } else {
    float rot = aSize.z + aSize.w * age;
    float cs = cos(rot);
    float sn = sin(rot);
    off = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;
    vRot = rot;
  }
  // Keep tiny distant particles from shimmering out of existence: at least ~1.5 px.
  float px = size * uPxScale / max(-mv.z, 0.1);
  float minScale = px < 1.5 ? 1.5 / max(px, 1e-3) : 1.0;
  mv.xy += off * minScale;
  gl_Position = projectionMatrix * mv;

  float fadeIn = max(aExtra.z, 1e-3);
  float alpha = aColor.a * smoothstep(0.0, fadeIn, t) * (1.0 - smoothstep(0.45, 1.0, t)) / (minScale * minScale);
  vec3 col = aColor.rgb;
  if (uLit > 0.5) {
    col = dwApplyFog(fxLitDust(col, wp), wp, cameraPosition);
  } else {
    alpha *= fxFogTransmittance(wp);
  }
  vColor = vec4(col, alpha);
  vUv = c;
  vShape = aExtra.x;
  vSeed = fract(aTime.x * 13.17 + aPos0.x * 0.37);
  if (aExtra.x == 1.0) vRot = 0.0;
}
`;

const FRAG = /* glsl */ `
${FX_COMMON_GLSL}
${FX_NOISE_GLSL}
uniform float uLit;
uniform float uOcclude;
varying vec2 vUv;
varying vec4 vColor;
varying float vShape;
varying float vSeed;
varying float vRot;

void main() {
  vec2 p = vUv * 2.0;
  float r = length(p);
  float a;
  vec3 col = vColor.rgb;
  if (vShape == 0.0) {
    // Painterly puff: a cotton-ball blob with a noisy, fairly crisp edge, lit from above (the
    // particle's local axes are rotated on screen, so "up" is rotated back into them).
    float n = fxNoise(p * 2.1 + vSeed * 17.0) * 0.6 + fxNoise(p * 4.7 - vSeed * 9.0) * 0.4;
    float rr = r + (n - 0.5) * 0.42;
    a = 1.0 - smoothstep(0.55, 0.78, rr);
    vec2 up = vec2(sin(vRot), cos(vRot));
    float lit = clamp(dot(p, up) * 0.55 + 0.5 - (n - 0.5) * 0.3, 0.0, 1.0);
    col *= 0.78 + 0.34 * lit;
    a *= 0.8 + 0.2 * (1.0 - r);
  } else if (vShape == 1.0) {
    // Spark: bright core line, soft edges.
    float across = 1.0 - smoothstep(0.0, 1.0, abs(p.x));
    float along = 1.0 - smoothstep(0.6, 1.0, abs(p.y));
    a = across * across * along;
  } else if (vShape == 2.0) {
    // Glint: a round core with four thin rays.
    float core = exp(-r * r * 9.0);
    float rays = max(0.0, 1.0 - abs(p.x) * 9.0) * (1.0 - smoothstep(0.0, 1.0, abs(p.y)))
               + max(0.0, 1.0 - abs(p.y) * 9.0) * (1.0 - smoothstep(0.0, 1.0, abs(p.x)));
    a = core + rays * 0.55;
  } else {
    // Round glow.
    a = exp(-r * r * 4.0) * (1.0 - smoothstep(0.8, 1.0, r));
  }
  a *= vColor.a;
  if (a < 0.003) discard;
  // Glow layer: premultiplied "over" with partial occlusion — mostly additive light, but it dims
  // what's behind a little so gold still reads as gold against a bright sky.
  gl_FragColor = uLit > 0.5 ? vec4(col, a) : vec4(col * a, min(1.0, a * uOcclude));
}
`;

const STRIDE = { pos: 3, vel: 3, time: 4, size: 4, color: 4, extra: 4 };

export class BurstParticles {
  readonly mesh: Mesh;
  readonly capacity: number;
  private geo: InstancedBufferGeometry;
  private mat: ShaderMaterial;
  private aPos: InstancedBufferAttribute;
  private aVel: InstancedBufferAttribute;
  private aTime: InstancedBufferAttribute;
  private aSize: InstancedBufferAttribute;
  private aColor: InstancedBufferAttribute;
  private aExtra: InstancedBufferAttribute;
  private next = 0;
  private activeCap: number;
  private dirtyFrom = Infinity;
  private dirtyTo = -1;
  private wrapped = false;
  /** Current effect clock (s). */
  now = 0;
  /** Particles emitted since construction (stats). */
  emitted = 0;

  constructor(scene: Scene, capacity: number, opts: { additive: boolean; renderOrder?: number; name: string }) {
    this.capacity = capacity;
    this.activeCap = capacity;
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (n: number) => {
      const a = new InstancedBufferAttribute(new Float32Array(capacity * n), n);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.aPos = mk(STRIDE.pos);
    this.aVel = mk(STRIDE.vel);
    this.aTime = mk(STRIDE.time);
    this.aSize = mk(STRIDE.size);
    this.aColor = mk(STRIDE.color);
    this.aExtra = mk(STRIDE.extra);
    // Everything starts dead (birth far in the future would also work; zero alpha is clearer).
    geo.setAttribute('aPos0', this.aPos);
    geo.setAttribute('aVel0', this.aVel);
    geo.setAttribute('aTime', this.aTime);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aColor', this.aColor);
    geo.setAttribute('aExtra', this.aExtra);
    geo.instanceCount = capacity;
    this.geo = geo;
    this.mat = new ShaderMaterial({
      uniforms: {
        ...globalUniforms,
        uNow: { value: 0 },
        uLit: { value: opts.additive ? 0 : 1 },
        uOcclude: { value: 0.45 },
        uPxScale: { value: 600 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? CustomBlending : NormalBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
    });
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.name = opts.name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.renderOrder ?? 5;
    scene.add(this.mesh);
  }

  emit(s: ParticleSpec): void {
    const i = this.next;
    this.next = (this.next + 1) % this.activeCap;
    if (this.next === 0) this.wrapped = true;
    this.emitted++;
    const P = this.aPos.array as Float32Array;
    const V = this.aVel.array as Float32Array;
    const T = this.aTime.array as Float32Array;
    const S = this.aSize.array as Float32Array;
    const C = this.aColor.array as Float32Array;
    const X = this.aExtra.array as Float32Array;
    P[i * 3] = s.x;
    P[i * 3 + 1] = s.y;
    P[i * 3 + 2] = s.z;
    V[i * 3] = s.vx;
    V[i * 3 + 1] = s.vy;
    V[i * 3 + 2] = s.vz;
    T[i * 4] = this.now;
    T[i * 4 + 1] = Math.max(0.01, s.life);
    T[i * 4 + 2] = s.drag;
    T[i * 4 + 3] = s.gravity;
    S[i * 4] = s.size0;
    S[i * 4 + 1] = s.size1;
    S[i * 4 + 2] = s.rotation;
    S[i * 4 + 3] = s.spin;
    C[i * 4] = s.r;
    C[i * 4 + 1] = s.g;
    C[i * 4 + 2] = s.b;
    C[i * 4 + 3] = s.a;
    X[i * 4] = s.shape;
    X[i * 4 + 1] = s.stretch;
    X[i * 4 + 2] = s.fadeIn;
    X[i * 4 + 3] = s.wind;
    if (i < this.dirtyFrom) this.dirtyFrom = i;
    if (i > this.dirtyTo) this.dirtyTo = i;
  }

  /** Advance the clock and upload what was emitted this frame. */
  update(dt: number, pxScale: number): void {
    this.now += dt;
    this.mat.uniforms.uNow.value = this.now;
    this.mat.uniforms.uPxScale.value = pxScale;
    if (this.dirtyTo < 0) return;
    const from = this.dirtyFrom;
    const count = this.dirtyTo - this.dirtyFrom + 1;
    for (const [attr, n] of [
      [this.aPos, STRIDE.pos],
      [this.aVel, STRIDE.vel],
      [this.aTime, STRIDE.time],
      [this.aSize, STRIDE.size],
      [this.aColor, STRIDE.color],
      [this.aExtra, STRIDE.extra],
    ] as const) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(from * n, count * n);
      attr.needsUpdate = true;
    }
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
  }

  /** Draw only the first `n` slots (quality scaling); emission wraps within them. */
  setActiveCapacity(n: number): void {
    const c = Math.max(16, Math.min(this.capacity, Math.floor(n)));
    this.geo.instanceCount = c;
    if (this.next >= c) this.next = 0;
    this.activeCap = c;
  }

  get active(): number {
    return this.activeCap;
  }

  /** True once the ring buffer has wrapped at least once (stats). */
  get hasWrapped(): boolean {
    return this.wrapped;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** Shared scratch color for callers mixing palettes. */
export const tmpColor = new Color();
