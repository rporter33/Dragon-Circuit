// Thermals made visible, so players can find the rising air from a distance and fly into it:
//   - heat haze: a soft, warm column of rising shimmer (a camera-facing card around each
//     column's axis, broken into rising streaks) — what you spot from several hundred meters,
//     painted air rather than an object; it thins away as you fly into it,
//   - wind lines: dry-brush strokes climbing each column in a lazy helix, warm and broken, fading
//     with distance so they never scribble over far landmarks,
//   - motes: warm specks spiraling up inside it (the close-up detail when you're in the lift),
//     opaque enough to read as gold on white cloud.
// Every thermal gets its haze, by distance alone. The motes and wind lines are a fixed budget
// shared by the THERMAL_SLOTS nearest thermals: a thermal keeps its slot (and so its motes'
// pattern) for as long as it stays among them, and its motes and lines fade with its lead over
// the nearest thermal left out, so a thermal joins or leaves the set at zero, never with a pop.
// All motion is analytic in the vertex shaders: rise + swirl with a world-anchored vertical wrap
// inside a window around the camera's height, so the column never slides when the camera climbs.
// `presence` dims the whole effect off the wing (title, stable, on foot): thermals are for flyers.

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
import { FX_COMMON_GLSL, FX_NOISE_GLSL } from './shaders';
import { damp, smoothstep } from '../core/math';

/** Thermals whose motes and wind lines are drawn at once (they share the particle budget). */
export const THERMAL_SLOTS = 4;
/**
 * Lead (m) over the nearest thermal without a slot at which a slot's motes and lines are at full
 * strength. At a hand-off the two thermals are level, so both are at zero.
 */
export const SLOT_HANDOFF = 150;
/** Vertical extent of the window around the camera's height (m). */
const WINDOW = 460;

/** Shared slot lookup + fades. `n` is the size of the slot arrays (fixed per material). */
const slotGlsl = (n: number) => /* glsl */ `
attribute vec4 aSeed;
attribute float aSlot;
uniform vec4 uThermA[${n}]; // x, z, radius, strength
uniform vec4 uThermB[${n}]; // baseY, topY, visibility, window bottom
uniform float uNow;
uniform float uWindow;
uniform float uPresence;

void thermalSlot(out vec4 A, out vec4 B) {
  int slot = clamp(int(aSlot + 0.5), 0, ${n - 1});
  A = uThermA[slot];
  B = uThermB[slot];
}

float columnFade(vec4 B, float y) {
  return smoothstep(B.x + 20.0, B.x + 110.0, y) * (1.0 - smoothstep(B.y - 140.0, B.y, y));
}

/** Columns lean downwind with height, like real thermals. */
vec2 leanAt(vec4 B, float y) {
  return uWind.xz * (y - B.x) * 0.0025;
}
`;

const moteVert = (n: number) => /* glsl */ `
${FX_COMMON_GLSL}
${slotGlsl(n)}
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
  float grow = px < 2.5 ? 2.5 / max(px, 1e-3) : 1.0;
  mv.xy += position.xy * size * grow;
  gl_Position = projectionMatrix * mv;

  float winFade = smoothstep(0.0, 0.12, yy / H) * (1.0 - smoothstep(0.88, 1.0, yy / H));
  float twinkle = 0.65 + 0.35 * sin(uNow * (1.5 + aSeed.w * 2.0) + aSeed.x * 40.0);
  float nearFade = smoothstep(2.0, 10.0, -mv.z);
  // Grown (distant) motes dim only linearly, so the column still sparkles from afar.
  vAlpha = uPresence * B.z * columnFade(B, y) * winFade * twinkle * nearFade * fxFogTransmittance(wp) / sqrt(grow);
  // Deep warm gold: reads against white cloud as well as blue sky.
  vColor = mix(vec3(1.0, 0.72, 0.32) * (0.75 + 0.6 * uSunColor), vec3(1.0, 0.6, 0.35) * 0.8, uNight);
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
  // Mostly covering, a little glowing: gold specks, not white-on-white.
  gl_FragColor = vec4(vColor * a, a * 0.8);
}
`;

