import {
  BoxGeometry, BufferGeometry, CatmullRomCurve3, Color, DoubleSide, Float32BufferAttribute,
  Group, InstancedMesh, Matrix4, Mesh, Quaternion, TorusGeometry, TubeGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonMaterial } from '../../render/painterly';
import { CABIN_WALLS, WINDHAVEN_HITCHES, WINDHAVEN_ORIGIN, WINDOW_SHOULDER, WINDOW_SILL, windhavenPlan, type Finish, type ShipPart } from './windhavenPlan';
import { roundedPrism } from './roundedPrism';
import { SailCloth } from './SailCloth';
import { hullTexture, windhavenHull } from './windhavenHull';

// Master v2 palette. Timber and aged bronze support the pale cloth.
const COLORS = {
  deck: '#bda582', cream: '#F2EADA', blue: '#7FA8C4', bronze: '#AA8656', timber: '#705b46',
  linen: '#FAF8F3', seam: '#c8baa1',
};
type Paint = keyof typeof COLORS;
type Point = (u: number, v: number) => Vector3;

export class WindhavenView extends Group {
  readonly sails: SailCloth[] = [];
  private readonly wind = new Vector3();
  private readonly sample = new Vector3();
  updateCloth(dt: number, windAt: (point: Vector3, out: Vector3) => Vector3): void {
    for (const sail of this.sails) {
      this.sample.copy(sail.samplePoint).add(this.position);
      sail.update(dt, windAt(this.sample, this.wind));
    }
  }
}

