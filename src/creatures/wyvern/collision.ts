// Self-collision proxies for the wyvern (C16, quality bar Q17 "No clipping"): the parts a pose can
// push through each other, measured in the posed skeleton's own space, cheap and allocation-free.
//
//   wing   every wing vertex (the membranes and the arm, hand and finger tubes), skinned as the GPU
//          skins it, minus the bands that are sunk into the body by design (the membrane's root
//          rows along the flank and the humerus's root inside the shoulder)
//   body   the torso tube itself: the body plan's cross-sections (superellipses) from the neck
//          base to the tail base, each carried by its trunk bone
//   leg    thigh, shin and metatarsus capsules per leg (the thigh from where it stands out of the
//          flank), bound to their bones
//   neck   neck and head capsules, sized from the body plan
//   tail   tail capsules (its half-width: the tail is flattened like a rudder)
//
// wyvernPenetration() reports the deepest penetration per part pair (m): wing↔leg, wing↔body,
// neck↔wing and tail↔leg. The capture harness records it on every frame (window.__dw
// .wyvernPenetration, measure/m-penetration.json) and the animator's anti-clipping tests sweep it
// over every pose, breed and saddle.

import { Matrix4, Vector3, type BufferGeometry, type SkinnedMesh } from 'three';
import type { RigDef } from './rig';
import { SIDE_SIGN, tailTaper } from './rig';

/** The part pairs measured (Q17). */
export const PEN_PAIRS = ['wing-leg', 'wing-body', 'neck-wing', 'tail-leg'] as const;
export type PenPair = (typeof PEN_PAIRS)[number];
export type Penetration = Record<PenPair, number>;

/** A capsule bound to a bone: endpoints in the bind pose, radius at each end. */
interface Capsule {
  bone: number;
  a: Vector3;
  b: Vector3;
  ra: number;
  rb: number;
}

/** A torso cross-section in the bind pose, carried by its trunk bone. */
interface Section {
  bone: number;
  y: number;
  z: number;
  hw: number;
  hu: number;
  hl: number;
  sq: number;
}

const _p = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _d = new Vector3();
const _m = new Matrix4();

export class WyvernProxies {
  /** Wing vertices measured (indices into the geometry). */
  readonly wing: Int32Array;
  /**
   * Per wing vertex: 1 when it rides mostly on the humerus. The upper arm is wrapped in the
   * shoulder's mass (it leaves the body from inside the shoulder bulge, beside the neck's base),
   * so it is measured against the legs only.
   */
  readonly upperArm: Uint8Array;
  readonly legs: Capsule[];
  readonly neck: Capsule[];
  readonly tail: Capsule[];
  readonly sections: Section[];
  /** The trunk bones the sections ride on. */
  readonly trunkBones: number[];
  private readonly bindPos: Vector3[];
  /** Per bone: inverse world matrix this measurement (allocated once). */
  private readonly inv: Matrix4[];
  private readonly posed = { a: new Vector3(), b: new Vector3(), c: new Vector3(), d: new Vector3() };

  private static cache = new WeakMap<BufferGeometry, WyvernProxies>();

  /** The proxies for a built wyvern (cached per geometry: a rebuild makes new ones). */
  static for(rig: RigDef, geometry: BufferGeometry): WyvernProxies {
    let p = WyvernProxies.cache.get(geometry);
    if (!p) {
      p = new WyvernProxies(rig, geometry);
      WyvernProxies.cache.set(geometry, p);
    }
    return p;
  }