const lineVert = (n: number) => /* glsl */ `
${FX_COMMON_GLSL}
${slotGlsl(n)}
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
varying float vSeed;

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
  // A fine brush: ~2 px far away, 0.35 m up close.
  float width = max(0.35, 2.1 * dist / uPxScale);
  // Taper: thin at both ends, full in the middle of the stroke.
  wp += side * position.x * width * (0.35 + 0.65 * sin(u * 3.14159));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);

  float winFade = smoothstep(0.0, 0.1, yy / H) * (1.0 - smoothstep(0.9, 1.0, yy / H));
  float ends = smoothstep(0.0, 0.5, u) * (1.0 - smoothstep(0.7, 1.0, u));
  float nearFade = smoothstep(6.0, 30.0, dist);
  // Strokes are a mid-range read; from afar the haze column carries the thermal.
  float farFade = 1.0 - smoothstep(450.0, 1200.0, dist);
  // The far side of the column is dimmer: reads as a turning column, not a crosshatch.
  vec2 radial = vec2(cos(theta), sin(theta));
  vec2 toCam = normalize(cameraPosition.xz - vec2(A.x, A.y) + 1e-4);
  float front = 0.3 + 0.7 * smoothstep(-0.4, 0.5, dot(radial, toCam));
  vAlpha = 0.55 * uPresence * front * B.z * columnFade(B, y) * winFade * ends * nearFade * farFade * fxFogTransmittance(wp);
  // Warm, sunlit gold: reads against white cloud and blue sky, never as a white vector line.
  vColor = dwApplyFog(fxLitDust(vec3(1.0, 0.78, 0.46), wp) * 1.15, wp, cameraPosition);
  vUv = vec2(position.x * 2.0, u);
  vSeed = aSeed.y * 37.0 + aSeed.w * 11.0;
}
`;

const LINE_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
varying float vSeed;
void main() {
  float across = 1.0 - abs(vUv.x);
  // Dry brush: the stroke breaks up along its length.
  float brush = 0.5 + 0.5 * sin(vUv.y * 19.0 + vSeed) * sin(vUv.y * 7.0 + vSeed * 1.7);
  brush = smoothstep(0.1, 0.75, brush);
  vec3 col = mix(vColor * vec3(0.82, 0.8, 0.86), vColor, smoothstep(0.25, 0.75, across));
  float a = smoothstep(0.0, 0.75, across) * (0.3 + 0.7 * brush) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col * a, a);
}
`;

/**
 * Heat haze: one camera-facing card per thermal around the column's (leaning) axis, spanning the
 * window. The fragment shader paints a soft cylinder of rising, streaky shimmer.
 */
const hazeVert = (n: number) => /* glsl */ `
${FX_COMMON_GLSL}
${slotGlsl(n)}
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
varying float vY;
varying float vRise;
varying float vSlotSeed;

void main() {
  vec4 A;
  vec4 B;
  thermalSlot(A, B);
  if (B.z <= 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float v = position.y + 0.5;
  float y = B.w + v * uWindow;
  vec2 lean = leanAt(B, y);
  vec3 axis = vec3(A.x + lean.x, y, A.y + lean.y);
  vec2 toCam = cameraPosition.xz - axis.xz;
  float dh = length(toCam);
  vec2 side = dh > 1e-3 ? vec2(-toCam.y, toCam.x) / dh : vec2(1.0, 0.0);
  float halfW = A.z * 1.15;
  vec3 wp = axis + vec3(side.x, 0.0, side.y) * position.x * 2.0 * halfW;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);

  float winFade = smoothstep(0.0, 0.18, v) * (1.0 - smoothstep(0.82, 1.0, v));
  // Thin away as you fly in (the motes and strokes take over), and with great distance.
  float inside = smoothstep(A.z * 0.8, A.z * 2.6, dh);
  float far = 1.0 - smoothstep(1300.0, 2100.0, dh);
  vAlpha = 0.36 * uPresence * B.z * columnFade(B, y) * winFade * inside * far * fxFogTransmittance(axis);
  vColor = dwApplyFog(fxLitDust(vec3(1.0, 0.76, 0.42), axis) * 1.15, axis, cameraPosition);
  vUv = vec2(position.x * 2.0, v);
  vY = y;
  vRise = A.w * 0.9;
  // One card per thermal, so the streak pattern belongs to the thermal.
  vSlotSeed = aSeed.x * 17.0;
}
`;

const HAZE_FRAG = /* glsl */ `
${FX_COMMON_GLSL}
${FX_NOISE_GLSL}
uniform float uNow;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
varying float vY;
varying float vRise;
varying float vSlotSeed;
void main() {
  float x = vUv.x;
  // A cylinder's thickness seen side-on, softened at the rim.
  float thick = pow(max(0.0, 1.0 - x * x), 1.5);
  if (thick * vAlpha < 0.002) discard;
  // Rising shimmer: tall streaks drifting upward with the air.
  vec2 q = vec2(x * 3.2 + vSlotSeed, (vY - uNow * vRise) / 55.0);
  float n = fxNoise(q) * 0.62 + fxNoise(q * vec2(2.1, 2.7) + 4.3) * 0.38;
  float streak = smoothstep(0.4, 0.78, n);
  float a = thick * (0.14 + 0.86 * streak) * vAlpha;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor * a, a);
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

