// WebGL renderer + post chain: scene → bloom → grade (color, vignette, speed blur, fades) →
// output (ACES tone map + sRGB). MSAA happens in the composer's render target.

import {
  ACESFilmicToneMapping,
  Color,
  HalfFloatType,
  PCFShadowMap,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
  type Camera,
  type Scene,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { QUALITY, type QualityProfile } from './quality';
import type { QualityLevel } from '../core/types';

const GradeShader = {
  name: 'DriftwingGrade',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uExposure: { value: 1.0 },
    uSaturation: { value: 1.08 },
    uContrast: { value: 1.04 },
    uLift: { value: new Color(0.0, 0.0, 0.0) },
    uGain: { value: new Color(1.0, 1.0, 1.0) },
    uVignette: { value: 0.32 },
    /** 0..1 radial speed blur (dives). */
    uSpeedBlur: { value: 0 },
    /** 0..1 full-screen fade to uFadeColor (respawn, transitions). */
    uFade: { value: 0 },
    uFadeColor: { value: new Color(0.92, 0.95, 1.0) },
    /** 0..1 additive flash (ring passed, collectible). */
    uFlash: { value: 0 },
    uFlashColor: { value: new Color(1.0, 0.9, 0.6) },
    /** 0..1 white-out when flying through a cloud. */
    uCloudVeil: { value: 0 },
    uCloudColor: { value: new Color(0.9, 0.93, 0.97) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uExposure, uSaturation, uContrast, uVignette, uSpeedBlur, uFade, uFlash, uCloudVeil;
    uniform vec3 uLift, uGain, uFadeColor, uFlashColor, uCloudColor;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      vec2 uv = vUv;
      vec3 col = texture2D(tDiffuse, uv).rgb;
      if (uSpeedBlur > 0.001) {
        vec2 dir = uv - 0.5;
        float r = length(dir);
        float amt = uSpeedBlur * smoothstep(0.12, 0.7, r) * 0.06;
        vec3 acc = col;
        for (int i = 1; i < 8; i++) {
          acc += texture2D(tDiffuse, uv - dir * amt * float(i) / 7.0).rgb;
        }
        col = acc / 8.0;
      }
      col *= uExposure;
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);
      // Contrast around mid-grey, applied in linear HDR before tone mapping.
      col = max(col, 0.0);
      col = (col - 0.18) * uContrast + 0.18;
      col = max(col, 0.0);
      col = col * uGain + uLift * (1.0 - clamp(luma, 0.0, 1.0));
      col = mix(col, uCloudColor * (0.9 + 0.1 * hash(uv * 3.0 + uTime)), uCloudVeil);
      col += uFlashColor * uFlash;
      // Vignette.
      vec2 v = uv - 0.5;
      float vig = 1.0 - uVignette * smoothstep(0.25, 0.85, length(v * vec2(1.1, 1.0)) * 1.25);
      col *= vig;
      col = mix(col, uFadeColor, uFade);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export type GradeUniforms = typeof GradeShader.uniforms;

export class Renderer {
  readonly gl: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly grade: GradeUniforms;
  quality: QualityProfile;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private bloom: UnrealBloomPass;
  private gradePass: ShaderPass;
  private target: WebGLRenderTarget;
  private resolutionScale = 1;
  private size = new Vector2();

  constructor(container: HTMLElement, level: QualityLevel = 'high') {
    this.quality = QUALITY[level];
    this.gl = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.gl.outputColorSpace = SRGBColorSpace;
    this.gl.toneMapping = ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.0;
    this.gl.shadowMap.enabled = this.quality.shadows;
    this.gl.shadowMap.type = PCFShadowMap;
    this.canvas = this.gl.domElement;
    this.canvas.tabIndex = 0;
    container.appendChild(this.canvas);

    this.target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: this.quality.msaa });
    this.composer = new EffectComposer(this.gl, this.target);
    this.renderPass = new RenderPass(undefined as unknown as Scene, undefined as unknown as Camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new Vector2(256, 256), 0.32, 0.55, 0.86);
    this.bloom.enabled = this.quality.bloom;
    this.composer.addPass(this.bloom);
    this.gradePass = new ShaderPass(GradeShader);
    this.grade = this.gradePass.uniforms as unknown as GradeUniforms;
    this.composer.addPass(this.gradePass);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(level: QualityLevel, resolutionScale = this.resolutionScale): void {
    this.quality = QUALITY[level];
    this.resolutionScale = resolutionScale;
    this.gl.shadowMap.enabled = this.quality.shadows;
    this.bloom.enabled = this.quality.bloom;
    this.target.samples = this.quality.msaa;
    this.resize();
  }

  /** Bloom strength (sky module raises it at dusk/night for glowing lanterns). */
  setBloom(strength: number, threshold?: number): void {
    this.bloom.strength = strength;
    if (threshold !== undefined) this.bloom.threshold = threshold;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap) * this.resolutionScale;
    this.gl.setPixelRatio(pr);
    this.gl.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    // Bloom at half resolution is plenty and much cheaper.
    this.bloom.resolution.set(Math.max(1, (w * pr) / 2), Math.max(1, (h * pr) / 2));
    this.size.set(w, h);
    for (const fn of this.resizeListeners) fn(w, h);
  }

  private resizeListeners: ((w: number, h: number) => void)[] = [];
  onResize(fn: (w: number, h: number) => void): void {
    this.resizeListeners.push(fn);
    fn(this.size.x, this.size.y);
  }

  get aspect(): number {
    return this.size.x / Math.max(1, this.size.y);
  }

  render(scene: Scene, camera: Camera, dt: number): void {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.grade.uTime.value += dt;
    this.composer.render(dt);
  }

  /** Render without post (for the stable preview inset or debug captures). */
  renderRaw(scene: Scene, camera: Camera): void {
    this.gl.setRenderTarget(null);
    this.gl.render(scene, camera);
  }
}
