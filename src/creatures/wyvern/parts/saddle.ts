// Saddles: rider (leather + blanket + girths + stirrups), racing (a light seat with neck
// handles), nomad (bedroll, saddlebags and a lantern) and royal (a carved howdah under a little
// canopy). They sit behind the shoulder girdle, over the ribcage near the center of mass (see
// SEAT_Z in rig.ts), just behind the withers. Every saddle is built on the same raised frame,
// like a camel's or an elephant's: two padded bars along the back either side of the spine carry
// a narrow seat 0.2-0.3 m above it, with side flaps falling from the seat's edges, so a rider
// straddles a horse-width seat (knees in, thighs near vertical) on a back up to 2 m across. What lies on the body (blankets, seat shells, girths, buckles) is skinned
// like the body under it, so it hugs the back as the spine twists; the rigid hardware (pommel,
// stirrups, posts, handles, bags) rides the spine bone, which also carries the saddle anchor, so
// the rider and the seat move as one.

import { Vector3 } from 'three';
import { clamp, smoothstep } from '../../../core/math';
import { GeoBuilder, MREGION, REGION, Skin, ellipsoid } from '../builder';
import type { RigDef } from '../rig';
import type { BodyStation as Station } from '../rig';
import { bodyChain } from './body';
import { leaf, spike, strip } from './shape';
import { RES, sides, tackN, type Res } from './res';

export interface SaddleInfo {
  /** Seat (rider's hips), body space bind. */
  seat: Vector3;
  /** Half-width of the body where the rider's thighs grip (m). */
  halfWidth: number;
  /** Where the hands hold, in saddle space (+Z forward, +Y up). */
  grip: Vector3;
  /**
   * The barrel under the seat, in saddle space: a superellipse cross-section centred `cy` below
   * the seat (negative), half-width `rx` and upper half-height `ry` (blanket included), exponent
   * `sq`. The rider wraps its lower legs around it (knees in at the saddle, shins down the ribs).
   */
  flank: SaddleFlank;
}

export interface SaddleFlank {
  cy: number;
  rx: number;
  ry: number;
  sq: number;
}

interface ShellOpts {
  s0: number;
  s1: number;
  th0: number;
  th1: number;
  ns: number;
  nt: number;
  top: (u: number, v: number) => number;
  bottom: number;
  region: (u: number, v: number, rim: boolean) => number;
  /** Skin at an arc length along the body (body-hugging parts follow the body's own weights). */
  skin: (s: number) => Skin;
  /** Raise the top straight up rather than along the hide's normal (a level seat on a sloping back). */
  level?: boolean;
}

const UP = new Vector3(0, 1, 0);

/** A shell lying on the body surface between two arc lengths and girth angles, with a rim. */
function shell(b: GeoBuilder, rig: RigDef, o: ShellOpts, res: Res): void {
  // Coarser shells (and the coarser body under them) cut deeper chords: float them a little
  // higher so the hide never pokes through.
  const lift = res.tack === 2 ? 0 : res.tack === 1 ? 0.025 : 0.045;
  const top0 = o.top;
  o = { ...o, ns: tackN(res, o.ns, 2), nt: tackN(res, o.nt, 2), top: (u, v) => top0(u, v) + lift, bottom: o.bottom + lift };
  const plan = rig.plan;
  const p = new Vector3();
  const n = new Vector3();
  const top: number[][] = [];
  const bot: number[][] = [];
  b.begin(0);
  for (let i = 0; i <= o.ns; i++) {
    const u = i / o.ns;
    const s = o.s0 + (o.s1 - o.s0) * u;
    const rt: number[] = [];
    const rb: number[] = [];
    const sk = o.skin(s);
    for (let j = 0; j <= o.nt; j++) {
      const v = j / o.nt;
      const th = o.th0 + (o.th1 - o.th0) * v;
      plan.surface(s, th, p, n);
      const rim = i === 0 || j === 0 || i === o.ns || j === o.nt;
      const base = p.clone();
      rt.push(b.vertex(p.copy(base).addScaledVector(o.level ? UP : n, o.top(u, v)), sk, { region: o.region(u, v, rim) }, u, v));
      rb.push(b.vertex(p.copy(base).addScaledVector(n, o.bottom), sk, { region: o.region(u, v, true) }, u, v));
    }
    top.push(rt);
    bot.push(rb);
  }
  for (let i = 0; i < o.ns; i++) {
    for (let j = 0; j < o.nt; j++) {
      b.quad(top[i][j], top[i][j + 1], top[i + 1][j + 1], top[i + 1][j]);
      b.quad(bot[i][j], bot[i + 1][j], bot[i + 1][j + 1], bot[i][j + 1]);
    }
  }
  // Rim around the four edges.
  const ring: [number, number][] = [];
  for (let j = 0; j < o.nt; j++) ring.push([0, j]);
  for (let i = 0; i < o.ns; i++) ring.push([i, o.nt]);
  for (let j = o.nt; j > 0; j--) ring.push([o.ns, j]);
  for (let i = o.ns; i > 0; i--) ring.push([i, 0]);
  for (let k = 0; k < ring.length; k++) {
    const [i0, j0] = ring[k];
    const [i1, j1] = ring[(k + 1) % ring.length];
    b.quad(top[i0][j0], bot[i0][j0], bot[i1][j1], top[i1][j1]);
  }
  b.end();
}

