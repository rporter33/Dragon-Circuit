import { BoxGeometry, BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh } from 'three';
import { toonMaterial } from '../../render/painterly';
import { WINDHAVEN_ORIGIN, windhavenPlan, type Finish, type ShipPart } from './windhavenPlan';

const COLORS: Record<Finish, string> = { deck: '#b99361', cream: '#eee0bd', blue: '#638eab', bronze: '#927344', timber: '#70543b' };

/** Review asset, constructed locally without external models or textures. */
export function buildWindhaven(parts: readonly ShipPart[] = windhavenPlan()): Group {
  const group = new Group();
  group.name = 'Windhaven blockout';
  group.position.set(WINDHAVEN_ORIGIN.x, WINDHAVEN_ORIGIN.y, WINDHAVEN_ORIGIN.z);
  const materials = Object.fromEntries(Object.entries(COLORS).map(([id, color]) => [id, toonMaterial({ color })])) as Record<Finish, ReturnType<typeof toonMaterial>>;
  const cube = new BoxGeometry(1, 1, 1);
  for (const part of parts) {
    const b = part.box;
    const mesh = new Mesh(cube, materials[part.finish]);
    mesh.name = part.id;
    mesh.position.set(b.x, b.y, b.z);
    mesh.rotation.y = b.yaw;
    mesh.scale.set(b.hx * 2, b.hy * 2, b.hz * 2);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  const cloth = toonMaterial({ color: '#f2e7cd', side: DoubleSide });
  const edge = toonMaterial({ color: '#729fba', side: DoubleSide });
  // Two consistent swept wings, rooted above the masts. Their entire footprint is forward
  // of the landing terrace. Cloth/fins are silhouette studies and have no collision yet.
  for (const [z, y, span, chord] of [[18, 22, 29, 16], [28, 17, 20, 10]]) {
    for (const side of [-1, 1]) {
      const point = (u: number, v: number) => [side * (1 + u * span), y + Math.sin(u * Math.PI) * 3 - v * 1.6, z - u * 7 + (v - 0.5) * chord * (1 - 0.85 * u)];
      for (const [v0, v1, mat] of [[0, 0.88, cloth], [0.88, 1, edge]] as const) {
        const vertices: number[] = [];
        for (let i = 0; i < 16; i++) {
          const a = point(i / 16, v0), b = point((i + 1) / 16, v0);
          const c = point((i + 1) / 16, v1), d = point(i / 16, v1);
          vertices.push(...a, ...b, ...c, ...a, ...c, ...d);
        }
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
        geometry.computeVertexNormals();
        const mesh = new Mesh(geometry, mat);
        mesh.name = 'Proposed sail cloth (visual only)';
        mesh.castShadow = true;
        group.add(mesh);
      }
    }
  }
  for (const side of [-1, 1]) {
    for (const z of [-16, 8]) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([side * 9, -3, z + 6, side * 15, -13, z - 6, side * 11, -4, z - 7], 3));
      geometry.computeVertexNormals();
      const mesh = new Mesh(geometry, edge);
      mesh.name = 'Proposed steering cloth (visual only)';
      group.add(mesh);
    }
  }
  return group;
}
