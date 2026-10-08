// The lofted body: one continuous tube from inside the skull, down the neck, through the torso
// and out to the tail tip, skinned along the spine chain.

import { Vector3 } from 'three';
import { smoothstep } from '../../../core/math';
import { GeoBuilder, REGION, Skin } from '../builder';
import { surfacePoint, type RigDef } from '../rig';
import { SkinChain, type ChainSegment } from './chain';

export const BODY_AROUND = 18;

/** The spine chain as arc-length segments of the body plan. */
export function bodyChain(rig: RigDef): SkinChain {
  const { plan, idx } = rig;
  const k = plan.keyS;
  const m = plan.marks;
  const segs: ChainSegment[] = [{ bone: idx.head, s0: k[0], s1: k[m.neckTop] }];
  // Neck joints run from the top (neck5) down to the base (neck0).
  for (let i = 0; i < idx.neck.length; i++) {
    const bone = idx.neck[idx.neck.length - 1 - i];
    segs.push({ bone, s0: k[m.neckTop + i], s1: k[m.neckTop + i + 1] });
  }
  segs.push({ bone: idx.chest, s0: k[m.neckBase], s1: k[m.chest] });
  segs.push({ bone: idx.spine, s0: k[m.chest], s1: k[m.mid] });
  segs.push({ bone: idx.pelvis, s0: k[m.mid], s1: k[m.tailBase] });
  for (let i = 0; i < idx.tail.length; i++) {
    segs.push({ bone: idx.tail[i], s0: k[m.tailBase + i], s1: k[Math.min(m.tip, m.tailBase + i + 1)] });
  }
  return new SkinChain(segs);
}

export function buildBody(b: GeoBuilder, rig: RigDef): void {
  const { plan, idx } = rig;
  const chain = bodyChain(rig);
  const k = plan.keyS;
  const m = plan.marks;
  const len = plan.length;
  const p = new Vector3();
  const n = new Vector3();

  // Stations: denser where the body bends most (neck and tail base), ~0.16 m elsewhere.
  const stations: number[] = [];
  const step = Math.max(0.1, rig.props.shape.torsoLength * 0.048);
  for (let s = 0; s < len; s += step * (s > k[m.tailBase] + 1.5 ? 1.25 : 1)) stations.push(s);
  stations.push(len);

  const sChest = k[m.chest];
  const sRear = k[m.rear];
  const sNeckBase = k[m.neckBase];
  const sTail = k[m.tailBase];
  const rings: number[][] = [];
  b.begin(0);
  for (let si = 0; si < stations.length; si++) {
    const s = stations[si];
    const st = plan.station(s);
    // A low dorsal ridge along the neck, back and tail.
    const ridge = 0.07 * smoothstep(k[1], k[2], s) * (1 - 0.6 * smoothstep(sTail, len, s));
    const ring: number[] = [];
    for (let a = 0; a < BODY_AROUND; a++) {
      const th = (a / BODY_AROUND) * Math.PI * 2;
      const c = Math.cos(th);
      surfacePoint(st, th, p);
      const bump = ridge * Math.exp(-(th > Math.PI ? (th - Math.PI * 2) ** 2 : th * th) / 0.08) * st.upper;
      p.addScaledVector(st.up, bump);
      const skin = chain.skin(s);
      // Ribs and belly breathe: part of the torso's lower flanks follows the breath bone.
      const torso = smoothstep(sNeckBase, sChest, s) * (1 - smoothstep(sChest + (sRear - sChest) * 0.7, sRear, s));
      const lower = smoothstep(0.55, -0.35, c);
      if (torso * lower > 0) {
        const w = 0.55 * torso * lower;
        const blended = new Skin().mix(skin, 1 - w).add(idx.breath, w);
        ring.push(
          b.vertex(p, blended, { region: REGION.skin, belly: smoothstep(-0.25, -0.72, c), dorsal: smoothstep(0.25, 0.95, c) }, s, Math.sin(th)),
        );
        continue;
      }
      ring.push(b.vertex(p, skin, { region: REGION.skin, belly: smoothstep(-0.25, -0.72, c), dorsal: smoothstep(0.25, 0.95, c) }, s, Math.sin(th)));
    }
    rings.push(ring);
  }
  // Stitch (the ring runs dorsal → left → belly → right; stations run head → tail).
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r];
    const B = rings[r + 1];
    for (let i = 0; i < BODY_AROUND; i++) {
      const j = (i + 1) % BODY_AROUND;
      b.quad(A[i], A[j], B[j], B[i]);
    }
  }
  // Cap both ends (the front one hides inside the skull, the back one under the tail tip).
  const st0 = plan.station(0);
  const c0 = b.vertex(st0.center, chain.skin(0), { region: REGION.skin }, 0, 0);
  const st1 = plan.station(len);
  const c1 = b.vertex(n.copy(st1.center).addScaledVector(st1.tangent, 0.02), chain.skin(len), { region: REGION.skin, belly: 0.5 }, len, 0);
  const first = rings[0];
  const last = rings[rings.length - 1];
  for (let i = 0; i < BODY_AROUND; i++) {
    const j = (i + 1) % BODY_AROUND;
    b.tri(c0, first[j], first[i]);
    b.tri(c1, last[i], last[j]);
  }
  b.end();
}
