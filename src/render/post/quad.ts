// One full-screen triangle shared by every post pass. Each pass owns a Mesh with its own material
// (so the warmup can compile every post program up front); they all share this geometry.

import { BufferGeometry, Float32BufferAttribute, Mesh, OrthographicCamera, type Material, type WebGLRenderer } from 'three';

let geometry: BufferGeometry | null = null;

function triangle(): BufferGeometry {
  if (geometry) return geometry;
  geometry = new BufferGeometry();
  // A single oversized triangle covers the viewport without a diagonal seam.
  geometry.setAttribute('position', new Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  geometry.setAttribute('uv', new Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  return geometry;
}

export const POST_CAMERA = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

/** Vertex shader for post passes: positions are already in clip space. */
export const POST_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export class PostQuad<M extends Material = Material> {
  readonly mesh: Mesh<BufferGeometry, M>;

  constructor(readonly material: M) {
    this.mesh = new Mesh(triangle(), material);
    this.mesh.frustumCulled = false;
  }

  /** Draw into whatever render target is bound (the caller sets it and handles clears). */
  render(gl: WebGLRenderer): void {
    gl.render(this.mesh, POST_CAMERA);
  }

  dispose(): void {
    this.material.dispose();
  }
}