/**
 * Sticky slot assignment for the mote and line budget. `order` lists every thermal by distance
 * (nearest first); the first `slots.length` of them hold the slots. A thermal keeps its slot for
 * as long as it stays among them, so a change of rank inside the set never re-deals a column's
 * motes, and a newcomer takes the slot that was freed. `fades[s]` is the slot's strength: its
 * thermal's lead over the nearest thermal left out, eased over `handoff` meters. At a hand-off
 * the leaving and the arriving thermal are level, so both are at zero.
 * Mutates `slots` (thermal index per slot, -1 = empty) and `fades`; allocates nothing.
 */
export function assignThermalSlots(order: readonly number[], dists: ArrayLike<number>, slots: number[], fades: number[], handoff: number): void {
  const k = slots.length;
  const n = Math.min(k, order.length);
  // The nearest thermal left without a slot sets the bar.
  const cut = order.length > k ? dists[order[k]] : Infinity;
  for (let s = 0; s < k; s++) {
    const i = slots[s];
    if (i < 0) continue;
    let kept = false;
    for (let r = 0; r < n; r++) {
      if (order[r] === i) {
        kept = true;
        break;
      }
    }
    if (!kept) slots[s] = -1;
  }
  for (let r = 0; r < n; r++) {
    const i = order[r];
    if (slots.indexOf(i) >= 0) continue;
    slots[slots.indexOf(-1)] = i;
  }
  for (let s = 0; s < k; s++) {
    const i = slots[s];
    fades[s] = i < 0 ? 0 : smoothstep(0, handoff, cut - dists[i]);
  }
}

export class ThermalMotes {
  readonly mesh: Mesh;
  readonly lines: Mesh;
  readonly haze: Mesh;
  private mats: ShaderMaterial[] = [];
  private geos: InstancedBufferGeometry[] = [];
  /** Per slot (motes and lines). */
  private thermA: Vector4[];
  private thermB: Vector4[];
  /** Per thermal (haze). */
  private hazeA: Vector4[];
  private hazeB: Vector4[];
  private uNow = { value: 0 };
  private uPresence = { value: 1 };
  private readonly counts: number[];
  /** Indices of the thermals currently in each slot (-1 = empty). */
  private slots: number[] = Array.from({ length: THERMAL_SLOTS }, () => -1);
  /** Each slot's hand-off strength (see assignThermalSlots). */
  private fades: number[] = Array.from({ length: THERMAL_SLOTS }, () => 0);
  private order: number[];
  private dists: number[];
  private byDistance = (a: number, b: number) => this.dists[a] - this.dists[b];

  constructor(scene: Scene, private thermals: readonly ThermalDef[], moteCount = 2000, lineCount = 360) {
    const hazeCount = Math.max(1, thermals.length);
    this.counts = [moteCount, lineCount, hazeCount];
    this.thermA = Array.from({ length: THERMAL_SLOTS }, () => new Vector4());
    this.thermB = Array.from({ length: THERMAL_SLOTS }, () => new Vector4());
    this.hazeA = Array.from({ length: hazeCount }, () => new Vector4());
    this.hazeB = Array.from({ length: hazeCount }, () => new Vector4());
    this.order = thermals.map((_, i) => i);
    this.dists = thermals.map(() => 0);
    const shared = {
      uThermA: { value: this.thermA },
      uThermB: { value: this.thermB },
      uNow: this.uNow,
      uWindow: { value: WINDOW },
      uPresence: this.uPresence,
    };
    const make = (geo: InstancedBufferGeometry, n: number, slotCount: number, seed: number, vert: string, frag: string, extra: Record<string, { value: unknown }>): Mesh => {
      const rand = mulberry32(seed);
      const seeds = new Float32Array(n * 4);
      const slots = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 4; k++) seeds[i * 4 + k] = rand();
        slots[i] = i % slotCount;
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
    this.mesh = make(quad(), moteCount, THERMAL_SLOTS, 0x7e41, moteVert(THERMAL_SLOTS), MOTE_FRAG, { uSize: { value: 1.1 } });
    this.mesh.name = 'fx-thermal-motes';
    this.lines = make(stripGeometry(10), lineCount, THERMAL_SLOTS, 0x9a11, lineVert(THERMAL_SLOTS), LINE_FRAG, {});
    this.lines.name = 'fx-thermal-lines';
    // One haze card per thermal (instance = thermal index): a strip so the column can lean.
    this.haze = make(stripGeometry(12), hazeCount, hazeCount, 0x4a2e, hazeVert(hazeCount), HAZE_FRAG, {
      uThermA: { value: this.hazeA },
      uThermB: { value: this.hazeB },
    });
    this.haze.name = 'fx-thermal-haze';
    this.haze.renderOrder = 3;
  }

