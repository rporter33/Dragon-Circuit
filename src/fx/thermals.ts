// Thermals made visible, so players can find the rising air from a distance and fly into it:
//   - wind lines: long pale streaks climbing each column in a lazy helix (they read from far
//     away as a tall swirling column),
//   - motes: warm specks spiraling up inside it (the close-up detail when you're in the lift).
// The four thermals nearest the camera share fixed populations. All motion is analytic in the
// vertex shaders: rise + swirl with a world-anchored vertical wrap inside a window around the
// camera's height, so the column never slides when the camera climbs.

import {
  DoubleSide,
  CustomBlending,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  Vector4,
  type Scene,
} from 'three';
import { globalUniforms } from '../render/uniforms';
import { mulberry32 } from '../core/rng';
import type { ThermalDef } from '../world/layout';
import { FX_COMMON_GLSL } from './shaders';
import { smoothstep } from '../core/math';

export const THERMAL_SLOTS = 4;
/** Vertical extent of the window around the camera's height (m). */
const WINDOW = 460;

/** Shared slot lookup + fades. */
const SLOT_GLSL = /* glsl */ `
attribute vec4 aSeed;
attribute float aSlot;
uniform vec4 uThermA[${THERMAL_SLOTS}]; // x, z, radius, strength
uniform vec4 uThermB[${THERMAL_SLOTS}]; // baseY, topY, visibility, window bottom
uniform float uNow;
uniform float uWindow;

void thermalSlot(out vec4 A, out vec4 B) {
  int slot = int(aSlot);
  A = uThermA[0];
  B = uThermB[0];
  if (slot == 1) { A = uThermA[1]; B = uThermB[1]; }
  else if (slot == 2) { A = uThermA[2]; B = uThermB[2]; }
  else if (slot == 3) { A = uThermA[3]; B = uThermB[3]; }
}

float columnFade(vec4 B, float y) {
  return smoothstep(B.x + 20.0, B.x + 110.0, y) * (1.0 - smoothstep(B.y - 140.0, B.y, y));
}

/** Columns lean downwind with height, like real thermals. */
vec2 leanAt(vec4 B, float y) {
  return uWind.xz * (y - B.x) * 0.0025;
}
`;

const MOTE_VERT = /* glsl */ `
${FX_COMMON_GLSL}
${SLOT_GLSL}
uniform float uSize;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;

void main() {
  vec4 A;
  vec4 B;
  thermalSlot(A, B);
  if (B.z <= 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float r = sqrt(aSeed.x) * A.z * 0.85;
  float rise = A.w * (0.35 + 0.35 * aSeed.w);
  float swirl = (0.5 + 0.5 * aSeed.w) * 7.0 / (r + 9.0);
  float H = uWindow;
  float yy = mod(aSeed.z * H + uNow * rise - B.w, H);
  float y = B.w + yy;
  float ang = aSeed.y * 6.2831853 + uNow * swirl;
  vec2 lean = leanAt(B, y);
  vec3 wp = vec3(A.x + cos(ang) * r + lean.x, y, A.y + sin(ang) * r + lean.y);

  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float size = uSize * (0.6 + 0.8 * fract(aSeed.w * 5.3));
  float px = size * uPxScale / max(-mv.z, 0.1);
  float grow = px < 2.0 ? 2.0 / max(px, 1e-3) : 1.0;
  mv.xy += position.xy * size * grow;
  gl_Position = projectionMatrix * mv;

  float winFade = smoothstep(0.0, 0.12, yy / H) * (1.0 - smoothstep(0.88, 1.0, yy / H));
  float twinkle = 0.65 + 0.35 * sin(uNow * (1.5 + aSeed.w * 2.0) + aSeed.x * 40.0);
  float nearFade = smoothstep(2.0, 10.0, -mv.z);
  // Grown (distant) motes dim only linearly, so the column still sparkles from afar.
  vAlpha = B.z * columnFade(B, y) * winFade * twinkle * nearFade * fxFogTransmittance(wp) / grow;
  vColor = mix(vec3(1.0, 0.8, 0.45) * (0.9 + 0.9 * uSunColor), vec3(1.0, 0.6, 0.35) * 0.8, uNight);
  vUv = position.xy;
}
`;

