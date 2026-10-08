// Growable vertex/index buffers for the procedural meshers, plus the ring stitching every
// surface-of-revolution in the world uses (islands, spires, arches). Pure: no WebGL, so the
// meshers run (and are tested) in Node.
//
// Each vertex carries a position, a linear-space base color and a 4-channel surface mask that
// the terrain material reads (see terrainMaterial.ts):
//   surf.x  rock / strata weight (the shader paints sedimentary bands by world height)
//   surf.y  grass weight (brush-stroke hue and value variation)
//   surf.z  paving weight (flagstone pattern)
//   surf.w  hanging moss / root streak weight (just under a rim)
//
// Island top surfaces also carry an "over" material (aOver): the color of whatever non-grass
// material is nearest (rock, dirt, paving) in rgb and its coverage in a, stored as 2 + coverage
// so a geometry without the attribute (WebGL default a = 1) never reads as a top surface. The
// shader thresholds the coverage with brush noise, so material edges stay crisp and ragged at
// any mesh density instead of smearing across a triangle. There, surf.x and surf.z are the rock
// and paving shares of the over material and surf.y = 1 marks grass-capable ground.

import { BufferAttribute, BufferGeometry } from 'three';

/** A closed loop of `count` vertices starting at index `start`, evenly spaced in angle from 0. */
export interface Ring {
  start: number;
  count: number;
}

/** Final, trimmed mesh data. */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  surf: Float32Array;
  over: Float32Array;
  indices: Uint32Array;
}

export class MeshBuilder {
  positions: Float32Array;
  colors: Float32Array;
  surf: Float32Array;
  over: Float32Array;
  indices: Uint32Array;
  vertexCount = 0;
  indexCount = 0;

  constructor(vertexCapacity = 1024, indexCapacity = vertexCapacity * 6) {
    this.positions = new Float32Array(vertexCapacity * 3);
    this.colors = new Float32Array(vertexCapacity * 3);
    this.surf = new Float32Array(vertexCapacity * 4);
    this.over = new Float32Array(vertexCapacity * 4);
    this.indices = new Uint32Array(indexCapacity);
  }

  private growVertices(): void {
    const cap = (this.positions.length / 3) * 2;
    const p = new Float32Array(cap * 3);
    p.set(this.positions);
    this.positions = p;
    const c = new Float32Array(cap * 3);
    c.set(this.colors);
    this.colors = c;
    const s = new Float32Array(cap * 4);
    s.set(this.surf);
    this.surf = s;
    const o = new Float32Array(cap * 4);
    o.set(this.over);
    this.over = o;
  }

  /** Adds a vertex with a neutral color and empty surface mask; returns its index. */
  vertex(x: number, y: number, z: number): number {
    if ((this.vertexCount + 1) * 3 > this.positions.length) this.growVertices();
    const i = this.vertexCount++;
    const o = i * 3;
    this.positions[o] = x;
    this.positions[o + 1] = y;
    this.positions[o + 2] = z;
    this.colors[o] = this.colors[o + 1] = this.colors[o + 2] = 1;
    const s = i * 4;
    this.surf[s] = this.surf[s + 1] = this.surf[s + 2] = this.surf[s + 3] = 0;
    this.over[s] = this.over[s + 1] = this.over[s + 2] = this.over[s + 3] = 0;
    return i;
  }

  setColor(i: number, r: number, g: number, b: number): void {
    const o = i * 3;
    this.colors[o] = r;
    this.colors[o + 1] = g;
    this.colors[o + 2] = b;
  }

  setSurf(i: number, rock: number, grass: number, pave: number, moss: number): void {
    const o = i * 4;
    this.surf[o] = rock;
    this.surf[o + 1] = grass;
    this.surf[o + 2] = pave;
    this.surf[o + 3] = moss;
  }

  /** Marks a top-surface vertex: the over material's color and its coverage (0..1). */
  setOver(i: number, r: number, g: number, b: number, coverage: number): void {
    const o = i * 4;
    this.over[o] = r;
    this.over[o + 1] = g;
    this.over[o + 2] = b;
    this.over[o + 3] = 2 + coverage;
  }

