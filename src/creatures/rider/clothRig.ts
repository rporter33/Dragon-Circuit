// Runs the rider's cloth pieces against the skeleton: pins anchored particles to bones, feeds
// colliders and air, and draws each piece as a smooth sheet (capes, scarves, coat tails, long
// hair) or a tube (ponytail, braids). Meshes are drawn in the simulation frame: positions are
// relative to a moving origin, and the mesh's world matrix is just a translation to it.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Matrix4,
  Mesh,
  MeshToonMaterial,
  Vector3,
  type Bone,
  type Group,
} from 'three';
import { applyPainterly, toonRamp } from '../../render/painterly';
import { Cloth, type Capsule } from './cloth';
import type { ClothPattern, ClothSpec, ColliderName } from './accessories';

const PATTERN_ID: Record<ClothPattern, number> = { plain: 0, tattered: 1, feather: 2, hair: 3, scarf: 4, tail: 5, braid: 6, coat: 7 };

const PATTERN_GLSL = /* glsl */ `
float dwHash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
vec3 dwPattern(vec3 base, vec2 uv, bool front) {
  vec3 c = base;
  #if DW_PATTERN == 0
    // Plain cape: trim along the hem and edges.
    float edge = step(0.94, uv.y) + step(uv.x, 0.025) + step(0.975, uv.x);
    c = mix(c, uDwTrim, clamp(edge, 0.0, 1.0));
  #elif DW_PATTERN == 1
    // Tattered: ragged hem, a few holes, weathered toward the bottom.
    float cell = floor(uv.x * 11.0);
    float f = fract(uv.x * 11.0);
    float cut = 0.8 + 0.13 * dwHash(cell) + 0.07 * abs(f - 0.5) * 2.0 * dwHash(cell + 7.0);
    if (uv.y > cut) discard;
    vec2 hc = floor(uv * vec2(5.0, 7.0));
    vec2 hf = fract(uv * vec2(5.0, 7.0)) - 0.5;
    if (uv.y > 0.4 && dwHash(hc.x * 13.0 + hc.y * 7.0) > 0.82 && length(hf * vec2(1.0, 1.4)) < 0.18 + 0.06 * dwHash(hc.x + hc.y)) discard;
    c *= mix(1.0, 0.72, smoothstep(0.35, 1.0, uv.y));
    c = mix(c, c * 0.6, smoothstep(cut - 0.06, cut, uv.y));
  #elif DW_PATTERN == 2
    // Feathered mantle: overlapping rows of pointed feathers.
    float rows = 7.0;
    float rv = uv.y * rows;
    float row = floor(rv);
    float fv = fract(rv);
    float cols = 7.0;
    float fu = fract(uv.x * cols + mod(row, 2.0) * 0.5);
    float tip = 1.0 - 0.55 * pow(abs(fu * 2.0 - 1.0), 1.6);
    if (row >= rows - 1.0 && fv > tip) discard;
    float tone = 0.86 + 0.14 * dwHash(row * 3.1 + floor(uv.x * cols + mod(row, 2.0) * 0.5));
    c *= tone * mix(1.0, 0.68, smoothstep(tip - 0.3, tip, fv));
    c = mix(c, uDwTrim, 0.35 * step(abs(fu - 0.5), 0.035) * (1.0 - fv));
    c = mix(c, uDwTrim, 0.25 * smoothstep(0.6, 1.0, uv.y));
  #elif DW_PATTERN == 3
    // Long hair: strands and pointed clumps at the ends.
    float cl = fract(uv.x * 7.0);
    float tipH = 0.72 + 0.28 * pow(1.0 - abs(cl * 2.0 - 1.0), 0.7) * (0.75 + 0.25 * dwHash(floor(uv.x * 7.0)));
    if (uv.y > tipH) discard;
    c *= 0.84 + 0.16 * sin(uv.x * 70.0 + sin(uv.y * 9.0) * 2.0);
    c *= mix(1.0, 0.8, abs(cl * 2.0 - 1.0));
  #elif DW_PATTERN == 4
    // Scarf: a band near the end and a fringe.
    float band = step(0.84, uv.y) * step(uv.y, 0.885) + step(0.91, uv.y) * step(uv.y, 0.925);
    c = mix(c, uDwTrim, band);
    if (uv.y > 0.955 && fract(uv.x * 6.0) > 0.55) discard;
    c *= 0.92 + 0.08 * smoothstep(0.0, 0.2, min(uv.x, 1.0 - uv.x));
  #elif DW_PATTERN == 5
    // Ponytail: soft streaks running down the tail.
    c *= 0.82 + 0.18 * sin(uv.x * 6.2831 * 5.0 + uv.y * 4.0);
  #elif DW_PATTERN == 6
    // Braid: interlocking chevrons and a tie near the end.
    float b = fract(uv.y * 14.0 + abs(uv.x - 0.5) * 1.6);
    c *= 0.72 + 0.28 * smoothstep(0.0, 0.5, b) * (1.0 - smoothstep(0.75, 1.0, b));
    c = mix(c, uDwTrim, step(0.86, uv.y) * step(uv.y, 0.92));
  #elif DW_PATTERN == 7
    // Coat tails: a darker hem band.
    c = mix(c, uDwTrim, step(0.9, uv.y));
  #endif
  // Lining: the inside of capes and coats is a deeper tone.
  if (!front) c *= 0.66;
  return c;
}
`;

