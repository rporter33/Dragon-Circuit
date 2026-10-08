// Bloom as a mip chain (the "dual filter" family used by most current engines):
//
//   prefilter  scene (full res) → L0 (half res): 4 bilinear taps (a 4×4 footprint), each passed
//              through a soft threshold, then a luma-weighted (Karis) average so a single bright
//              pixel can't flicker the whole halo.
//   down       L(i) → L(i+1): 13-tap filter (Jimenez 2014), box-weighted, no aliasing shimmer.
//   up         L(i+1) → L(i): 3×3 tent, blended additively on top of L(i), coarsest first.
//
// L0 then holds the whole halo (every level summed, each progressively wider). The grade pass
// adds it to the scene in the same draw that tone maps, so bloom costs no full-resolution pass and
// never writes into the multisampled scene target. The level count is the quality knob: each
// extra level doubles the halo's reach for a quarter of the previous level's cost.

import {
  AddEquation,
  CustomBlending,
  HalfFloatType,
  LinearFilter,
  NoBlending,
  OneFactor,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { POST_VERTEX, PostQuad } from './quad';

const PREFILTER_FRAG = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uTexel;       // source texel size
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Soft threshold: the full color passes above threshold + knee, nothing below threshold - knee,
// with a smooth ramp between (no popping as a pixel crosses the line).
vec3 bright(vec3 c) {
  float l = luma(c);
  return c * smoothstep(uThreshold - uKnee, uThreshold + uKnee, l);
}

void main() {
  vec3 a = bright(texture2D(tSource, vUv + uTexel * vec2(-1.0, -1.0)).rgb);
  vec3 b = bright(texture2D(tSource, vUv + uTexel * vec2( 1.0, -1.0)).rgb);
  vec3 c = bright(texture2D(tSource, vUv + uTexel * vec2(-1.0,  1.0)).rgb);
  vec3 d = bright(texture2D(tSource, vUv + uTexel * vec2( 1.0,  1.0)).rgb);
  // Karis average: weight each tap by 1/(1+luma) so isolated hot pixels don't dominate.
  float wa = 1.0 / (1.0 + luma(a));
  float wb = 1.0 / (1.0 + luma(b));
  float wc = 1.0 / (1.0 + luma(c));
  float wd = 1.0 / (1.0 + luma(d));
  vec3 col = (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
  gl_FragColor = vec4(min(col, vec3(64.0)), 1.0);
}
`;

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uTexel;       // source texel size
varying vec2 vUv;

void main() {
  vec2 t = uTexel;
  vec3 a = texture2D(tSource, vUv + t * vec2(-2.0,  2.0)).rgb;
  vec3 b = texture2D(tSource, vUv + t * vec2( 0.0,  2.0)).rgb;
  vec3 c = texture2D(tSource, vUv + t * vec2( 2.0,  2.0)).rgb;
  vec3 d = texture2D(tSource, vUv + t * vec2(-2.0,  0.0)).rgb;
  vec3 e = texture2D(tSource, vUv).rgb;
  vec3 f = texture2D(tSource, vUv + t * vec2( 2.0,  0.0)).rgb;
  vec3 g = texture2D(tSource, vUv + t * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture2D(tSource, vUv + t * vec2( 0.0, -2.0)).rgb;
  vec3 i = texture2D(tSource, vUv + t * vec2( 2.0, -2.0)).rgb;
  vec3 j = texture2D(tSource, vUv + t * vec2(-1.0,  1.0)).rgb;
  vec3 k = texture2D(tSource, vUv + t * vec2( 1.0,  1.0)).rgb;
  vec3 l = texture2D(tSource, vUv + t * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture2D(tSource, vUv + t * vec2( 1.0, -1.0)).rgb;
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  gl_FragColor = vec4(col, 1.0);
}
`;

const UP_FRAG = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uTexel;       // source (coarser level) texel size
uniform float uWeight;
varying vec2 vUv;

void main() {
  vec2 t = uTexel;
  vec3 col = texture2D(tSource, vUv).rgb * 4.0;
  col += (texture2D(tSource, vUv + vec2(-t.x, 0.0)).rgb + texture2D(tSource, vUv + vec2(t.x, 0.0)).rgb
        + texture2D(tSource, vUv + vec2(0.0, -t.y)).rgb + texture2D(tSource, vUv + vec2(0.0, t.y)).rgb) * 2.0;
  col += texture2D(tSource, vUv + vec2(-t.x, -t.y)).rgb + texture2D(tSource, vUv + vec2(t.x, -t.y)).rgb
       + texture2D(tSource, vUv + vec2(-t.x, t.y)).rgb + texture2D(tSource, vUv + vec2(t.x, t.y)).rgb;
  gl_FragColor = vec4(col * (uWeight / 16.0), 1.0);
}
`;

function pass(fragmentShader: string, name: string, additive = false): ShaderMaterial {
  return new ShaderMaterial({
    name,
    uniforms: {
      tSource: { value: null },
      uTexel: { value: new Vector2(1, 1) },
      uThreshold: { value: 0.85 },
      uKnee: { value: 0.12 },
      uWeight: { value: 1 },
    },
    vertexShader: POST_VERTEX,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    // Additive: dst = dst + src (the coarser level's halo on top of this level).
    blending: additive ? CustomBlending : NoBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    toneMapped: false,
  });
}

export class BloomChain {
  /** Bloom threshold (linear scene luminance) and soft knee half-width. */
  threshold = 0.85;
  knee = 0.12;
  private levels: WebGLRenderTarget[] = [];
  private count = 0;
  private width = 1;
  private height = 1;
  private readonly prefilter = new PostQuad(pass(PREFILTER_FRAG, 'DriftwingBloomPrefilter'));
  private readonly down = new PostQuad(pass(DOWN_FRAG, 'DriftwingBloomDown'));
  private readonly up = new PostQuad(pass(UP_FRAG, 'DriftwingBloomUp', true));

  constructor(levels: number) {
    this.setLevels(levels);
  }

  /** The post-pass meshes, for shader warmup. */
  get quads(): PostQuad[] {
    return [this.prefilter, this.down, this.up];
  }

  get levelCount(): number {
    return this.count;
  }

  setLevels(n: number): void {
    n = Math.max(1, Math.min(8, Math.round(n)));
    if (n === this.count) return;
    for (const t of this.levels) t.dispose();
    this.levels = [];
    for (let i = 0; i < n; i++) {
      const t = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter });
      t.texture.name = `DriftwingBloom.L${i}`;
      t.texture.generateMipmaps = false;
      this.levels.push(t);
    }
    this.count = n;
    this.setSize(this.width, this.height);
  }

  /** Size of the source (scene) buffer in pixels; L0 is half that. */
  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    let w = width;
    let h = height;
    for (const t of this.levels) {
      w = Math.max(1, Math.ceil(w / 2));
      h = Math.max(1, Math.ceil(h / 2));
      t.setSize(w, h);
    }
  }

  /** A render target to compile the passes against (any non-screen target will do). */
  get compileTarget(): WebGLRenderTarget {
    return this.levels[0];
  }

  /** Run the chain on `source` (linear HDR) and return the summed halo at half resolution. */
  render(gl: WebGLRenderer, source: Texture): Texture {
    const autoClear = gl.autoClear;
    gl.autoClear = false;

    const pre = this.prefilter.material.uniforms;
    pre.tSource.value = source;
    pre.uTexel.value.set(1 / this.width, 1 / this.height);
    pre.uThreshold.value = this.threshold;
    pre.uKnee.value = this.knee;
    gl.setRenderTarget(this.levels[0]);
    this.prefilter.render(gl);

    const down = this.down.material.uniforms;
    for (let i = 1; i < this.count; i++) {
      const src = this.levels[i - 1];
      down.tSource.value = src.texture;
      down.uTexel.value.set(1 / src.width, 1 / src.height);
      gl.setRenderTarget(this.levels[i]);
      this.down.render(gl);
    }

    const up = this.up.material.uniforms;
    for (let i = this.count - 2; i >= 0; i--) {
      const src = this.levels[i + 1];
      up.tSource.value = src.texture;
      up.uTexel.value.set(1 / src.width, 1 / src.height);
      up.uWeight.value = 1;
      gl.setRenderTarget(this.levels[i]);
      this.up.render(gl);
    }

    gl.autoClear = autoClear;
    return this.levels[0].texture;
  }

  dispose(): void {
    for (const t of this.levels) t.dispose();
    this.levels = [];
    this.count = 0;
    for (const q of this.quads) q.dispose();
  }
}