  constructor(rig: RigDef, geometry: BufferGeometry) {
    const I = rig.idx;
    const P = rig.props;
    const S = P.shape;
    this.bindPos = rig.bones.map((b) => b.pos);
    this.inv = rig.bones.map(() => new Matrix4());
    this.trunkBones = [I.chest, I.spine, I.pelvis];

    // Wing vertices: skinned mostly to wing bones (the fold helpers count as wing), excluding the
    // flank-root band (any real trunk weight: it is sunk into the flank by design) and the
    // humerus's root inside the shoulder.
    const wingBones = new Set<number>();
    for (const w of I.wings) {
      for (const b of [w.humerus, w.forearm, w.hand, w.claw]) wingBones.add(b);
      for (const f of w.fingers) for (const b of f) wingBones.add(b);
    }
    for (const b of I.fold) wingBones.add(b);
    // (The membrane's flank root is skinned to the trunk and, behind the hips, the tail root.)
    const trunk = new Set<number>([I.root, I.chest, I.spine, I.pelvis, I.breath, ...I.tail]);
    const si = geometry.getAttribute('skinIndex');
    const sw = geometry.getAttribute('skinWeight');
    const pos = geometry.getAttribute('position');
    const shoulderRoot = 0.35 * P.arm.humerus;
    const humeri = new Set<number>([I.wings[0].humerus, I.wings[1].humerus]);
    const list: number[] = [];
    const upper: number[] = [];
    for (let v = 0; v < si.count; v++) {
      let ww = 0;
      let tw = 0;
      let hw = 0;
      for (let k = 0; k < 4; k++) {
        const bi = si.getComponent(v, k);
        const w = sw.getComponent(v, k);
        if (wingBones.has(bi)) ww += w;
        else if (trunk.has(bi)) tw += w;
        if (humeri.has(bi)) hw += w;
      }
      if (ww < 0.5 || tw > 0.1) continue;
      _p.fromBufferAttribute(pos, v);
      const sx = _p.x >= 0 ? 1 : -1;
      _a.set(P.shoulder[0] * sx, P.shoulder[1], P.shoulder[2]);
      if (_p.distanceTo(_a) < shoulderRoot) continue;
      list.push(v);
      upper.push(hw > 0.5 ? 1 : 0);
    }
    this.wing = Int32Array.from(list);
    this.upperArm = Uint8Array.from(upper);

    // Legs: thigh from where it stands out of the flank, shin, metatarsus (bind positions).
    const R = S.thighRadius;
    this.legs = [];
    for (let side = 0; side < 2; side++) {
      const sx = SIDE_SIGN[side];
      const l = I.legs[side];
      const hip = rig.bones[l.thigh].pos;
      const knee = rig.bones[l.shin].pos;
      const ankle = rig.bones[l.meta].pos;
      const ball = rig.bones[l.toes].pos;
      const out = hip.clone().add(new Vector3(0.3 * R * sx, -0.25 * R, 0));
      this.legs.push({ bone: l.thigh, a: out, b: knee.clone(), ra: 0.9 * R, rb: 0.5 * R });
      this.legs.push({ bone: l.shin, a: knee.clone(), b: ankle.clone(), ra: 0.45 * R, rb: 0.3 * R });
      this.legs.push({ bone: l.meta, a: ankle.clone(), b: ball.clone(), ra: 0.28 * R, rb: 0.26 * R });
    }

    // Neck and head capsules (radius from the plan's half-width there).
    const plan = rig.plan;
    const widthAt = (p: Vector3) => {
      // Nearest key of the plan (the neck keys sit on the neck bones).
      let best = Infinity;
      let hw = 0;
      for (let k = 0; k < plan.keyS.length; k++) {
        const st = plan.station(plan.keyS[k]);
        const d = st.center.distanceTo(p);
        if (d < best) {
          best = d;
          hw = st.halfWidth;
        }
      }
      return hw;
    };
    // (From the second neck bone: the neck's base merges into the shoulders by design.)
    this.neck = [];
    for (let i = 1; i < I.neck.length; i++) {
      const a = rig.bones[I.neck[i]].pos;
      const b = i + 1 < I.neck.length ? rig.bones[I.neck[i + 1]].pos : rig.bones[I.head].pos;
      this.neck.push({ bone: I.neck[i], a: a.clone(), b: b.clone(), ra: widthAt(a), rb: widthAt(b) });
    }
    this.neck.push({ bone: I.head, a: rig.bones[I.head].pos.clone(), b: rig.mouth.clone(), ra: 0.85 * S.headHalfWidth, rb: 0.5 * S.headHalfWidth });

    // Tail capsules (its half-width: flattened side to side beyond its root).
    // (From the second tail bone: the tail's root and the thighs share the hindquarters' muscle by
    // design.)
    this.tail = [];
    const tb = rig.bones[I.tail[0]].pos;
    for (let i = 1; i < I.tail.length; i++) {
      const a = rig.bones[I.tail[i]].pos;
      const b = i + 1 < I.tail.length ? rig.bones[I.tail[i + 1]].pos : rig.tailTip;
      const ta = a.distanceTo(tb) / S.tailLength;
      const tbb = b.distanceTo(tb) / S.tailLength;
      const r = (t: number) => S.tailBaseRadius * tailTaper(t) * (1.05 - 0.35 * t);
      this.tail.push({ bone: I.tail[i], a: a.clone(), b: b.clone(), ra: r(ta), rb: r(Math.min(1, tbb)) });
    }

    // Torso cross-sections every ~0.1 m from the neck base to the tail base, on their trunk bone.
    const k = plan.keyS;
    const m = plan.marks;
    const s0 = k[m.neckBase];
    const s1 = k[m.tailBase];
    const n = Math.max(8, Math.round((s1 - s0) / 0.1));
    this.sections = [];
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      const st = plan.station(s);
      const bone = s < k[m.chest] ? I.chest : s < k[m.mid] ? I.spine : I.pelvis;
      this.sections.push({ bone, y: st.center.y, z: st.center.z, hw: st.halfWidth, hu: st.upper, hl: st.lower, sq: st.squareness });
    }
  }

  /**
   * The deepest penetration per part pair (m, 0 when clear) of the wyvern as last posed (its bones'
   * world matrices must be current, as after Wyvern.update).
   */
  measure(mesh: SkinnedMesh, out: Penetration): Penetration {
    for (const p of PEN_PAIRS) out[p] = 0;
    const bones = mesh.skeleton.bones;
    for (let i = 0; i < bones.length; i++) this.inv[i].copy(bones[i].matrixWorld).invert();
    // Leg and neck capsules, posed once.
    const legs = this.posedCapsules(this.legs, bones);
    const neck = this.posedCapsules(this.neck, bones);
    const tail = this.posedCapsules(this.tail, bones);
    for (let i = 0; i < this.wing.length; i++) {
      mesh.getVertexPosition(this.wing[i], _p).applyMatrix4(mesh.matrixWorld);
      for (let c = 0; c < legs.length; c++) out['wing-leg'] = Math.max(out['wing-leg'], capsulePen(_p, legs[c]));
      if (this.upperArm[i]) continue;
      for (let c = 0; c < neck.length; c++) out['neck-wing'] = Math.max(out['neck-wing'], capsulePen(_p, neck[c]));
      out['wing-body'] = Math.max(out['wing-body'], this.torsoDepth(_p));
    }
    for (let t = 0; t < tail.length; t++)
      for (let c = 0; c < legs.length; c++) out['tail-leg'] = Math.max(out['tail-leg'], capsuleCapsulePen(tail[t], legs[c]));
    return out;
  }

  private posedCapsules(caps: Capsule[], bones: SkinnedMesh['skeleton']['bones']) {
    return caps.map((c) => {
      const M = bones[c.bone].matrixWorld;
      const bp = this.bindPos[c.bone];
      return {
        a: c.a.clone().sub(bp).applyMatrix4(M),
        b: c.b.clone().sub(bp).applyMatrix4(M),
        ra: c.ra,
        rb: c.rb,
      };
    });
  }

  /**
   * How deep a world point is inside the torso tube (m, 0 outside), as of the last measure() (its
   * trunk bones' inverse matrices).
   */
  torsoDepth(p: Vector3): number {
    let deepest = 0;
    for (const bone of this.trunkBones) {
      // Into this trunk bone's bind frame.
      _c.copy(p).applyMatrix4(this.inv[bone]).add(this.bindPos[bone]);
      // Nearest section on this bone.
      let sec: Section | null = null;
      let dz = Infinity;
      for (const s of this.sections) {
        if (s.bone !== bone) continue;
        const d = Math.abs(s.z - _c.z);
        if (d < dz) {
          dz = d;
          sec = s;
        }
      }
      if (!sec || dz > 0.15) continue;
      const dx = Math.abs(_c.x);
      const dy = _c.y - sec.y;
      const hv = dy > 0 ? sec.hu : sec.hl;
      const rho = Math.pow(Math.pow(dx / sec.hw, sec.sq) + Math.pow(Math.abs(dy) / hv, sec.sq), 1 / sec.sq);
      if (rho >= 1) continue;
      const d = Math.sqrt(dx * dx + dy * dy);
      const depth = rho > 1e-3 ? Math.min(d * (1 / rho - 1), Math.min(sec.hw, hv)) : Math.min(sec.hw, hv);
      deepest = Math.max(deepest, depth);
    }
    return deepest;
  }
}

