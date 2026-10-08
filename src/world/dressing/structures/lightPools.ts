// Soft pools of warm light on the ground under lanterns: additive discs that fade in with uNight.
// Far cheaper than real point lights and they read just as well in a painterly scene.

import { AdditiveBlending, BufferAttribute, BufferGeometry, Mesh, ShaderMaterial } from 'three';
import { FOG_PARS_GLSL } from '../../../render/painterly';
import { globalUniforms } from '../../../render/uniforms';

let material: ShaderMaterial | null = null;

function poolMaterial(): ShaderMaterial {
  if (material) return material;
  material = new ShaderMaterial({
    uniforms: { ...globalUniforms },
    vertexShader: /* glsl */ `
      attribute vec2 aDisc;
      varying vec2 vDisc;
      varying vec3 vDwWorldPos;
      void main() {
        vDisc = aDisc;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vDwWorldPos = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${FOG_PARS_GLSL}
      varying vec2 vDisc;
      varying vec3 vDwWorldPos;
      void main() {
        float r = length(vDisc);
        float a = 1.0 - smoothstep(0.0, 1.0, r);
        a *= a;
        vec3 col = vec3(1.0, 0.66, 0.32) * a * (0.04 + uNight * 0.75);
        // Additive: keep only the part of the color the fog doesn't swallow.
        col = dwApplyFog(col, vDwWorldPos, cameraPosition) - dwApplyFog(vec3(0.0), vDwWorldPos, cameraPosition);
        gl_FragColor = vec4(max(col, 0.0), 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  return material;
}

/** One mesh of ground discs from packed (x, y, z, radius) quads. */
export function lightPoolMesh(pools: number[]): Mesh | null {
  const n = pools.length / 4;
  if (n === 0) return null;
  const pos = new Float32Array(n * 4 * 3);
  const disc = new Float32Array(n * 4 * 2);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const [x, y, z, r] = pools.slice(i * 4, i * 4 + 4);
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    corners.forEach(([u, w], k) => {
      pos.set([x + u * r, y + 0.12, z + w * r], (i * 4 + k) * 3);
      disc.set([u, w], (i * 4 + k) * 2);
    });
    const b = i * 4;
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('aDisc', new BufferAttribute(disc, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const m = new Mesh(g, poolMaterial());
  m.name = 'light-pools';
  m.renderOrder = 2;
  return m;
}