  setDensity(particles: number): void {
    // The haze (last) always draws one card per thermal.
    this.geos.forEach((g, i) => (g.instanceCount = i === 2 ? this.counts[2] : Math.max(THERMAL_SLOTS, Math.round((this.counts[i] * particles) / 1.4))));
  }

  setPxScale(v: number): void {
    for (const m of this.mats) m.uniforms.uPxScale.value = v;
  }

  /** The thermal (layout index) shown in each slot, for tests/debug. */
  get slotThermals(): readonly number[] {
    return this.slots;
  }

  /** Strength (0..1, before presence and fog) of a slot's motes and lines, for tests/debug. */
  slotVisibility(slot: number): number {
    return this.thermB[slot].z;
  }

  /** Strength (0..1, before presence and fog) of a thermal's haze column, for tests/debug. */
  hazeVisibility(thermal: number): number {
    return this.hazeB[thermal].z;
  }

  /** Step the clock back by `by` seconds (see Fx: done while the screen is faded out). */
  wrapTime(by: number): void {
    this.uNow.value -= by;
  }

  /**
   * @param presence  0..1 target for how strongly thermals show (1 in flight; dimmer on foot,
   *                  in the title and the stable). Eased, so mode changes never pop.
   */
  update(dt: number, cam: { x: number; y: number; z: number }, maxDistance: number, presence = 1): void {
    this.uNow.value += dt;
    this.uPresence.value = damp(this.uPresence.value, presence, 1.5, dt);
    const th = this.thermals;
    for (let i = 0; i < th.length; i++) {
      // sqrt, not Math.hypot (which allocates in V8), once per thermal per frame.
      const dx = th[i].x - cam.x;
      const dz = th[i].z - cam.z;
      this.dists[i] = Math.max(0, Math.sqrt(dx * dx + dz * dz) - th[i].radius);
    }
    let any = false;
    // Haze: every thermal, faded by its own distance alone.
    for (let i = 0; i < th.length; i++) {
      const t = th[i];
      const vis = 1 - smoothstep(maxDistance * 0.55, maxDistance, this.dists[i]);
      // The window follows the camera's height, clamped inside the column.
      const lo = t.baseY;
      const hi = Math.max(lo + WINDOW, t.topY);
      const center = Math.min(Math.max(cam.y, lo + WINDOW / 2), hi - WINDOW / 2);
      this.hazeA[i].set(t.x, t.z, t.radius, t.strength);
      this.hazeB[i].set(t.baseY, t.topY, vis, center - WINDOW / 2);
      if (vis > 0) any = true;
    }
    // Motes and lines: the nearest few, handed over at zero.
    this.order.sort(this.byDistance);
    assignThermalSlots(this.order, this.dists, this.slots, this.fades, SLOT_HANDOFF);
    for (let s = 0; s < THERMAL_SLOTS; s++) {
      const i = this.slots[s];
      if (i < 0) {
        this.thermB[s].z = 0;
        continue;
      }
      this.thermA[s].copy(this.hazeA[i]);
      this.thermB[s].copy(this.hazeB[i]);
      this.thermB[s].z *= this.fades[s];
    }
    const show = any && this.uPresence.value > 0.01;
    this.mesh.visible = show;
    this.lines.visible = show;
    this.haze.visible = show;
  }

  dispose(): void {
    for (const m of [this.mesh, this.lines, this.haze]) m.removeFromParent();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
