// Floating debris: small rocks (< 3 m) hovering just off island rims and beneath their undersides,
// fragments drifting in the Broken Ring's gap and around the Eye of the Gale. Visual only (no
// collision), so they are small, sparse and kept clear of every solid. One InstancedMesh; the
// gentle bob is done in the vertex shader from uTime, so animating them costs no CPU.

import { Color, IcosahedronGeometry, InstancedMesh, Matrix4, Quaternion, Vector3, type BufferGeometry, type MeshToonMaterial } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { QualityProfile } from '../../render/quality';
import type { Terrain } from '../terrain';
import { Rng } from '../../core/rng';
import { noise3 } from '../../core/noise';
import { smoothstep } from '../../core/math';
import { toonMaterial } from '../../render/painterly';
import { MeshBuilder, toGeometry } from './MeshBuilder';
import { patchTerrainShader } from './terrainMaterial';

export interface DebrisPiece {
  position: [number, number, number];
  /** Largest half-extent (m). */
  size: number;
  /** Per-axis stretch. */
  stretch: [number, number, number];
  yaw: number;
  tilt: number;
}

/** Upper bound on a piece's half-extent, so the "small" promise holds. */
export const DEBRIS_MAX_SIZE = 1.5;

/** Seeded placement of every debris piece in the world. Pure, so it is tested in Node. */
export function placeDebris(terrain: Terrain, seed = 0x5eed): DebrisPiece[] {
  const rng = new Rng(seed);
  const out: DebrisPiece[] = [];
  const p = new Vector3();
  const tryPlace = (x: number, y: number, z: number, size: number): boolean => {
    p.set(x, y, z);
    // Clear of all rock (with room for the bob), so they never clip a cliff or each other's island.
    if (terrain.distance(p) < size * 1.8 + 2.5) return false;
    for (const o of out) {
      if (Math.hypot(o.position[0] - x, o.position[1] - y, o.position[2] - z) < (o.size + size) * 2 + 1.5) return false;
    }
    out.push({
      position: [x, y, z],
      size,
      stretch: [rng.range(0.75, 1), rng.range(0.5, 0.85), rng.range(0.7, 1)],
      yaw: rng.range(0, Math.PI * 2),
      tilt: rng.range(-0.35, 0.35),
    });
    return true;
  };
  const size = () => DEBRIS_MAX_SIZE * (0.35 + 0.65 * rng.float() ** 1.6);

  for (const shape of terrain.islands) {
    const d = shape.def;
    if (d.radius < 34) continue;
    const count = Math.round(2 + d.radius / 24);
    for (let k = 0; k < count; k++) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const th = rng.range(0, Math.PI * 2);
        const R = shape.outlineRadius(th);
        const sz = size();
        if (rng.chance(0.55)) {
          // Rim crumbs: just off the cliff, a little below the lip, as if recently broken away.
          const out = rng.range(5, 12 + d.radius * 0.06);
          const x = d.x + Math.cos(th) * (R + out);
          const z = d.z + Math.sin(th) * (R + out);
          const y = d.y - d.lip * rng.range(0.2, 1.6) - rng.range(0, 10);
          if (tryPlace(x, y, z, sz)) break;
        } else {
          // Beneath the underside, hanging in its shadow.
          const s = rng.range(0.3, 0.88);
          const x = d.x + Math.cos(th) * R * s;
          const z = d.z + Math.sin(th) * R * s;
          const y = shape.bottomHeight(x, z) - rng.range(7, 30);
          if (tryPlace(x, y, z, sz)) break;
        }
      }
    }
  }

  const tmp = new Vector3();
  for (const arch of terrain.arches) {
    const d = arch.def;
    if (arch.full) {
      // A loose halo of stones orbiting outside the Eye (never in the hole you fly through).
      for (let k = 0; k < 12; k++) {
        for (let attempt = 0; attempt < 8; attempt++) {
          const a = rng.range(0, Math.PI * 2);
          arch.pointAt(a, tmp);
          const radial = d.tube + rng.range(6, 24);
          const dirx = Math.cos(a);
          const diry = Math.sin(a);
          const side = rng.range(-10, 10);
          const x = tmp.x + (arch.right.x * dirx + arch.up.x * diry) * radial + arch.normal.x * side;
          const y = tmp.y + (arch.right.y * dirx + arch.up.y * diry) * radial + arch.normal.y * side;
          const z = tmp.z + (arch.right.z * dirx + arch.up.z * diry) * radial + arch.normal.z * side;
          if (tryPlace(x, y, z, size())) break;
        }
      }
    } else if (d.arcEnd - d.arcStart < Math.PI * 1.9 && d.arcEnd - d.arcStart > Math.PI * 1.2) {
      // The Broken Ring: fragments of the missing span still drifting along its line.
      const gap0 = d.arcEnd;
      const gap1 = d.arcStart + Math.PI * 2;
      for (let k = 0; k < 9; k++) {
        for (let attempt = 0; attempt < 8; attempt++) {
          const a = rng.range(gap0 + 0.12, gap1 - 0.12);
          arch.pointAt(a, tmp);
          const j = d.tube * 0.9;
          if (tryPlace(tmp.x + rng.range(-j, j), tmp.y + rng.range(-j, j), tmp.z + rng.range(-j, j), size() * 1.0)) break;
        }
      }
    }
  }
  // Shuffle so lowering the quality drops a uniform subset (InstancedMesh.count keeps a prefix).
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const ROCK = new Color('#ae9c86');
const ROCK_DARK = new Color('#77707d');
const MOSS = new Color('#5c8c3e');
const tmpC = new Color();

