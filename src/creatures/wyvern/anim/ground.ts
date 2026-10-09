// Ground layer of the wyvern animator: wing-walking on the hind feet and the folded wrists.
//
//   gait           feet planted in world space by gait.ts (phase driven by distance travelled,
//                  corrective steps while standing), and the landing brace
//   groundTrunk    the gait's bob, sway, pitch and roll, the landing settle (dip) and the takeoff
//                  crouch
//   touchdown      plant the feet where they are and kick the settle spring
//   groundWingPose the FK wing pose on the ground: folded, the settle and shuffle, raised for the
//                  takeoff, spread to bask
//   applyWingIK    the folded stance: wrists planted as front feet by two-bone IK, the hand and
//                  fingers folded back up along the forearm and the flank
//   applyLegs      flight leg poses (FK, weights from the flight layer) blended with ground IK to
//                  the planted feet
//   contacts       where the feet are (for the next touchdown, footstep FX and contact shadows)
//
// Methods take no number arguments (see frame.ts).

import { Quaternion, Vector3 } from 'three';
import type { GroundHit, TerrainQuery } from '../../../core/types';
import { DEG, TAU, clamp, clamp01, smoothstep } from '../../../core/math';
import { SIDE_SIGN, innerTrailRoot, type RigDef } from '../rig';
import { Bouncy, aimRotation, solveTwoBoneAt } from '../ik';
import { armScale } from '../parts/wings';
import { Gait, type GaitContext } from '../gait';
import { FLAP_STYLES, WING_CHANNELS, blendPose, flapPose, type WingPose } from '../wingPoses';
import type { WyvernAnimator } from '../animator';
import { BASK, FOLDED, SETTLE } from './groundPoses';
import { FWD, LEFT, UP, bump, type AnimFrame } from './frame';

/**
 * Leg bone directions (pelvis space, left leg) for the flight poses, one row of 12 per bone
 * (thigh, shin, metatarsus): tucked, dangling, reaching for the ground, pushing off (xyz each).
 */
const LEG_POSES = new Float64Array([
  0.06, -0.5, -0.86, 0.1, -0.86, 0.48, 0.14, -0.62, 0.78, 0.05, -0.92, -0.38,
  0.0, 0.25, -0.97, 0.02, -0.82, -0.56, 0.03, -0.97, 0.24, 0.0, -0.94, -0.33,
  0.0, -0.18, -0.98, 0.0, -0.9, 0.22, 0.0, -0.94, 0.32, 0.0, -0.8, -0.6,
]);

// Scratch (module-level: the animator never re-enters).
const _q = new Quaternion();
const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _v4 = new Vector3();
const _v5 = new Vector3();
const _hum = new Vector3();
const _fore = new Vector3();
const _ref = new Vector3();
const _handD = new Vector3();
const _fd = new Vector3();
const _lv = new Vector3();
const _outG = new Vector3();
const _tv1 = new Vector3();
const _tv2 = new Vector3();
const _tv3 = new Vector3();
const _tv4 = new Vector3();
const _qr = new Quaternion();
const _qa = new Float64Array(4);

/**
 * The folded stance (applyWingIK), as fractions: where the wrist plants, the elbow's pole, how
 * the hand and fingers bundle along the forearm, and how the outer finger segments rise.
 */
export const FOLD = {
  /** Wrist rest spot: in from the elbow's line (× standHeight) and ahead of the shoulder (× forearm). */
  wristIn: 0.03,
  wristFwd: 0.15,
  /**
   * Where the elbow tucks: behind the shoulder (× humerus), down the flank (× the body's depth
   * below its centreline), clear of the flank (× the elbow's radius), and no narrower than this
   * share of the shoulders' half-width (the track the forefeet stand on).
   */
  elbowBack: 0.55,
  elbowLow: 0.5,
  elbowClear: 1.0,
  minTrack: 0.6,
  /** How hard the elbow's pole leans out toward its tuck point (1 = straight at it). */
  poleOut: 1,
  /** How far the humerus's dorsal face turns up from out (its flat blade lies lower on the flank). */
  humRefUp: 0,
  /** Hand direction offsets from straight up the forearm (out, back; negative out = in toward the body). */
  handOut: -0.05,
  handBack: 0.08,
  /** Finger inner segments: out and back offsets from up the forearm, and the step per finger. */
  fingerOut: -0.2,
  fingerOutStep: 0,
  fingerBack: 0.1,
  fingerBackStep: 0.06,
  /**
   * Where the outer finger segments' tips ride: their height as a share of the body's upper
   * half-height above its centreline at the elbow (the wingtip finger, the others, the step per
   * finger), within this pitch range above level (rad).
   */
  tipH0: 0.9,
  tipH: 0.35,
  tipHStep: 0.25,
  riseMin: 0.15,
  riseMax: 1.25,
  /**
   * The fold helpers (A2): the inner panel's interior is drawn toward the folded arm, scaled about
   * a point on the elbow's inner face: across (x), up and down (y) and fore and aft (z).
   */
  helperX: 0.2,
  helperY: 0.85,
  helperZ: 0.6,
  /** ...across about this share of the shoulders' half-width at most. */
  helperFlank: 1,
  /** Outer finger segments turned out from straight back (rad). */
  tipOut: 0.04,
};

