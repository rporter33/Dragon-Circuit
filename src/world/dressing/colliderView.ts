// Debug view of collision shapes: wireframes over the world (solid orange, soft green), so what
// you see can be checked against what you hit. Built on demand from any collider lists:
// game.dressing.showColliders(true) in the console or an automation script.

import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { Collider } from '../../core/types';

const SOLID = new Color('#ff8a1f');
const SOFT = new Color('#3dff6a');

export function colliderView(lists: readonly (readonly Collider[])[]): Group {
  const group = new Group();
  group.name = 'debug:colliders';
  const all = lists.flat();
  const kinds: { geo: BufferGeometry; items: Collider[] }[] = [
    { geo: new BoxGeometry(1, 1, 1), items: all.filter((c) => c.kind === 'box') },
    { geo: new CylinderGeometry(1, 1, 1, 12, 1, true), items: all.filter((c) => c.kind === undefined || c.kind === 'cylinder') },
    { geo: new SphereGeometry(1, 10, 6), items: all.filter((c) => c.kind === 'sphere') },
  ];
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const pos = new Vector3();
  const scale = new Vector3();
  for (const { geo, items } of kinds) {
    if (items.length === 0) continue;
    const mat = new MeshBasicMaterial({ wireframe: true, transparent: true, opacity: 0.55, depthWrite: false, fog: false });
    const mesh = new InstancedMesh(geo, mat, items.length);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    items.forEach((c, i) => {
      if (c.kind === 'box') {
        q.setFromAxisAngle(up, c.yaw);
        m.compose(pos.set(c.x, c.y, c.z), q, scale.set(c.hx * 2, c.hy * 2, c.hz * 2));
      } else if (c.kind === 'sphere') {
        m.compose(pos.set(c.x, c.y, c.z), q.identity(), scale.setScalar(c.radius));
      } else {
        m.compose(pos.set(c.x, (c.y0 + c.y1) / 2, c.z), q.identity(), scale.set(c.radius, c.y1 - c.y0, c.radius));
      }
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.soft ? SOFT : SOLID);
    });
    group.add(mesh);
  }
  return group;
}