/** A strap ring around the body at arc length s (skinned like the body there). */
function girth(b: GeoBuilder, rig: RigDef, s: number, width: number, hug: (s: number) => Skin, res: Res, thMax = Math.PI): void {
  if (res.tack === 0) return;
  const plan = rig.plan;
  const p = new Vector3();
  const n = new Vector3();
  const N = tackN(res, 24, 8);
  const rows: number[][] = [];
  b.begin(0);
  for (const ds of [-width / 2, width / 2]) {
    const row: number[] = [];
    const skin = hug(s + ds);
    for (let k = 0; k <= N; k++) {
      const th = -thMax + (2 * thMax * k) / N;
      plan.surface(s + ds, th, p, n);
      row.push(b.vertex(p.addScaledVector(n, 0.03), skin, { region: REGION.leather }, k / N, 0));
    }
    rows.push(row);
  }
  for (let k = 0; k < N; k++) b.quad(rows[0][k], rows[0][k + 1], rows[1][k + 1], rows[1][k]);
  b.end();
}

/** A small rectangular buckle or plate standing on the surface. */
function buckle(b: GeoBuilder, rig: RigDef, s: number, th: number, size: number, hug: (s: number) => Skin, res: Res): void {
  if (res.tack < 2) return;
  const skin = hug(s);
  const p = new Vector3();
  const n = new Vector3();
  rig.plan.surface(s, th, p, n);
  const st = rig.plan.station(s);
  const u = st.tangent.clone().addScaledVector(n, -st.tangent.dot(n)).normalize();
  const v = new Vector3().crossVectors(n, u).normalize();
  b.begin(0);
  leaf(
    b,
    p.addScaledVector(n, 0.04),
    u,
    v,
    n,
    [
      [size, size * 0.8],
      [-size, size * 0.8],
      [-size, -size * 0.8],
      [size, -size * 0.8],
    ],
    0.025,
    () => skin,
    () => ({ region: REGION.metal }),
    1,
  );
  b.end();
}

/** Is `q` (body space) inside the body's cross-section at station `st` (blanket included)? */
function insideBody(st: Station, q: Vector3): boolean {
  const dy = q.y - st.center.y;
  const h = dy >= 0 ? st.upper : st.lower;
  const t = Math.abs(dy) / (h + 0.03);
  if (t >= 1) return false;
  const w = (st.halfWidth + 0.03) * Math.pow(1 - Math.pow(t, st.squareness), 1 / st.squareness);
  return Math.abs(q.x - st.center.x) < w;
}

/**
 * A stirrup leather from `top` hanging `drop` m down the flank (stepping out wherever it would
 * cut into the body), and the iron at its foot.
 */