export class GroundLayer {
  private readonly a: WyvernAnimator;
  private readonly f: AnimFrame;
  private readonly rig: RigDef;
  private readonly terrain?: Pick<TerrainQuery, 'groundAt'>;
  readonly gait: Gait;
  /** Where each foot is now (world): hind feet under the ball of the foot, fore at the claw. */
  readonly footWorld: Vector3[] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  private readonly gaitCtx: GaitContext;
  /** The landing settle: the body sinks into the legs and springs back. */
  private readonly dip: Bouncy;
  private readonly wingRestDir: Vector3[][];
  private readonly legRestDir: Vector3[][];
  private readonly fwdG = new Vector3();
  private readonly flapTmp = new Float32Array(WING_CHANNELS);
  /** Leg pose weights this frame: tuck, reach, push, side sign, fatigue, swing (see legDir). */
  private readonly legW = new Float64Array(6);
  /** This frame's weight of the folded-stance wing IK. */
  private ikW = 0;
  /** Toe curl for setEulerAt (x, y, z). */
  private readonly toeAng = new Float64Array(3);
  /** Two-bone lengths for solveTwoBoneAt: humerus, forearm, thigh, shin. */
  private readonly lens: Float64Array;
  /** Reused terrain query result. */
  private readonly hit: GroundHit = { y: 0, normal: new Vector3(), islandId: -1, surface: 'grass' };
  /**
   * Per side and finger: sin and cos of half the angle (about the bind wing normal) that turns the
   * finger's bind direction onto the innermost finger's, which closes the fan in the fold.
   */
  private readonly fanClose = new Float64Array(12);
  /** The outer finger segments' lengths. */
  private readonly fingerB: Float64Array;
  /** The body's centreline height and upper half-height at the folded elbow. */
  private readonly flankMid = new Float64Array(2);
  /** Where the folded elbow tucks against the flank (left side, body frame). */
  private readonly elbowAt = new Vector3();
  /** The shoulders' half-width (the body's widest, seen from the front). */
  private readonly flankX: number;
  /** The arm's radius scale (parts/wings.ts armScale). */
  private readonly armR: number;
  /** The breed's standing metatarsus angle from vertical (BreedShape.legAngles). */
  private readonly metaAngle: number;
  /**
   * Per side (12 each), for trailRoll: the innermost finger's bind direction (3); the offset of
   * the inner panel's trailing-edge midpoint from that finger's outer joint, across the finger (3);
   * that offset along the finger; the midpoint's bind x; the trailing root's bind x; the outer
   * segment's length.
   */
  private readonly trailBind = new Float64Array(24);

