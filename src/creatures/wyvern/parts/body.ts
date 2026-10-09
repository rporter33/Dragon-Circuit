// The lofted body: one continuous tube from inside the skull, down the neck, through the torso
// and out to the tail tip, skinned along the spine chain.

import { Vector3 } from 'three';
import { smoothstep } from '../../../core/math';
import { GeoBuilder, REGION, Skin } from '../builder';
import { humerusRootRadius, surfacePoint, type BodyStation, type RigDef } from '../rig';
import { SkinChain, type ChainSegment } from './chain';
import { RES, type Res } from './res';

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

/**
 * The collar (A12): where the trunk's hide ends at the base of the neck. The humerus heads sweep
 * the shoulders and rise beside the withers at the top of the upstroke, so whatever rides the trunk
 * round the front (the tack's yoke) passes ahead of the humerus root by `shoulderClear` (× its
 * radius, plus m). Behind an oblique cervical line just ahead of that course (from the dorsal neck
 * base, behind the neck rope, round to the sternum) the hide rides the trunk alone, and the neck
 * blends in over `blend` m ahead of it: the neck bends there, never dragging the skin of the
 * shoulders and chest (or the tack on it) along.
 */
export const COLLAR = {
  shoulderClear: [1.15, 0.1] as const,
  /** The cervical line keeps this far (m) ahead of the yoke's centre line. */
  margin: 0.1,
  /** Width (m, along the body) over which the neck's skin blends into the trunk's. */
  blend: 0.4,
  /** The neck rope's flank station: this far (m, body z) ahead of the yoke's course. */
  ropeAhead: 0.17,
  /** The sternum plate's reach up the chest from its centre (m, × the breed's scale). */
  plateReach: 0.35,
  /** The plate sits where the chest's front faces this far below horizontal (radians). */
  plateFacing: 0.6,
};

/** The collar's course and cervical line for a rig (see COLLAR); left side, θ > 0. */
export interface Collar {
  /** The yoke passes ahead of this body z beside the wing root. */
  zF: number;
  /** The yoke's course after the withers (hide coordinates), and the sternum plate's station. */
  course: { s: number; th: number }[];
  sPlate: number;
  /** The neck rope loop's station at the flanks. */
  ropeS: number;
  /** The cervical line: (|θ|, s) keys, θ ascending; behind it (s ≥) the hide rides the trunk. */
  line: [number, number][];
}
const collarCache = new WeakMap<RigDef, Collar>();

/**
 * The hide's shape over the body plan: the plan's superellipse sections plus the surface anatomy
 * buildBody adds (a low dorsal ridge along the neck, back and tail; the withers rising from the
 * shoulder blades ahead of the saddle; the pectorals bulging low on the chest). Tack and other
 * parts that lie on the hide place themselves with it, so they sit on exactly the surface drawn.
 */
export class Hide {
  readonly rig: RigDef;
  readonly chain: SkinChain;
  private readonly neck: Set<number>;
  private readonly sWithers: number;
  private readonly sPecs: number;
  private readonly sigS: number;
  private readonly hh: number;
  private readonly hwT: number;

  constructor(rig: RigDef) {
    this.rig = rig;
    this.chain = bodyChain(rig);
    this.neck = new Set([...rig.idx.neck, rig.idx.head]);
    const T = rig.props.shape.torsoLength;
    this.hh = rig.props.shape.torsoHalfHeight;
    this.hwT = rig.props.shape.torsoHalfWidth;
    this.sWithers = rig.plan.sAtZ(0.28 * T);
    this.sPecs = rig.plan.sAtZ(0.24 * T);
    this.sigS = 0.06 * T;
  }

