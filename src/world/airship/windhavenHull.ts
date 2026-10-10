import { BufferGeometry, DataTexture, Float32BufferAttribute, LinearFilter, SRGBColorSpace, Vector3 } from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import type { BoxCollider } from '../../core/types';

// Kept separate from the unchanged walkable deck. A closed, smoothly shaded shell replaces
// the stacked box strakes. Its exact triangle surface is also the collision solid.
const TOP = -0.78;
function beam(z: number): number {
  if (z < -34.8) return 12.8 + Math.sqrt(Math.max(0, 1.44 - (z + 34.8) ** 2));
  if (z <= 14) return 14;
  return 14 * Math.sqrt(Math.max(0, 1 - ((z - 14) / 22) ** 2));
}
function depth(z: number): number {
  return 1.1 + 5.3 * Math.pow(Math.max(0, Math.sin((z + 36) / 72 * Math.PI)), 0.85);
}
export function hullPoint(z: number, angle: number): Vector3 {
  return new Vector3(beam(z) * Math.cos(angle), TOP - depth(z) * Math.sin(angle), z);
}

let cached: { geometry: BufferGeometry; collider: BoxCollider } | undefined;
export function windhavenHull(): { geometry: BufferGeometry; collider: BoxCollider } {
  if (cached) return cached;
  const points: Vector3[] = [];
  // Extra end stations keep the narrowing stem and rounded transom corners crisp in silhouette.
  const stations = [...new Set([-36, -35.9, -35.6, -35.2, -34.8, ...Array.from({ length: 71 }, (_, i) => -35 + i), 35.5, 35.8, 35.95, 36])].sort((a, b) => a - b);
  for (const z of stations) for (let i = 0; i <= 40; i++) points.push(hullPoint(z, i / 40 * Math.PI));
  const geometry = new ConvexGeometry(points);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!, centre = bounds.getCenter(new Vector3()), size = bounds.getSize(new Vector3()).multiplyScalar(0.5);
  const positions = geometry.getAttribute('position'), originalNormals = geometry.getAttribute('normal');
  const triangles = new Float32Array(positions.count * 3), planes = new Float64Array(positions.count / 3 * 4);
  const normals: number[] = [], uv: number[] = [];
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3(), cross = new Vector3();
  for (let i = 0; i < positions.count; i++) {
    a.fromBufferAttribute(positions, i);
    triangles[i * 3] = a.x - centre.x; triangles[i * 3 + 1] = a.y - centre.y; triangles[i * 3 + 2] = a.z - centre.z;
    const angle = Math.atan2((TOP - a.y) / depth(a.z), a.x / Math.max(beam(a.z), 1e-6));
    // Preserve the flat concealed top and transom. Other vertices share continuous analytic
    // normals even where the convex tessellator chooses a different triangle diagonal.
    n.fromBufferAttribute(originalNormals, i);
    if (Math.abs(n.y - 1) > 1e-5 && Math.abs(n.z + 1) > 1e-5) {
      b.set(-beam(a.z) * Math.sin(angle), -depth(a.z) * Math.cos(angle), 0);
      c.copy(hullPoint(Math.min(36, a.z + 0.01), angle)).sub(hullPoint(Math.max(-36, a.z - 0.01), angle));
      cross.crossVectors(c, b).normalize();
      if (cross.lengthSq() > 0.5) n.copy(cross);
    }
    normals.push(n.x, n.y, n.z);
    uv.push((a.z + 36) / 72, 1 - Math.abs(angle - Math.PI / 2) / (Math.PI / 2));
  }
  for (let i = 0, p = 0; i < triangles.length; i += 9, p += 4) {
    a.fromArray(triangles, i); b.fromArray(triangles, i + 3); c.fromArray(triangles, i + 6);
    n.subVectors(b, a).cross(c.sub(a)).normalize();
    planes[p] = n.x; planes[p + 1] = n.y; planes[p + 2] = n.z; planes[p + 3] = -n.dot(a);
  }
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  cached = { geometry, collider: { kind: 'box', x: centre.x, y: centre.y, z: centre.z, hx: size.x, hy: size.y, hz: size.z, yaw: 0, surface: 'wood', convex: { triangles, planes } } };
  return cached;
}

/** Quiet longitudinal plank grain, blue wale and bronze seams follow the hull's curvature. */
export function hullTexture(): DataTexture {
  const w = 1024, h = 256, bytes = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = y / (h - 1);
    const blue = v > 0.075 && v < 0.20;
    const bronze = Math.abs(v - 0.055) < 0.006 || Math.abs(v - 0.225) < 0.006;
    const keel = v > 0.91;
    const color = bronze ? [170, 134, 86] : blue ? [127, 168, 196] : keel ? [112, 91, 70] : [242, 234, 218];
    const seam = Math.abs(v * 9 - Math.round(v * 9)) < 0.012;
    const grain = Math.sin(x * 0.075 + Math.sin(y * 0.5)) * Math.sin(y * 1.7) * 2;
    for (let k = 0; k < 3; k++) bytes[(y * w + x) * 4 + k] = color[k] + grain - (seam ? 18 : 0);
    bytes[(y * w + x) * 4 + 3] = 255;
  }
  const texture = new DataTexture(bytes, w, h);
  texture.colorSpace = SRGBColorSpace; texture.magFilter = texture.minFilter = LinearFilter; texture.needsUpdate = true;
  return texture;
}