  constructor(a: WyvernAnimator, terrain?: Pick<TerrainQuery, 'groundAt'>) {
    this.a = a;
    this.f = a.frame;
    this.rig = a.rig;
    this.terrain = terrain;
    const rig = a.rig;
    const heft = a.heft;
    this.lens = new Float64Array([rig.props.arm.humerus, rig.props.arm.forearm, rig.props.leg.thigh, rig.props.leg.shin]);
    // Heavier bodies settle slower and bounce less.
    this.dip = new Bouncy(8.5 - 2.5 * heft, 0.42 + 0.1 * heft);
    const B = rig.bones;
    const dirOf = (i: number, b: Vector3) => b.clone().sub(B[i].pos).normalize();
    this.wingRestDir = [0, 1].map((side) => {
      const w = rig.idx.wings[side];
      const m = (v: Vector3) => new Vector3(v.x * SIDE_SIGN[side], v.y, v.z);
      return [
        dirOf(w.humerus, m(rig.elbow)),
        dirOf(w.forearm, m(rig.wrist)),
        dirOf(w.hand, m(rig.knuckle)),
        dirOf(w.fingers[0][0], m(rig.fingerTips[0])),
        dirOf(w.fingers[1][0], m(rig.fingerTips[1])),
        dirOf(w.fingers[2][0], m(rig.fingerTips[2])),
      ];
    });
    for (let side = 0; side < 2; side++) {
      const r = this.wingRestDir[side];
      for (let f = 0; f < 3; f++) {
        // Angle about +Y from finger f's bind direction to straight back (0, 0, -1), turned out from
        // the body by FOLD.tipOut (both in the bind plane).
        const d = r[3 + f];
        const o = FOLD.tipOut * SIDE_SIGN[side];
        const tx = Math.sin(o);
        const tz = -Math.cos(o);
        const ang = Math.atan2(d.z * tx - d.x * tz, d.x * tx + d.z * tz);
        this.fanClose[side * 6 + f * 2] = Math.sin(ang / 2);
        this.fanClose[side * 6 + f * 2 + 1] = Math.cos(ang / 2);
      }
    }
    this.armR = armScale(rig);
    {
      // The inner panel's trailing edge (parts/wings.ts, sector C): a scalloped line from the
      // flank root to finger 2's tip, its middle drawn in toward the wrist.
      const trail0 = innerTrailRoot(rig.props, rig.plan);
      for (let side = 0; side < 2; side++) {
        const sx = SIDE_SIGN[side];
        const w = rig.idx.wings[side];
        const trail = new Vector3(trail0.x * sx, trail0.y, trail0.z);
        const tip = new Vector3(rig.fingerTips[2].x * sx, rig.fingerTips[2].y, rig.fingerTips[2].z);
        const wr = new Vector3(rig.wrist.x * sx, rig.wrist.y, rig.wrist.z);
        const mid = trail.clone().lerp(tip, 0.5);
        const inward = wr.clone().sub(mid);
        inward.y = 0;
        inward.normalize();
        mid.addScaledVector(inward, rig.props.shape.wing.scallop * 1.2 * trail.distanceTo(tip));
        const m2 = rig.bones[w.fingers[2][1]].pos;
        const d = this.wingRestDir[side][5];
        const off = mid.clone().sub(m2);
        const along = off.dot(d);
        const perp = off.clone().addScaledVector(d, -along);
        this.trailBind.set([d.x, d.y, d.z, perp.x, perp.y, perp.z, along, mid.x, trail.x, tip.distanceTo(m2)], side * 12);
      }
    }
    this.metaAngle = rig.props.shape.legAngles.meta;
    this.fingerB = new Float64Array(rig.props.arm.fingers.map((f) => f[1]));
    this.legRestDir = [0, 1].map((side) => {
      const l = rig.idx.legs[side];
      const m = (v: Vector3) => new Vector3(v.x * SIDE_SIGN[side], v.y, v.z);
      return [dirOf(l.thigh, m(rig.knee)), dirOf(l.shin, m(rig.ankle)), dirOf(l.meta, m(rig.ball)), FWD.clone()];
    });

    // Gait rest spots (body space, on the ground plane).
    const P = rig.props;
    const sh = P.standHeight;
    const hipX = P.hip[0];
    const restHind = (side: number) => new Vector3(hipX * 1.08 * SIDE_SIGN[side], -sh, rig.ball.z + 0.1 * sh);
    // The folded elbow rests against the flank below and behind the shoulder, the forearm's
    // surface just clear of the body there; the wrist plants under it, a little in and ahead.
    {
      const hum = P.arm.humerus;
      const ez = P.shoulder[2] - FOLD.elbowBack * hum;
      const st = rig.plan.station(rig.plan.sAtZ(ez));
      const ey = st.center.y - FOLD.elbowLow * st.lower;
      const ty = Math.min(1, Math.abs(ey - st.center.y) / st.lower);
      const flank = st.halfWidth * Math.pow(Math.max(0, 1 - Math.pow(ty, st.squareness)), 1 / st.squareness);
      this.flankX = rig.plan.station(rig.plan.keyS[rig.plan.marks.shoulder]).halfWidth;
      const track = FOLD.minTrack * this.flankX;
      this.elbowAt.set(Math.max(flank, track) + FOLD.elbowClear * 0.17 * armScale(rig), ey, ez);
      this.flankMid[0] = st.center.y;
      this.flankMid[1] = st.upper;
    }
    const restFore = (side: number) => new Vector3((this.elbowAt.x - FOLD.wristIn * sh) * SIDE_SIGN[side], -sh, P.shoulder[2] + FOLD.wristFwd * P.arm.forearm);
    this.gait = new Gait([restHind(0), restHind(1), restFore(0), restFore(1)]);
    this.gaitCtx = {
      dt: 0,
      toWorld: (m, out) => out.copy(m).applyQuaternion(a.qW).add(a.posW),
      groundAt: (x, z, y) => this.groundHeight(x, z, y),
      velocity: new Vector3(),
      yawRate: 0,
      standHeight: sh,
      runBlend: 0,
      moving: false,
      groundKey: 0.5,
    };
  }

  /** After a teleport: the settle starts from rest (the gait re-plants in gait()). */
  reset(): void {
    this.dip.reset();
  }