  /**
   * The plan's station at s, interpolated from a table sampled every STATION_STEP m (built once
   * per rig): the exact sections are smooth enough that the difference is far below a millimetre,
   * and parts laid on the hide in thousands of points stay cheap to build.
   */
  station(s: number): BodyStation {
    const T = stationTable(this.rig);
    const n = T.count;
    const x = Math.min(n - 1.000001, Math.max(0, s / STATION_STEP));
    const i = Math.floor(x);
    const t = x - i;
    const a = i * STATION_FIELDS;
    const b = a + STATION_FIELDS;
    const d = T.data;
    const L = (k: number) => d[a + k] + (d[b + k] - d[a + k]) * t;
    const st = _st;
    st.s = s;
    st.center.set(L(0), L(1), L(2));
    st.tangent.set(L(3), L(4), L(5)).normalize();
    st.up.set(L(6), L(7), L(8)).normalize();
    st.side.set(L(9), L(10), L(11)).normalize();
    st.halfWidth = L(12);
    st.upper = L(13);
    st.lower = L(14);
    st.squareness = L(15);
    return st;
  }

  /** The station at girth angle `th` whose hide point first lies at least at body z (from the shoulders up the neck). */
  sAhead(th: number, z: number): number {
    const k = this.rig.plan.keyS;
    const m = this.rig.plan.marks;
    for (let s = k[m.shoulder]; s > k[m.neckTop]; s -= 0.01) {
      this.point(s, th, _d);
      if (_d.z >= z) return s;
    }
    return k[m.neckBase];
  }

  /** The collar (see COLLAR), built once per rig. */
  collar(): Collar {
    let c = collarCache.get(this.rig);
    if (!c) {
      const rig = this.rig;
      const P = rig.props;
      const scale = Math.min(1.25, Math.max(0.75, P.shape.torsoHalfWidth / 0.8));
      const zF = P.shoulder[2] + COLLAR.shoulderClear[0] * humerusRootRadius(rig) + COLLAR.shoulderClear[1];
      // The sternum plate sits low on the chest's front: where the ventral midline faces forward and
      // down by `plateFacing` (searched from the keel up toward the throat).
      const k = rig.plan.keyS;
      const m = rig.plan.marks;
      const a = new Vector3();
      const b = new Vector3();
      let sPlate = k[m.neckBase];
      for (let s = k[m.shoulder]; s > k[m.neckBase] - 0.6; s -= 0.02) {
        this.point(s - 0.02, Math.PI, a);
        this.point(s + 0.02, Math.PI, b);
        // Surface tangent (toward the tail) and the facing below horizontal of its normal.
        const facing = Math.atan2(a.z - b.z, a.y - b.y);
        if (facing < COLLAR.plateFacing) {
          sPlate = s;
          break;
        }
      }
      // Beside the wing root and below it the strap keeps ahead of the humerus' sweep, then runs
      // in (and back) to the plate on the midline.
      const keys: [number, number][] = [
        [0.5, zF - 0.25],
        [1.0, zF - 0.05],
        [1.45, zF],
        [2.0, zF + 0.05],
        [2.55, zF + 0.1],
      ];
      const course = keys.map(([th, z]) => ({ s: this.sAhead(th, z), th }));
      const ropeS = this.sAhead(Math.PI / 2, zF + COLLAR.ropeAhead);
      const line: [number, number][] = [[0, ropeS + 0.1], ...course.map((p) => [p.th, p.s - COLLAR.margin] as [number, number]), [Math.PI, sPlate - COLLAR.plateReach * scale - COLLAR.margin]];
      c = { zF, course, sPlate, ropeS, line };
      collarCache.set(rig, c);
    }
    return c;
  }

  /** How much of the neck's share the hide at (s, |θ|) gives to the trunk (1 behind the cervical line). */
  trunkShare(s: number, absTh: number): number {
    const L = this.collar().line;
    let i = 0;
    while (i < L.length - 2 && L[i + 1][0] <= absTh) i++;
    const t = Math.min(1, Math.max(0, (absTh - L[i][0]) / (L[i + 1][0] - L[i][0])));
    const line = L[i][1] + (L[i + 1][1] - L[i][1]) * t;
    return smoothstep(line - COLLAR.blend, line, s);
  }