  x(i: number): number {
    return this.positions[i * 3];
  }
  y(i: number): number {
    return this.positions[i * 3 + 1];
  }
  z(i: number): number {
    return this.positions[i * 3 + 2];
  }

  tri(a: number, b: number, c: number): void {
    if (this.indexCount + 3 > this.indices.length) {
      const n = new Uint32Array(this.indices.length * 2);
      n.set(this.indices);
      this.indices = n;
    }
    this.indices[this.indexCount++] = a;
    this.indices[this.indexCount++] = b;
    this.indices[this.indexCount++] = c;
  }

  /**
   * Triangulates the band between two closed rings with any vertex counts ("zipper"). Both rings
   * must start at angle 0 and advance in the same rotational direction. With `a` the ring nearer
   * the start of the surface (the top center for an island) the faces point to the outside of a
   * surface whose rings advance counter-clockwise seen from above — see the island mesher.
   * A ring of count 1 is a single pole vertex (fan).
   */
  stitch(a: Ring, b: Ring, flip = false): void {
    const na = a.count;
    const nb = b.count;
    let i = 0;
    let j = 0;
    while (i < na || j < nb) {
      // Advance on whichever ring's next vertex comes first in angle (integer compare).
      const advanceA = j >= nb || (i < na && (i + 1) * nb <= (j + 1) * na);
      const a0 = a.start + (i % na);
      const b0 = b.start + (j % nb);
      if (advanceA) {
        const a1 = a.start + ((i + 1) % na);
        if (na > 1) {
          if (flip) this.tri(a0, b0, a1);
          else this.tri(a0, a1, b0);
        }
        i++;
      } else {
        const b1 = b.start + ((j + 1) % nb);
        if (nb > 1) {
          if (flip) this.tri(a0, b0, b1);
          else this.tri(a0, b1, b0);
        }
        j++;
      }
    }
  }

  /** Area-weighted smooth vertex normals over the indexed mesh. */
  computeNormals(): Float32Array {
    const n = new Float32Array(this.vertexCount * 3);
    const p = this.positions;
    const idx = this.indices;
    for (let k = 0; k < this.indexCount; k += 3) {
      const a = idx[k] * 3;
      const b = idx[k + 1] * 3;
      const c = idx[k + 2] * 3;
      const e1x = p[b] - p[a];
      const e1y = p[b + 1] - p[a + 1];
      const e1z = p[b + 2] - p[a + 2];
      const e2x = p[c] - p[a];
      const e2y = p[c + 1] - p[a + 1];
      const e2z = p[c + 2] - p[a + 2];
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      n[a] += nx;
      n[a + 1] += ny;
      n[a + 2] += nz;
      n[b] += nx;
      n[b + 1] += ny;
      n[b + 2] += nz;
      n[c] += nx;
      n[c + 1] += ny;
      n[c + 2] += nz;
    }
    for (let i = 0; i < n.length; i += 3) {
      const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
      n[i] /= l;
      n[i + 1] /= l;
      n[i + 2] /= l;
    }
    return n;
  }

  finish(normals: Float32Array = this.computeNormals()): MeshData {
    return {
      positions: this.positions.slice(0, this.vertexCount * 3),
      normals,
      colors: this.colors.slice(0, this.vertexCount * 3),
      surf: this.surf.slice(0, this.vertexCount * 4),
      over: this.over.slice(0, this.vertexCount * 4),
      indices: this.indices.slice(0, this.indexCount),
    };
  }
}

/** Packs mesh data into a BufferGeometry with the attributes the terrain material expects. */
export function toGeometry(data: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(data.positions, 3));
  g.setAttribute('normal', new BufferAttribute(data.normals, 3));
  g.setAttribute('color', new BufferAttribute(data.colors, 3));
  g.setAttribute('aSurf', new BufferAttribute(data.surf, 4));
  g.setAttribute('aOver', new BufferAttribute(data.over, 4));
  const vCount = data.positions.length / 3;
  g.setIndex(new BufferAttribute(vCount > 65535 ? data.indices : Uint16Array.from(data.indices), 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Number of triangles in mesh data. */
export function triangleCount(data: MeshData): number {
  return data.indices.length / 3;
}