  private groundHeight(x: number, z: number, y: number): number {
    const fallback = this.a.groundRef;
    if (this.terrain) {
      const g = this.terrain.groundAt(x, z, y, this.hit);
      // Ignore ground far from the body's own (decks over the void, cliff bottoms).
      if (g && Math.abs(g.y - fallback) < 1.6) return g.y;
    }
    return fallback;
  }

  /**
   * Touchdown: plant the feet where they are and absorb the impact — the body sinks into the legs
   * (knees flex through the leg IK), pitches forward a touch and springs back.
   */
  touchdown(): void {
    const f = this.f;
    this.dip.velocity -= clamp(f.sink, 1.5, 10) * (0.24 + 0.08 * f.heft) * (f.sh / 2.6);
    this.gaitCtx.standHeight = f.sh;
    this.gait.plantAt(this.footWorld, this.gaitCtx);
  }

  /** The landing brace, and the gait: plant feet in world space. */
  gaitUpdate(): void {
    const f = this.f;
    const pose = f.pose;
    const { airborne, heft } = f;
    // Wings held up and half open for balance while the weight comes down, then folded.
    f.brace = airborne ? 0 : f.landImpact * bump(f.landT, 0, 0.06, 0.3 + 0.25 * heft, 1.0 + 0.3 * heft);
    if (!airborne || f.legAirW < 0.99) {
      const c = this.gaitCtx;
      c.dt = f.dt;
      c.velocity.copy(pose.velocity);
      c.velocity.y = 0;
      c.yawRate = f.om.y;
      c.standHeight = f.sh;
      c.groundKey = this.a.groundRef;
      const gs = Math.sqrt(c.velocity.x * c.velocity.x + c.velocity.z * c.velocity.z);
      const runSpeed = this.rig.props.breed === 'galewing' ? 5 : 5.5;
      c.runBlend = smoothstep(runSpeed * 0.7, runSpeed * 1.25, gs);
      c.moving = !f.takeoffCrouch && (gs > 0.35 || Math.abs(f.om.y) > 0.35);
      if (f.teleport) this.gait.reset(c);
      this.gait.update(c);
    }
    f.runBlend = this.gaitCtx.runBlend;
    f.gaitPhase = this.gait.phase;
    f.moving = this.gaitCtx.moving && !airborne;
  }

  /** The gait's bob, sway, pitch and roll, the landing dip, the takeoff crouch. */
  groundTrunk(): void {
    const f = this.f;
    const { moving, runBlend, gaitPhase, heft, sh } = f;
    f.gaitBob = moving ? -(0.025 + 0.01 * heft) * sh * (1 + 2 * runBlend) * (0.5 - 0.5 * Math.cos(gaitPhase * Math.PI * 4)) : 0;
    const dipV = this.dip.step(0, f.dt);
    f.dipV = dipV;
    f.gaitSway = moving ? 0.05 * (1 - runBlend * 0.5) * Math.sin(gaitPhase * TAU) : 0;
    // Settle: the landing dip pitches the nose down a little and the body rocks back up.
    f.gaitPitch = moving ? -0.03 * runBlend * Math.sin(gaitPhase * Math.PI * 4) : 0;
    f.dipPitch = (dipV / sh) * (0.5 + 0.2 * heft);
    f.gaitRoll = moving ? 0.03 * Math.sin(gaitPhase * TAU) * (1 - runBlend) : 0;
    f.crouchPitch = f.takeoffCrouch ? -0.08 * f.openAmt : 0;
    // Turning on the ground, the chest leans into the turn (3° at a full turn).
    f.turnLean = f.groundW * clamp(-0.05 * f.om.y, -3 * DEG, 3 * DEG);
    // The folded-stance wing IK weight for this frame: knuckles on the ground as front feet
    // (lifted off them to shuffle, brace or bask).
    this.ikW = f.groundW * (1 - f.openAmt) * (1 - f.shuffle * 0.65) * (1 - 0.85 * f.brace) * (1 - f.bask);
  }

  /** The ground FK wing pose (settle/shuffle/brace, raised for the takeoff, spread to bask). */
  groundWingPose(out: WingPose): void {
    const f = this.f;
    if (f.takeoffCrouch) blendPose(SETTLE, flapPose(0, 0, this.flapTmp, FLAP_STYLES[this.rig.props.breed]), f.openAmt, out);
    else blendPose(FOLDED, SETTLE, clamp01(f.openAmt * 1.4 + f.shuffle * 0.8 + f.brace), out);
    if (f.bask > 0.001) blendPose(out, BASK, f.bask, out);
  }