export function clothMaterial(pattern: ClothPattern, color: Color, trim: Color): MeshToonMaterial {
  const m = new MeshToonMaterial({ color, side: DoubleSide, gradientMap: toonRamp() });
  const trimU = { value: trim.clone() };
  applyPainterly(m, {
    rim: 0.9,
    onBeforeCompile: (shader) => {
      shader.uniforms.uDwTrim = trimU;
      shader.defines = { ...(shader.defines ?? {}), DW_PATTERN: PATTERN_ID[pattern] };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 dwUv;\nvarying vec2 vDwUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDwUv = dwUv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vDwUv;\nuniform vec3 uDwTrim;\n' + PATTERN_GLSL)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = dwPattern(diffuseColor.rgb, vDwUv, gl_FrontFacing);');
    },
  });
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${key()}-cloth-${pattern}`;
  return m;
}

/** Centripetal-free uniform Catmull-Rom on scalars. */
function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

interface Piece {
  spec: ClothSpec;
  cloth: Cloth;
  mesh: Mesh;
  geo: BufferGeometry;
  pos: Float32Array;
  nrm: Float32Array;
  /** Visual grid size. */
  vu: number;
  vv: number;
  /** Bone-local offsets of pinned particles (bind rotations are identity). */
  pinOffset: Float64Array;
  pinBone: Int32Array;
  /** For reset: per particle, the bone whose motion carries it and its offset. */
  carryBone: Int32Array;
  targets: Float64Array;
  capsules: Capsule[];
  /** Tube scratch: smoothed centerline. */
  line?: Float64Array;
  flip: boolean;
  /** Visual subdivisions per particle span (quality dependent). */
  sub: number;
}

export interface ClothLod {
  /** Multiplier on visual subdivisions (1 = full). */
  detail: number;
  shadows: boolean;
}

const _m = new Matrix4();
const _v = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _n = new Vector3();
const _t = new Vector3();
const _prevN = new Vector3();

export class ClothRig {
  readonly pieces: Piece[] = [];
  private readonly parent: Group;
  readonly origin = new Vector3();

  private readonly lod: ClothLod;

  constructor(specs: ClothSpec[], bindPos: Vector3[], parent: Group, colliderSets: Record<ColliderName, Capsule>, lod: ClothLod = { detail: 1, shadows: true }) {
    this.parent = parent;
    this.lod = lod;
    for (const spec of specs) this.pieces.push(this.makePiece(spec, bindPos, colliderSets));
  }

  private makePiece(spec: ClothSpec, bindPos: Vector3[], colliderSets: Record<ColliderName, Capsule>): Piece {
    const n = spec.cols * spec.rows;
    const rest = new Float64Array(n * 3);
    const pinned = new Uint8Array(n);
    const pinOffset = new Float64Array(n * 3);
    const pinBone = new Int32Array(n).fill(-1);
    const carryBone = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const p = spec.rest[i];
      rest[i * 3] = p.x;
      rest[i * 3 + 1] = p.y;
      rest[i * 3 + 2] = p.z;
      const bone = spec.anchorBone[i];
      if (bone >= 0) {
        pinned[i] = 1;
        pinBone[i] = bone;
        pinOffset[i * 3] = p.x - bindPos[bone].x;
        pinOffset[i * 3 + 1] = p.y - bindPos[bone].y;
        pinOffset[i * 3 + 2] = p.z - bindPos[bone].z;
      }
      // Free particles ride with their column's anchor bone on reset.
      const col = i % spec.cols;
      carryBone[i] = spec.anchorBone[col] >= 0 ? spec.anchorBone[col] : spec.anchorBone.find((b) => b >= 0) ?? 0;
    }
    const cloth = new Cloth({ cols: spec.cols, rows: spec.rows, rest, pinned, ...spec.config });
    const sub = Math.max(1, Math.round((spec.render.subdiv ?? 3) * this.lod.detail));
    let vu: number;
    let vv: number;
    if (spec.render.kind === 'tube') {
      vu = 9; // ring vertices (+1 seam)
      vv = (spec.rows - 1) * sub + 1;
    } else {
      vu = spec.cols === 2 ? 2 : (spec.cols - 1) * sub + 1;
      vv = (spec.rows - 1) * sub + 1;
    }
    const geo = new BufferGeometry();
    const pos = new Float32Array(vu * vv * 3);
    const nrm = new Float32Array(vu * vv * 3);
    const uv = new Float32Array(vu * vv * 2);
    for (let j = 0; j < vv; j++) {
      for (let i = 0; i < vu; i++) {
        uv[(j * vu + i) * 2] = i / (vu - 1);
        uv[(j * vu + i) * 2 + 1] = j / (vv - 1);
      }
    }
    // Which winding faces away from the body? Check the rest shape's middle against the outward
    // direction from the body's vertical axis.
    let flip = false;
    if (spec.render.kind === 'sheet' && spec.cols > 1) {
      const c0 = Math.floor(spec.cols / 2) - (spec.cols === 2 ? 1 : 0);
      const r0 = Math.min(1, spec.rows - 1);
      const i0 = r0 * spec.cols + c0;
      const p0 = spec.rest[i0];
      const pr = spec.rest[i0 + 1];
      const pd = spec.rest[i0 + spec.cols] ?? spec.rest[i0];
      _a.subVectors(pr, p0);
      _b.subVectors(pd, p0);
      _n.crossVectors(_a, _b); // face normal of (i, i+1, i+cols) winding
      _t.set(p0.x, 0, p0.z);
      flip = _n.dot(_t) < 0;
    }
    const idx: number[] = [];
    for (let j = 0; j < vv - 1; j++) {
      for (let i = 0; i < vu - 1; i++) {
        const a = j * vu + i;
        const b = a + 1;
        const c = a + vu;
        const d = c + 1;
        if (!flip) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
    }
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('normal', new BufferAttribute(nrm, 3));
    geo.setAttribute('dwUv', new BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mat = clothMaterial(spec.render.pattern, spec.render.color, spec.render.trim);
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.castShadow = this.lod.shadows;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;
    this.parent.add(mesh);
    const capsules = spec.colliders.map((c) => colliderSets[c]).filter(Boolean);
    cloth.setColliders(capsules);
    return { spec, cloth, mesh, geo, pos, nrm, vu, vv, pinOffset, pinBone, carryBone, targets: new Float64Array(n * 3), capsules, flip, sub };
  }

  /** Put every particle back on its rest shape, carried by the current bone poses. */
  reset(bones: Bone[], bindPos: Vector3[], origin: Vector3): void {
    this.origin.copy(origin);
    for (const pc of this.pieces) {
      const n = pc.spec.cols * pc.spec.rows;
      const out = pc.targets;
      for (let i = 0; i < n; i++) {
        const bone = pc.carryBone[i];
        const r = pc.spec.rest[i];
        _v.set(r.x - bindPos[bone].x, r.y - bindPos[bone].y, r.z - bindPos[bone].z).applyMatrix4(bones[bone].matrixWorld).sub(origin);
        out[i * 3] = _v.x;
        out[i * 3 + 1] = _v.y;
        out[i * 3 + 2] = _v.z;
      }
      pc.cloth.reset(out);
    }
  }

  /**
   * Advance. `origin` is the frame origin this frame (world), `dv` the change of the frame's
   * velocity since last frame, `air` the relative air velocity (wind − rider velocity).
   */
  update(dt: number, bones: Bone[], origin: Vector3, dv: Vector3, air: Vector3, time: number): void {
    this.origin.copy(origin);
    for (const pc of this.pieces) {
      const n = pc.spec.cols * pc.spec.rows;
      const tg = pc.targets;
      for (let i = 0; i < n; i++) {
        const bone = pc.pinBone[i];
        if (bone < 0) continue;
        _v.set(pc.pinOffset[i * 3], pc.pinOffset[i * 3 + 1], pc.pinOffset[i * 3 + 2]).applyMatrix4(bones[bone].matrixWorld).sub(origin);
        tg[i * 3] = _v.x;
        tg[i * 3 + 1] = _v.y;
        tg[i * 3 + 2] = _v.z;
      }
      pc.cloth.setAnchors(tg);
      pc.cloth.frameVelocityChange(dv.x, dv.y, dv.z);
      pc.cloth.update(dt, { airX: air.x, airY: air.y, airZ: air.z, time });
      this.draw(pc);
      _m.makeTranslation(origin.x, origin.y, origin.z);
      pc.mesh.matrixWorld.copy(_m);
    }
  }

  private draw(pc: Piece): void {
    if (pc.spec.render.kind === 'tube') this.drawTube(pc);
    else this.drawSheet(pc);
    pc.geo.attributes.position.needsUpdate = true;
    pc.geo.attributes.normal.needsUpdate = true;
  }

  private drawSheet(pc: Piece): void {
    const { cols, rows } = pc.spec;
    const p = pc.cloth.pos;
    const sub = pc.sub;
    const vu = pc.vu;
    const vv = pc.vv;
    const out = pc.pos;
    // Pass 1: Catmull-Rom down every particle column at each visual row.
    if (!pc.line || pc.line.length !== vv * cols * 3) pc.line = new Float64Array(vv * cols * 3);
    const tmp = pc.line;
    for (let j = 0; j < vv; j++) {
      const r = Math.min(rows - 2, Math.floor(j / sub));
      const tv = j / sub - r;
      const r0 = Math.max(0, r - 1);
      const r3 = Math.min(rows - 1, r + 2);
      for (let c = 0; c < cols; c++) {
        for (let k = 0; k < 3; k++) {
          tmp[(j * cols + c) * 3 + k] = cr(p[(r0 * cols + c) * 3 + k], p[(r * cols + c) * 3 + k], p[((r + 1) * cols + c) * 3 + k], p[(r3 * cols + c) * 3 + k], tv);
        }
      }
    }
    // Two-wide ribbons: drawn about their centerline with a minimum width and a twist that
    // builds along the length, so a scarf tail shows its face from any side (never a string).
    if (cols === 2) {
      this.drawRibbon(pc, tmp, vv);
      return this.sheetNormals(pc);
    }
    // Pass 2: across the columns.
    for (let j = 0; j < vv; j++) {
      const rowBase = j * cols * 3;
      for (let i = 0; i < vu; i++) {
        const o = (j * vu + i) * 3;
        const c = Math.min(cols - 2, Math.floor(i / sub));
        const tu = i / sub - c;
        const c0 = Math.max(0, c - 1);
        const c3 = Math.min(cols - 1, c + 2);
        for (let k = 0; k < 3; k++) {
          out[o + k] = cr(tmp[rowBase + c0 * 3 + k], tmp[rowBase + c * 3 + k], tmp[rowBase + (c + 1) * 3 + k], tmp[rowBase + c3 * 3 + k], tu);
        }
      }
    }
    this.sheetNormals(pc);
  }

  /** Ribbon rows from the two smoothed columns in `line` (row-major, 2 points per row). */
  private drawRibbon(pc: Piece, line: Float64Array, vv: number): void {
    const out = pc.pos;
    const twist = pc.spec.render.twist ?? 0;
    const minHalf = (pc.spec.render.minWidth ?? 0) / 2;
    for (let j = 0; j < vv; j++) {
      const a = j * 6;
      const cx = (line[a] + line[a + 3]) / 2;
      const cy = (line[a + 1] + line[a + 4]) / 2;
      const cz = (line[a + 2] + line[a + 5]) / 2;
      // Tangent from the neighbouring rows' centers.
      const p0 = Math.max(0, j - 1) * 6;
      const p1 = Math.min(vv - 1, j + 1) * 6;
      let tx = (line[p1] + line[p1 + 3] - line[p0] - line[p0 + 3]) / 2;
      let ty = (line[p1 + 1] + line[p1 + 4] - line[p0 + 1] - line[p0 + 4]) / 2;
      let tz = (line[p1 + 2] + line[p1 + 5] - line[p0 + 2] - line[p0 + 5]) / 2;
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      // Half-width vector, made perpendicular to the tangent.
      let hx = (line[a + 3] - line[a]) / 2;
      let hy = (line[a + 4] - line[a + 1]) / 2;
      let hz = (line[a + 5] - line[a + 2]) / 2;
      const ht = hx * tx + hy * ty + hz * tz;
      hx -= tx * ht;
      hy -= ty * ht;
      hz -= tz * ht;
      let hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
      if (hl < 1e-6) {
        // Degenerate: any perpendicular.
        hx = -tz;
        hy = 0;
        hz = tx;
        hl = Math.sqrt(hx * hx + hz * hz) || 1;
      }
      const w = Math.max(hl, minHalf) / hl;
      hx *= w;
      hy *= w;
      hz *= w;
      // Twist about the tangent, building up from the knot toward the end.
      const f = j / Math.max(1, vv - 1);
      const ang = twist * f * f * (3 - 2 * f);
      if (ang !== 0) {
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        // Rodrigues with h ⟂ t: h' = h cos + (t × h) sin.
        const qx = ty * hz - tz * hy;
        const qy = tz * hx - tx * hz;
        const qz = tx * hy - ty * hx;
        hx = hx * c + qx * s;
        hy = hy * c + qy * s;
        hz = hz * c + qz * s;
      }
      const o = j * 6;
      out[o] = cx - hx;
      out[o + 1] = cy - hy;
      out[o + 2] = cz - hz;
      out[o + 3] = cx + hx;
      out[o + 4] = cy + hy;
      out[o + 5] = cz + hz;
    }
  }

  /** Normals by central differences on the visual grid. */
  private sheetNormals(pc: Piece): void {
    const out = pc.pos;
    const vu = pc.vu;
    const vv = pc.vv;
    const nrm = pc.nrm;
    const s = pc.flip ? -1 : 1;
    for (let j = 0; j < vv; j++) {
      for (let i = 0; i < vu; i++) {
        const l = j * vu + Math.max(0, i - 1);
        const rr = j * vu + Math.min(vu - 1, i + 1);
        const u = Math.max(0, j - 1) * vu + i;
        const d = Math.min(vv - 1, j + 1) * vu + i;
        _a.set(out[rr * 3] - out[l * 3], out[rr * 3 + 1] - out[l * 3 + 1], out[rr * 3 + 2] - out[l * 3 + 2]);
        _b.set(out[d * 3] - out[u * 3], out[d * 3 + 1] - out[u * 3 + 1], out[d * 3 + 2] - out[u * 3 + 2]);
        _n.crossVectors(_a, _b).multiplyScalar(s);
        if (_n.lengthSq() < 1e-14) _n.set(0, 1, 0);
        _n.normalize();
        const o = (j * vu + i) * 3;
        nrm[o] = _n.x;
        nrm[o + 1] = _n.y;
        nrm[o + 2] = _n.z;
      }
    }
  }

  private drawTube(pc: Piece): void {
    const rows = pc.spec.rows;
    const p = pc.cloth.pos;
    const sub = pc.sub;
    const vu = pc.vu;
    const vv = pc.vv;
    const ring = vu - 1;
    const out = pc.pos;
    const nrm = pc.nrm;
    const radius = pc.spec.render.radius ?? (() => 0.02);
    const braid = pc.spec.render.pattern === 'braid';
    const at = (r: number, k: number) => p[(r < 0 ? 0 : r >= rows ? rows - 1 : r) * 3 + k];
    if (!pc.line) pc.line = new Float64Array(vv * 3);
    const line = pc.line;
    for (let j = 0; j < vv; j++) {
      const r = Math.min(rows - 2, Math.floor(j / sub));
      const t = j / sub - r;
      for (let k = 0; k < 3; k++) line[j * 3 + k] = cr(at(r - 1, k), at(r, k), at(r + 1, k), at(r + 2, k), t);
    }
    // Parallel-transport frames down the line.
    _prevN.set(1, 0, 0);
    for (let j = 0; j < vv; j++) {
      const a = Math.max(0, j - 1);
      const b = Math.min(vv - 1, j + 1);
      _t.set(line[b * 3] - line[a * 3], line[b * 3 + 1] - line[a * 3 + 1], line[b * 3 + 2] - line[a * 3 + 2]).normalize();
      _n.copy(_prevN).addScaledVector(_t, -_prevN.dot(_t));
      if (_n.lengthSq() < 1e-8) _n.set(0, 1, 0).addScaledVector(_t, -_t.y);
      _n.normalize();
      _prevN.copy(_n);
      _b.crossVectors(_t, _n);
      const f = j / (vv - 1);
      let rad = Math.max(0.002, radius(f));
      for (let i = 0; i <= ring; i++) {
        const th = (i / ring) * Math.PI * 2;
        let rr = rad;
        if (braid) rr *= 0.86 + 0.2 * Math.abs(Math.sin(f * 40 + (i % 2) * 1.5 + th));
        const cx = Math.cos(th);
        const sy = Math.sin(th);
        _v.copy(_n).multiplyScalar(cx).addScaledVector(_b, sy);
        const o = (j * vu + i) * 3;
        out[o] = line[j * 3] + _v.x * rr;
        out[o + 1] = line[j * 3 + 1] + _v.y * rr;
        out[o + 2] = line[j * 3 + 2] + _v.z * rr;
        nrm[o] = _v.x;
        nrm[o + 1] = _v.y;
        nrm[o + 2] = _v.z;
      }
      if (j === vv - 1) rad = 0;
    }
    // Pinch the tip closed.
    const last = (vv - 1) * vu;
    for (let i = 0; i <= ring; i++) {
      const o = (last + i) * 3;
      out[o] = line[(vv - 1) * 3];
      out[o + 1] = line[(vv - 1) * 3 + 1];
      out[o + 2] = line[(vv - 1) * 3 + 2];
    }
  }

  dispose(): void {
    for (const pc of this.pieces) {
      pc.mesh.removeFromParent();
      pc.geo.dispose();
      (pc.mesh.material as MeshToonMaterial).dispose();
    }
    this.pieces.length = 0;
  }
}
