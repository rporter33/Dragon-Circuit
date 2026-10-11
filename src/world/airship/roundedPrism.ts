import { BoxGeometry, ExtrudeGeometry, Shape, type BufferGeometry } from 'three';
import type { BoxCollider } from '../../core/types';

/** Flat-topped rounded footprint matching BoxCollider.roundXZ, centred at the origin. */
export function roundedPrism(b: BoxCollider): BufferGeometry {
  const r = Math.min(b.roundXZ ?? 0, b.hx, b.hz);
  if (!(r > 0)) return new BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2);
  const x = b.hx, z = b.hz, shape = new Shape();
  shape.moveTo(-x + r, -z);
  shape.lineTo(x - r, -z); shape.absarc(x - r, -z + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(x, z - r); shape.absarc(x - r, z - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-x + r, z); shape.absarc(-x + r, z - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-x, -z + r); shape.absarc(-x + r, -z + r, r, Math.PI, Math.PI * 1.5, false);
  return new ExtrudeGeometry(shape, { depth: b.hy * 2, bevelEnabled: false, curveSegments: 8, steps: 1 })
    .rotateX(Math.PI / 2).translate(0, b.hy, 0);
}