  /**
   * Folded stance: the wrist (with its pad and digits) is a front foot planted by the gait under
   * the shoulder; humerus + forearm reach it by two-bone IK with the elbow tucked back against the
   * flank, so the arm hangs from the shoulder like a bird's or a bat's (never a crocodile's
   * sideways elbow). The hand folds back up along the forearm and the fingers run on up its inner
   * side in a tight bundle; their outer segments fold back along the flank, the fan closed in the
   * wing's own plane, the wingtip finger riding highest. Every bone keeps its dorsal face turned
   * out, so the membrane lies along the body in a narrow pleated bundle rather than standing out as
   * a panel; the innermost finger's roll keeps the inner panel's trailing edge in to the flank
   * (trailRoll) and the fold helpers draw its interior in (foldHelpers). Blended over the FK pose
   * by this frame's IK weight.
   */
  applyWingIK(side: number): void {
    const weight = this.ikW;
    if (!(weight > 0.001)) return;
    const a = this.a;
    a.blend = weight;
    const rig = this.rig;
    const sh = this.f.sh;
    const w = rig.idx.wings[side];
    const sx = SIDE_SIGN[side];
    const rest = this.wingRestDir[side];
    const up = a.upM;
    const T = FOLD;
    // (Scalar arithmetic in place of three.js calls taking computed numbers: in a function this
    // size the JIT may not inline them, and every double passed would be boxed on the heap.)
    const fwdG = this.fwdG.copy(FWD);
    fwdG.x -= up.x * up.z;
    fwdG.y -= up.y * up.z;
    fwdG.z -= up.z * up.z;
    fwdG.normalize();
    // Out from the body (this side), level with the ground.
    const outG = _outG;
    outG.x = LEFT.x * sx;
    outG.y = LEFT.y * sx;
    outG.z = LEFT.z * sx;
    // Wrist target (model space) from the planted foot, the claws resting on the ground.
    const foot = this.gait.feet[2 + side];
    const Wt = a.toModel(foot.pos, _v3);
    const lift = 0.07 * sh;
    Wt.x += up.x * lift;
    Wt.y += up.y * lift;
    Wt.z += up.z * lift;
    const S = _v2.copy(a.modelP[w.humerus]);
    // Pole: level toward the elbow's tuck against the flank, back and a little out from the
    // shoulder (a bird's or bat's arm hanging from the shoulder, never a crocodile's sideways
    // elbow). Level, so it never lines up with the near-vertical shoulder-to-wrist line as the
    // forefoot swings through a stride.
    const ea = this.elbowAt;
    const pOut = (ea.x - S.x * sx) * T.poleOut;
    const pBack = S.z - ea.z;
    _v4.x = outG.x * pOut - fwdG.x * pBack;
    _v4.y = outG.y * pOut - fwdG.y * pBack;
    _v4.z = outG.z * pOut - fwdG.z * pBack;
    const E = _v5;
    solveTwoBoneAt(S, this.lens, 0, Wt, _v4, E);
    const hum = _hum.subVectors(E, S);
    const fore = _fore.subVectors(Wt, E);
    // Every wing bone keeps its dorsal face turned out from the body: the membrane between them
    // then lies along the flank instead of standing out from it as a panel.
    // (The humerus's flat deltopectoral blade turns a little up, keeping its crest low on the flank.)
    _fd.x = outG.x + up.x * T.humRefUp;
    _fd.y = outG.y + up.y * T.humRefUp;
    _fd.z = outG.z + up.z * T.humRefUp;
    aimRotation(rest[0], UP, hum, _fd, _q);
    a.setModelBlend(w.humerus, _q);
    aimRotation(rest[1], UP, fore, outG, _q);
    a.setModelBlend(w.forearm, _q);
    // Up the forearm from the wrist.
    const back = _handD.subVectors(E, Wt).normalize();
    // The hand folds back up along the forearm, behind and just inside it.
    _fd.x = back.x + outG.x * T.handOut + fwdG.x * -T.handBack;
    _fd.y = back.y + outG.y * T.handOut + fwdG.y * -T.handBack;
    _fd.z = back.z + outG.z * T.handOut + fwdG.z * -T.handBack;
    _fd.normalize();
    aimRotation(rest[2], UP, _fd, outG, _q);
    a.setModelBlend(w.hand, _q);
    for (let f = 0; f < 3; f++) {
      // Inner segment: up beside the forearm, bundled on its inner side and a little behind it.
      const out = T.fingerOut + T.fingerOutStep * f;
      const behind = -T.fingerBack - T.fingerBackStep * f;
      _fd.x = back.x + outG.x * out + fwdG.x * behind;
      _fd.y = back.y + outG.y * out + fwdG.y * behind;
      _fd.z = back.z + outG.z * out + fwdG.z * behind;
      _fd.normalize();
      aimRotation(rest[3 + f], UP, _fd, outG, _q);
      a.setModelBlend(w.fingers[f][0], _q);
      // Outer segment: folded back along the flank, tips toward the tail. The fan closes in the
      // wing's own plane (each finger turned about the bind normal onto the innermost finger's
      // line, so the panels between them collapse like a closing fan instead of twisting), then
      // pitches up about the body's side axis: the inner panel's trailing edge, which hangs between
      // the flank and this finger, then runs straight from its root to the fingertip instead of
      // bowing out from the body.
      // Pitched up just enough to bring the tip to its height on the flank.
      const pv = a.pivot(w.fingers[f][1]);
      const tipY = this.flankMid[0] + (f === 0 ? T.tipH0 : T.tipH - T.tipHStep * (f - 1)) * this.flankMid[1];
      const sinR = (tipY - pv.y) / this.fingerB[f];
      const rise = sinR >= 1 ? T.riseMax : sinR <= -1 ? T.riseMin : clamp(Math.asin(sinR), T.riseMin, T.riseMax);
      const sxh = Math.sin(rise * 0.5);
      const cxh = Math.cos(rise * 0.5);
      const close = this.fanClose;
      const syh = close[side * 6 + f * 2];
      const cyh = close[side * 6 + f * 2 + 1];
      const qa = _qa;
      qa[0] = sxh * cyh;
      qa[1] = cxh * syh;
      qa[2] = sxh * syh;
      qa[3] = cxh * cyh;
      _q.fromArray(qa);
      if (f === 2) this.trailRoll(side, _q);
      a.setModelBlend(w.fingers[f][1], _q);
    }
    // Claws point forward along the ground.
    _fd.x = fwdG.x + up.x * -0.25 + LEFT.x * (0.2 * sx);
    _fd.y = fwdG.y + up.y * -0.25 + LEFT.y * (0.2 * sx);
    _fd.z = fwdG.z + up.z * -0.25 + LEFT.z * (0.2 * sx);
    _fd.normalize();
    aimRotation(FWD, UP, _fd, up, _q);
    a.setModelBlend(w.claw, _q);
  }

