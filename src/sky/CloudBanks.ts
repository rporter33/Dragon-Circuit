// Cumulus banks among the islands: instanced soft puffs (camera-facing, normal-mapped) lit by
// the key light with the shared painterly cloud model — flat shaded bases, bright crowns, silver
// edges against the sun. Puffs are depth-sorted every frame (insertion sort on a nearly sorted
// list) and fade out as the camera enters them, where the grade's cloud veil takes over.

import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  type PerspectiveCamera,
  type Scene,
  type Texture,
} from 'three';
import { FOG_PARS_GLSL } from '../render/painterly';
import { globalUniforms } from '../render/uniforms';
import { CLOUD_SHADE_GLSL, NOISE_GLSL, RAMP_GLSL } from './glsl';
import type { CloudBankField } from './cloudBankField';
import type { SeaShared } from './CloudSea';

const VERTEX = /* glsl */ `
attribute vec3 aCenter;
attribute vec4 aPuff; // radius, rotation, shade (0 base .. 1 crown), alpha
attribute float aVariant;
attribute vec4 aBank; // bank center xyz, bank half-width
varying vec4 vBank;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vFace;
varying vec2 vRot;
varying float vShade;
varying float vAlpha;

void main() {
  vec3 toCam = cameraPosition - aCenter;
  float dist = length(toCam);
  vec3 f = toCam / max(dist, 1e-3);
  vec3 r = cross(vec3(0.0, 1.0, 0.0), f);
  r = length(r) < 1e-3 ? vec3(1.0, 0.0, 0.0) : normalize(r);
  vec3 u = cross(f, r);
  float c = cos(aPuff.y);
  float s = sin(aPuff.y);
  vec2 corner = position.xy;
  vec2 rc = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);
  float radius = aPuff.x;
  // Pull the card toward the camera so its depth sits nearer the puff's front surface.
  vec3 world = aCenter + (r * rc.x + u * rc.y) * radius + f * radius * 0.35;
  vWorld = world;
  vRight = r;
  vUp = u;
  vFace = f;
  vRot = vec2(c, s);
  vShade = aPuff.z;
  vBank = aBank;
  // Fade the card out as the camera pushes into the puff (the veil takes over from there).
  float near = smoothstep(radius * 0.45, radius * 1.35, dist);
  vAlpha = aPuff.w * near;
  float vx = mod(aVariant, 2.0);
  float vy = floor(aVariant / 2.0);
  vUv = (vec2(vx, vy) + (corner * 0.5 + 0.5) * (2.0 / 2.2) + (1.0 - 2.0 / 2.2) * 0.5) * 0.5;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
${FOG_PARS_GLSL}
${NOISE_GLSL}
${RAMP_GLSL}
${CLOUD_SHADE_GLSL}
uniform sampler2D uPuffTex;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vFace;
varying vec2 vRot;
varying float vShade;
varying float vAlpha;
varying vec4 vBank;

void main() {
  vec4 tex = texture2D(uPuffTex, vUv);
  float alpha = tex.a * vAlpha;
  if (alpha < 0.003) discard;
  vec2 nq = tex.rg * 2.0 - 1.0;
  vec2 nb = vec2(vRot.x * nq.x - vRot.y * nq.y, vRot.y * nq.x + vRot.x * nq.y);
  float nz = sqrt(max(0.0, 1.0 - dot(nb, nb)));
  vec3 nPuff = normalize(vRight * nb.x + vUp * nb.y + vFace * nz);
  // Shade the whole bank as one big soft dome, with each puff adding its lumps on top —
  // otherwise a bank reads as a pile of separately lit balls.
  vec3 surf = vWorld + vFace * tex.b * vBank.w * 0.25;
  vec3 nBank = normalize((surf - vBank.xyz) * vec3(1.0, 1.5, 1.0) + vec3(0.0, vBank.w * 0.2, 0.0));
  // Thin, fading edges take the bank's normal: no dark outlines around puffs.
  vec3 n = normalize(nBank * 0.65 + nPuff * 0.45 * smoothstep(0.15, 0.7, tex.a));
  vec3 rd = -vFace;
  float ndl = dot(n, uSunDir);
  float band = dwSoftRamp(clamp(ndl * 0.55 + 0.5, 0.0, 1.0), 0.13);
  // Flat, shaded bases; sunlit crowns.
  float height = mix(0.5, 1.0, smoothstep(0.0, 0.8, vShade));
  vec3 col = uCloudShade * mix(0.82, 1.05, vShade);
  col += (uCloudLit - uCloudShade * 0.5) * band * height;
  // Silver lining: thin edges glow when the sun is behind the cloud.
  float back = pow(max(dot(rd, uSunDir), 0.0), 6.0);
  col += uCloudLit * back * (1.0 - tex.b) * 1.4;
  col += dwFlashGlow(vWorld) * 0.8;
  col = dwApplyFog(col, vWorld, cameraPosition);
  gl_FragColor = vec4(col, alpha);
}
`;