  /** The dorsal ridge's height at s (× the section's upper half-height; peaks on the spine). */
  ridge(s: number): number {
    const k = this.rig.plan.keyS;
    const m = this.rig.plan.marks;
    return 0.07 * smoothstep(k[1], k[2], s) * (1 - 0.6 * smoothstep(k[m.tailBase], this.rig.plan.length, s));
  }

  /** Withers and pectoral weights at (s, |θ|): the bumps' Gaussian falloffs (0..1). */
  bumps(s: number, at: number): { withers: number; pecs: number } {
    const gW = Math.exp(-(((s - this.sWithers) / this.sigS) ** 2) - ((at - 0.7) / 0.32) ** 2);
    const gP = Math.exp(-(((s - this.sPecs) / (1.3 * this.sigS)) ** 2) - ((at - 2.2) / 0.42) ** 2);
    return { withers: gW, pecs: gP };
  }

  /**
   * Hide point at arc length s and girth angle θ (0 = dorsal, +π/2 = left), with the plan's
   * section normal (the bumps are smooth enough that it stays a good normal). `st` is the
   * station at s when the caller already has it.
   */
  point(s: number, th: number, out: Vector3, outNormal?: Vector3, st: BodyStation = this.station(s)): Vector3 {
    const n = outNormal ?? _n;
    surfacePoint(st, th, out, n);
    const ths = th > Math.PI ? th - Math.PI * 2 : th < -Math.PI ? th + Math.PI * 2 : th;
    out.addScaledVector(st.up, this.ridge(s) * Math.exp(-(ths * ths) / 0.08) * st.upper);
    const g = this.bumps(s, Math.abs(ths));
    if (g.withers > 1e-3 || g.pecs > 1e-3) out.addScaledVector(n, 0.12 * this.hh * g.withers + 0.1 * this.hwT * g.pecs);
    return out;
  }

  /**
   * The hide's bone weights at (s, θ): the spine chain, the shoulder blades and pectorals partly
   * on the humerus, the throat floor on the gular bone, the flanks over the ribs on the breath
   * bone (exactly as buildBody skins them).
   */
  skin(s: number, th: number): Skin {
    const { idx, plan } = this.rig;
    const k = plan.keyS;
    const m = plan.marks;
    const c = Math.cos(th);
    const ths = th > Math.PI ? th - Math.PI * 2 : th < -Math.PI ? th + Math.PI * 2 : th;
    const g = this.bumps(s, Math.abs(ths));
    const wHum = 0.3 * g.withers + 0.4 * g.pecs;
    const hum = idx.wings[ths >= 0 ? 0 : 1].humerus;
    let skin = this.chain.skin(s);
    // Behind the cervical line the neck's share rides the trunk (the chest).
    if (s < k[m.chest]) {
      const T = this.trunkShare(s, Math.abs(ths));
      if (T > 1e-4) {
        const src = skin;
        skin = new Skin();
        for (let i = 0; i < src.bones.length; i++) {
          const w = src.weights[i];
          if (this.neck.has(src.bones[i])) {
            skin.add(src.bones[i], w * (1 - T));
            skin.add(idx.chest, w * T);
          } else skin.add(src.bones[i], w);
        }
      }
    }
    if (wHum > 1e-3) skin = new Skin().mix(skin, 1 - wHum).add(hum, wHum);
    // The throat floor under and behind the jaw rides the gular bone (throat pumping).
    const wG = 0.5 * (1 - smoothstep(k[m.neckTop], k[m.neckTop + 1], s)) * smoothstep(-0.2, -0.8, c);
    if (wG > 1e-3) skin = new Skin().mix(skin, 1 - wG).add(idx.gular, wG);
    // Reptiles breathe with their ribs: the flanks over the ribcage swing out on each breath
    // (most at the sides, a little under the belly, the spine still), driven by the breath bone.
    const sChest = k[m.chest];
    const sRear = k[m.rear];
    const torso = smoothstep(k[m.neckBase], sChest, s) * (1 - smoothstep(sChest + (sRear - sChest) * 0.7, sRear, s));
    const sn = Math.sin(th);
    const ribs = 0.8 * sn * sn * smoothstep(0.85, 0.2, c) + 0.3 * smoothstep(-0.2, -0.9, c);
    if (torso * ribs > 0) skin = new Skin().mix(skin, 1 - torso * ribs).add(idx.breath, torso * ribs);
    return skin;
  }