  /**
   * Roll the innermost finger's outer segment about its own axis so the inner panel's trailing
   * edge runs straight out from the flank to the fingertip. That edge is skinned partly to the body
   * (which keeps its bind, spread-wing position) and partly to this bone, so any other roll bows its
   * middle out from the flank — the "slab". `q` (the segment's model rotation, its direction already
   * set) is rolled in place; the roll that keeps the dorsal face turning outward wins.
   */
  private trailRoll(side: number, q: Quaternion): void {
    const k = side * 12;
    const B = this.trailBind;
    const sx = SIDE_SIGN[side];
    // d' = q·d (the finger's direction), u = q·q⊥ (the bind edge midpoint's offset across it).
    const d = _tv1.set(B[k], B[k + 1], B[k + 2]).applyQuaternion(q);
    const u = _tv2.set(B[k + 3], B[k + 4], B[k + 5]).applyQuaternion(q);
    const wv = _tv3.crossVectors(d, u);
    const qd = B[k + 6];
    const pMidX = B[k + 7];
    const trailX = B[k + 8];
    const tipLen = B[k + 9];
    // The finger's pivot and tip (model frame; the tip doesn't depend on the roll).
    const m2 = this.a.modelP[this.rig.idx.wings[side].fingers[2][1]];
    const tipX = m2.x + d.x * tipLen;
    // x of the bind midpoint carried by this bone, so the edge's middle sits half-way across.
    const c = trailX + tipX - pMidX - m2.x - qd * d.x;
    const A = u.x;
    const Bv = wv.x;
    const R = Math.sqrt(A * A + Bv * Bv);
    const base = Math.atan2(Bv, A);
    let psi = base;
    if (R > 1e-6) {
      const r = c / R;
      if (r >= 1) psi = base;
      else if (r <= -1) psi = base + Math.PI;
      else {
        // Two rolls satisfy it: keep the one whose dorsal face (q·UP rolled) points out more.
        const ac = Math.acos(r);
        const up0 = _tv4.copy(UP).applyQuaternion(q);
        // Dorsal x after rolling by ±ac about d (Rodrigues; only x is needed).
        const dn = d.x * (d.x * up0.x + d.y * up0.y + d.z * up0.z);
        const cx = d.y * up0.z - d.z * up0.y;
        const p1 = base + ac;
        const p2 = base - ac;
        const x1 = up0.x * Math.cos(p1) + cx * Math.sin(p1) + dn * (1 - Math.cos(p1));
        const x2 = up0.x * Math.cos(p2) + cx * Math.sin(p2) + dn * (1 - Math.cos(p2));
        psi = x1 * sx >= x2 * sx ? p1 : p2;
      }
    }
    const sh = Math.sin(psi * 0.5);
    const qa = _qa;
    qa[0] = d.x * sh;
    qa[1] = d.y * sh;
    qa[2] = d.z * sh;
    qa[3] = Math.cos(psi * 0.5);
    q.premultiply(_qr.fromArray(qa));
  }