const MOTE_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
void main() {
  float r = length(vUv * 2.0);
  float a = exp(-r * r * 3.5) * (1.0 - smoothstep(0.7, 1.0, r)) * vAlpha;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor * a, a * 0.35);
}
`;

const LINE_VERT = /* glsl */ `
${FX_COMMON_GLSL}
${SLOT_GLSL}
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;

void main() {
  vec4 A;
  vec4 B;
  thermalSlot(A, B);
  if (B.z <= 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float r = (0.3 + 0.65 * aSeed.x) * A.z;
  float rise = A.w * (0.8 + 0.5 * aSeed.w);
  // Climb slope of the helix (dy per meter along the line).
  float slope = 0.75;
  float H = uWindow;
  float yy = mod(aSeed.z * H + uNow * rise - B.w, H);
  float len = 28.0 + 26.0 * aSeed.w;
  float u = position.y + 0.5; // 0 tail .. 1 head
  float dTheta = len * 0.92 / r;
  float omega = rise / (slope * r) * 0.92;
  float theta = aSeed.y * 6.2831853 + uNow * omega - (1.0 - u) * dTheta;
  float y = B.w + yy - (1.0 - u) * len * slope;
  vec2 lean = leanAt(B, y);
  vec3 wp = vec3(A.x + cos(theta) * r + lean.x, y, A.y + sin(theta) * r + lean.y);
  vec3 tan = normalize(vec3(-sin(theta) * r * dTheta, len * slope, cos(theta) * r * dTheta));
  vec3 viewV = normalize(wp - cameraPosition);
  vec3 side = cross(tan, viewV);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  float dist = length(wp - cameraPosition);
  // Wider with distance (about 2.5 px at 1080p far away) so the column reads from across the sky.
  float width = max(0.3, 2.4 * dist / uPxScale);
  wp += side * position.x * width;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);

  float winFade = smoothstep(0.0, 0.1, yy / H) * (1.0 - smoothstep(0.9, 1.0, yy / H));
  float ends = smoothstep(0.0, 0.35, u) * (1.0 - smoothstep(0.8, 1.0, u));
  float nearFade = smoothstep(6.0, 30.0, dist);
  // The far side of the column is dimmer: reads as a turning column, not a crosshatch.
  vec2 radial = vec2(cos(theta), sin(theta));
  vec2 toCam = normalize(cameraPosition.xz - vec2(A.x, A.y) + 1e-4);
  float front = 0.3 + 0.7 * smoothstep(-0.4, 0.5, dot(radial, toCam));
  vAlpha = 0.6 * front * B.z * columnFade(B, y) * winFade * ends * nearFade * fxFogTransmittance(wp);
  vColor = dwApplyFog(fxLitDust(vec3(1.0, 0.96, 0.88), wp) * 1.45, wp, cameraPosition);
  vUv = vec2(position.x * 2.0, u);
}
`;

const LINE_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
void main() {
  float across = 1.0 - abs(vUv.x);
  // Bright core, cooler darker edges: reads on cloud and sky alike.
  vec3 col = mix(vColor * vec3(0.66, 0.75, 0.92), vColor, smoothstep(0.25, 0.75, across));
  float a = smoothstep(0.0, 0.6, across) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col * a, a);
}
`;