  /**
   * The hide's local frame at (s, θ): ∂P/∂s and ∂P/∂θ (finite differences), so a small move on
   * the surface maps back to hide coordinates (see toHide).
   */
  frame(s: number, th: number, outDs: Vector3, outDth: Vector3): void {
    const e = 0.01;
    this.point(s + e, th, outDs);
    this.point(s - e, th, _d);
    outDs.sub(_d).multiplyScalar(1 / (2 * e));
    this.point(s, th + e, outDth);
    this.point(s, th - e, _d);
    outDth.sub(_d).multiplyScalar(1 / (2 * e));
  }

  /**
   * The hide coordinates of a small surface offset `d` (body space) from (s, θ), given the frame
   * there (least squares on ∂P/∂s, ∂P/∂θ): the point moved along the hide.
   */
  static toHide(s: number, th: number, ds: Vector3, dth: Vector3, d: Vector3, out: { s: number; th: number }): { s: number; th: number } {
    const a = ds.dot(ds);
    const b = ds.dot(dth);
    const c = dth.dot(dth);
    const u = ds.dot(d);
    const v = dth.dot(d);
    const det = a * c - b * b || 1e-12;
    out.s = s + (c * u - b * v) / det;
    out.th = th + (a * v - b * u) / det;
    return out;
  }

  /**
   * The hide coordinates (s, θ) under a body-space point: the station whose section plane holds
   * the point (searched near `sHint`), and the girth angle pointing at it within that section.
   */
  project(q: Vector3, sHint: number, out: { s: number; th: number } = { s: 0, th: 0 }): { s: number; th: number } {
    const plan = this.rig.plan;
    const f = (s: number) => {
      const st = this.station(s);
      return _d.subVectors(q, st.center).dot(st.tangent);
    };
    // Bracket a sign change of f around the hint, then bisect.
    let a = sHint;
    let fa = f(a);
    let b = a;
    let fb = fa;
    const step = 0.08 * Math.sign(fa || 1);
    for (let i = 0; i < 80 && Math.sign(fb) === Math.sign(fa) && fa !== 0; i++) {
      a = b;
      fa = fb;
      b = Math.min(plan.length, Math.max(0, b + step));
      fb = f(b);
      if (b <= 0 || b >= plan.length) break;
    }
    for (let i = 0; i < 30; i++) {
      const mid = 0.5 * (a + b);
      const fm = f(mid);
      if (Math.sign(fm) === Math.sign(fa)) {
        a = mid;
        fa = fm;
      } else b = mid;
    }
    const s = 0.5 * (a + b);
    const st = this.station(s);
    _d.subVectors(q, st.center);
    const x = _d.dot(st.side);
    const y = _d.dot(st.up);
    const X = Math.abs(x) / Math.max(1e-6, st.halfWidth);
    const Y = Math.abs(y) / Math.max(1e-6, y >= 0 ? st.upper : st.lower);
    // A superellipse point at θ has |X| : |Y| = |sin θ|^(2/sq) : |cos θ|^(2/sq).
    const t = Math.atan(Math.pow(X / Math.max(1e-9, Y), st.squareness / 2));
    const th = y >= 0 ? t : Math.PI - t;
    out.s = s;
    out.th = x >= 0 ? th : -th;
    return out;
  }
}