function stirrup(b: GeoBuilder, rig: RigDef, s: number, top: Vector3, drop: number, sx: number, skin: Skin, res: Res): void {
  if (res.tack === 0) return;
  const st = rig.plan.station(s);
  const pts = [top.clone()];
  const q = new Vector3();
  const N = 4;
  for (let i = 1; i <= N; i++) {
    q.copy(pts[i - 1]).add(new Vector3(0, -drop / N, 0));
    // Lean out until the leather clears the hide by a few centimetres.
    for (let k = 0; k < 40 && insideBody(st, q.clone().add(new Vector3(-0.04 * sx, 0, 0))); k++) q.x += 0.01 * sx;
    pts.push(q.clone());
  }
  const bottom = pts[N];
  b.begin(0);
  spike(b, res.tack === 2 ? pts : [pts[0], pts[2], pts[N]], 0.035, skin, { region: REGION.leather }, sides(res, 4), new Vector3(sx, 0, 0), 0.35, 0);
  b.end();
  // Ring.
  const ring: Vector3[] = [];
  const NR = tackN(res, 12, 5);
  for (let i = 0; i <= NR; i++) {
    const a = (i / NR) * Math.PI * 2;
    ring.push(bottom.clone().add(new Vector3(0, -0.1 + Math.cos(a) * 0.1, Math.sin(a) * 0.13)));
  }
  b.begin(0);
  spike(b, ring, 0.022, skin, { region: REGION.metal }, sides(res, 5), new Vector3(sx, 0, 0), 1, 0);
  b.end();
}

/** The raised saddle frame shared by every saddle (A9; see the header). */
const FRAME = {
  /** Half-width of the seat at the top (m) and where the thighs grip (SaddleInfo.halfWidth). */
  seatHalfWidth: 0.18,
  gripHalfWidth: 0.28,
  /** Girth angle of the bars' centrelines and their padding (m). */
  barTh: 0.35,
  barThick: 0.08,
  /** Side flaps: tilt out from vertical, longest drop and thickness (m). */
  flapTilt: 25 * (Math.PI / 180),
  flapLen: 0.42,
  flapThick: 0.025,
  /** Half-width of the barrel the rider's knees see at the top of the back: the flaps (m). */
  flankTop: 0.28,
};

