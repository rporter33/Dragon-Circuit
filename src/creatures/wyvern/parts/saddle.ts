// Saddles: rider (leather + blanket + girths + stirrups), racing (a low shell with neck
// handles), nomad (bedroll, saddlebags and a lantern) and royal (a carved howdah under a little
// canopy). They sit behind the shoulder girdle, over the ribcage near the center of mass (see
// SEAT_Z in rig.ts). What lies on the body (blankets, seat shells, girths, buckles) is skinned
// like the body under it, so it hugs the back as the spine twists; the rigid hardware (pommel,
// stirrups, posts, handles, bags) rides the spine bone, which also carries the saddle anchor, so
// the rider and the seat move as one.

import { Vector3 } from 'three';
import { clamp, smoothstep } from '../../../core/math';
import { GeoBuilder, MREGION, REGION, Skin, ellipsoid } from '../builder';
import type { RigDef } from '../rig';
import { bodyChain } from './body';
import { leaf, spike, strip } from './shape';

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
}

/** A shell lying on the body surface between two arc lengths and girth angles, with a rim. */
function shell(b: GeoBuilder, rig: RigDef, o: ShellOpts): void {
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
      rt.push(b.vertex(p.copy(base).addScaledVector(n, o.top(u, v)), sk, { region: o.region(u, v, rim) }, u, v));
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
function girth(b: GeoBuilder, rig: RigDef, s: number, width: number, hug: (s: number) => Skin, thMax = Math.PI): void {
  const plan = rig.plan;
  const p = new Vector3();
  const n = new Vector3();
  const N = 24;
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
function buckle(b: GeoBuilder, rig: RigDef, s: number, th: number, size: number, hug: (s: number) => Skin): void {
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

function stirrup(b: GeoBuilder, top: Vector3, drop: number, sx: number, skin: Skin): void {
  b.begin(0);
  const bottom = top.clone().add(new Vector3(0.05 * sx, -drop, 0));
  spike(b, [top.clone(), top.clone().lerp(bottom, 0.5), bottom.clone().add(new Vector3(0, 0.02, 0)), bottom], 0.035, skin, { region: REGION.leather }, 4, new Vector3(sx, 0, 0), 0.35, 0);
  b.end();
  // Ring.
  const pts: Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    pts.push(bottom.clone().add(new Vector3(0, -0.1 + Math.cos(a) * 0.1, Math.sin(a) * 0.13)));
  }
  b.begin(0);
  spike(b, pts, 0.022, skin, { region: REGION.metal }, 5, new Vector3(sx, 0, 0), 1, 0);
  b.end();
}

export function buildSaddle(b: GeoBuilder, rig: RigDef, id: string): SaddleInfo {
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
  // Half-width where the thighs grip the saddle: ~0.3 m below the top of the back, capped at
  // 0.45-0.5 m so a rider on a broad back still sits a horse-like straddle (knees in at the
  // saddle) rather than doing the splits; below the knee the shins follow the barrel (`flank`).
  const depth = 0.3;
  const c = clamp(1 - depth / st.upper, -1, 1);
  const sn = Math.sqrt(1 - Math.pow(Math.abs(c), st.squareness));
  const bodyHalfWidth = Math.pow(sn, 2 / st.squareness) * st.halfWidth;
  const halfWidth = Math.min(bodyHalfWidth, 0.45 + 0.05 * clamp((S.torsoHalfWidth - 0.5) / 0.5, 0, 1));
  const seat = new Vector3(0, topY + 0.12, rig.seat.z);
  // Hands on the pommel: up and forward of the hips, so the arms reach naturally.
  const grip = new Vector3(0, 0.36, 0.5);
  const p = new Vector3();
  const n = new Vector3();

  const leatherSeat = (lift: number, cantle: number, pommel: number, len: number, wide: number) =>
    shell(b, rig, {
      s0: sc - m(len * 0.52),
      s1: sc + m(len * 0.48),
      th0: -wide,
      th1: wide,
      ns: 10,
      nt: 8,
      top: (u, v) => lift + cantle * smoothstep(0.62, 1, u) * (1 - Math.abs(v - 0.5)) + pommel * smoothstep(0.3, 0, u) * (1 - 1.6 * Math.abs(v - 0.5)) - 0.02 * Math.sin(Math.PI * u),
      bottom: 0.0,
      region: () => REGION.leather,
      skin: hug,
    });
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
    });

  switch (id) {
    case 'racing': {
      // A low, light shell; the rider lies flat along the neck and holds two neck handles.
      leatherSeat(0.05, 0.1, 0.03, 0.95, 0.6);
      // Racing stripe down the middle.
      shell(b, rig, {
        s0: sc - m(0.5),
        s1: sc + m(0.45),
        th0: -0.08,
        th1: 0.08,
        ns: 6,
        nt: 1,
        top: (u) => 0.062 + 0.1 * smoothstep(0.62, 1, u) * 0.92,
        bottom: 0.03,
        region: () => REGION.cloth,
        skin: hug,
      });
      girth(b, rig, sc - m(0.55), 0.09, hug);
      for (const sx of [1, -1]) {
        const base = new Vector3(0.17 * sx * scale, 0, rig.seat.z + m(0.62));
        const s = plan.sAtZ(base.z);
        plan.surface(s, 0.35 * sx, p, n);
        base.copy(p);
        const tip = base.clone().add(new Vector3(0.04 * sx, 0.3, 0.12));
        b.begin(0);
        spike(b, [base.clone().addScaledVector(n, -0.05), base.clone().lerp(tip, 0.6), tip], 0.03, skin, { region: REGION.metal }, 5, new Vector3(1, 0, 0), 1, 0);
        const g0 = tip.clone().add(new Vector3(-0.02 * sx, -0.02, -0.02));
        spike(b, [g0, g0.clone().add(new Vector3(0.09 * sx, 0, 0)), g0.clone().add(new Vector3(0.14 * sx, 0, 0))], 0.035, skin, { region: REGION.leather }, 6, new Vector3(0, 1, 0), 1, 0);
        b.end();
      }
      seat.y = topY + 0.08;
      grip.set(0, 0.28 + (topY - seat.y), m(0.72));
      // Short stirrups set back so the knees tuck up.
      for (const sx of [1, -1]) {
        plan.surface(sc + m(0.25), 0.7 * sx, p, n);
        stirrup(b, p.clone().addScaledVector(n, 0.04), 0.45, sx, skin);
      }
      break;
    }
    case 'royal': {
      // Carved howdah: blanket with gold trim, a wooden seat with a back, posts and a canopy.
      blanket(1.9, 1.25, REGION.metal);
      shell(b, rig, {
        s0: sc - m(0.55),
        s1: sc + m(0.5),
        th0: -0.75,
        th1: 0.75,
        ns: 8,
        nt: 8,
        top: (u, v) => 0.14 + 0.05 * (1 - Math.sin(Math.PI * v)) + 0.04 * smoothstep(0.85, 1, u),
        bottom: 0.03,
        region: (u, v, rim) => (rim ? REGION.metal : REGION.wood),
        skin: hug,
      });
      // Cushion.
      shell(b, rig, {
        s0: sc - m(0.4),
        s1: sc + m(0.32),
        th0: -0.5,
        th1: 0.5,
        ns: 6,
        nt: 6,
        top: (u, v) => 0.2 + 0.04 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v),
        bottom: 0.12,
        region: () => REGION.cloth,
        skin: hug,
      });
      // Backrest.
      const backS = sc + m(0.52);
      const bst = plan.station(backS);
      const backBase = bst.center.clone().addScaledVector(bst.up, bst.upper + 0.18);
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
        3,
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
        spike(b, [base.clone().addScaledVector(n, -0.06), base.clone().lerp(top, 0.5), top], 0.045, skin, { region: REGION.wood }, 6, new Vector3(0, 0, 1), 1, 0);
        spike(b, [top.clone(), top.clone().add(new Vector3(0, 0.12, 0)), top.clone().add(new Vector3(0, 0.26, 0))], 0.06, skin, { region: REGION.metal }, 6);
        b.end();
      }
      // Canopy: a shallow dome over the posts, scalloped hem.
      b.begin(1);
      const [p00, p10, p01, p11] = [posts[1], posts[0], posts[3], posts[2]]; // (−x,front) (+x,front) (−x,back) (+x,back)
      const grid: number[][] = [];
      const NX = 6;
      const NZ = 6;
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
          if (edge && (i + j) % 2 === 1) p.y -= 0.1;
          row.push(b.vertex(p, skin, { region: MREGION.canopy, belly: 0.6, dorsal: edge ? 1 : 0, flutter: edge ? 0.4 : 0.1 }, u, w));
        }
        grid.push(row);
      }
      for (let i = 0; i < NZ; i++) for (let j = 0; j < NX; j++) b.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
      b.end();
      // Tassels from the corners.
      b.begin(1);
      for (const top of posts) {
        const a = top.clone().add(new Vector3(top.x > 0 ? 0.08 : -0.08, 0.02, 0));
        const pts = [a, a.clone().add(new Vector3(0, -0.2, 0)), a.clone().add(new Vector3(0, -0.42, 0))];
        const side = [new Vector3(0, 0, 1), new Vector3(0, 0, 1), new Vector3(0, 0, 1)];
        strip(b, pts, side, [0.03, 0.05, 0.07], () => skin, (_i, t) => ({ region: MREGION.canopy, belly: 0.5, dorsal: 1, flutter: t }), 1);
      }
      b.end();
      girth(b, rig, sc - m(0.75), 0.12, hug);
      girth(b, rig, sc + m(0.85), 0.12, hug);
      seat.y = topY + 0.24;
      grip.set(0, 0.38, 0.47);
      break;
    }
    case 'nomad':
    case 'rider':
    default: {
      blanket(1.55, 1.12, REGION.leather);
      leatherSeat(0.1, 0.24, 0.16, 1.0, 0.72);
      // Pommel horn.
      const front = plan.station(sc - m(0.46));
      const pBase = front.center.clone().addScaledVector(front.up, front.upper + 0.12);
      b.begin(0);
      spike(b, [pBase.clone(), pBase.clone().add(new Vector3(0, 0.12, 0.03)), pBase.clone().add(new Vector3(0, 0.2, 0.06))], 0.05, skin, { region: REGION.leather }, 6, new Vector3(0, 0, 1), 1, 0.4);
      ellipsoid(b, pBase.clone().add(new Vector3(0, 0.21, 0.06)), new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1), [0.055, 0.035, 0.055], () => skin, () => ({ region: REGION.metal }), 4, 8);
      b.end();
      girth(b, rig, sc - m(0.62), 0.11, hug);
      girth(b, rig, sc + m(0.7), 0.11, hug);
      for (const sx of [1, -1]) {
        buckle(b, rig, sc - m(0.62), 1.15 * sx, 0.06, hug);
        buckle(b, rig, sc + m(0.7), 1.15 * sx, 0.06, hug);
        plan.surface(sc + m(0.05), 0.78 * sx, p, n);
        stirrup(b, p.clone().addScaledVector(n, 0.05), 0.7, sx, skin);
      }
      if (id === 'nomad') {
        // Bedroll across the back behind the cantle.
        const bs = sc + m(0.72);
        const bst = plan.station(bs);
        const c0 = bst.center.clone().addScaledVector(bst.up, bst.upper + 0.17);
        b.begin(0);
        const roll: Vector3[] = [];
        for (let i = 0; i <= 6; i++) roll.push(c0.clone().add(new Vector3(-0.58 + (1.16 * i) / 6, -0.05 * Math.pow((i - 3) / 3, 2) * 2, 0)));
        spike(b, roll, 0.17, skin, { region: REGION.wool }, 12, new Vector3(0, 1, 0), 1, 0);
        b.end();
        for (const x of [-0.32, 0.32]) {
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
            3,
            0.4,
          );
          b.end();
          buckle(b, rig, sc + m(0.62), 1.32 * sx, 0.05, hug);
          if (sx > 0) {
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
  const flank: SaddleFlank = { cy: st.center.y - seat.y, rx: st.halfWidth + 0.04, ry: st.upper + 0.04, sq: st.squareness };
  return { seat, halfWidth, grip, flank };
}
