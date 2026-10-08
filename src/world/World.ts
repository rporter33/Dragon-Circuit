// Builds the visible archipelago. (Baseline mesher; the terrain and dressing module owners
// replace it with full island meshes, vegetation, waterfalls and structures.)

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  type PerspectiveCamera,
  type Scene,
  Vector3,
} from 'three';
import type { WorldSystem } from '../game/contracts';
import type { QualityProfile } from '../render/quality';
import { vertexColorToon } from '../render/painterly';
import { LAYOUT, type WorldLayout } from './layout';
import { Terrain } from './terrain';
import type { IslandShape } from './islandShape';

const GRASS = new Color('#6f9a4a');
const ROCK = new Color('#8a7a6a');
const UNDER = new Color('#5a4a42');

function islandGeometry(shape: IslandShape, rings = 24, segs = 64): BufferGeometry {
  const d = shape.def;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const n = new Vector3();
  // Top surface: center vertex + rings.
  const ringVerts = (fn: (x: number, z: number) => number, colorAt: (x: number, z: number, y: number) => Color, flip: boolean) => {
    const base = pos.length / 3;
    pos.push(d.x, fn(d.x, d.z), d.z);
    const c0 = colorAt(d.x, d.z, 0);
    col.push(c0.r, c0.g, c0.b);
    for (let r = 1; r <= rings; r++) {
      const t = r / rings;
      for (let s = 0; s < segs; s++) {
        const th = (s / segs) * Math.PI * 2;
        const R = shape.outlineRadius(th) * t;
        const x = d.x + Math.cos(th) * R;
        const z = d.z + Math.sin(th) * R;
        const y = fn(x, z);
        pos.push(x, y, z);
        const c = colorAt(x, z, t);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let s = 0; s < segs; s++) {
      const a = base + 1 + s;
      const b = base + 1 + ((s + 1) % segs);
      if (flip) idx.push(base, a, b);
      else idx.push(base, b, a);
    }
    for (let r = 1; r < rings; r++) {
      for (let s = 0; s < segs; s++) {
        const a = base + 1 + (r - 1) * segs + s;
        const b = base + 1 + (r - 1) * segs + ((s + 1) % segs);
        const c = base + 1 + r * segs + s;
        const e = base + 1 + r * segs + ((s + 1) % segs);
        if (flip) idx.push(a, c, b, b, c, e);
        else idx.push(a, b, c, b, e, c);
      }
    }
    return base;
  };
  const topBase = ringVerts(
    (x, z) => shape.topHeight(x, z),
    (x, z) => {
      shape.topNormal(x, z, n);
      return n.y < 0.75 ? ROCK : GRASS;
    },
    false,
  );
  const botBase = ringVerts((x, z) => shape.bottomHeight(x, z), () => UNDER, true);
  // Cliff band joining the outer rings.
  const outerTop = topBase + 1 + (rings - 1) * segs;
  const outerBot = botBase + 1 + (rings - 1) * segs;
  for (let s = 0; s < segs; s++) {
    const a = outerTop + s;
    const b = outerTop + ((s + 1) % segs);
    const c = outerBot + s;
    const e = outerBot + ((s + 1) % segs);
    idx.push(a, c, b, b, c, e);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class World implements WorldSystem {
  readonly terrain: Terrain;
  readonly layout: WorldLayout;
  readonly group = new Group();

  constructor(scene: Scene, _quality: QualityProfile) {
    this.layout = LAYOUT;
    this.terrain = new Terrain(this.layout);
    this.group.name = 'world';
    const mat = vertexColorToon();
    for (const shape of this.terrain.islands) {
      const mesh = new Mesh(islandGeometry(shape), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    scene.add(this.group);
  }

  update(_dt: number, _camera: PerspectiveCamera, _focus: Vector3): void {}

  setQuality(_q: QualityProfile): void {}
}