/** Indexed smooth surface; the same function also places spars and sewn panel seams. */
function surface(point: Point, nu: number, nv: number, v0 = 0, v1 = 1): BufferGeometry {
  const vertices: number[] = [], indices: number[] = [];
  for (let u = 0; u <= nu; u++) for (let v = 0; v <= nv; v++) {
    vertices.push(...point(u / nu, v0 + (v1 - v0) * v / nv).toArray());
  }
  for (let u = 0; u < nu; u++) for (let v = 0; v < nv; v++) {
    const a = u * (nv + 1) + v, b = a + nv + 1;
    indices.push(a, b, b + 1, a, b + 1, a + 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Procedural art study. Structural boxes use their exact collider transforms.
 * Cloth and its light fittings are decorative; the landing/ground routes stay clear.
 */
export function buildWindhaven(parts: readonly ShipPart[] = windhavenPlan()): WindhavenView {
  const group = new WindhavenView();
  group.name = 'Windhaven';
  group.position.set(WINDHAVEN_ORIGIN.x, WINDHAVEN_ORIGIN.y, WINDHAVEN_ORIGIN.z);
  const hull = new Mesh(windhavenHull().geometry.clone(), toonMaterial({ color: '#ffffff', map: hullTexture(), rim: 0.28 }));
  hull.name = 'hull-shell';
  hull.castShadow = hull.receiveShadow = true;
  group.add(hull);
  const cube = new BoxGeometry(1, 1, 1);
  const matrix = new Matrix4(), rotation = new Quaternion(), up = new Vector3(0, 1, 0);
  const position = new Vector3(), scale = new Vector3();
  // Structural fittings are batched by material; the hull is one continuous surface.
  for (const finish of ['deck', 'cream', 'blue', 'bronze', 'timber'] as Finish[]) {
    const rounded = parts.filter(p => p.finish === finish && p.box.roundXZ);
    if (rounded.length) {
      let start = 0;
      const ranges: { id: string; start: number; count: number }[] = [];
      const geometries = rounded.map(p => {
        const b = p.box;
        const geometry = roundedPrism(b).rotateY(b.yaw).translate(b.x, b.y, b.z);
        const count = geometry.getAttribute('position').count;
        ranges.push({ id: p.id, start, count });
        start += count;
        return geometry;
      });
      const mesh = new Mesh(mergeGeometries(geometries)!, toonMaterial({ color: COLORS[finish], rim: 0.28 }));
      geometries.forEach(g => g.dispose());
      mesh.name = `rounded-${finish}`;
      mesh.userData.partVertexRanges = ranges;
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
    const batch = parts.filter(p => p.finish === finish && !p.box.roundXZ);
    if (!batch.length) continue;
    const mesh = new InstancedMesh(cube, toonMaterial({ color: COLORS[finish], rim: 0.28 }), batch.length);
    mesh.name = `structure-${finish}`;
    mesh.userData.partIds = batch.map(p => p.id);
    batch.forEach((part, i) => {
      const b = part.box;
      matrix.compose(position.set(b.x, b.y, b.z), rotation.setFromAxisAngle(up, b.yaw), scale.set(b.hx * 2, b.hy * 2, b.hz * 2));
      mesh.setMatrixAt(i, matrix);
      if (finish === 'deck') mesh.setColorAt(i, new Color().setScalar(0.96 + (i % 4) * 0.018));
    });
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Batch fittings by material. No downloads, individual rivet draws or new shaders.
  const details = new Map<Paint, BufferGeometry[]>();
  const add = (paint: Paint, geometry: BufferGeometry) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    for (const key of Object.keys(flat.attributes)) if (key !== 'position' && key !== 'normal') flat.deleteAttribute(key);
    if (flat !== geometry) geometry.dispose();
    const list = details.get(paint) ?? [];
    list.push(flat);
    details.set(paint, list);
  };
  const box = (paint: Paint, x: number, y: number, z: number, w: number, h: number, d: number) =>
    add(paint, new BoxGeometry(w, h, d).translate(x, y, z));
  const tube = (paint: Paint, points: Vector3[], radius: number, segments = 24) =>
    add(paint, new TubeGeometry(new CatmullRomCurve3(points), segments, radius, 6, false));
  const path = (fn: (t: number) => Vector3, steps = 24) => Array.from({ length: steps + 1 }, (_, i) => fn(i / steps));
  const line = (paint: Paint, a: Vector3, b: Vector3, radius: number) => tube(paint, [a, b], radius, 1);
  const cloth = (name: string, point: Point, loose = false, emblem = false) => {
    const sail = new SailCloth(name, point, loose, emblem);
    group.sails.push(sail);
    group.add(sail.mesh);
  };

  // Flush caulking rather than raised bars across the landing terrace.
  for (let x = -13.5; x <= 13.5; x += 0.9) {
    const end = 14 + 22 * Math.sqrt(1 - (Math.abs(x) / 14) ** 2) - 0.2;
    const start = -34.8 - Math.sqrt(1.44 - Math.max(0, Math.abs(x) - 12.8) ** 2) + 0.1;
    box('timber', x, 0.008, (end + start) / 2, 0.018, 0.008, end - start);
    const joinEnd = Math.min(end, 14 + 22 * Math.sqrt(Math.max(0, 1 - (Math.abs(x + 0.84) / 14) ** 2)) - 0.2);
    for (let z = -32 + (Math.round((x + 13.5) / 0.9) % 3) * 2; x + 0.84 < 14 && z < joinEnd; z += 8) {
      box('timber', x + 0.43, 0.009, z, 0.82, 0.008, 0.018);
    }
  }
  for (const side of [-1, 1]) {
    line('bronze', new Vector3(side * 13.78, 0.012, -35.2), new Vector3(side * 13.78, 0.012, 14), 0.045);
    for (const y of [0.35, 6, 12, 19.8]) box('bronze', side * 6, y, 14, 0.69, 0.18, 0.69);
    for (const z of [-9.5, 5.5]) {
      box('timber', side * 7.3, 0.15, z, 0.55, 0.3, 0.55);
      box('cream', side * 7.3, 9.35, z, 0.58, 0.3, 0.58);
    }
  }

  // Crescent wings: cloth, boltropes and curved spars evaluate the same surface.
  for (const [z, y, span, chord] of [[14, 20, 30, 22], [26, 16, 23, 12]]) {
    for (const side of [-1, 1]) {
      const sail: Point = (u, v) => new Vector3(
        side * u * span,
        y + Math.sin(u * Math.PI) * 4.1 + u * 1.2 - Math.sin(v * Math.PI) * (1 - u) * 2.1,
        z - u * 8 + (0.5 - v) * chord * Math.pow(1 - u, 0.72),
      );
      cloth(`sail-${z}-${side}`, sail, false, z === 14 && side === 1);
      for (const v of [0, 1]) tube('timber', path(u => sail(u, v)), v === 0 ? 0.13 : 0.075, 36);
      tube('seam', path(v => sail(0, v)), 0.04);
      const mast = new Vector3(side * 6, y, 14);
      for (const v of [0, 1]) line('timber', mast, sail(0, v), 0.14);
      line('seam', new Vector3(side * 6, 12, 14), sail(0.7, 0), 0.035);
    }
  }

  // Linen shade on the unchanged shelter slab: underside/headroom remains 9.6 m.
  const shade: Point = (u, v) => new Vector3((u - 0.5) * 15.2, 10.03 + Math.sin(u * Math.PI) * 0.85 + Math.sin(v * Math.PI) * 0.25, -10 + 16 * v);
  add('linen', surface(shade, 24, 20));
  for (const v of [0, 1]) tube('timber', path(u => shade(u, v)), 0.09);
  for (const u of [0, 0.25, 0.5, 0.75, 1]) tube('seam', path(v => shade(u, v)), 0.028);
  for (const x of [-6, -3, 0, 3, 6]) box('cream', x, 3, 5.81, 0.12, 5.8, 0.05);
  box('timber', 0, 0.3, 5.8, 14.7, 0.5, 0.08);

  // Glassless arched windows. Shared masonry layout leaves actual sight lines through the cabin.
  const arch = (x: number, z: number, yaw: number, width = 1.45) => {
    const r = width / 2, base = WINDOW_SILL, shoulder = WINDOW_SHOULDER;
    const transform = new Matrix4().makeRotationY(yaw).setPosition(x, 0, z);
    const place = (xx: number, yy: number) => new Vector3(xx, yy, 0.016).applyMatrix4(transform);
    const rim = [place(-r, base), ...path(t => place(Math.cos(Math.PI - t * Math.PI) * r, shoulder + Math.sin(t * Math.PI) * r)), place(r, base)];
    tube('bronze', rim, 0.055, 40);
    line('timber', place(0, base), place(0, shoulder + r), 0.045);
    line('blue', place(-r, 1.8), place(r, 1.8), 0.045);
    line('cream', place(-r - 0.1, base), place(r + 0.1, base), 0.09);
  };
  for (const side of [-1, 1]) {
    for (const z of [16.2, 19.5, 22.5, 25.8]) box('cream', side * 4.18, 2.15, z, 0.16, 4.3, 0.18);
    box('blue', side * 4.17, 0.45, 21, 0.09, 0.55, 9.8);
    box('bronze', side * 4.2, 4.35, 21, 0.15, 0.12, 10.25);
  }
  for (const wall of CABIN_WALLS) for (const u of wall.windows) {
    for (const face of [-1, 1]) arch(wall.x + Math.cos(wall.yaw) * u + Math.sin(wall.yaw) * 0.16 * face,
      wall.z - Math.sin(wall.yaw) * u + Math.cos(wall.yaw) * 0.16 * face, wall.yaw, wall.width);
  }
  const roof: Point = (u, v) => new Vector3((u - 0.5) * 8.8, 4.82 + Math.sin(u * Math.PI) * 0.95, 15.5 + v * 11);
  add('blue', surface(roof, 24, 16));
  for (const v of [0, 1]) tube('cream', path(u => roof(u, v)), 0.12);
  for (const u of [0, 0.25, 0.5, 0.75, 1]) tube('seam', path(v => roof(u, v)), 0.025);
  for (const x of [-1.62, 1.62]) box('timber', x, 2.15, 15.8, 0.09, 4.3, 0.05);

  // A single long travel pennon above the cabin, attached near the head of its standard.
  line('timber', new Vector3(0, 5.8, 24.5), new Vector3(0, 10, 24.5), 0.075);
  const pennon: Point = (u, v) => new Vector3(0.5 * Math.sin(u * 5), 9.65 - v * 1.35 * (1 - u * 0.75) - 0.2 * Math.sin(u * 5), 24.5 - u * 5);
  cloth('travel-pennon', pennon, true);

  for (const hitch of WINDHAVEN_HITCHES) {
    const anchor = new Group();
    anchor.name = `hitch-socket-${hitch.id}`;
    anchor.position.set(hitch.x + hitch.side * 0.43, hitch.y, hitch.z);
    anchor.userData = { capacity: 1, reserved: true, gameplayImplemented: false };
    group.add(anchor);
    add('bronze', new TorusGeometry(0.38, 0.08, 8, 24).rotateY(Math.PI / 2).translate(anchor.position.x, anchor.position.y, anchor.position.z));
    box('blue', hitch.x, 0.88, hitch.z, 0.72, 0.18, 0.72);
  }

  // Broad construction detail stays within the existing workbench/storage footprints.
  for (const x of [-10.5, 10.5]) {
    box('deck', x, 1.205, 10, 2.48, 0.01, 2.98);
    for (const dx of [-0.94, 0.94]) box('bronze', x + dx, 0.66, 4.68, 0.12, 1.1, 0.04);
    box('timber', x, 1.305, 5.5, 2.48, 0.01, 1.58);
    box('bronze', x, 0.72, 4.66, 0.24, 0.22, 0.04);
  }
  box('linen', 0, 1.305, 30, 2.15, 0.01, 1.2);
  for (let i = 0; i < 3; i++) tube('blue', path(t => new Vector3(-0.8 + 1.5 * t, 1.318, 29.7 + i * 0.24 + Math.sin(t * 6) * 0.08)), 0.018);

  // Lower crescent stabilizer cloth remains explicitly visual-only.
  for (const side of [-1, 1]) for (const z of [-16, 8]) {
    const fin: Point = (u, v) => new Vector3(side * (9 + 7 * u), -2.8 - 8 * Math.sin(u * Math.PI / 2) - v * Math.sin(u * Math.PI), z + 6 - 11 * u - v * 12 * Math.sin(u * Math.PI));
    cloth(`steering-sail-${z}-${side}`, fin);
    for (const v of [0, 1]) tube('timber', path(u => fin(u, v)), 0.10);
  }

  for (const [paint, geometries] of details) {
    const geometry = mergeGeometries(geometries)!;
    geometries.forEach(g => g.dispose());
    const mesh = new Mesh(geometry, toonMaterial({ color: COLORS[paint], side: DoubleSide, rim: 0.28 }));
    mesh.name = `ornament-${paint}`;
    mesh.userData.visualOnly = true;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
