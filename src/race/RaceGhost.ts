// The best run's ghost: a wyvern built as the breed and look the run was flown with, drawn as a
// tinted glass figure in the course's color, with wingtip streamers so it can be found from a
// hundred meters off.
//
// Readability over the white cloud sea and bright skies is the whole point (a pale additive
// shell vanishes on white), so the ghost carries its own materials rather than the creature's
// generic ghost shell: a saturated, darker body that darkens what's behind it (straight alpha),
// a light rim just inside the silhouette and a dark ink line right at it by day (a bright one at
// night), so it reads against cloud, sky and rock alike. A depth-only prepass keeps it one clean
// layer (no muddy overlap where a wing crosses the body).
//
// The model is rebuilt only when the recording's breed or shape cosmetics differ from the last
// one shown (Wyvern.setLook updates uniforms otherwise), and the materials are put back on the
// mesh whenever it is rebuilt.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  FrontSide,
  Group,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  SkinnedMesh,
  Vector3,
  type Material,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import type { WyvernLook } from '../core/types';
import type { GhostRecording } from '../game/contracts';
import type { QualityProfile } from '../render/quality';
import { FOG_PARS_GLSL } from '../render/painterly';
import { globalUniforms } from '../render/uniforms';
import { createWyvernPose } from '../player/poses';
import { Wyvern } from '../creatures/wyvern/Wyvern';
import type { GhostSample } from './ghost';

/** Drawn after the rest of the transparent world (rings 3, disc 4, beacon 5, halos 6). */
const RENDER_ORDER = 8;

const shared = () => ({
  uTime: globalUniforms.uTime,
  uSunDir: globalUniforms.uSunDir,
  uSunColor: globalUniforms.uSunColor,
  uFogColor: globalUniforms.uFogColor,
  uFogSunColor: globalUniforms.uFogSunColor,
  uFogDensity: globalUniforms.uFogDensity,
  uFogHeightFalloff: globalUniforms.uFogHeightFalloff,
  uFogBaseY: globalUniforms.uFogBaseY,
  uNight: globalUniforms.uNight,
});

// ---------------------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------------------

/** Skinned vertex shader shared by the depth prepass and the color pass. */
const GHOST_VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
attribute vec4 aMat;
varying vec3 vDwWorldPos;
varying vec3 vN;
varying float vEdge;
varying float vBodyZ;
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vDwWorldPos = wp.xyz;
  vN = normalize(mat3(modelMatrix) * objectNormal);
  vEdge = aMat.z;
  vBodyZ = position.z;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const GHOST_FRAG = /* glsl */ `
${FOG_PARS_GLSL}
uniform vec3 uTint;
uniform float uOpacity;
varying vec3 vDwWorldPos;
varying vec3 vN;
varying float vEdge;
varying float vBodyZ;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vDwWorldPos);
  float grazing = 1.0 - abs(dot(N, V));
  // Light running back along the body, like the rings' chasing bands.
  float band = 0.5 + 0.5 * sin(vBodyZ * 2.6 - uTime * 4.5);
  vec3 deep = uTint * 0.42;
  vec3 light = mix(uTint, vec3(1.0), 0.55);
  vec3 ink = mix(uTint * 0.16, vec3(0.03, 0.04, 0.08), 0.5);
  // Night: the ink line turns into a glowing outline instead.
  vec3 outline = mix(ink, uTint * 1.6 + 0.2, uNight);
#ifdef MEMBRANE
  // Flat skin: an even tint, its edges inked.
  float rim = 0.0;
  float edge = smoothstep(0.86, 0.97, vEdge);
  vec3 col = mix(deep, light, 0.18 + 0.12 * band);
  float a = 0.36 + 0.06 * band;
#else
  float rim = smoothstep(0.42, 0.66, grazing);
  float edge = smoothstep(0.74, 0.9, grazing);
  vec3 col = deep * (0.9 + 0.45 * band);
  float a = 0.42 + 0.08 * band;
#endif
  col = mix(col, light, rim * (1.0 - edge) * 0.85);
  col = mix(col, outline, edge);
  a = mix(a, 0.72, rim * (1.0 - edge));
  a = mix(a, 0.92, edge);
  // Haze softens it with distance but never swallows it.
  col = mix(dwApplyFog(col, vDwWorldPos, cameraPosition), col, 0.55);
  gl_FragColor = vec4(col, a * uOpacity);
}
`;