function quad(): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** A strip of `segs` quads along y in [-0.5, 0.5], so a line can follow a curve. */
export function stripGeometry(segs: number): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const y = i / segs - 0.5;
    pos.push(-0.5, y, 0, 0.5, y, 0);
    if (i < segs) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class ThermalMotes {
  readonly mesh: Mesh;
  readonly lines: Mesh;
  private mats: ShaderMaterial[] = [];
  private geos: InstancedBufferGeometry[] = [];
  private thermA: Vector4[];
  private thermB: Vector4[];
  private uNow = { value: 0 };
  private readonly counts: number[];
  /** Indices of the thermals currently in each slot (-1 = empty). */
  private slots: number[] = [-1, -1, -1, -1];
  private order: number[];
  private dists: number[];
  private byDistance = (a: number, b: number) => this.dists[a] - this.dists[b];

  constructor(scene: Scene, private thermals: readonly ThermalDef[], moteCount = 1400, lineCount = 520) {
    this.counts = [moteCount, lineCount];
    this.thermA = Array.from({ length: THERMAL_SLOTS }, () => new Vector4());
    this.thermB = Array.from({ length: THERMAL_SLOTS }, () => new Vector4());
    this.order = thermals.map((_, i) => i);
    this.dists = thermals.map(() => 0);
    const shared = {
      uThermA: { value: this.thermA },
      uThermB: { value: this.thermB },
      uNow: this.uNow,
      uWindow: { value: WINDOW },
    };
    const make = (geo: InstancedBufferGeometry, n: number, seed: number, vert: string, frag: string, extra: Record<string, { value: unknown }>): Mesh => {
      const rand = mulberry32(seed);
      const seeds = new Float32Array(n * 4);
      const slots = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 4; k++) seeds[i * 4 + k] = rand();
        slots[i] = i % THERMAL_SLOTS;
      }
      geo.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4));
      geo.setAttribute('aSlot', new InstancedBufferAttribute(slots, 1));
      geo.instanceCount = n;
      const mat = new ShaderMaterial({
        uniforms: { ...globalUniforms, ...shared, uPxScale: { value: 600 }, ...extra },
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        // Strips are built from cross products, so their winding can face either way.
        side: DoubleSide,
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
      });
      const mesh = new Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      scene.add(mesh);
      this.mats.push(mat);
      this.geos.push(geo);
      return mesh;
    };
    this.mesh = make(quad(), moteCount, 0x7e41, MOTE_VERT, MOTE_FRAG, { uSize: { value: 0.85 } });
    this.mesh.name = 'fx-thermal-motes';
    this.lines = make(stripGeometry(10), lineCount, 0x9a11, LINE_VERT, LINE_FRAG, {});
    this.lines.name = 'fx-thermal-lines';
  }

  setDensity(particles: number): void {
    this.geos.forEach((g, i) => (g.instanceCount = Math.max(THERMAL_SLOTS, Math.round((this.counts[i] * particles) / 1.4))));
  }

  setPxScale(v: number): void {
    for (const m of this.mats) m.uniforms.uPxScale.value = v;
  }

  /** The thermal (layout index) shown in each slot, for tests/debug. */
  get slotThermals(): readonly number[] {
    return this.slots;
  }

  update(dt: number, cam: { x: number; y: number; z: number }, maxDistance: number): void {
    this.uNow.value += dt;
    const th = this.thermals;
    for (let i = 0; i < th.length; i++) this.dists[i] = Math.max(0, Math.hypot(th[i].x - cam.x, th[i].z - cam.z) - th[i].radius);
    this.order.sort(this.byDistance);
    let any = false;
    for (let s = 0; s < THERMAL_SLOTS; s++) {
      const i = s < this.order.length ? this.order[s] : -1;
      this.slots[s] = i;
      const A = this.thermA[s];
      const B = this.thermB[s];
      if (i < 0) {
        B.z = 0;
        continue;
      }
      const t = th[i];
      const vis = 1 - smoothstep(maxDistance * 0.55, maxDistance, this.dists[i]);
      // The window follows the camera's height, clamped inside the column.
      const lo = t.baseY;
      const hi = Math.max(lo + WINDOW, t.topY);
      const center = Math.min(Math.max(cam.y, lo + WINDOW / 2), hi - WINDOW / 2);
      A.set(t.x, t.z, t.radius, t.strength);
      B.set(t.baseY, t.topY, vis, center - WINDOW / 2);
      if (vis > 0) any = true;
    }
    this.mesh.visible = any;
    this.lines.visible = any;
  }

  dispose(): void {
    for (const m of [this.mesh, this.lines]) m.removeFromParent();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