export function buildSaddle(b: GeoBuilder, rig: RigDef, id: string, res: Res = RES[0]): SaddleInfo {
  const plan = rig.plan;
  const S = rig.props.shape;
  const sc = plan.sAtZ(rig.seat.z);
  const st = plan.station(sc);
  // Rigid hardware rides the spine bone (like the anchor); body-hugging parts take the body's skin.
  const skin = Skin.of(rig.idx.spine);
  const chain = bodyChain(rig);
  const hug = (s: number) => chain.skin(s);
  const topY = st.center.y + st.upper;
  const scale = clamp(S.torsoHalfWidth / 0.8, 0.75, 1.25);
  const m = (x: number) => x * scale;
  // The rider's legs are the same length on every breed: a small breed's frame stands a little
  // taller so the feet hang clear of the wing roots, a broad one's a little lower (0.22-0.28 m).
  const rise = clamp(0.12 * (1 - scale), -0.03, 0.03);
  // The thighs grip the raised seat's flaps, not the back: a horse-like straddle on any breed.
  const halfWidth = FRAME.gripHalfWidth;
  const seat = new Vector3(0, topY + 0.3, rig.seat.z);
  // Hands on the pommel (set by the frame below).
  const grip = new Vector3(0, 0.2, 0.42);
  const p = new Vector3();
  const n = new Vector3();

  /** The seat's girth angle for a half-width at the top of the back (bisection on the plan). */
  const thAtX = (x: number) => {
    let lo = 0;
    let hi = Math.PI / 2;
    for (let k = 0; k < 20; k++) {
      const mid = 0.5 * (lo + hi);
      plan.surface(sc, mid, p, n);
      if (Math.abs(p.x) < x) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  };
  const thSeat = thAtX(FRAME.seatHalfWidth);
  /**
   * The raised frame: padded bars either side of the spine, a narrow seat block `lift` above the
   * back (cantle behind, pommel horn in front, a dish for the rider) and side flaps falling from
   * its edges at ~25 degrees from vertical down to the hide. Returns the pommel's top (body
   * space), where the hands hold.
   */
  const frame = (opts: { lift: number; len: number; cantle: number; pommel: number; seatRegion: number; flapRegion: number; trim: number; barRegion: number }) => {
    const o = { ...opts, lift: opts.lift + rise };
    // Padded bars.
    for (const sx of [1, -1]) {
      shell(b, rig, {
        s0: sc - m(o.len * 0.6),
        s1: sc + m(o.len * 0.55),
        th0: sx * (FRAME.barTh - 0.09),
        th1: sx * (FRAME.barTh + 0.09),
        ns: 6,
        nt: 2,
        top: (u, v) => FRAME.barThick * (0.75 + 0.25 * Math.sin(Math.PI * u)) * (0.8 + 0.2 * Math.sin(Math.PI * v)),
        bottom: 0,
        region: () => o.barRegion,
        skin: hug,
      }, res);
    }
    // Seat block on the spine between the bars.
    shell(b, rig, {
      s0: sc - m(o.len * 0.5),
      s1: sc + m(o.len * 0.46),
      th0: -thSeat,
      th1: thSeat,
      ns: 8,
      nt: 4,
      top: (u, v) => {
        const a = Math.abs(2 * v - 1);
        return o.lift + o.cantle * smoothstep(0.62, 1, u) * (1 - 0.5 * a) + o.pommel * smoothstep(0.32, 0, u) * (1 - 0.7 * a) - 0.025 * Math.sin(Math.PI * u) - 0.05 * a * a;
      },
      bottom: 0,
      region: (_u, _v, rim) => (rim ? o.trim : o.seatRegion),
      skin: hug,
      level: true,
    }, res);
    // Side flaps: from the seat's edge down and out to the hide.
    for (const sx of res.tack > 0 ? [1, -1] : []) {
      const NZ = tackN(res, 4, 2);
      const top: Vector3[] = [];
      const bot: Vector3[] = [];
      const out = new Vector3(sx * Math.sin(FRAME.flapTilt), -Math.cos(FRAME.flapTilt), 0);
      for (let i = 0; i <= NZ; i++) {
        const u = i / NZ;
        const sz = sc - m(o.len * 0.36) + m(o.len * 0.68) * u;
        plan.surface(sz, sx * thSeat, p, n);
        const t0 = p.clone().addScaledVector(UP, o.lift - 0.04 + (res.tack === 2 ? 0.045 : 0.025));
        // Down to the hide (a little into it), at most FRAME.flapLen; rounded lower corners.
        const st2 = plan.station(sz);
        let len = 0;
        const q = new Vector3();
        while (len < FRAME.flapLen) {
          q.copy(t0).addScaledVector(out, len);
          if (insideBody(st2, q)) break;
          len += 0.01;
        }
        len = Math.min(FRAME.flapLen, len + 0.03) * (0.82 + 0.18 * Math.sin(Math.PI * u));
        top.push(t0);
        bot.push(t0.clone().addScaledVector(out, len));
      }
      const nOut = new Vector3(Math.cos(FRAME.flapTilt) * sx, Math.sin(FRAME.flapTilt), 0);
      b.begin(0);
      const rows: number[][] = [];
      for (const [layer, d] of [
        [0, FRAME.flapThick],
        [1, 0],
      ] as const) {
        const rt: number[] = [];
        const rb: number[] = [];
        for (let i = 0; i <= NZ; i++) {
          const rim = i === 0 || i === NZ;
          rt.push(b.vertex(top[i].clone().addScaledVector(nOut, d), skin, { region: o.flapRegion }, i / NZ, 0));
          rb.push(b.vertex(bot[i].clone().addScaledVector(nOut, d), skin, { region: rim || layer === 0 ? o.trim : o.flapRegion }, i / NZ, 1));
        }
        rows.push(rt, rb);
      }
      const [ot, ob, it, ib] = rows;
      for (let i = 0; i < NZ; i++) {
        const quadOut = (a: number, b2: number, c: number, d: number) => (sx > 0 ? b.quad(a, b2, c, d) : b.quad(d, c, b2, a));
        quadOut(ot[i], ob[i], ob[i + 1], ot[i + 1]);
        quadOut(it[i + 1], ib[i + 1], ib[i], it[i]);
        // Lower edge.
        quadOut(ob[i], ib[i], ib[i + 1], ob[i + 1]);
      }
      // Front and back edges.
      for (const [i, f] of [
        [0, 1],
        [NZ, -1],
      ] as const) {
        if (sx * f > 0) b.quad(ot[i], it[i], ib[i], ob[i]);
        else b.quad(ob[i], ib[i], it[i], ot[i]);
      }
      b.end();
    }
    // Pommel horn rising from the seat's front.
    const sP = sc - m(o.len * 0.44);
    plan.surface(sP, 0, p, n);
    const pBase = p.clone().addScaledVector(UP, o.lift + o.pommel * 0.7);
    const pTop = pBase.clone().add(new Vector3(0, 0.15, 0.05));
    if (res.tack > 0) {
      b.begin(0);
      spike(b, [pBase.clone().addScaledVector(UP, -0.06), pBase.clone().lerp(pTop, 0.6), pTop], 0.05, skin, { region: o.seatRegion }, sides(res, 6), new Vector3(0, 0, 1), 1, 0.4);
      if (res.tack === 2) ellipsoid(b, pTop.clone().add(new Vector3(0, 0.01, 0.01)), new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1), [0.055, 0.035, 0.055], () => skin, () => ({ region: REGION.metal }), 4, 8);
      b.end();
    }
    return pTop;
  };
  /** Stirrups: leathers from the flaps' lower edge, down the flank outside the hide. */
  const stirrups = (sAt: number, drop: number) => {
    for (const sx of [1, -1]) {
      plan.surface(sAt, sx * thSeat, p, n);
      const top = p.clone().addScaledVector(n, 0.05).add(new Vector3(sx * Math.sin(FRAME.flapTilt), -Math.cos(FRAME.flapTilt), 0).multiplyScalar(0.22));
      stirrup(b, rig, sAt, top, drop, sx, skin, res);
    }
  };
  const blanket = (len: number, wide: number, trim: number) =>
    shell(b, rig, {
      s0: sc - m(len * 0.55),
      s1: sc + m(len * 0.45),
      th0: -wide,
      th1: wide,
      ns: 10,
      nt: 12,
      top: (u, v) => 0.045 + 0.01 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v),
      bottom: -0.02,
      region: (u, v, rim) => (rim || u < 0.06 || u > 0.94 || v < 0.05 || v > 0.95 ? trim : REGION.cloth),
      skin: hug,
    }, res);

  switch (id) {
    case 'racing': {
      // A light seat on the frame; the rider lies along the neck and holds two neck handles. The
      // seat stands as high as the touring saddle's: the rider's legs hang straight down the flank
      // (the jockey's tucked knees on the short stirrups wait for the rider retune, C11), and 5 cm
      // lower put the boots into the sweep of the skimmer's raised inner wing (mounted.test.ts).
      const pTop = frame({ lift: 0.25, len: 0.85, cantle: 0.09, pommel: 0.02, seatRegion: REGION.leather, flapRegion: REGION.leather, trim: REGION.cloth, barRegion: REGION.leather });
      // Racing stripe down the middle of the seat.
      shell(b, rig, {
        s0: sc - m(0.4),
        s1: sc + m(0.36),
        th0: -0.06,
        th1: 0.06,
        ns: 6,
        nt: 1,
        top: (u) => 0.265 + rise + 0.09 * smoothstep(0.62, 1, u) * 0.92,
        bottom: 0.23 + rise,
        region: () => REGION.cloth,
        skin: hug,
      }, res);
      girth(b, rig, sc - m(0.55), 0.09, hug, res);
      for (const sx of res.tack > 0 ? [1, -1] : []) {
        const base = new Vector3(0.17 * sx * scale, 0, rig.seat.z + m(0.62));
        const s = plan.sAtZ(base.z);
        plan.surface(s, 0.35 * sx, p, n);
        base.copy(p);
        // Tall enough to reach from the raised seat.
        const tip = base.clone().add(new Vector3(0.04 * sx, 0.5, 0.12));
        b.begin(0);
        spike(b, [base.clone().addScaledVector(n, -0.05), base.clone().lerp(tip, 0.6), tip], 0.03, skin, { region: REGION.metal }, sides(res, 5), new Vector3(1, 0, 0), 1, 0);
        const g0 = tip.clone().add(new Vector3(-0.02 * sx, -0.02, -0.02));
        spike(b, [g0, g0.clone().add(new Vector3(0.09 * sx, 0, 0)), g0.clone().add(new Vector3(0.14 * sx, 0, 0))], 0.035, skin, { region: REGION.leather }, sides(res, 6), new Vector3(0, 1, 0), 1, 0);
        b.end();
      }
      void pTop;
      seat.y = topY + 0.3 + rise;
      grip.set(0, 0.48 + (topY - seat.y), m(0.72));
      // Short stirrups set back so the knees tuck up.
      stirrups(sc + m(0.2), 0.42);
      break;
    }
    case 'royal': {
      // Carved howdah: blanket with gold trim, the frame in carved wood with a gilt rim and a
      // cushion on the seat, a back, posts and a canopy.
      if (res.tack > 0) blanket(1.9, 1.25, REGION.metal);
      frame({ lift: 0.22, len: 1.05, cantle: 0.06, pommel: 0.04, seatRegion: REGION.wood, flapRegion: REGION.cloth, trim: REGION.metal, barRegion: REGION.wood });
      // Cushion.
      if (res.tack > 0) shell(b, rig, {
        s0: sc - m(0.38),
        s1: sc + m(0.3),
        th0: -thSeat * 0.9,
        th1: thSeat * 0.9,
        ns: 4,
        nt: 3,
        top: (u, v) => 0.29 + rise + 0.04 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v),
        bottom: 0.2 + rise,
        region: () => REGION.cloth,
        skin: hug,
      }, res);
      // Backrest.
      const backS = sc + m(0.52);
      const bst = plan.station(backS);
      const backBase = bst.center.clone().addScaledVector(bst.up, bst.upper + 0.3 + rise);
      b.begin(0);
      leaf(
        b,
        backBase.clone().add(new Vector3(0, 0.32, -0.02)),
        new Vector3(1, 0, 0),
        new Vector3(0, 1, 0),
        new Vector3(0, 0, 1),
        Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return [Math.cos(a) * 0.42, Math.sin(a) * (Math.sin(a) > 0 ? 0.42 : 0.3)] as [number, number];
        }),
        0.05,
        () => skin,
        (_t, f) => ({ region: f > 0.8 ? REGION.metal : REGION.wood }),
        res.tack === 2 ? 3 : 1,
      );
      b.end();
      // Posts, finials and the canopy.
      const posts: Vector3[] = [];
      const H = 1.75;
      for (const [fx, fz] of [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ] as const) {
        const s = sc + m(fz > 0 ? -0.55 : 0.58);
        plan.surface(s, 0.62 * fx, p, n);
        const base = p.clone().addScaledVector(n, 0.05);
        const top = new Vector3(base.x * 0.95, seat.y + H, base.z);
        posts.push(top);
        b.begin(0);
        spike(b, res.tack > 0 ? [base.clone().addScaledVector(n, -0.06), base.clone().lerp(top, 0.5), top] : [base.clone().addScaledVector(n, -0.06), top], 0.045, skin, { region: REGION.wood }, sides(res, 6), new Vector3(0, 0, 1), 1, 0);
        if (res.tack > 0) spike(b, [top.clone(), top.clone().add(new Vector3(0, 0.12, 0)), top.clone().add(new Vector3(0, 0.26, 0))], 0.06, skin, { region: REGION.metal }, sides(res, 6));
        b.end();
      }
      // Canopy: a shallow dome over the posts, scalloped hem.
      b.begin(1);
      const [p00, p10, p01, p11] = [posts[1], posts[0], posts[3], posts[2]]; // (−x,front) (+x,front) (−x,back) (+x,back)
      const grid: number[][] = [];
      const NX = tackN(res, 6, 2);
      const NZ = tackN(res, 6, 2);
      for (let i = 0; i <= NZ; i++) {
        const row: number[] = [];
        for (let j = 0; j <= NX; j++) {
          const u = j / NX;
          const w = i / NZ;
          const a = p00.clone().lerp(p10, u);
          const c2 = p01.clone().lerp(p11, u);
          p.lerpVectors(a, c2, w);
          p.x *= 1.12;
          p.y += 0.28 * Math.sin(Math.PI * u) * Math.sin(Math.PI * w) + 0.05;
          const edge = i === 0 || i === NZ || j === 0 || j === NX;
          if (edge && (i + j) % 2 === 1 && res.tack === 2) p.y -= 0.1;
          row.push(b.vertex(p, skin, { region: MREGION.canopy, belly: 0.6, dorsal: edge ? 1 : 0, flutter: edge ? 0.4 : 0.1 }, u, w));
        }
        grid.push(row);
      }
      for (let i = 0; i < NZ; i++) for (let j = 0; j < NX; j++) b.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
      b.end();
      // Tassels from the corners.
      b.begin(1);
      for (const top of res.tack === 2 ? posts : []) {
        const a = top.clone().add(new Vector3(top.x > 0 ? 0.08 : -0.08, 0.02, 0));
        const pts = [a, a.clone().add(new Vector3(0, -0.2, 0)), a.clone().add(new Vector3(0, -0.42, 0))];
        const side = [new Vector3(0, 0, 1), new Vector3(0, 0, 1), new Vector3(0, 0, 1)];
        strip(b, pts, side, [0.03, 0.05, 0.07], () => skin, (_i, t) => ({ region: MREGION.canopy, belly: 0.5, dorsal: 1, flutter: t }), 1);
      }
      b.end();
      girth(b, rig, sc - m(0.75), 0.12, hug, res);
      girth(b, rig, sc + m(0.85), 0.12, hug, res);
      seat.y = topY + 0.34 + rise;
      grip.set(0, 0.26, 0.45);
      break;
    }
    case 'nomad':
    case 'rider':
    default: {
      // The blanket stops short in front, so the pommel sits just behind the withers.
      if (res.tack > 0) blanket(1.35, 1.12, REGION.leather);
      const nomad = id === 'nomad';
      const pTop = frame({ lift: nomad ? 0.26 : 0.25, len: 1.0, cantle: 0.16, pommel: 0.08, seatRegion: REGION.leather, flapRegion: REGION.leather, trim: REGION.leather, barRegion: REGION.cloth });
      seat.y = topY + (nomad ? 0.31 : 0.3) + rise;
      grip.set(0, pTop.y - seat.y, pTop.z - seat.z);
      girth(b, rig, sc - m(0.62), 0.11, hug, res);
      girth(b, rig, sc + m(0.7), 0.11, hug, res);
      for (const sx of [1, -1]) {
        buckle(b, rig, sc - m(0.62), 1.15 * sx, 0.06, hug, res);
        buckle(b, rig, sc + m(0.7), 1.15 * sx, 0.06, hug, res);
      }
      stirrups(sc + m(0.05), 0.55);
      if (id === 'nomad' && res.tack > 0) {
        // Bedroll across the back behind the cantle.
        const bs = sc + m(0.72);
        const bst = plan.station(bs);
        const c0 = bst.center.clone().addScaledVector(bst.up, bst.upper + 0.17);
        b.begin(0);
        const roll: Vector3[] = [];
        for (let i = 0; i <= 6; i++) roll.push(c0.clone().add(new Vector3(-0.58 + (1.16 * i) / 6, -0.05 * Math.pow((i - 3) / 3, 2) * 2, 0)));
        spike(b, roll, 0.17, skin, { region: REGION.wool }, sides(res, 12), new Vector3(0, 1, 0), 1, 0);
        b.end();
        for (const x of res.tack === 2 ? [-0.32, 0.32] : []) {
          b.begin(0);
          const ring: Vector3[] = [];
          for (let i = 0; i <= 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            ring.push(c0.clone().add(new Vector3(x, Math.cos(a) * 0.185, Math.sin(a) * 0.185)));
          }
          spike(b, ring, 0.025, skin, { region: REGION.leather }, 4, new Vector3(1, 0, 0), 1, 0);
          b.end();
        }
        // Saddlebags hanging on both flanks.
        for (const sx of [1, -1]) {
          plan.surface(sc + m(0.62), 1.32 * sx, p, n);
          const ss = plan.station(sc + m(0.62));
          const u = ss.tangent.clone().addScaledVector(n, -ss.tangent.dot(n)).normalize();
          const v = new Vector3().crossVectors(n, u).normalize();
          const bag = p.clone().addScaledVector(n, 0.16);
          b.begin(0);
          leaf(
            b,
            bag,
            u,
            v,
            n,
            Array.from({ length: 12 }, (_, i) => {
              const a = (i / 12) * Math.PI * 2;
              const r = 1 / Math.pow(Math.pow(Math.abs(Math.cos(a)), 4) + Math.pow(Math.abs(Math.sin(a)), 4), 0.25);
              return [Math.cos(a) * r * 0.32, Math.sin(a) * r * 0.26] as [number, number];
            }),
            0.17,
            () => skin,
            (_t, f) => ({ region: f > 0.85 ? REGION.metal : REGION.leather }),
            res.tack === 2 ? 3 : 1,
            0.4,
          );
          b.end();
          buckle(b, rig, sc + m(0.62), 1.32 * sx, 0.05, hug, res);
          if (sx > 0 && res.tack === 2) {
            // A lantern hanging off the left bag.
            const hook = bag.clone().addScaledVector(n, 0.2).addScaledVector(u, -0.3);
            const lamp = hook.clone().add(new Vector3(0.02, -0.3, 0));
            b.begin(0);
            spike(b, [hook, hook.clone().lerp(lamp, 0.5), lamp.clone().add(new Vector3(0, 0.12, 0))], 0.012, skin, { region: REGION.metal }, 4, new Vector3(1, 0, 0), 1, 0);
            ellipsoid(b, lamp, new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1), [0.07, 0.1, 0.07], () => skin, () => ({ region: REGION.glass }), 6, 8);
            spike(b, [lamp.clone().add(new Vector3(0, 0.08, 0)), lamp.clone().add(new Vector3(0, 0.15, 0)), lamp.clone().add(new Vector3(0, 0.2, 0))], 0.075, skin, { region: REGION.metal }, 6);
            b.end();
          }
        }
      }
      break;
    }
  }
  // The barrel the legs wrap (blanket included), as seen by the rider: as wide as the body at
  // its equator, but only as wide as the flaps at the top of the back where the knees grip (the
  // seat's frame lifts the thighs clear of the back's shoulders). A rounder exponent than the
  // body's own narrows the top while the equator keeps the body's width, so the shins still
  // clear the ribs lower down.
  const rx = st.halfWidth + 0.04;
  const ry = st.upper + 0.04;
  const t0 = st.upper / ry;
  const want = clamp(FRAME.flankTop / rx, 0.05, 1);
  let sq = st.squareness;
  if (Math.pow(1 - Math.pow(t0, sq), 1 / sq) > want) {
    let lo = 1.2;
    let hi = st.squareness;
    for (let k = 0; k < 24; k++) {
      const mid = 0.5 * (lo + hi);
      if (Math.pow(1 - Math.pow(t0, mid), 1 / mid) > want) hi = mid;
      else lo = mid;
    }
    sq = 0.5 * (lo + hi);
  }
  const flank: SaddleFlank = { cy: st.center.y - seat.y, rx, ry, sq };
  return { seat, halfWidth, grip, flank };
}