const DEPTH_FRAG = /* glsl */ `
void main() { gl_FragColor = vec4(0.0); }
`;

export interface GhostMaterials {
  body: ShaderMaterial;
  membrane: ShaderMaterial;
  depth: ShaderMaterial;
  depthMembrane: ShaderMaterial;
  tint: Color;
  opacity: { value: number };
}

export function createGhostMaterials(): GhostMaterials {
  const tint = new Color('#2f9dff');
  const opacity = { value: 1 };
  const color = (membrane: boolean) =>
    new ShaderMaterial({
      name: membrane ? 'race-ghost-membrane' : 'race-ghost-body',
      uniforms: { ...shared(), uTint: { value: tint }, uOpacity: opacity },
      vertexShader: GHOST_VERT,
      fragmentShader: GHOST_FRAG,
      defines: membrane ? { MEMBRANE: '' } : {},
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      side: membrane ? DoubleSide : FrontSide,
    });
  const depth = (membrane: boolean) =>
    new ShaderMaterial({
      name: 'race-ghost-depth',
      uniforms: {},
      vertexShader: GHOST_VERT,
      fragmentShader: DEPTH_FRAG,
      transparent: true,
      colorWrite: false,
      depthWrite: true,
      side: membrane ? DoubleSide : FrontSide,
    });
  return { body: color(false), membrane: color(true), depth: depth(false), depthMembrane: depth(true), tint, opacity };
}

// ---------------------------------------------------------------------------------------------
// Wingtip streamers
// ---------------------------------------------------------------------------------------------

const TRAIL_POINTS = 40;
/** Seconds a streamer sample lives, and the spacing between committed samples. */
const TRAIL_LIFE = 1.4;
const TRAIL_EVERY = TRAIL_LIFE / (TRAIL_POINTS - 2);
/** Half-width at the tip (m); never thinner than ~1.5 px. */
const TRAIL_WIDTH = 0.35;

const TRAIL_VERT = /* glsl */ `
attribute float aAge;
attribute float aSide;
varying float vAge;
varying float vSide;
varying vec3 vDwWorldPos;
void main() {
  vAge = aAge;
  vSide = aSide;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDwWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const TRAIL_FRAG = /* glsl */ `
