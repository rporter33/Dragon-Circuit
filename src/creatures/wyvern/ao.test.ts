// A10: the ambient occlusion in aExtra.x (the baked field and its analytic fallback).

import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { rigFor } from './rig';
import { aoJob, applyAO, buildWyvernGeometry, type WyvernMeshInfo } from './geometry';
import { bakeAO } from './ao';
import { REGION } from './builder';
import { look } from './wyvern.testkit';

/** Median of `field` over the hide-tube vertices (aMat.w > 0.5, D's onTube) that pass `f`. */
function median(info: WyvernMeshInfo, field: ArrayLike<number>, f: (p: Vector3) => boolean): number {
  const pos = info.geometry.getAttribute('position');
  const mat = info.geometry.getAttribute('aMat');
  const p = new Vector3();
  const vals: number[] = [];
  for (let v = 0; v < pos.count; v++) {
    if (!info.ao.mask[v] || Math.round(mat.getX(v)) !== REGION.skin || mat.getW(v) < 0.5) continue;
    if (f(p.fromBufferAttribute(pos, v))) vals.push(field[v]);
  }
  expect(vals.length).toBeGreaterThanOrEqual(8);
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1];
}

/** The hide round a limb root: level with the joint, within r of it along and up. */
const near = (at: readonly number[], r: number) => (p: Vector3) => Math.abs(p.z - at[2]) < r && Math.abs(p.y - at[1]) < r;

describe('ambient occlusion (A10)', () => {
  it('every vertex carries a value in aExtra.x, the builders’ own values times the field', () => {
    for (const lod of [0, 1, 2] as const) {
      const info = buildWyvernGeometry(rigFor('harrier'), look('harrier'), lod);
      const ex = info.geometry.getAttribute('aExtra');
      for (let v = 0; v < ex.count; v++) {
        const a = ex.getX(v);
        expect(Number.isFinite(a)).toBe(true);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
        expect(a).toBeCloseTo(info.ao.base[v] * info.ao.field[v], 5);
      }
      // The field covers the body's hide (group 0), not the eyes, teeth or claws.
      const mat = info.geometry.getAttribute('aMat');
      const idx = info.geometry.index!.array;
      const g0 = info.geometry.groups[0];
      for (let i = g0.start; i < g0.start + g0.count; i++) if (Math.round(mat.getX(idx[i])) === REGION.skin) expect(info.ao.mask[idx[i]]).toBe(1);
    }
  });

  it.each(['harrier', 'ironback'] as const)('%s: the bake shades the shoulder root and the hide under the saddle, leaves the open back lit', (breed) => {
    const rig = rigFor(breed);
    const info = buildWyvernGeometry(rig, look(breed), 0);
    const job = aoJob(info);
    const ao = bakeAO(job.pos, job.nrm, job.tris, job.mask);
    const P = rig.props;
    const seat = info.saddle.seat;
    const shoulder = near(P.shoulder, 0.3);
    // The hide under the saddle's footprint (the blanket and the flaps): shut in, so no seam glows.
    const footprint = (p: Vector3) => p.y > seat.y - 0.8 && Math.abs(p.z - seat.z) < 0.3;
    // The open back behind the saddle and ahead of the hips.
    const open = (p: Vector3) => p.y > P.hip[1] && Math.abs(p.x) < 0.4 && p.z < seat.z - 0.6 && p.z > P.hip[2] + 0.35;
    expect(median(info, ao, shoulder)).toBeGreaterThan(0.3);
    expect(median(info, ao, shoulder)).toBeLessThan(0.75);
    expect(median(info, ao, footprint)).toBeLessThan(0.4);
    expect(median(info, ao, open)).toBeGreaterThan(0.9);
    // The fallback agrees in kind: the shoulder root shaded about as the bake has it, the back open.
    const anl = info.ao.field;
    expect(median(info, anl, shoulder)).toBeGreaterThan(0.25);
    expect(median(info, anl, shoulder)).toBeLessThan(0.75);
    expect(median(info, anl, open)).toBeGreaterThan(median(info, anl, shoulder) + 0.2);
    // applyAO swaps the field in.
    applyAO(info, ao);
    const ex = info.geometry.getAttribute('aExtra');
    for (let v = 0; v < ex.count; v += 97) expect(ex.getX(v)).toBeCloseTo(info.ao.base[v] * ao[v], 5);
  });
});
