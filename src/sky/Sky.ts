// Sky, sun and lighting. (Baseline: gradient dome, a sun light, hemisphere fill and a flat cloud
// sea. The sky module owner implements the day/night cycle, stars, clouds and full lighting.)

import {
  BackSide,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import type { Settings } from '../core/types';
import type { SkySystem } from '../game/contracts';
import type { QualityProfile } from '../render/quality';
import type { Renderer } from '../render/renderer';
import { globalUniforms } from '../render/uniforms';
import { applyPainterly } from '../render/painterly';

export class Sky implements SkySystem {
  timeOfDay = 0.36;
  sunDirection = new Vector3();
  night = 0;
  private sun: DirectionalLight;
  private hemi: HemisphereLight;
  private dome: Mesh;
  private sea: Mesh;
  private quality: QualityProfile;

  constructor(scene: Scene, renderer: Renderer, quality: QualityProfile) {
    this.quality = quality;
    this.sun = new DirectionalLight(0xfff0dd, 2.6);
    this.sun.castShadow = quality.shadows;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    const e = quality.shadowExtent;
    Object.assign(this.sun.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 1, far: 1200 });
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);
    this.hemi = new HemisphereLight(0xbcd4f0, 0x6a5a48, 1.1);
    scene.add(this.hemi);

    this.dome = new Mesh(
      new SphereGeometry(1, 32, 16),
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        uniforms: globalUniforms,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uSkyZenith, uSkyHorizon, uSunDir, uSunColor;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float h = clamp(d.y, -1.0, 1.0);
            vec3 col = mix(uSkyHorizon, uSkyZenith, pow(max(h, 0.0), 0.55));
            col = mix(col, uSkyHorizon * 0.9, smoothstep(0.0, -0.3, h));
            float s = max(dot(d, uSunDir), 0.0);
            col += uSunColor * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.25);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    );
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1;
    this.dome.scale.setScalar(9000);
    scene.add(this.dome);

    this.sea = new Mesh(
      new PlaneGeometry(30000, 30000).rotateX(-Math.PI / 2),
      applyPainterly(new MeshBasicMaterial({ color: new Color('#e8eef6') }), { rim: 0 }),
    );
    this.sea.position.y = 0;
    scene.add(this.sea);
    renderer.setBloom(0.3);
    this.setTimeOfDay(this.timeOfDay);
  }

  setTimeOfDay(t: number): void {
    this.timeOfDay = ((t % 1) + 1) % 1;
    const ang = (this.timeOfDay - 0.25) * Math.PI * 2;
    this.sunDirection.set(Math.cos(ang) * 0.8, Math.sin(ang), 0.45).normalize();
    globalUniforms.uSunDir.value.copy(this.sunDirection);
  }

  setQuality(q: QualityProfile): void {
    this.quality = q;
    this.sun.castShadow = q.shadows;
  }

  cloudVeilAt(_p: Vector3): number {
    return 0;
  }

  update(dt: number, camera: PerspectiveCamera, focus: Vector3, _settings: Settings): void {
    globalUniforms.uTime.value += dt;
    this.dome.position.copy(camera.position);
    this.sun.position.copy(focus).addScaledVector(this.sunDirection, 500);
    this.sun.target.position.copy(focus);
    this.sea.position.x = camera.position.x;
    this.sea.position.z = camera.position.z;
  }
}