  /**
   * The fold helpers' transforms this frame (body frame, composed onto their rest hold by
   * Wyvern): with the wings folded on the ground the inner panel's interior is drawn in toward the
   * folded arm, so the membrane bunches into a narrow pleated bundle beside it instead of
   * standing out from the flank as a sheet. Identity in the air.
   */
  foldHelpers(): void {
    const a = this.a;
    const fold = this.f.fold;
    const T = FOLD;
    const r = 0.17 * this.armR;
    for (let side = 0; side < 2; side++) {
      const e = a.foldXform[side].elements;
      if (!(fold > 0.001)) {
        e[0] = e[5] = e[10] = e[15] = 1;
        e[1] = e[2] = e[3] = e[4] = e[6] = e[7] = e[8] = e[9] = e[11] = e[12] = e[13] = e[14] = 0;
        continue;
      }
      const sx = SIDE_SIGN[side];
      // About the folded elbow (fore and aft, up and down), and across about the flank or the
      // elbow's inner face, whichever is further in.
      const el = a.modelP[this.rig.idx.wings[side].forearm];
      const px = sx * Math.min(el.x * sx - r, this.flankX * T.helperFlank);
      const kx = 1 + (T.helperX - 1) * fold;
      const ky = 1 + (T.helperY - 1) * fold;
      const kz = 1 + (T.helperZ - 1) * fold;
      e[0] = kx;
      e[5] = ky;
      e[10] = kz;
      e[15] = 1;
      e[1] = e[2] = e[3] = e[4] = e[6] = e[7] = e[8] = e[9] = e[11] = 0;
      e[12] = (1 - kx) * px;
      e[13] = (1 - ky) * el.y;
      e[14] = (1 - kz) * el.z;
    }
  }

  /** Both legs: the flight poses (FK) blended with ground IK to the planted feet. */
  applyLegs(): void {
    const legAirW = this.f.legAirW;
    for (let side = 0; side < 2; side++) {
      this.applyLegFK(side);
      if (legAirW < 0.999) this.applyLegIK(side);
    }
  }

  /** Contact points for the next touchdown (hind: under the ball of the foot, fore: knuckle). */
  contacts(): void {
    const a = this.a;
    const I = this.rig.idx;
    for (let side = 0; side < 2; side++) {
      a.toWorld(a.modelP[I.legs[side].toes], this.footWorld[side]);
      a.toWorld(a.modelP[I.wings[side].claw], this.footWorld[2 + side]);
    }
  }

  /**
   * The four ground contacts (LH, RH, LF, RF; world) as the gait plants them, and how firmly each
   * is down (1 planted … 0 lifted or in the air). Returns how many were written.
   */
  footContacts(outPos: Vector3[], outW: { [i: number]: number }): number {
    const groundW = this.f.groundW;
    const n = Math.min(4, outPos.length);
    for (let i = 0; i < n; i++) {
      const foot = this.gait.feet[i];
      outPos[i].copy(foot.pos);
      outW[i] = groundW * (1 - foot.airborne);
    }
    return n;
  }

  // --- Legs --------------------------------------------------------------------------------------

  /**
   * Blend a leg bone direction (pelvis space, left; mirrored) from the four poses in LEG_POSES
   * (row 0 thigh, 1 shin, 2 meta), with this frame's weights in `legW`.
   */
  private legDir(out: Vector3, row: number): Vector3 {
    const P = LEG_POSES;
    const g = this.legW;
    const tuckAmt = g[0];
    const dangle = 1 - tuckAmt;
    const o = row * 12;
    // The dangling pose swings with the body (legSwing) and droops when tired.
    const dy = P[o + 4] - (row === 0 ? 0.05 * g[4] : 0);
    const dz = P[o + 5] - g[5] * (row === 2 ? 0.5 : 1);
    out.set(P[o] * tuckAmt + P[o + 3] * dangle, P[o + 1] * tuckAmt + dy * dangle, P[o + 2] * tuckAmt + dz * dangle);
    out.lerp(_lv.set(P[o + 6], P[o + 7], P[o + 8]), g[1]);
    out.lerp(_lv.set(P[o + 9], P[o + 10], P[o + 11]), g[2]);
    out.x *= g[3];
    return out.normalize();
  }