/** A lumpy unit rock with a flattish, mossy top. */
function rockGeometry(): BufferGeometry {
  const ico = mergeVertices(new IcosahedronGeometry(1, 2));
  const pos = ico.getAttribute('position');
  const idx = ico.getIndex()!;
  const n = noise3(4242);
  const b = new MeshBuilder(pos.count, idx.count);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const r = 0.82 + 0.22 * n(x * 1.3, y * 1.3, z * 1.3) + 0.08 * n(x * 3.1 + 5, y * 3.1, z * 3.1);
    x *= r;
    y *= r;
    z *= r;
    // Sheared-off top: where it broke from the island.
    if (y > 0.45) y = 0.45 + (y - 0.45) * 0.25;
    b.vertex(x, y, z);
  }
  for (let k = 0; k < idx.count; k += 3) b.tri(idx.getX(k), idx.getX(k + 1), idx.getX(k + 2));
  const normals = b.computeNormals();
  for (let i = 0; i < b.vertexCount; i++) {
    const ny = normals[i * 3 + 1];
    const moss = smoothstep(0.55, 0.85, ny);
    tmpC.copy(ROCK).lerp(ROCK_DARK, smoothstep(0.1, -0.8, ny) * 0.7).lerp(MOSS, moss * 0.9);
    b.setColor(i, tmpC.r, tmpC.g, tmpC.b);
    b.setSurf(i, 0.7 * (1 - moss), moss * 0.6, 0, smoothstep(0.2, -0.3, ny) * smoothstep(-0.9, -0.2, ny) * 0.6);
  }
  ico.dispose();
  return toGeometry(b.finish(normals));
}

/** Terrain paint plus a slow, per-instance bob and drift in the vertex shader. */
function debrisMaterial(): MeshToonMaterial {
  const m = toonMaterial({ vertexColors: true, rim: 0.85 });
  const prev = m.onBeforeCompile.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    patchTerrainShader(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          vec3 dwIP = instanceMatrix[3].xyz;
          float dwPh = fract(dot(dwIP, vec3(0.0131, 0.0071, 0.0113))) * 6.2832;
          mvPosition.y += sin(uTime * 0.52 + dwPh) * 0.45 + sin(uTime * 0.21 + dwPh * 1.7) * 0.25;
          mvPosition.xz += vec2(sin(uTime * 0.29 + dwPh * 2.3), cos(uTime * 0.25 + dwPh * 1.3)) * 0.18;
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  const prevKey = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => prevKey() + '|dw-debris';
  m.name = 'dw-debris';
  return m;
}

export class Debris {
  readonly mesh: InstancedMesh;
  readonly pieces: DebrisPiece[];

  constructor(terrain: Terrain, quality: QualityProfile) {
    this.pieces = placeDebris(terrain);
    this.mesh = new InstancedMesh(rockGeometry(), debrisMaterial(), this.pieces.length);
    this.mesh.name = 'debris';
    const m = new Matrix4();
    const q = new Quaternion();
    const e = new Vector3();
    const s = new Vector3();
    const pos = new Vector3();
    const tilt = new Quaternion();
    this.pieces.forEach((p, i) => {
      q.setFromAxisAngle(e.set(0, 1, 0), p.yaw);
      tilt.setFromAxisAngle(e.set(1, 0, 0), p.tilt);
      q.multiply(tilt);
      s.set(p.size * p.stretch[0], p.size * p.stretch[1], p.size * p.stretch[2]);
      m.compose(pos.set(...p.position), q, s);
      this.mesh.setMatrixAt(i, m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.computeBoundingSphere();
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.setQuality(quality);
  }

  update(_dt: number): void {
    // Animated entirely in the vertex shader.
  }

  setQuality(q: QualityProfile): void {
    this.mesh.count = Math.round(this.pieces.length * Math.min(1, Math.max(0.3, q.propDensity)));
  }
}
