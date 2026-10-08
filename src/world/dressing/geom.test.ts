import { describe, expect, it } from 'vitest';
import { BoxGeometry, Vector3 } from 'three';
import { GeoBuilder, bezier, tube, xf } from './geom';

describe('geometry kit', () => {
  it('builds tubes whose normals point away from the path', () => {
    const path = [new Vector3(0, 0, 0), new Vector3(0, 5, 0), new Vector3(2, 10, 0)];
    const g = tube(path, [1, 0.8, 0.5], 8, false);
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    const p = new Vector3();
    const n = new Vector3();
    for (let i = 0; i < 8; i++) {
      p.fromBufferAttribute(pos, i);
      n.fromBufferAttribute(nrm, i);
      expect(n.dot(p.clone().sub(path[0]).normalize())).toBeGreaterThan(0.5);
    }
  });

  it('merges transformed parts with per-vertex color, sway and glow', () => {
    const b = new GeoBuilder();
    b.add(new BoxGeometry(1, 1, 1), xf(10, 0, 0), { color: '#ff0000', sway: (p) => p.y + 1 });
    b.add(new BoxGeometry(1, 1, 1), xf(-10, 0, 0, 0, 0, 0, -1, 1, 1), { glow: 1 });
    const g = b.build();
    expect(g.getAttribute('position').count).toBe(48);
    expect(g.getAttribute('aSway')).toBeDefined();
    expect(g.getAttribute('aGlow')).toBeDefined();
    expect(g.getAttribute('color').getX(0)).toBeCloseTo(1);
    // The mirrored copy still has outward-facing winding: geometry normals agree with stored ones.
    const check = g.clone();
    check.computeVertexNormals();
    const a = g.getAttribute('normal');
    const c = check.getAttribute('normal');
    for (let i = 24; i < 48; i++) expect(a.getX(i) * c.getX(i) + a.getY(i) * c.getY(i) + a.getZ(i) * c.getZ(i)).toBeGreaterThan(0.5);
  });

  it('inverts shells on request', () => {
    const b = new GeoBuilder();
    b.add(new BoxGeometry(1, 1, 1), null, { invert: true });
    const g = b.build();
    const n = new Vector3().fromBufferAttribute(g.getAttribute('normal'), 0);
    const p = new Vector3().fromBufferAttribute(g.getAttribute('position'), 0);
    expect(n.dot(p)).toBeLessThan(0);
  });

  it('samples Bézier curves through their end points', () => {
    const pts = bezier([new Vector3(0, 0, 0), new Vector3(1, 2, 0), new Vector3(2, 0, 0)], 4);
    expect(pts.length).toBe(5);
    expect(pts[0].x).toBe(0);
    expect(pts[4].x).toBeCloseTo(2);
    expect(pts[2].y).toBeCloseTo(1);
  });
});