const _d = new Vector3();
const _st: BodyStation = { s: 0, center: new Vector3(), tangent: new Vector3(), up: new Vector3(), side: new Vector3(), halfWidth: 0, upper: 0, lower: 0, squareness: 2 };

/** Spacing (m) of the hide's station table. */
const STATION_STEP = 0.02;
const STATION_FIELDS = 16;
const tableCache = new WeakMap<RigDef, { count: number; data: Float64Array }>();

/** The body plan's stations sampled every STATION_STEP m (center, tangent, up, side, section). */
function stationTable(rig: RigDef): { count: number; data: Float64Array } {
  let t = tableCache.get(rig);
  if (!t) {
    const plan = rig.plan;
    const count = Math.ceil(plan.length / STATION_STEP) + 2;
    const data = new Float64Array(count * STATION_FIELDS);
    for (let i = 0; i < count; i++) {
      const st = plan.station(Math.min(plan.length, i * STATION_STEP));
      data.set(
        [st.center.x, st.center.y, st.center.z, st.tangent.x, st.tangent.y, st.tangent.z, st.up.x, st.up.y, st.up.z, st.side.x, st.side.y, st.side.z, st.halfWidth, st.upper, st.lower, st.squareness],
        i * STATION_FIELDS,
      );
    }
    tableCache.set(rig, (t = { count, data }));
  }
  return t;
}

const _n = new Vector3();

export function buildBody(b: GeoBuilder, rig: RigDef, res: Res = RES[0]): void {
  const AROUND = res.bodyAround;
  const { plan, idx } = rig;
  const chain = bodyChain(rig);
  const k = plan.keyS;
  const m = plan.marks;
  const len = plan.length;
  const p = new Vector3();
  const n = new Vector3();

  // Stations: denser where the body bends most (neck and tail base), ~0.16 m elsewhere.
  const stations: number[] = [];
  const step = Math.max(0.1, rig.props.shape.torsoLength * 0.048) * res.stationStep;
  for (let s = 0; s < len; s += step * (s > k[m.tailBase] + 1.5 ? 1.25 : 1)) stations.push(s);
  stations.push(len);

  // Shoulder girdle surface anatomy (Hide): the shoulder blades rise as withers ahead of the
  // saddle, the pectorals bulge low on the chest; both are partly carried by the humerus so they
  // work with every wingbeat.
  const hide = new Hide(rig);
  const rings: number[][] = [];
  b.begin(0);
  for (let si = 0; si < stations.length; si++) {
    const s = stations[si];
    const st = plan.station(s);
    const ring: number[] = [];
    for (let a = 0; a < AROUND; a++) {
      const th = (a / AROUND) * Math.PI * 2;
      const c = Math.cos(th);
      hide.point(s, th, p, n, st);
      // Angle around the tube for the scale rows (aMat.w = 2 + θ/π, θ in (−π, π], 0 on the spine;
      // the body material reads it, membranes use the channel for flutter instead).
      const around = 2 + (th > Math.PI ? th - Math.PI * 2 : th) / Math.PI;
      ring.push(
        b.vertex(p, hide.skin(s, th), { region: REGION.skin, belly: smoothstep(-0.25, -0.72, c), dorsal: smoothstep(0.25, 0.95, c), flutter: around }, s, Math.sin(th)),
      );
    }
    rings.push(ring);
  }
  // Stitch (the ring runs dorsal → left → belly → right; stations run head → tail).
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r];
    const B = rings[r + 1];
    for (let i = 0; i < AROUND; i++) {
      const j = (i + 1) % AROUND;
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
  for (let i = 0; i < AROUND; i++) {
    const j = (i + 1) % AROUND;
    b.tri(c0, first[j], first[i]);
    b.tri(c1, last[i], last[j]);
  }
  b.end();
}
