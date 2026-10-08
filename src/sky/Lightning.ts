// Distant lightning: a jagged, branching bolt from the storm deck down into the cloud sea, a few
// kilometres away, flickering over half a second. Never close, never a hazard — just weather.

import {
  DoubleSide,
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  ShaderMaterial,
  Vector3,
  type Scene,
} from 'three';
import { mulberry32 } from '../core/rng';
import { FOG_PARS_GLSL } from '../render/painterly';
import { globalUniforms } from '../render/uniforms';

const MAX_SEGMENTS = 160;
const TOP_Y = 1050;
const BOTTOM_Y = 10;

const VERTEX = /* glsl */ `
attribute vec3 aOther;
attribute float aSide;
attribute float aWidth;
attribute float aBright;
varying float vSide;
varying float vBright;
varying vec3 vWorld;
void main() {
  vec3 dir = normalize(aOther - position);
  vec3 view = normalize(position - cameraPosition);
  vec3 side = normalize(cross(dir, view) + vec3(1e-5, 0.0, 0.0));
  float dist = length(position - cameraPosition);
  // Stay at least a couple of pixels wide at any distance.
  float width = max(aWidth, dist * 0.0016 * aWidth / 4.0);
  vec3 world = position + side * aSide * width;
  vSide = aSide;
  vBright = aBright;
  vWorld = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
${FOG_PARS_GLSL}
uniform float uBolt;
varying float vSide;
varying float vBright;
varying vec3 vWorld;
void main() {
  float e = 1.0 - abs(vSide);
  float core = pow(e, 3.0);
  vec3 col = (vec3(0.75, 0.8, 1.0) * e * e + vec3(1.0) * core) * vBright * uBolt * 3.0;
  // Let the fog soften it a little, but it should still punch through rain haze.
  vec3 fogged = dwApplyFog(col, vWorld, cameraPosition);
  col = mix(col, fogged, 0.5);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class LightningBolt {
  readonly mesh: Mesh;
  /** 0..~1.4 current flash brightness. */
  flash = 0;
  /** Where the bolt meets the cloud sea. */
  readonly position = new Vector3();
  private time = 99;
  private pulses = [0, 0, 0];
  private amps = [1, 0.6, 0.85];
  private positions: Float32Array;
  private others: Float32Array;
  private widths: Float32Array;
  private brights: Float32Array;
  private geometry: BufferGeometry;
  private uBolt = { value: 0 };
  private intensityScale = 1;

  constructor(scene: Scene) {
    const verts = MAX_SEGMENTS * 4;
    this.positions = new Float32Array(verts * 3);
    this.others = new Float32Array(verts * 3);
    this.widths = new Float32Array(verts);
    this.brights = new Float32Array(verts);
    const sides = new Float32Array(verts);
    const index = new Uint16Array(MAX_SEGMENTS * 6);
    for (let s = 0; s < MAX_SEGMENTS; s++) {
      sides[s * 4] = -1;
      sides[s * 4 + 1] = 1;
      sides[s * 4 + 2] = -1;
      sides[s * 4 + 3] = 1;
      const v = s * 4;
      index.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], s * 6);
    }
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aOther', new BufferAttribute(this.others, 3));
    this.geometry.setAttribute('aSide', new BufferAttribute(sides, 1));
    this.geometry.setAttribute('aWidth', new BufferAttribute(this.widths, 1));
    this.geometry.setAttribute('aBright', new BufferAttribute(this.brights, 1));
    this.geometry.setIndex(new BufferAttribute(index, 1));
    this.geometry.setDrawRange(0, 0);
    const material = new ShaderMaterial({
      name: 'DriftwingLightning',
      // Ribbon winding depends on the view, so draw both faces.
      side: DoubleSide,
      uniforms: { ...globalUniforms, uBolt: this.uBolt },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.name = 'lightning';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Strike at ground point (x, z) with a seeded shape. `scale` < 1 tones it down (reduced motion). */
  strike(x: number, z: number, seed: number, scale = 1): void {
    const rnd = mulberry32(seed);
    this.time = 0;
    this.intensityScale = scale;
    this.pulses[1] = 0.06 + rnd() * 0.06;
    this.pulses[2] = 0.18 + rnd() * 0.14;
    this.amps[2] = 0.5 + rnd() * 0.5;
    this.position.set(x, BOTTOM_Y, z);

    let seg = 0;
    const addSeg = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, br: number) => {
      if (seg >= MAX_SEGMENTS) return;
      const v = seg * 4;
      for (let k = 0; k < 4; k++) {
        const end = k >= 2;
        const i3 = (v + k) * 3;
        this.positions[i3] = end ? bx : ax;
        this.positions[i3 + 1] = end ? by : ay;
        this.positions[i3 + 2] = end ? bz : az;
        // Direction is always a→b so both ends agree on which side is which.
        this.others[i3] = end ? bx + (bx - ax) : bx;
        this.others[i3 + 1] = end ? by + (by - ay) : by;
        this.others[i3 + 2] = end ? bz + (bz - az) : bz;
        this.widths[v + k] = w;
        this.brights[v + k] = br;
      }
      seg++;
    };

    // Main channel: a random walk down from the storm deck, leaning a little.
    const steps = 46;
    const nodes: [number, number, number][] = [];
    let px = x + (rnd() - 0.5) * 300;
    let pz = z + (rnd() - 0.5) * 300;
    let vx = 0;
    let vz = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = TOP_Y + (BOTTOM_Y - TOP_Y) * t;
      // Converge on the strike point toward the bottom.
      vx = vx * 0.5 + (rnd() - 0.5) * 70;
      vz = vz * 0.5 + (rnd() - 0.5) * 70;
      px += vx + (x - px) * t * 0.25;
      pz += vz + (z - pz) * t * 0.25;
      nodes.push([px, y, pz]);
    }
    for (let i = 0; i < steps; i++) {
      const [ax, ay, az] = nodes[i];
      const [bx, by, bz] = nodes[i + 1];
      addSeg(ax, ay, az, bx, by, bz, 6, 1);
    }
    // Branches fork off and die out.
    const branches = 3 + Math.floor(rnd() * 3);
    for (let b = 0; b < branches; b++) {
      let [bx, by, bz] = nodes[4 + Math.floor(rnd() * (steps * 0.6))];
      const dirx = (rnd() - 0.5) * 2;
      const dirz = (rnd() - 0.5) * 2;
      const len = 8 + Math.floor(rnd() * 12);
      for (let i = 0; i < len; i++) {
        const nx = bx + dirx * 30 + (rnd() - 0.5) * 50;
        const ny = by - (14 + rnd() * 22);
        const nz = bz + dirz * 30 + (rnd() - 0.5) * 50;
        const fade = 1 - i / len;
        addSeg(bx, by, bz, nx, ny, nz, 3.5 * fade + 1, 0.55 * fade + 0.15);
        bx = nx;
        by = ny;
        bz = nz;
      }
    }
    this.geometry.setDrawRange(0, seg * 6);
    for (const name of ['position', 'aOther', 'aWidth', 'aBright']) {
      (this.geometry.getAttribute(name) as BufferAttribute).needsUpdate = true;
    }
  }

  update(dt: number): void {
    this.time += dt;
    let f = 0;
    for (let i = 0; i < 3; i++) {
      const t = this.time - this.pulses[i];
      if (t >= 0) f += this.amps[i] * Math.exp(-t * 13);
    }
    this.flash = f * this.intensityScale;
    this.uBolt.value = Math.min(1.5, f) * this.intensityScale;
    this.mesh.visible = f > 0.02;
  }
}