${FOG_PARS_GLSL}
uniform vec3 uTint;
uniform float uOpacity;
varying float vAge;
varying float vSide;
varying vec3 vDwWorldPos;
void main() {
  float t = clamp(vAge, 0.0, 1.0);
  // A colored ribbon with a darker core line by day (reads on white) and a hot one at night.
  float core = 1.0 - smoothstep(0.0, 0.55, abs(vSide));
  vec3 col = mix(uTint * 0.9, mix(uTint * 0.35, uTint * 1.8 + 0.3, uNight), core);
  float a = (0.75 + 0.25 * core) * pow(1.0 - t, 1.5) * smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.75, 1.0, abs(vSide)));
  col = mix(dwApplyFog(col, vDwWorldPos, cameraPosition), col, 0.6);
  gl_FragColor = vec4(col, a * uOpacity);
}
`;

/** Two camera-facing ribbons trailing the wingtips (CPU-built: 160 vertices a frame). */
class Streamers {
  readonly mesh: Mesh;
  private pts = [new Float32Array(TRAIL_POINTS * 3), new Float32Array(TRAIL_POINTS * 3)];
  private born = new Float32Array(TRAIL_POINTS);
  private count = 0;
  private head = 0;
  private commitTimer = 0;
  private now = 0;
  private pos: BufferAttribute;
  private age: BufferAttribute;
  readonly material: ShaderMaterial;

  constructor(tint: Color, opacity: { value: number }) {
    const g = new BufferGeometry();
    const n = 2 * TRAIL_POINTS * 2;
    this.pos = new BufferAttribute(new Float32Array(n * 3), 3);
    this.pos.setUsage(DynamicDrawUsage);
    this.age = new BufferAttribute(new Float32Array(n), 1);
    this.age.setUsage(DynamicDrawUsage);
    const side = new Float32Array(n);
    const idx: number[] = [];
    for (let r = 0; r < 2; r++) {
      const base = r * TRAIL_POINTS * 2;
      for (let i = 0; i < TRAIL_POINTS; i++) {
        side[base + i * 2] = -1;
        side[base + i * 2 + 1] = 1;
        if (i < TRAIL_POINTS - 1) {
          const a = base + i * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    }
    g.setAttribute('position', this.pos);
    g.setAttribute('aAge', this.age);
    g.setAttribute('aSide', new BufferAttribute(side, 1));
    g.setIndex(idx);
    this.material = new ShaderMaterial({
      name: 'race-ghost-streamer',
      uniforms: { ...shared(), uTint: { value: tint }, uOpacity: opacity },
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.mesh = new Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = RENDER_ORDER - 1;
  }

  clear(): void {
    this.count = 0;
    this.commitTimer = 0;
  }

  /** Follow the tips; commit a sample every TRAIL_EVERY s; rebuild the strips facing the camera. */
  update(dt: number, left: Vector3, right: Vector3, camera: PerspectiveCamera): void {
    this.now += dt;
    this.commitTimer -= dt;
    if (this.count === 0 || this.commitTimer <= 0) {
      this.commitTimer = TRAIL_EVERY;
      this.head = (this.head + 1) % TRAIL_POINTS;
      this.count = Math.min(TRAIL_POINTS, this.count + 1);
      this.born[this.head] = this.now;
    }
    // The newest sample rides on the tip.
    left.toArray(this.pts[0], this.head * 3);
    right.toArray(this.pts[1], this.head * 3);
    const P = this.pos.array as Float32Array;
    const A = this.age.array as Float32Array;
    const cam = camera.position;
    const pixel = (2 * Math.tan((camera.fov * Math.PI) / 360)) / 1080;
    for (let r = 0; r < 2; r++) {
      const src = this.pts[r];
      const base = r * TRAIL_POINTS * 2;
      for (let i = 0; i < TRAIL_POINTS; i++) {
        // i = 0 is the newest sample.
        const k = (this.head - Math.min(i, this.count - 1) + TRAIL_POINTS) % TRAIL_POINTS;
        const kp = (this.head - Math.min(i + 1, this.count - 1) + TRAIL_POINTS) % TRAIL_POINTS;
        const kn = (this.head - Math.max(0, Math.min(i - 1, this.count - 1)) + TRAIL_POINTS) % TRAIL_POINTS;
        const x = src[k * 3];
        const y = src[k * 3 + 1];
        const z = src[k * 3 + 2];
        const tx = src[kn * 3] - src[kp * 3];
        const ty = src[kn * 3 + 1] - src[kp * 3 + 1];
        const tz = src[kn * 3 + 2] - src[kp * 3 + 2];
        const vx = x - cam.x;
        const vy = y - cam.y;
        const vz = z - cam.z;
        // side = tangent × view
        let sx = ty * vz - tz * vy;
        let sy = tz * vx - tx * vz;
        let sz = tx * vy - ty * vx;
        const sl = Math.hypot(sx, sy, sz) || 1;
        const age = i >= this.count ? 1 : Math.min(1, (this.now - this.born[k]) / TRAIL_LIFE);
        const dist = Math.hypot(vx, vy, vz);
        const w = Math.max(TRAIL_WIDTH * (1 - 0.5 * age), 1.5 * dist * pixel);
        sx = (sx / sl) * w;
        sy = (sy / sl) * w;
        sz = (sz / sl) * w;
        const o = (base + i * 2) * 3;
        P[o] = x - sx;
        P[o + 1] = y - sy;
        P[o + 2] = z - sz;
        P[o + 3] = x + sx;
        P[o + 4] = y + sy;
        P[o + 5] = z + sz;
        A[base + i * 2] = age;
        A[base + i * 2 + 1] = age;
      }
    }
    this.pos.needsUpdate = true;
    this.age.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// The ghost
// ---------------------------------------------------------------------------------------------

const _l = new Vector3();
const _r = new Vector3();

/** The look a recording's ghost is built with: its own look, as the breed it was flown on. */
export function ghostLookOf(g: GhostRecording): WyvernLook {
  return { ...g.look, breed: g.breed };
}

export class RaceGhost {
  readonly group = new Group();
  /** The model (null until the first ghost is shown). */
  wyvern: Wyvern | null = null;
  /** The recording the model was built for. */
  private builtFor: GhostRecording | null = null;
  private mesh: SkinnedMesh | null = null;
  private depthMesh: SkinnedMesh | null = null;
  private pose = createWyvernPose();
  private mats = createGhostMaterials();
  private streamers: Streamers;
  private visible = false;

  constructor(scene: Scene, _quality: QualityProfile) {
    this.group.name = 'race-ghost';
    this.streamers = new Streamers(this.mats.tint, this.mats.opacity);
    this.group.add(this.streamers.mesh);
    this.group.visible = false;
    scene.add(this.group);
  }

  get shown(): boolean {
    return this.visible;
  }

  /** Pose the ghost from a decoded sample of `rec`, tinted `color`. */
  show(rec: GhostRecording, s: GhostSample, color: string, dt: number, camera: PerspectiveCamera): void {
    if (!this.wyvern) {
      this.wyvern = new Wyvern(ghostLookOf(rec), { ghost: true });
      this.group.add(this.wyvern.group);
      this.builtFor = rec;
    } else if (this.builtFor !== rec) {
      this.wyvern.setLook(ghostLookOf(rec));
      this.builtFor = rec;
    }
    this.dress();
    this.mats.tint.set(color);
    if (!this.visible) this.streamers.clear();
    this.visible = true;
    this.group.visible = true;

    const pose = this.pose;
    pose.position.copy(s.position);
    pose.orientation.copy(s.orientation);
    pose.velocity.copy(s.velocity);
    pose.airborne = true;
    pose.airspeed = s.velocity.length();
    pose.wingSpread = s.wingSpread;
    pose.flapPhase = s.flapPhase;
    pose.flapStrength = s.flapStrength;
    pose.flare = s.flare;
    pose.gait = 'idle';
    pose.groundY = null;
    pose.lookTarget.copy(s.position).addScaledVector(s.velocity, 1.5);
    this.wyvern.update(dt, pose);
    this.wyvern.getWingtips(_l, _r);
    this.streamers.update(dt, _l, _r, camera);
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.group.visible = false;
    this.streamers.clear();
  }

  /** (Re)apply the ghost's own materials and depth prepass to the current model. */
  private dress(): void {
    const w = this.wyvern!;
    const mesh = w.skinnedMesh;
    if (!mesh || mesh === this.mesh) return;
    if (this.depthMesh) this.depthMesh.removeFromParent();
    this.mesh = mesh;
    const m = this.mats;
    mesh.material = [m.body, m.membrane] as Material[];
    mesh.renderOrder = RENDER_ORDER;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // Same geometry and skeleton, depth only, drawn first: the color pass then keeps only the
    // nearest surface.
    const depth = new SkinnedMesh(mesh.geometry, [m.depth, m.depthMembrane]);
    depth.bind(mesh.skeleton, mesh.bindMatrix);
    depth.boundingSphere = mesh.boundingSphere;
    depth.renderOrder = RENDER_ORDER - 0.5;
    depth.frustumCulled = mesh.frustumCulled;
    mesh.parent!.add(depth);
    this.depthMesh = depth;
  }

  dispose(): void {
    this.wyvern?.dispose();
    this.streamers.dispose();
    for (const m of [this.mats.body, this.mats.membrane, this.mats.depth, this.mats.depthMembrane]) m.dispose();
    this.group.removeFromParent();
  }
}
