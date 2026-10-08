// Rain: instanced streaks in a box that wraps around the camera, entirely on the GPU. Each drop
// falls with the wind; its streak is drawn along its velocity *relative to the camera*, so at
// speed the rain rakes toward you like real rain past a windscreen.

import {
  DoubleSide,
  Color,
  NormalBlending,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Scene,
} from 'three';
import { mulberry32 } from '../core/rng';
import { FOG_PARS_GLSL } from '../render/painterly';
import { globalUniforms } from '../render/uniforms';

const VERTEX = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uBox;
uniform vec3 uFall;
uniform vec3 uRel;
uniform float uDensity;
uniform float uStreak;
uniform float uRainTime;
varying float vAlpha;
varying float vSide;
varying vec3 vWorld;

void main() {
  if (aSeed.w > uDensity) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float speed = 0.85 + 0.3 * fract(aSeed.w * 7.13);
  vec3 p = aSeed.xyz * uBox + uFall * uRainTime * speed;
  p = cameraPosition + mod(p - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 axis = uRel * speed * uStreak;
  vec3 tail = p - axis;
  vec3 view = normalize(p - cameraPosition);
  vec3 side = cross(normalize(axis + vec3(0.0, -1e-4, 0.0)), view);
  side = length(side) < 1e-4 ? vec3(1.0, 0.0, 0.0) : normalize(side);
  float dist = length(p - cameraPosition);
  float width = max(0.03, dist * 0.0021);
  vec3 world = mix(tail, p, position.y + 0.5) + side * position.x * width;
  vSide = position.x;
  vWorld = world;
  // Not right in the face, and fading out before the box edge so wrap-around never pops.
  vAlpha = smoothstep(1.2, 4.0, dist) * (1.0 - smoothstep(uBox.x * 0.32, uBox.x * 0.48, dist)) * (0.35 + 0.65 * (position.y + 0.5));
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
${FOG_PARS_GLSL}
uniform vec3 uRainColor;
uniform float uOpacity;
varying float vAlpha;
varying float vSide;
varying vec3 vWorld;

void main() {
  float edge = 1.0 - abs(vSide);
  float a = edge * vAlpha * uOpacity;
  if (a < 0.002) discard;
  vec3 v = normalize(vWorld - cameraPosition);
  // Drops catch the light: brighter than the air around them, glinting toward the sun or moon.
  float back = pow(max(dot(v, uSunDir), 0.0), 4.0);
  vec3 col = uRainColor + uSunColor * back * 0.5;
  gl_FragColor = vec4(col, a);
}
`;

export class Rain {
  readonly mesh: Mesh;
  private uniforms: {
    uBox: { value: Vector3 };
    uFall: { value: Vector3 };
    uRel: { value: Vector3 };
    uDensity: { value: number };
    uStreak: { value: number };
    uRainTime: { value: number };
    uRainColor: { value: Color };
    uOpacity: { value: number };
  };
  private geometry: InstancedBufferGeometry;

  constructor(scene: Scene, maxDrops: number) {
    const quad = new PlaneGeometry(2, 1);
    this.geometry = new InstancedBufferGeometry();
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    const seeds = new Float32Array(maxDrops * 4);
    const rnd = mulberry32(0x7a17);
    for (let i = 0; i < maxDrops; i++) {
      seeds[i * 4] = rnd();
      seeds[i * 4 + 1] = rnd();
      seeds[i * 4 + 2] = rnd();
      seeds[i * 4 + 3] = rnd();
    }
    this.geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4));
    this.geometry.instanceCount = maxDrops;
    this.uniforms = {
      uBox: { value: new Vector3(64, 48, 64) },
      uFall: { value: new Vector3(0, -11, 0) },
      uRel: { value: new Vector3(0, -11, 0) },
      uDensity: { value: 0 },
      uStreak: { value: 0.07 },
      uRainTime: { value: 0 },
      uRainColor: { value: new Color(0.5, 0.55, 0.62) },
      uOpacity: { value: 0.5 },
    };
    const material = new ShaderMaterial({
      name: 'DriftwingRain',
      // Ribbon winding depends on the view, so draw both faces.
      side: DoubleSide,
      uniforms: { ...globalUniforms, ...this.uniforms },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.name = 'rain';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  setMaxDrops(n: number): void {
    const attr = this.geometry.getAttribute('aSeed');
    this.geometry.instanceCount = Math.min(n, attr.count);
  }

  /**
   * @param intensity 0..1 rain amount.
   * @param wind      prevailing wind (m/s).
   * @param camVel    camera velocity (m/s), for streak direction.
   * @param tint      ambient color the drops pick up.
   */
  update(dt: number, intensity: number, wind: Vector3, camVel: Vector3, tint: Color): void {
    const u = this.uniforms;
    u.uRainTime.value = (u.uRainTime.value + dt) % 1000;
    u.uDensity.value = intensity;
    this.mesh.visible = intensity > 0.01;
    u.uFall.value.set(wind.x * 0.85, -11, wind.z * 0.85);
    u.uRel.value.copy(u.uFall.value).sub(camVel);
    // Keep streaks believable at high speed: cap their length at ~3.5 m.
    const len = u.uRel.value.length() * u.uStreak.value;
    if (len > 3.5) u.uRel.value.multiplyScalar(3.5 / len);
    u.uRainColor.value.copy(tint);
    u.uOpacity.value = 0.22 + 0.2 * intensity;
  }
}