  private applyLegFK(side: number): void {
    const a = this.a;
    const f = this.f;
    const l = this.rig.idx.legs[side];
    const rest = this.legRestDir[side];
    const pq = a.modelQ[a.parent[l.thigh]];
    const g = this.legW;
    const tuckAmt = f.legTuck;
    const reach = f.legReach;
    const push = f.legPush;
    g[0] = tuckAmt;
    g[1] = reach;
    g[2] = push;
    g[3] = SIDE_SIGN[side];
    g[4] = f.fatigue;
    // Dangling legs swing back and forth with the body's fore-aft acceleration.
    g[5] = f.legSwing * (1 - tuckAmt);
    const thigh = this.legDir(_v, 0);
    const shin = this.legDir(_v2, 1);
    const meta = this.legDir(_v3, 2);
    thigh.applyQuaternion(pq);
    shin.applyQuaternion(pq);
    meta.applyQuaternion(pq);
    const lat = _ref.copy(LEFT).applyQuaternion(pq);
    aimRotation(rest[0], LEFT, thigh, lat, _q);
    a.setModel(l.thigh, _q);
    aimRotation(rest[1], LEFT, shin, lat, _q);
    a.setModel(l.shin, _q);
    aimRotation(rest[2], LEFT, meta, lat, _q);
    a.setModel(l.meta, _q);
    // Toes: curled while tucked or dangling, spread forward when reaching.
    const curl = (0.9 * tuckAmt + 0.55 * (1 - tuckAmt)) * (1 - reach) * (1 - push * 0.5) - 0.15 * reach;
    const e = this.toeAng;
    e[0] = curl;
    e[1] = 0;
    e[2] = 0;
    a.setEulerAt(l.toes, e, 0);
  }

  private applyLegIK(side: number): void {
    const a = this.a;
    const rig = this.rig;
    a.blend = 1 - this.f.legAirW;
    const l = rig.idx.legs[side];
    const G = rig.props.leg;
    const rest = this.legRestDir[side];
    const foot = this.gait.feet[side];
    const up = a.upM;
    // (Scalar arithmetic in place of three.js calls taking computed numbers; see applyWingIK.)
    const fwdG = this.fwdG.copy(FWD);
    fwdG.x -= up.x * up.z;
    fwdG.y -= up.y * up.z;
    fwdG.z -= up.z * up.z;
    fwdG.normalize();
    // Ball of the foot above the planted sole.
    const sole = G.sole;
    const ball = a.toModel(foot.pos, _v);
    ball.x += up.x * sole;
    ball.y += up.y * sole;
    ball.z += up.z * sole;
    // Metatarsus leans forward at the breed's own angle (near flat on the ironback); more when the
    // heel lifts during a swing.
    const ang = this.metaAngle + foot.airborne * 0.5;
    const ca = -Math.cos(ang);
    const sa = Math.sin(ang);
    const metaDir = _v3;
    metaDir.x = up.x * ca + fwdG.x * sa;
    metaDir.y = up.y * ca + fwdG.y * sa;
    metaDir.z = up.z * ca + fwdG.z * sa;
    const ml = -G.meta;
    const ankle = _v4;
    ankle.x = ball.x + metaDir.x * ml;
    ankle.y = ball.y + metaDir.y * ml;
    ankle.z = ball.z + metaDir.z * ml;
    const hip = a.modelP[l.thigh];
    const out = 0.12 * SIDE_SIGN[side];
    const pole = _v5;
    pole.x = fwdG.x + LEFT.x * out;
    pole.y = fwdG.y + LEFT.y * out;
    pole.z = fwdG.z + LEFT.z * out;
    const knee = _hum;
    solveTwoBoneAt(hip, this.lens, 2, ankle, pole, knee);
    const lat = _ref.copy(LEFT).applyQuaternion(a.modelQ[a.parent[l.thigh]]);
    aimRotation(rest[0], LEFT, _fore.subVectors(knee, hip), lat, _q);
    a.setModelBlend(l.thigh, _q);
    aimRotation(rest[1], LEFT, _fore.subVectors(ankle, a.pivot(l.shin)), lat, _q);
    a.setModelBlend(l.shin, _q);
    aimRotation(rest[2], LEFT, _fore.subVectors(ball, a.pivot(l.meta)), lat, _q);
    a.setModelBlend(l.meta, _q);
    // Toes flat on the ground in stance, pointing down as the foot lifts.
    const down = -0.9 * foot.airborne;
    _fd.x = fwdG.x + up.x * down;
    _fd.y = fwdG.y + up.y * down;
    _fd.z = fwdG.z + up.z * down;
    _fd.normalize();
    aimRotation(FWD, UP, _fd, up, _q);
    a.setModelBlend(l.toes, _q);
  }

}
