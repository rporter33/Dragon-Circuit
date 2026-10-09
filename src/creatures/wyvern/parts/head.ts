// The head: a lofted skull with brow ridges and a tapering snout, a separate lower jaw (so the
// mouth can open on the jaw bone), eyes, nostrils and a few small teeth.
//
// Head space: origin at the head bone pivot (end of the neck), +Z along the snout.

import { Vector3 } from 'three';
import { smoothstep } from '../../../core/math';
import { GeoBuilder, REGION, Skin } from '../builder';
import { TONGUE, type RigDef } from '../rig';
import { ellipsoid } from '../builder';
import { keyed, spike, spow } from './shape';

export interface HeadInfo {
  /** Left eye center (body space, bind) and outward axis; the right eye mirrors x. */
  eyeCenter: Vector3;
  eyeAxis: Vector3;
  eyeRadius: number;
  /** Points on the skull (body space, left side) for horns and frills. */
  skullBack: Vector3;
  browTop: Vector3;
  cheek: Vector3;
}

const AROUND = 18;

export function buildHead(b: GeoBuilder, rig: RigDef): HeadInfo {
  const S = rig.props.shape;
  const H = rig.bones[rig.idx.head].pos;
  const L = S.headLength;
  const Wd = S.headHalfWidth;
  const Hh = S.headHalfHeight;
  const headSkin = Skin.of(rig.idx.head);
  const jawSkin = Skin.of(rig.idx.jaw);
  // Stocky breeds get a blunter, deeper snout.
  const blunt = S.plates ? 1.12 : 1;

  const zBack = -0.2 * L;
  const zTip = 1.0 * L;
  const width = (t: number) =>
    Wd *
    keyed(
      [
        [0, 0.55],
        [0.12, 1.0],
        [0.26, 1.1],
        [0.4, 1.0],
        [0.52, 0.74 * blunt],
        [0.7, 0.6 * blunt],
        [0.88, 0.55 * blunt],
        [0.97, 0.45 * blunt],
        [1.0, 0.18],
      ],
      t,
    );
  const top = (t: number) =>
    Hh *
    keyed(
      [
        [0, 0.75],
        [0.12, 1.3],
        [0.27, 1.42],
        [0.38, 1.3],
        [0.5, 0.92],
        [0.68, 0.72 * blunt],
        [0.86, 0.66 * blunt],
        [0.96, 0.56],
        [1.0, 0.22],
      ],
      t,
    );
  const bottom = (t: number) =>
    Hh *
    keyed(
      [
        [0, 0.8],
        [0.14, 0.95],
        [0.28, 0.55],
        [0.38, 0.14],
        [0.55, 0.08],
        [1.0, 0.06],
      ],
      t,
    );
  const mouthY = (t: number) => Hh * keyed([[0, -0.1], [0.3, -0.38], [1, -0.48]], t);
  const zAt = (t: number) => zBack + (zTip - zBack) * t;

  // Brow ridge and cheek bulges, as outward offsets around the ring.
  const angDist = (a: number, b: number) => {
    let d = Math.abs(a - b) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    return d;
  };
  const bump = (t: number, th: number) => {
    const brow = 0.24 * Hh * Math.exp(-(((t - 0.37) / 0.07) ** 2)) * Math.max(Math.exp(-((angDist(th, 0.78) / 0.32) ** 2)), Math.exp(-((angDist(th, -0.78) / 0.32) ** 2)));
    const cheek = 0.14 * Wd * Math.exp(-(((t - 0.2) / 0.1) ** 2)) * Math.max(Math.exp(-((angDist(th, 1.85) / 0.45) ** 2)), Math.exp(-((angDist(th, -1.85) / 0.45) ** 2)));
    return brow + cheek;
  };

  const ringPoint = (t: number, th: number, out: Vector3) => {
    const c = Math.cos(th);
    const s = Math.sin(th);
    const sq = 2 / 2.35;
    const w = width(t);
    const y = mouthY(t) + spow(c, sq) * (c >= 0 ? top(t) : bottom(t));
    const x = spow(s, sq) * w;
    out.set(H.x + x, H.y + y, H.z + zAt(t));
    const bb = bump(t, th);
    if (bb > 0) {
      const ny = c >= 0 ? c : c * 0.3;
      out.x += s * bb;
      out.y += ny * bb;
    }
    return out;
  };

  // --- Skull ------------------------------------------------------------------------------------
  const p = new Vector3();
  b.begin(0);
  const STATIONS = 22;
  const rings: number[][] = [];
  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    const ring: number[] = [];
    for (let a = 0; a < AROUND; a++) {
      const th = (a / AROUND) * Math.PI * 2;
      const c = Math.cos(th);
      ringPoint(t, th, p);
      const palate = c < -0.5 && t > 0.3;
      ring.push(
        b.vertex(
          p,
          headSkin,
          {
            region: palate ? REGION.mouth : REGION.skin,
            belly: t < 0.34 ? smoothstep(-0.2, -0.75, c) * (1 - smoothstep(0.24, 0.34, t)) : 0,
            dorsal: smoothstep(0.3, 0.95, c),
          },
          -0.6 + t * L,
          Math.sin(th),
        ),
      );
    }
    rings.push(ring);
  }
  for (let r = 0; r < STATIONS; r++) {
    const A = rings[r];
    const B = rings[r + 1];
    for (let i = 0; i < AROUND; i++) {
      const j = (i + 1) % AROUND;
      // Stations run back → front here, so the winding is the mirror of the body's.
      b.quad(A[i], B[i], B[j], A[j]);
    }
  }
  const cBack = b.vertex(p.set(H.x, H.y + mouthY(0) + 0.1 * Hh, H.z + zBack - 0.02 * L), headSkin, { region: REGION.skin, dorsal: 0.5 });
  const cTip = b.vertex(p.set(H.x, H.y + mouthY(1) + 0.04 * Hh, H.z + zTip + 0.01 * L), headSkin, { region: REGION.skin });
  for (let i = 0; i < AROUND; i++) {
    const j = (i + 1) % AROUND;
    b.tri(cBack, rings[0][i], rings[0][j]);
    b.tri(cTip, rings[STATIONS][j], rings[STATIONS][i]);
  }
  b.end();

  // --- Lower jaw ----------------------------------------------------------------------------------
  b.begin(0);
  const J = rig.bones[rig.idx.jaw].pos;
  const JST = 14;
  const JAR = 14;
  const jz0 = J.z - H.z - 0.06 * L;
  const jz1 = 0.965 * L;
  const jrings: number[][] = [];
  for (let i = 0; i <= JST; i++) {
    const tj = i / JST;
    const z = jz0 + (jz1 - jz0) * tj;
    const tu = (z - zBack) / (zTip - zBack);
    const wj = width(tu) * 0.9 * (1 - 0.15 * smoothstep(0.85, 1, tj));
    const yTop = mouthY(tu) + 0.05 * Hh;
    const depth = Hh * keyed([[0, 0.7], [0.3, 0.55], [0.8, 0.4], [0.95, 0.28], [1, 0.1]], tj);
    const ring: number[] = [];
    for (let a = 0; a < JAR; a++) {
      const th = (a / JAR) * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const y = yTop + (c >= 0 ? spow(c, 0.8) * 0.05 * Hh : spow(c, 0.85) * depth);
      p.set(H.x + spow(s, 0.85) * wj, H.y + y, H.z + z);
      ring.push(
        b.vertex(p, jawSkin, { region: c > 0.45 ? REGION.mouth : REGION.skin, belly: smoothstep(0.35, -0.35, c), dorsal: 0 }, z, s),
      );
    }
    jrings.push(ring);
  }
  for (let r = 0; r < JST; r++) {
    const A = jrings[r];
    const B = jrings[r + 1];
    for (let i = 0; i < JAR; i++) {
      const j = (i + 1) % JAR;
      b.quad(A[i], B[i], B[j], A[j]);
    }
  }
  const jb = b.vertex(p.set(H.x, H.y + mouthY(0.1) - 0.25 * Hh, H.z + jz0 - 0.03 * L), jawSkin, { region: REGION.skin, belly: 1 });
  const jt = b.vertex(p.set(H.x, H.y + mouthY(1) - 0.08 * Hh, H.z + jz1 + 0.02 * L), jawSkin, { region: REGION.skin, belly: 1 });
  for (let i = 0; i < JAR; i++) {
    const j = (i + 1) % JAR;
    b.tri(jb, jrings[0][i], jrings[0][j]);
    b.tri(jt, jrings[JST][j], jrings[JST][i]);
  }
  b.end();

  // --- Eyes ---------------------------------------------------------------------------------------
  const rEye = rig.eyeRadius;
  const te = 0.4;
  const the = 1.05;
  const eyeSurf = ringPoint(te, the, new Vector3());
  const eyeIn = ringPoint(te, the - 0.3, new Vector3());
  // Outward axis: mostly sideways, a little forward and up.
  const eyeAxis = new Vector3(1, 0.22, 0.42).normalize();
  const eyeCenter = eyeSurf.clone().addScaledVector(eyeAxis, -0.32 * rEye);
  eyeCenter.y = Math.min(eyeCenter.y, eyeIn.y - 0.15 * rEye);
  for (const side of [1, -1]) {
    const c = new Vector3(eyeCenter.x * side, eyeCenter.y, eyeCenter.z);
    const ax = new Vector3(eyeAxis.x * side, eyeAxis.y, eyeAxis.z);
    const ay = new Vector3(0, 1, 0).addScaledVector(ax, -ax.y).normalize();
    const az = new Vector3().crossVectors(ax, ay).normalize();
    b.begin(0);
    ellipsoid(b, c, ax, ay, az, [rEye, rEye * 0.92, rEye * 1.08], () => headSkin, () => ({ region: REGION.eye }), 8, 14);
    b.end();
    // Nostril.
    const nose = ringPoint(0.95, 0.5 * side, new Vector3());
    const nAx = new Vector3(0.6 * side, 0.5, 0.6).normalize();
    const nAy = new Vector3(0, 1, 0).addScaledVector(nAx, -nAx.y).normalize();
    const nAz = new Vector3().crossVectors(nAx, nAy).normalize();
    b.begin(0);
    ellipsoid(b, nose.addScaledVector(nAx, -0.012 * L), nAx, nAy, nAz, [0.012 * L, 0.02 * L, 0.03 * L], () => headSkin, () => ({ region: REGION.mouth }), 4, 8);
    b.end();
  }

  // --- Teeth --------------------------------------------------------------------------------------
  const toothLen = 0.055 * L;
  for (const side of [1, -1]) {
    b.begin(0);
    for (let i = 0; i < 5; i++) {
      const t = 0.5 + i * 0.105;
      const z = zAt(t);
      const w = width(t) * 0.86;
      const base = new Vector3(H.x + w * side, H.y + mouthY(t) - 0.02 * Hh, H.z + z);
      const len = toothLen * (i === 3 ? 1.5 : 1) * (1 - 0.1 * i);
      const tip = base.clone().add(new Vector3(0.12 * len * side, -len, 0.15 * len));
      spike(b, [base, base.clone().lerp(tip, 0.5), tip], 0.02 * L, headSkin, { region: REGION.claw }, 5);
    }
    for (let i = 0; i < 4; i++) {
      const tj = 0.5 + i * 0.13;
      const z = jz0 + (jz1 - jz0) * tj;
      const tu = (z - zBack) / (zTip - zBack);
      const w = width(tu) * 0.78;
      const base = new Vector3(H.x + w * side, H.y + mouthY(tu) + 0.02 * Hh, H.z + z);
      const len = toothLen * 0.75 * (i === 3 ? 1.25 : 1);
      const tip = base.clone().add(new Vector3(0.05 * len * side, len, 0.1 * len));
      spike(b, [base, base.clone().lerp(tip, 0.5), tip], 0.018 * L, jawSkin, { region: REGION.claw }, 5);
    }
    b.end();
  }

  // --- Tongue ------------------------------------------------------------------------------------
  // A long forked tongue lying on the jaw floor, wholly inside the closed mouth at rest; flicks
  // slide it out through the front to taste the air. Flat and broad at the root, then two prongs.
  const [tb0, tb1] = rig.idx.tongue;
  const T0 = rig.bones[tb0].pos;
  const T1 = rig.bones[tb1].pos;
  const tipZ = H.z + TONGUE.tip * L;
  const body: Vector3[] = [];
  for (let i = 0; i <= 6; i++) body.push(T0.clone().lerp(T1, i / 6));
  body.push(T1.clone().add(new Vector3(0, 0, 0.05 * L)));
  b.begin(0);
  spike(
    b,
    body,
    0.06 * L,
    (i) => (i < 4 ? Skin.of(tb0) : new Skin().add(tb0, 1 - (i - 3) / 4).add(tb1, (i - 3) / 4)),
    { region: REGION.tongue },
    8,
    new Vector3(0, 1, 0),
    0.42,
    0.35,
  );
  for (const side of [1, -1]) {
    const prong: Vector3[] = [];
    for (let i = 0; i <= 4; i++) {
      const f = i / 4;
      prong.push(new Vector3(H.x + side * (0.012 + 0.045 * f * f) * L, T1.y - 0.01 * Hh * f, T1.z + (tipZ - T1.z) * f));
    }
    spike(b, prong, 0.028 * L, Skin.of(tb1), { region: REGION.tongue }, 6, new Vector3(0, 1, 0), 0.55, 1);
  }
  b.end();

  return {
    eyeCenter,
    eyeAxis,
    eyeRadius: rEye,
    skullBack: ringPoint(0.1, 0.55, new Vector3()),
    browTop: ringPoint(0.38, 0.6, new Vector3()),
    cheek: ringPoint(0.16, 1.9, new Vector3()),
  };
}