export class CloudBanks {
  readonly mesh: Mesh;
  private field: CloudBankField;
  private geometry: InstancedBufferGeometry;
  private aCenter: InstancedBufferAttribute;
  private aPuff: InstancedBufferAttribute;
  private aVariant: InstancedBufferAttribute;
  private aBank: InstancedBufferAttribute;
  private bankOf: Int32Array;
  private order: Int32Array;
  private depth: Float32Array;
  private rotations: Float32Array;
  private shades: Float32Array;
  private variants: Float32Array;

  constructor(scene: Scene, field: CloudBankField, puffTex: Texture, shared: SeaShared) {
    this.field = field;
    const n = field.puffCount;
    const quad = new PlaneGeometry(2, 2);
    this.geometry = new InstancedBufferGeometry();
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.aCenter = new InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(DynamicDrawUsage);
    this.aPuff = new InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(DynamicDrawUsage);
    this.aVariant = new InstancedBufferAttribute(new Float32Array(n), 1).setUsage(DynamicDrawUsage);
    this.aBank = new InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('aCenter', this.aCenter);
    this.geometry.setAttribute('aPuff', this.aPuff);
    this.geometry.setAttribute('aVariant', this.aVariant);
    this.geometry.setAttribute('aBank', this.aBank);
    this.geometry.instanceCount = n;

    this.order = new Int32Array(n);
    for (let i = 0; i < n; i++) this.order[i] = i;
    this.depth = new Float32Array(n);
    this.rotations = new Float32Array(n);
    this.shades = new Float32Array(n);
    this.variants = new Float32Array(n);
    this.bankOf = new Int32Array(n);
    let k = 0;
    for (let b = 0; b < field.banks.length; b++) {
      for (const p of field.banks[b].puffs) {
        this.bankOf[k] = b;
        this.rotations[k] = p.rotation;
        this.shades[k] = p.shade;
        this.variants[k] = p.variant;
        k++;
      }
    }

    const material = new ShaderMaterial({
      name: 'DriftwingCloudBanks',
      uniforms: { ...globalUniforms, ...shared, uPuffTex: { value: puffTex } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.name = 'cloudBanks';
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Sort back to front and upload. Call after the field has been updated this frame. */
  update(camera: PerspectiveCamera): void {
    const f = this.field;
    const n = f.puffCount;
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    const c = f.centers;
    for (let i = 0; i < n; i++) {
      const dx = c[i * 3] - cx;
      const dy = c[i * 3 + 1] - cy;
      const dz = c[i * 3 + 2] - cz;
      this.depth[i] = dx * dx + dy * dy + dz * dz;
    }
    // Insertion sort, far to near: the order barely changes between frames, so this is ~O(n).
    const o = this.order;
    const d = this.depth;
    for (let i = 1; i < n; i++) {
      const v = o[i];
      const dv = d[v];
      let j = i - 1;
      while (j >= 0 && d[o[j]] < dv) {
        o[j + 1] = o[j];
        j--;
      }
      o[j + 1] = v;
    }
    const ac = this.aCenter.array as Float32Array;
    const ap = this.aPuff.array as Float32Array;
    const av = this.aVariant.array as Float32Array;
    const ab = this.aBank.array as Float32Array;
    let visible = 0;
    for (let i = 0; i < n; i++) {
      const k = o[i];
      if (f.alphas[k] < 0.004) continue;
      ac[visible * 3] = c[k * 3];
      ac[visible * 3 + 1] = c[k * 3 + 1];
      ac[visible * 3 + 2] = c[k * 3 + 2];
      ap[visible * 4] = f.radii[k];
      ap[visible * 4 + 1] = this.rotations[k];
      ap[visible * 4 + 2] = this.shades[k];
      ap[visible * 4 + 3] = f.alphas[k];
      av[visible] = this.variants[k];
      const b = this.bankOf[k];
      const bank = f.banks[b];
      const grow = 0.55 + 0.45 * f.bankAlpha[b];
      ab[visible * 4] = f.bankPos[b * 3];
      ab[visible * 4 + 1] = f.bankPos[b * 3 + 1] + bank.height * 0.3 * grow;
      ab[visible * 4 + 2] = f.bankPos[b * 3 + 2];
      ab[visible * 4 + 3] = bank.width * grow;
      visible++;
    }
    this.geometry.instanceCount = visible;
    this.mesh.visible = visible > 0;
    this.aCenter.needsUpdate = true;
    this.aPuff.needsUpdate = true;
    this.aVariant.needsUpdate = true;
    this.aBank.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}