/** Penetration of a point into a tapered capsule (m, 0 outside). */
function capsulePen(p: Vector3, c: { a: Vector3; b: Vector3; ra: number; rb: number }): number {
  _d.subVectors(c.b, c.a);
  const L2 = _d.lengthSq();
  const t = L2 > 1e-12 ? Math.max(0, Math.min(1, _a.subVectors(p, c.a).dot(_d) / L2)) : 0;
  _b.copy(c.a).addScaledVector(_d, t);
  const r = c.ra + (c.rb - c.ra) * t;
  return Math.max(0, r - p.distanceTo(_b));
}

/** Penetration of two tapered capsules (m, 0 apart): closest points of the two segments. */
function capsuleCapsulePen(
  c1: { a: Vector3; b: Vector3; ra: number; rb: number },
  c2: { a: Vector3; b: Vector3; ra: number; rb: number },
): number {
  // Sample one segment densely against the other (robust and plenty for a measurement).
  let best = 0;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    _c.lerpVectors(c1.a, c1.b, t);
    const r1 = c1.ra + (c1.rb - c1.ra) * t;
    _d.subVectors(c2.b, c2.a);
    const L2 = _d.lengthSq();
    const u = L2 > 1e-12 ? Math.max(0, Math.min(1, _a.subVectors(_c, c2.a).dot(_d) / L2)) : 0;
    _b.copy(c2.a).addScaledVector(_d, u);
    const r2 = c2.ra + (c2.rb - c2.ra) * u;
    best = Math.max(best, r1 + r2 - _c.distanceTo(_b));
  }
  return best;
}

/**
 * The wyvern's deepest self-penetration per part pair this frame (m), from its posed skeleton;
 * null before it is built. For the capture harness (window.__dw.wyvernPenetration) and tests.
 */
export function wyvernPenetration(w: { rigDef: RigDef; skinnedMesh: SkinnedMesh | null }, out?: Penetration): Penetration | null {
  const mesh = w.skinnedMesh;
  if (!mesh) return null;
  const o = out ?? ({} as Penetration);
  return WyvernProxies.for(w.rigDef, mesh.geometry).measure(mesh, o);
}

void _m;
