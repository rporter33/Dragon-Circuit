import { BufferGeometry, DataTexture, DoubleSide, DynamicDrawUsage, Float32BufferAttribute, LinearFilter, Mesh, SRGBColorSpace, Vector3 } from 'three';
import { Cloth } from '../../creatures/rider/cloth';
import { toonMaterial } from '../../render/painterly';

type Point = (u: number, v: number) => Vector3;
/** Procedural sewn linen; markings travel with UVs rather than floating above the cloth. */
function linen(emblem: boolean): DataTexture {
  const size = 256, bytes = new Uint8Array(size * size * 4);
  const spiral = Array.from({ length: 180 }, (_, i) => {
    const t = i / 179, a = t * Math.PI * 3.6, r = 0.09 * (1 - t);
    return [0.4 + Math.cos(a) * r, 0.38 + Math.sin(a) * r * 2.4];
  });
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1), v = y / (size - 1);
    const blue = v > 0.84 || (emblem && spiral.some(([a, b]) => Math.hypot(u - a, (v - b) / 2.4) < 0.011));
    const seam = Math.abs(u * 6 - Math.round(u * 6)) < 0.012;
    const color = blue ? [127, 168, 196] : seam ? [200, 186, 161] : [250, 248, 243];
    const weave = ((x + y) % 2) * 2;
    for (let k = 0; k < 3; k++) bytes[(y * size + x) * 4 + k] = color[k] - weave;
    bytes[(y * size + x) * 4 + 3] = 255;
  }
  const texture = new DataTexture(bytes, size, size);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Presentation cloth in ship-local coordinates. No force feeds back into flight simulation. */
export class SailCloth {
  readonly mesh: Mesh;
  readonly solver: Cloth;
  readonly rest: Float64Array;
  readonly pinned: Uint8Array;
  readonly samplePoint: Vector3;
  private accumulator = 0;
  private time = 0;

  constructor(name: string, point: Point, readonly loose = false, emblem = false, cols = 25, rows = 13) {
    const rest: number[] = [], uv: number[] = [], indices: number[] = [];
    this.pinned = new Uint8Array(cols * rows);
    for (let v = 0; v < rows; v++) for (let u = 0; u < cols; u++) {
      rest.push(...point(u / (cols - 1), v / (rows - 1)).toArray());
      uv.push(u / (cols - 1), v / (rows - 1));
      this.pinned[v * cols + u] = +(loose ? u === 0 : u === 0 || u === cols - 1 || v === 0 || v === rows - 1);
      if (u < cols - 1 && v < rows - 1) {
        const a = v * cols + u;
        indices.push(a, a + 1, a + cols + 1, a, a + cols + 1, a + cols);
      }
    }
    this.rest = new Float64Array(rest);
    this.samplePoint = point(0.5, 0.5);
    this.solver = new Cloth({ cols, rows, rest: this.rest, pinned: this.pinned,
      drag: 0.7, dragTangent: 0.12, dragQuad: 0.07, damping: 1.8, bend: 0.6,
      iterations: 6, radius: 0.02, flutter: 3, flutterHz: 0.8, gravity: loose ? 0.12 : 0.025 });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(rest, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    this.mesh = new Mesh(geometry, toonMaterial({ color: '#ffffff', map: linen(emblem), side: DoubleSide, rim: 0.28 }));
    this.mesh.name = name;
    this.mesh.userData.visualOnly = true;
    this.mesh.userData.cloth = true;
    this.mesh.castShadow = this.mesh.receiveShadow = true;
  }

  update(dt: number, wind: Vector3): void {
    if (!(dt > 0)) return;
    this.accumulator += Math.min(dt, 0.1);
    const step = 1 / 120;
    let changed = false;
    while (this.accumulator + 1e-10 >= step) {
      this.accumulator -= step;
      this.time += step;
      this.solver.update(step, { airX: wind.x, airY: wind.y, airZ: wind.z, time: this.time });
      // A restrained travel envelope protects the authored silhouette and deck clearance.
      // This is a safety tether, in addition to the solver's stretch/bend constraints.
      const limit = this.loose ? 2.5 : 1.2;
      for (let i = 0; i < this.pinned.length; i++) {
        if (this.pinned[i]) continue;
        const j = i * 3, p = this.solver.pos, r = this.rest;
        const dx = p[j] - r[j], dy = p[j + 1] - r[j + 1], dz = p[j + 2] - r[j + 2];
        const length = Math.hypot(dx, dy, dz);
        if (length > limit) for (let k = 0; k < 3; k++) {
          p[j + k] = r[j + k] + (p[j + k] - r[j + k]) * limit / length;
          this.solver.prev[j + k] = p[j + k];
        }
      }
      changed = true;
    }
    if (!changed) return;
    const position = this.mesh.geometry.getAttribute('position');
    (position.array as Float32Array).set(this.solver.pos);
    position.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.geometry.computeBoundingSphere();
  }
}
