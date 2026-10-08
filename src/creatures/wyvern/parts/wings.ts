// Wings: the arm (humerus, forearm, hand) as one tube with smooth joints, three long fingers,
// knuckle claws for walking, and the membranes stretched between them (group 1, rendered with
// the translucent membrane material).
//
// Membrane sectors (left wing; the right mirrors it):
//   A  finger 0 ↔ finger 1 (the wingtip panel)
//   B  finger 1 ↔ finger 2
//   C  arm + finger 2 ↔ the flank (the big inner panel, attached from shoulder to hip)
//   D  the small leading-edge panel in front of the elbow (shoulder → wrist)
// Each is a ruled patch between two skinned boundary curves; interior vertices blend the two
// boundaries' bones, so the membrane folds like a fan when the fingers close.

import { Vector3 } from 'three';
import { GeoBuilder, MREGION, REGION, Skin } from '../builder';
import { SIDE_SIGN, type RigDef } from '../rig';
import { bodyChain } from './body';
import { SkinChain } from './chain';
import { bezier3, spike } from './shape';

export interface WingInfo {
  /** Membrane area of one wing (m², bind pose), for checks against BreedStats.wingArea. */
  membraneArea: number;
}

export function buildWings(b: GeoBuilder, rig: RigDef): WingInfo {
  const P = rig.props;
  const S = P.shape;
  const k = 1.25 * Math.sqrt(S.torsoHalfWidth / 0.74);
  let area = 0;
  for (let side = 0; side < 2; side++) {
    const sx = SIDE_SIGN[side];
    const wi = rig.idx.wings[side];
    const m = (v: Vector3) => new Vector3(v.x * sx, v.y, v.z);
    const sh = new Vector3(P.shoulder[0] * sx, P.shoulder[1], P.shoulder[2]);
    const el = m(rig.elbow);
    const wr = m(rig.wrist);
    const kn = m(rig.knuckle);
    const tips = rig.fingerTips.map(m);
    const mids = [0, 1, 2].map((f) => kn.clone().lerp(tips[f], P.arm.fingers[f][0] / (P.arm.fingers[f][0] + P.arm.fingers[f][1])));

    // --- Arm tube ---------------------------------------------------------------------------------
    const pts: Vector3[] = [];
    const rad: [number, number][] = [];
    const sAt: number[] = [];
    const push = (p: Vector3, r: number) => {
      sAt.push(pts.length ? sAt[sAt.length - 1] + p.distanceTo(pts[pts.length - 1]) : 0);
      pts.push(p);
      rad.push([r, r * 0.82]);
    };
    const inBody = sh.clone().add(new Vector3(-0.45 * S.torsoHalfWidth * sx, -0.05, 0));
    push(inBody, 0.3 * k);
    push(sh.clone(), 0.27 * k);
    for (let i = 1; i <= 3; i++) push(sh.clone().lerp(el, i / 4), (0.25 - 0.035 * i) * k);
    push(el.clone(), 0.14 * k);
    for (let i = 1; i <= 4; i++) push(el.clone().lerp(wr, i / 5), (0.12 - 0.01 * i) * k);
    push(wr.clone(), 0.1 * k);
    push(wr.clone().lerp(kn, 0.5), 0.075 * k);
    push(kn.clone(), 0.085 * k);
    push(kn.clone().add(new Vector3(0.05 * sx, 0, 0)), 0.06 * k);
    const iSh = 1;
    const iEl = 5;
    const iWr = 10;
    const iKn = 12;
    const chain = new SkinChain([
      { bone: rig.idx.chest, s0: -0.4, s1: sAt[iSh] },
      { bone: wi.humerus, s0: sAt[iSh], s1: sAt[iEl] },
      { bone: wi.forearm, s0: sAt[iEl], s1: sAt[iWr] },
      { bone: wi.hand, s0: sAt[iWr], s1: sAt[iKn] },
    ]);
    // Bias the tent so the shoulder stays mostly on the humerus (otherwise flaps pinch it).
    const armSkin = (s: number) => (s < sAt[iSh] * 0.5 ? chain.skin(s) : chain.skin(Math.max(s, sAt[iSh] + 0.05)));
    b.begin(0);
    const rings: number[][] = [];
    const dir = new Vector3();
    const u = new Vector3();
    const w = new Vector3();
    const p = new Vector3();
    const SEG = 10;
    for (let i = 0; i < pts.length; i++) {
      dir.subVectors(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      u.set(0, 1, 0).addScaledVector(dir, -dir.y).normalize();
      w.crossVectors(dir, u).normalize();
      const ring: number[] = [];
      const skin = armSkin(sAt[i]);
      for (let q = 0; q < SEG; q++) {
        const th = (q / SEG) * Math.PI * 2;
        const c = Math.cos(th);
        // A slight leading-edge ridge (the forearm's front is the wing's leading edge).
        p.copy(pts[i]).addScaledVector(u, c * rad[i][1]).addScaledVector(w, Math.sin(th) * rad[i][0]);
        ring.push(b.vertex(p, skin, { region: REGION.skin, belly: Math.max(0, -c) * 0.7, dorsal: Math.max(0, c) }, 20 + sAt[i], Math.sin(th)));
      }
      rings.push(ring);
    }
    for (let r = 0; r < rings.length - 1; r++) {
      for (let q = 0; q < SEG; q++) {
        const j = (q + 1) % SEG;
        b.quad(rings[r][q], rings[r][j], rings[r + 1][j], rings[r + 1][q]);
      }
    }
    const capEnd = b.vertex(pts[pts.length - 1].clone().add(new Vector3(0.03 * sx, 0, 0)), armSkin(sAt[pts.length - 1]), { region: REGION.skin });
    const last = rings[rings.length - 1];
    for (let q = 0; q < SEG; q++) b.tri(last[q], last[(q + 1) % SEG], capEnd);
    b.end();

    // --- Fingers ------------------------------------------------------------------------------------
    for (let f = 0; f < 3; f++) {
      const [fa, fb] = wi.fingers[f];
      const la = P.arm.fingers[f][0];
      const fchain = new SkinChain([
        { bone: wi.hand, s0: -0.3, s1: 0 },
        { bone: fa, s0: 0, s1: la },
        { bone: fb, s0: la, s1: la + P.arm.fingers[f][1] },
      ]);
      const N = 7;
      const fpts: Vector3[] = [];
      for (let i = 0; i <= N; i++) fpts.push(kn.clone().lerp(tips[f], i / N));
      const r0 = (0.065 - 0.008 * f) * k;
      b.begin(0);
      spike(
        b,
        fpts,
        r0,
        (i) => fchain.skin((i / N) * (la + P.arm.fingers[f][1])),
        { region: REGION.skin, dorsal: 0.6 },
        6,
        new Vector3(0, 1, 0),
        0.8,
        0.75,
      );
      b.end();
    }

    // --- Thumb claws at the wrist (the "hands" it walks on) -------------------------------------
    const clawSkin = Skin.of(wi.claw);
    for (let c = 0; c < 2; c++) {
      const d = new Vector3((0.25 + 0.3 * c) * sx, -0.2 - 0.25 * c, 1).normalize();
      const base = wr.clone().add(new Vector3(0.02 * sx, -0.02, 0.06 * k));
      const len = (c === 0 ? 0.36 : 0.24) * k;
      const c1 = base.clone().addScaledVector(d, len * 0.6).add(new Vector3(0, 0.06 * k, 0));
      const c2 = base.clone().addScaledVector(d, len).add(new Vector3(0, -0.1 * k, 0));
      b.begin(0);
      spike(b, bezier3(base, c1, c2, 4), (c === 0 ? 0.06 : 0.045) * k, clawSkin, { region: REGION.claw }, 6, new Vector3(0, 1, 0), 0.8);
      b.end();
    }

    // --- Membranes --------------------------------------------------------------------------------
    const fingerSkin = (f: number, t: number, out: Skin, weight: number) => {
      const [fa, fb] = wi.fingers[f];
      const split = P.arm.fingers[f][0] / (P.arm.fingers[f][0] + P.arm.fingers[f][1]);
      const bw = 0.18;
      const x = (t - split) / bw;
      const tb = x <= -0.5 ? 0 : x >= 0.5 ? 1 : x + 0.5;
      out.add(fa, (1 - tb) * weight);
      out.add(fb, tb * weight);
    };
    const tris: number[] = [];
    const patch = (
      nt: number,
      nv: number,
      pos: (t: number, v: number, out: Vector3) => Vector3,
      skin: (t: number, v: number) => Skin,
      thin: (t: number, v: number) => number,
      edge: (t: number, v: number) => number,
      flutter: (t: number, v: number) => number,
      vOffset: number,
    ) => {
      b.begin(1);
      const grid: number[][] = [];
      for (let i = 0; i <= nt; i++) {
        const t = i / nt;
        const row: number[] = [];
        for (let j = 0; j <= nv; j++) {
          const v = j / nv;
          pos(t, v, p);
          row.push(b.vertex(p, skin(t, v), { region: MREGION.wing, belly: thin(t, v), dorsal: edge(t, v), flutter: flutter(t, v) }, t, v + vOffset));
        }
        grid.push(row);
      }
      for (let i = 0; i < nt; i++) {
        for (let j = 0; j < nv; j++) {
          const a = grid[i][j];
          const c = grid[i + 1][j];
          const d = grid[i + 1][j + 1];
          const e = grid[i][j + 1];
          if (sx > 0) {
            b.tri(a, c, d);
            b.tri(a, d, e);
          } else {
            b.tri(a, d, c);
            b.tri(a, e, d);
          }
          tris.push(a, c, d, a, d, e);
        }
      }
      b.end();
    };

    // A & B: between fingers, rays from the knuckle to a scalloped trailing edge.
    for (let sec = 0; sec < 2; sec++) {
      const fA = sec;
      const fB = sec + 1;
      const tA = tips[fA];
      const tB = tips[fB];
      const midTip = tA.clone().lerp(tB, 0.5);
      const inward = kn.clone().sub(midTip).normalize();
      const depth = S.wing.scallop * tA.distanceTo(tB);
      const E = new Vector3();
      patch(
        16,
        8,
        (t, v, out) => {
          E.lerpVectors(tA, tB, v).addScaledVector(inward, depth * Math.sin(Math.PI * v));
          return out.lerpVectors(kn, E, t);
        },
        (t, v) => {
          const s = new Skin();
          fingerSkin(fA, t, s, 1 - v);
          fingerSkin(fB, t, s, v);
          return s;
        },
        (t, v) => Math.pow(t, 0.6) * Math.sin(Math.PI * v),
        (t) => t,
        (t, v) => t * t * (0.35 + 0.65 * Math.sin(Math.PI * v)),
        sec,
      );
    }

    // C: arm + finger 2 ↔ flank.
    const body = bodyChain(rig);
    const trailZ = S.wing.trailZ * S.torsoLength;
    const sTrail = rig.plan.sAtZ(trailZ);
    const stT = rig.plan.station(sTrail);
    const trail = new Vector3(stT.halfWidth * 0.9 * sx, stT.center.y + 0.35 * stT.upper, trailZ);
    const bodyTrailSkin = body.skin(sTrail);
    const shAttach = sh.clone().add(new Vector3(-0.05 * sx, 0, -0.08));
    const armPts = [shAttach, el, wr, kn];
    const armLen: number[] = [0];
    for (let i = 1; i < armPts.length; i++) armLen.push(armLen[i - 1] + armPts[i].distanceTo(armPts[i - 1]));
    const armTotal = armLen[armLen.length - 1];
    const armAt = (t: number, out: Vector3) => {
      const s = t * armTotal;
      let i = 0;
      while (i < armPts.length - 2 && armLen[i + 1] < s) i++;
      const f = (s - armLen[i]) / Math.max(1e-6, armLen[i + 1] - armLen[i]);
      return out.lerpVectors(armPts[i], armPts[i + 1], Math.min(1, Math.max(0, f)));
    };
    const armChainS = (t: number) => {
      // Map the attach curve parameter onto the arm tube's arc length.
      const s = t * armTotal;
      return sAt[iSh] + s;
    };
    const tip2 = tips[2];
    const midC = trail.clone().lerp(tip2, 0.5);
    const inwardC = wr.clone().sub(midC);
    inwardC.y = 0;
    inwardC.normalize();
    const depthC = S.wing.scallop * 1.2 * trail.distanceTo(tip2);
    const Lp = new Vector3();
    const Rp = new Vector3();
    patch(
      16,
      10,
      (t, v, out) => {
        armAt(t, Lp);
        Rp.lerpVectors(trail, tip2, t).addScaledVector(inwardC, depthC * Math.sin(Math.PI * t));
        return out.lerpVectors(Lp, Rp, v);
      },
      (t, v) => {
        const s = new Skin();
        // Leading boundary follows the arm (the root follows the chest).
        if (t < 0.02) s.add(rig.idx.chest, 1 - v);
        else s.mix(chain.skin(armChainS(t)), 1 - v);
        // Trailing boundary: flank at the root, finger 2 at the tip.
        s.mix(bodyTrailSkin, v * (1 - t));
        fingerSkin(2, 1, s, v * t);
        return s;
      },
      (t, v) => v * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t * 1.3))),
      (_t, v) => v,
      (t, v) => v * v * Math.sin(Math.PI * t),
      2,
    );

    // D: leading-edge panel in front of the elbow.
    const lead0 = sh.clone().add(new Vector3(0, 0, 0.12));
    const fwd = new Vector3(0, 0, 1);
    patch(
      10,
      2,
      (t, v, out) => {
        armAt(t * (armLen[2] / armTotal), Lp);
        Rp.lerpVectors(lead0, wr, t).addScaledVector(fwd, 0.06 * Math.sin(Math.PI * t));
        return out.lerpVectors(Lp, Rp, v);
      },
      (t, v) => {
        const s = new Skin();
        s.mix(chain.skin(armChainS(t * (armLen[2] / armTotal))), 1 - v);
        s.add(wi.humerus, v * (1 - t));
        s.add(wi.forearm, v * t);
        return s;
      },
      (_t, v) => v * 0.6,
      (_t, v) => v,
      () => 0,
      -1,
    );

    // Area of this wing's membrane (bind pose).
    const A = new Vector3();
    const B = new Vector3();
    const C = new Vector3();
    for (let i = 0; i < tris.length; i += 3) {
      b.getPosition(tris[i], A);
      b.getPosition(tris[i + 1], B);
      b.getPosition(tris[i + 2], C);
      area += B.sub(A).cross(C.sub(A)).length() / 2;
    }
  }
  return { membraneArea: area / 2 };
}
