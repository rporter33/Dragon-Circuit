// Hind legs: a heavy muscled thigh, a lean shin and metatarsus (digitigrade, like a bird or a
// theropod), and a foot with three forward toes and a hallux, all clawed.

import { Vector3 } from 'three';
import { GeoBuilder, REGION, Skin } from '../builder';
import { SIDE_SIGN, type RigDef } from '../rig';
import { SkinChain } from './chain';
import { bezier3, spike } from './shape';

export function buildLegs(b: GeoBuilder, rig: RigDef): void {
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
    push(hip.clone().lerp(inBody, 0.35), R * 1.0, R * 1.12);
    for (let i = 1; i <= 4; i++) {
      const t = i / 5;
      const r = R * (1 - 0.55 * t * t);
      push(hip.clone().lerp(knee, t), r * 0.92, r * 1.12);
    }
    push(knee.clone(), R * 0.5, R * 0.54);
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      // The calf muscle sits high on the shin.
      const r = R * (0.5 - 0.16 * t + 0.06 * Math.sin(Math.PI * t * 0.8));
      push(knee.clone().lerp(ankle, t), r * 0.85, r);
    }
    push(ankle.clone(), R * 0.32, R * 0.34);
    push(ankle.clone().lerp(ball, 0.5), R * 0.26, R * 0.29);
    push(ball.clone(), R * 0.3, R * 0.31);
    push(ball.clone().add(new Vector3(0, -0.02 * R, 0.25 * R)), R * 0.22, R * 0.22);

    const sHip = sAt[1];
    const sKnee = sAt[6];
    const sAnkle = sAt[10];
    const sBall = sAt[12];
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
    const SEG = 12;
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
        const bulge = i >= 1 && i <= 5 ? 1 + 0.1 * Math.max(0, -c) + 0.06 * Math.max(0, out) : 1;
        p.copy(pts[i])
          .addScaledVector(u, c * rf * bulge)
          .addScaledVector(w, s * rl * bulge);
        // Belly-colored inner/front of the thigh, scaled skin elsewhere.
        const inner = Math.max(0, -out);
        ring.push(b.vertex(p, skin, { region: REGION.skin, belly: i <= 5 ? 0.6 * inner : 0, dorsal: i <= 5 ? 0.2 * Math.max(0, out) : 0 }, 4 + sAt[i], out));
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

    // Toes: three forward, one back. Toe tubes rest on the ground (sole at -standHeight).
    const ground = -P.standHeight;
    const toeR = G.sole * 0.95;
    const toes: { az: number; len: number }[] = [
      { az: -0.42 * sx, len: 0.85 },
      { az: 0, len: 1 },
      { az: 0.42 * sx, len: 0.85 },
      { az: Math.PI - 0.5 * sx, len: 0.45 },
    ];
    const toeSkin = new Skin().add(li.toes, 1);
    for (const toe of toes) {
      const d = new Vector3(Math.sin(toe.az), 0, Math.cos(toe.az));
      const len = G.toe * toe.len;
      const start = ball.clone().addScaledVector(d, 0.15 * R);
      start.y = ground + toeR * 1.25;
      const mid = start.clone().addScaledVector(d, len * 0.5);
      mid.y = ground + toeR * 1.25;
      const end = start.clone().addScaledVector(d, len);
      end.y = ground + toeR * 0.95;
      const path = bezier3(start, mid, end, 4);
      b.begin(0);
      spike(b, path, toeR, toeSkin, { region: REGION.skin, belly: 0.3 }, 8, new Vector3(0, 1, 0), 1, 0.35);
      b.end();
      // Claw: curved down to the ground.
      const c0 = end.clone().addScaledVector(d, -0.25 * toeR);
      c0.y += 0.1 * toeR;
      const c1 = c0.clone().addScaledVector(d, 0.9 * toeR).add(new Vector3(0, 0.25 * toeR, 0));
      const c2 = c0.clone().addScaledVector(d, 1.9 * toeR).add(new Vector3(0, -toeR * 0.9, 0));
      b.begin(0);
      spike(b, bezier3(c0, c1, c2, 4), toeR * 0.7, toeSkin, { region: REGION.claw }, 6, new Vector3(0, 1, 0), 0.75);
      b.end();
    }
  }
}
