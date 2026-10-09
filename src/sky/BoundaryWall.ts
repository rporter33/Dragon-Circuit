// The storm at the edge of the world: a ring-shaped curtain of rising, wind-torn haze standing in
// the cloud sea just beyond the boundary radius, where the headwind turns flyers back. It shows
// only as you approach (it fades in from ~2 km), so the open horizon seen from the islands stays
// clear; up close it is a towering, softly lit wall of storm vapour with a billowing crown.
//
// One open cylinder, drawn after the opaque world (depth-tested against the cloud sea, so it
// rises out of the billows) and hidden entirely while the camera is far from every part of it.

import { CylinderGeometry, DoubleSide, Mesh, NormalBlending, ShaderMaterial, Vector2, Vector3, type Scene } from 'three';
import { FOG_PARS_GLSL } from '../render/painterly';
import { globalUniforms } from '../render/uniforms';
import { mulberry32 } from '../core/rng';
import { SEA_BASE } from './CloudSea';
import type { SeaShared } from './CloudSea';

/** Height of the curtain's crown above the sea (m), before the billows ride up and down on it. */
const CROWN = 720;
/** Distance from the camera over which the curtain fades in (m). */
const FADE_NEAR = 1100;
const FADE_FAR = 2100;

const VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAGMENT = /* glsl */ `
${FOG_PARS_GLSL}
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uFlash;
uniform float uNow;
uniform float uCrown;
uniform vec2 uFade;
uniform float uFlicker;
uniform vec3 uFlickerPos;
varying vec3 vWorld;

float bwHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float bwNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bwHash(i), bwHash(i + vec3(1, 0, 0)), f.x), mix(bwHash(i + vec3(0, 1, 0)), bwHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(bwHash(i + vec3(0, 0, 1)), bwHash(i + vec3(1, 0, 1)), f.x), mix(bwHash(i + vec3(0, 1, 1)), bwHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

void main() {
  float dist = length(vWorld - cameraPosition);
  float show = (1.0 - smoothstep(uFade.x, uFade.y, dist)) * smoothstep(25.0, 140.0, dist);
  if (show < 0.004) discard;
  float y = vWorld.y;
  // A billowing crown: big slow heads with smaller ones on them.
  float heads = bwNoise(vec3(vWorld.x / 640.0, uNow * 0.004, vWorld.z / 640.0));
  float small = bwNoise(vec3(vWorld.x / 190.0, 3.7 + uNow * 0.01, vWorld.z / 190.0));
  float crown = uCrown + (heads - 0.5) * 520.0 + (small - 0.5) * 150.0;
  float body = 1.0 - smoothstep(crown - 220.0, crown + 30.0, y);
  if (body * show < 0.004) discard;
  // Texture: lumpy cumulus cells boiling slowly upward, streaked by the rising wind.
  vec3 w = vWorld;
  float billow = bwNoise(vec3(w.x / 150.0, (y - uNow * 3.0) / 120.0, w.z / 150.0)) * 0.6
               + bwNoise(vec3(w.x / 55.0, (y - uNow * 5.0) / 48.0, w.z / 55.0) + 3.3) * 0.4;
  float warp = bwNoise(vec3(w.x / 300.0, y / 400.0, w.z / 300.0)) * 3.0;
  float streak = bwNoise(vec3(w.x / 70.0 + warp, (y - uNow * 9.0) / 260.0, w.z / 70.0 + warp));
  float tex = mix(billow, streak, 0.3);
  float density = body * (0.75 + 0.25 * smoothstep(0.25, 0.75, tex));
  // Shade like a cumulonimbus: sunlit heads along the crown, a heavy slate body beneath them
  // (bulges a little lighter than the folds), darkest at the foot where it boils out of the sea.
  float below = max(crown - y, 0.0);
  float lit = exp(-below / 130.0) * (0.55 + 0.45 * small);
  float foot = 1.0 - smoothstep(20.0, 360.0, y);
  vec3 dark = uCloudShade * vec3(0.2, 0.22, 0.3);
  vec3 mid = uCloudShade * vec3(0.48, 0.5, 0.6);
  vec3 col = mix(dark, mid, smoothstep(0.3, 0.8, billow));
  col = mix(col, uCloudLit * 0.92, lit);
  col *= 1.0 - 0.35 * foot;
  // Lightning flickering deep inside the wall.
  float fl = uFlicker * exp(-length(vWorld - uFlickerPos) / 420.0);
  col += vec3(0.72, 0.78, 1.0) * fl * (1.2 - lit) * (0.6 + 0.4 * streak);
  col += vec3(0.7, 0.75, 1.0) * uFlash * 0.25;
  col = dwApplyFog(col, vWorld, cameraPosition);
  float a = clamp(density * 1.05, 0.0, 1.0) * show;
  gl_FragColor = vec4(col, a);
}
`;

export class BoundaryWall {
  readonly mesh: Mesh;
  private material: ShaderMaterial;
  private radius: number;
  private now = { value: 0 };
  private flicker = { value: 0 };
  private flickerPos = new Vector3();
  private nextFlicker = 3;
  private flickerAge = 99;
  private rand = mulberry32(0xb017);

  constructor(scene: Scene, radius: number, shared: Pick<SeaShared, 'uCloudLit' | 'uCloudShade' | 'uFlash'>) {
    this.radius = radius;
    const height = CROWN + 420 - SEA_BASE;
    const geo = new CylinderGeometry(radius, radius, height, 96, 1, true);
    geo.translate(0, SEA_BASE + height / 2, 0);
    this.material = new ShaderMaterial({
      name: 'DriftwingBoundaryWall',
      uniforms: {
        ...globalUniforms,
        uCloudLit: shared.uCloudLit,
        uCloudShade: shared.uCloudShade,
        uFlash: shared.uFlash,
        uNow: this.now,
        uCrown: { value: CROWN },
        uFade: { value: new Vector2(FADE_NEAR, FADE_FAR) },
        uFlicker: this.flicker,
        uFlickerPos: { value: this.flickerPos },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: NormalBlending,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.name = 'boundaryWall';
    this.mesh.frustumCulled = false;
    // Behind every other transparent thing: it is the farthest thing in the world.
    this.mesh.renderOrder = -2;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Show it only when some part of the ring is within fade range of the camera. */
  update(dt: number, camera: { position: Vector3 }): void {
    this.now.value += dt;
    const p = camera.position;
    const r = Math.hypot(p.x, p.z);
    this.mesh.visible = this.radius - r < FADE_FAR + 50;
    if (!this.mesh.visible) return;
    // Now and then lightning flickers inside the wall, somewhere ahead of the camera.
    this.nextFlicker -= dt;
    this.flickerAge += dt;
    if (this.nextFlicker <= 0) {
      this.nextFlicker = 2.5 + this.rand() * 7;
      this.flickerAge = 0;
      const a = Math.atan2(p.z, p.x) + (this.rand() - 0.5) * 0.5;
      this.flickerPos.set(Math.cos(a) * (this.radius + 120), 180 + this.rand() * 380, Math.sin(a) * (this.radius + 120));
    }
    // A double flash, then gone.
    const t = this.flickerAge;
    this.flicker.value = t < 0.6 ? Math.max(Math.exp(-t * 14), 0.7 * Math.exp(-Math.max(0, t - 0.18) * 10) * (t > 0.18 ? 1 : 0)) : 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
