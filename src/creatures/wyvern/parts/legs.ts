// Hind legs: a heavy muscled thigh, a lean shin and metatarsus (digitigrade, like a bird or a
// theropod), and a foot with three forward toes and a hallux, all clawed.

import { Vector3 } from 'three';
import { GeoBuilder, REGION, Skin, ZONE, ellipsoid, tube, zoneExtra } from '../builder';
import { SIDE_SIGN, type RigDef } from '../rig';
import { SkinChain } from './chain';
import { bezier3, spike } from './shape';
import { RES, sides, steps, type Res } from './res';

/** Toes (left foot; azimuth + = outward): four forward, the fourth longest, and a short fifth. */
const TOES: { az: number; len: number }[] = [
  { az: -0.55, len: 0.7 },
  { az: -0.18, len: 0.95 },
  { az: 0.18, len: 1.0 },
  { az: 0.5, len: 0.85 },
  { az: 1.3, len: 0.3 },
];
const SCUTATE = zoneExtra(ZONE.scutate);

export function buildLegs(b: GeoBuilder, rig: RigDef, res: Res = RES[0]): void {
  const thighRings = res.lod === 0 ? 4 + res.limbRings : res.lod === 1 ? 3 : 2;
  const shinRings = res.lod === 0 ? 3 : res.lod === 1 ? 2 : 1;
  const P = rig.props;
  const S = P.shape;
  const G = P.leg;
  for (let side = 0; side < 2; side++) {
    const sx = SIDE_SIGN[side];
    const li = rig.idx.legs[side];
    const m = (v: Vector3) => new Vector3(v.x * sx, v.y, v.z);
    const hip = new Vector3(P.hip[0] * sx, P.hip[1], P.hip[2]);
    const knee = m(rig.knee);
    const ankle = m(rig.ankle);
    const ball = m(rig.ball);
    const R = S.thighRadius;

    // Centerline: start inside the body above the hip so the thigh flows out of the flank.
    const pts: Vector3[] = [];
    const radii: [number, number][] = [];
    const sAt: number[] = [];
    const push = (p: Vector3, rx: number, ry: number) => {
      sAt.push(pts.length ? sAt[sAt.length - 1] + p.distanceTo(pts[pts.length - 1]) : 0);
      pts.push(p);
      radii.push([rx, ry]);
    };
    const inBody = hip.clone().add(new Vector3(-0.35 * R * sx, 0.55 * R, 0.1 * R));
    push(inBody, R * 0.9, R * 1.05);
    if (res.lod < 2) push(hip.clone().lerp(inBody, 0.35), R * 1.0, R * 1.12);
    for (let i = 1; i <= thighRings; i++) {
      const t = i / (thighRings + 1);
      const r = R * (1 - 0.55 * t * t);
      push(hip.clone().lerp(knee, t), r * 0.92, r * 1.12);
    }
    push(knee.clone(), R * 0.5, R * 0.54);
    const iKnee = pts.length - 1;
    for (let i = 1; i <= shinRings; i++) {
      const t = i / (shinRings + 1);
      // The calf muscle sits high on the shin.
      const r = R * (0.5 - 0.16 * t + 0.06 * Math.sin(Math.PI * t * 0.8));
      push(knee.clone().lerp(ankle, t), r * 0.85, r);
    }
    const iAnkle = pts.length;
    push(ankle.clone(), R * 0.32, R * 0.34);
    if (res.lod < 2) push(ankle.clone().lerp(ball, 0.5), R * 0.26, R * 0.29);
    const iBall = pts.length;
    push(ball.clone(), R * 0.3, R * 0.31);
    push(ball.clone().add(new Vector3(0, -0.02 * R, 0.25 * R)), R * 0.22, R * 0.22);

    const sHip = sAt[1];
    const sKnee = sAt[iKnee];
    const sAnkle = sAt[iAnkle];
    const sBall = sAt[iBall];
    const chain = new SkinChain([
      { bone: rig.idx.pelvis, s0: -0.6 * R, s1: sHip - 0.1 * R },
      { bone: li.thigh, s0: sHip - 0.1 * R, s1: sKnee },
      { bone: li.shin, s0: sKnee, s1: sAnkle },
      { bone: li.meta, s0: sAnkle, s1: sBall },
      { bone: li.toes, s0: sBall, s1: sBall + 0.5 * R },
    ]);

    b.begin(0);
    const n = pts.length;
    const dir = new Vector3();
    const u = new Vector3();
    const w = new Vector3();
    const p = new Vector3();
    const rings: number[][] = [];
    const SEG = res.legAround;
    for (let i = 0; i < n; i++) {
      dir.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      // u: the leg's "front" (knee direction), w: lateral.
      u.crossVectors(dir, w.set(1, 0, 0)).normalize();
      w.crossVectors(dir, u).normalize(); // points to -X for both legs
      const [rf, rl] = radii[i];
      const ring: number[] = [];
      const skin = chain.skin(sAt[i]);
      for (let k = 0; k < SEG; k++) {
        const th = (k / SEG) * Math.PI * 2;
        const c = Math.cos(th);
        const s = Math.sin(th);
        // Thigh muscle bulges at the back-outside; the shin is a little keeled at the front.
        const out = -s * sx;
        const bulge = i >= 1 && i < iKnee ? 1 + 0.1 * Math.max(0, -c) + 0.06 * Math.max(0, out) : 1;
        p.copy(pts[i])
          .addScaledVector(u, c * rf * bulge)
          .addScaledVector(w, s * rl * bulge);
        // Belly-colored inner/front of the thigh, scaled skin elsewhere.
        const inner = Math.max(0, -out);
        const shank = i >= iAnkle && i <= iBall && c > 0.2;
        ring.push(
          b.vertex(
            p,
            skin,
            { region: REGION.skin, belly: i < iKnee ? 0.6 * inner : 0, dorsal: i < iKnee ? 0.2 * Math.max(0, out) : 0, extra: shank ? SCUTATE : undefined },
            4 + sAt[i],
            out,
          ),
        );
      }
      rings.push(ring);
    }
    for (let r = 0; r < n - 1; r++) {
      const A = rings[r];
      const B = rings[r + 1];
      for (let k = 0; k < SEG; k++) {
        const j = (k + 1) % SEG;
        b.quad(A[k], A[j], B[j], B[k]);
      }
    }
    const cEnd = b.vertex(pts[n - 1].clone().add(new Vector3(0, 0, 0.1 * R)), chain.skin(sAt[n - 1]), { region: REGION.skin });
    for (let k = 0; k < SEG; k++) b.tri(rings[n - 1][k], rings[n - 1][(k + 1) % SEG], cEnd);
    b.end();

    // A reptile's foot: four toes splayed forward (the fourth longest, like a lizard's) and a
    // short fifth to the outside, no backward hallux; a pale sole pad under the ball, jointed
    // toes and claws hooking down into the ground. Toe tubes rest on the ground (the soles at
    // -standHeight); scutate scales (aExtra.z) along their tops and the front of the shank.
    const ground = -P.standHeight;
    const toeR = G.sole * 0.95;
    const toeSkin = new Skin().add(li.toes, 1);
    const toes = res.lod === 2 ? TOES.slice(1, 4) : TOES;
    for (const toe of toes) {
      const az = toe.az * sx;
      const d = new Vector3(Math.sin(az), 0, Math.cos(az));
      const len = G.toe * toe.len;
      const r = toeR * (toe.len < 0.5 ? 0.75 : 1);
      const start = ball.clone().addScaledVector(d, 0.15 * R);
      start.y = ground + r * 1.25;
      const at = (f: number) => {
        const q = start.clone().addScaledVector(d, len * f);
        q.y = ground + r * (1.25 - 0.3 * f * f);
        return q;
      };
      b.begin(0);
      if (res.joints && toe.len >= 0.5) {
        // Knuckle bulges at 35% and 70% of the toe.
        tube(b, {
          points: [0, 0.35, 0.53, 0.7, 1].map(at),
          radii: [r, r * 1.15 * 0.85, r * 0.72, r * 1.15 * 0.68, r * 0.42],
          segments: 7,
          hint: new Vector3(0, 1, 0),
          skin: () => toeSkin,
          mat: (_i, around) => ({ region: REGION.skin, belly: 0.3 * Math.max(0, -around), extra: around > 0.2 ? SCUTATE : undefined }),
          capEnd: true,
        });
      } else {
        spike(b, [at(0), at(0.5), at(1)], r, toeSkin, { region: REGION.skin, belly: 0.3 }, sides(res, 6), new Vector3(0, 1, 0), 1, 0.45);
      }
      b.end();
      if (!res.claws) continue;
      // Claw: out of the toe tip, recurved down into the ground.
      const end = at(1);
      const c0 = end.clone().addScaledVector(d, -0.25 * r);
      c0.y += 0.1 * r;
      const c1 = c0.clone().addScaledVector(d, 0.9 * r).add(new Vector3(0, 0.3 * r, 0));
      const c2 = c0.clone().addScaledVector(d, 1.8 * r).add(new Vector3(0, -r * 1.25, 0));
      b.begin(0);
      spike(b, bezier3(c0, c1, c2, res.lod === 0 ? 3 : 1), r * 0.7, toeSkin, { region: REGION.claw }, res.lod === 0 ? 5 : 3, new Vector3(0, 1, 0), 0.75);
      b.end();
    }
    // Sole pad under the ball of the foot, a little sunk into the ground (it carries the weight).
    if (res.lod < 2) {
      const padSkin = new Skin().add(li.meta, 0.5).add(li.toes, 0.5);
      b.begin(0);
      ellipsoid(
        b,
        new Vector3(ball.x, ground + 0.1 * R, ball.z + 0.08 * R),
        new Vector3(1, 0, 0),
        new Vector3(0, 1, 0),
        new Vector3(0, 0, 1),
        [0.32 * R, 0.12 * R, 0.38 * R],
        () => padSkin,
        (_p, nl) => ({ region: REGION.skin, belly: 0.5 + 0.3 * Math.max(0, -nl.y) }),
        res.lod === 0 ? 5 : 3,
        res.lod === 0 ? 8 : 5,
      );
      b.end();
    }
  }
}
