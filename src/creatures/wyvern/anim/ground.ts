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
import type { TerrainQuery } from '../../../core/types';
import { DEG, TAU, clamp, clamp01, smoothstep } from '../../../core/math';
import { SIDE_SIGN, type RigDef } from '../rig';
import { LEG_ANGLES } from '../proportions';
import { Bouncy, aimRotation, solveTwoBone } from '../ik';
import { Gait, type GaitContext } from '../gait';
import { WING_CHANNELS, blendPose, flapPose, type WingPose } from '../wingPoses';
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
const _refN = new Vector3();
const _handD = new Vector3();
const _fd = new Vector3();
const _lv = new Vector3();

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

  constructor(a: WyvernAnimator, terrain?: Pick<TerrainQuery, 'groundAt'>) {
    this.a = a;
    this.f = a.frame;
    this.rig = a.rig;
    this.terrain = terrain;
    const rig = a.rig;
    const heft = a.heft;
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
    const restFore = (side: number) =>
      new Vector3((P.shoulder[0] + 0.12 * P.arm.humerus + 0.1 * sh) * SIDE_SIGN[side], -sh, P.shoulder[2] + 0.42 * P.arm.forearm);
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
    };
  }

  /** After a teleport: the settle starts from rest (the gait re-plants in gait()). */
  reset(): void {
    this.dip.reset();
  }

  private groundHeight(x: number, z: number, y: number): number {
    const fallback = this.a.groundRef;
    if (this.terrain) {
      const g = this.terrain.groundAt(x, z, y);
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
    if (f.takeoffCrouch) blendPose(SETTLE, flapPose(0, 0, this.flapTmp, f.heft), f.openAmt, out);
    else blendPose(FOLDED, SETTLE, clamp01(f.openAmt * 1.4 + f.shuffle * 0.8 + f.brace), out);
    if (f.bask > 0.001) blendPose(out, BASK, f.bask, out);
  }

  /**
   * Folded stance: the wrist (with its thumb claws) is a front foot planted by the gait; humerus
   * + forearm reach it by two-bone IK with the elbow high and back. The hand folds back up along
   * the forearm and the fingers run on up beside it in a tight bundle, then their outer segments
   * fold back along the flank toward the tail, so the folded wing reads as one strong limb with
   * the wingtips lying along the upper flank and the membrane bunched into a narrow wedge (not a
   * second pair of stilts with a sheet hung between them). Blended over the FK pose by this
   * frame's IK weight.
   */
  applyWingIK(side: number): void {
    const weight = this.ikW;
    if (!(weight > 0.001)) return;
    const a = this.a;
    const rig = this.rig;
    const sh = this.f.sh;
    const w = rig.idx.wings[side];
    const A = rig.props.arm;
    const sx = SIDE_SIGN[side];
    const rest = this.wingRestDir[side];
    const up = a.upM;
    const fwdG = this.fwdG.copy(FWD).addScaledVector(up, -up.z).normalize();
    // Wrist target (model space) from the planted foot, the claws resting on the ground.
    const foot = this.gait.feet[2 + side];
    const Wt = a.toModel(foot.pos, _v3).addScaledVector(up, 0.07 * sh);
    const S = _v2.copy(a.modelP[w.humerus]);
    // Pole: back and up, a little out, so the elbow juts up behind the shoulder.
    _v4.set(0.25 * sx, 0.75, -0.62);
    const E = _v5;
    solveTwoBone(S, A.humerus, A.forearm, Wt, _v4, E);
    const hum = _hum.subVectors(E, S);
    const fore = _fore.subVectors(Wt, E);
    // Wing surface "up" in the bind is −(humerus × forearm) for the left wing.
    const ref = _ref.crossVectors(hum, fore).multiplyScalar(-sx);
    if (ref.lengthSq() < 1e-8) ref.copy(UP);
    ref.normalize();
    aimRotation(rest[0], UP, hum, ref, _q);
    a.setModel(w.humerus, _q, weight);
    aimRotation(rest[1], UP, fore, ref, _q);
    a.setModel(w.forearm, _q, weight);
    // Hand folds back up along the forearm, just outside it.
    const back = _handD.subVectors(E, Wt).normalize();
    _fd.copy(back).addScaledVector(LEFT, 0.12 * sx).addScaledVector(fwdG, -0.06).normalize();
    aimRotation(rest[2], UP, _fd, ref, _q);
    a.setModel(w.hand, _q, weight);
    for (let f = 0; f < 3; f++) {
      // Inner segment: up beside the forearm, bundled (outside and a little behind it).
      _fd.copy(back)
        .addScaledVector(LEFT, (0.07 + 0.02 * f) * sx)
        .addScaledVector(fwdG, -0.1 - 0.06 * f)
        .normalize();
      aimRotation(rest[3 + f], UP, _fd, ref, _q);
      a.setModel(w.fingers[f][0], _q, weight);
      // Outer segment: folded back along the flank, tips toward the tail; the wingtip finger
      // rides highest, the inner ones fan a little lower. Membrane side faces outward.
      _fd.copy(fwdG)
        .multiplyScalar(-0.92)
        .addScaledVector(up, 0.3 - 0.13 * f)
        .addScaledVector(LEFT, (0.07 - 0.02 * f) * sx)
        .normalize();
      aimRotation(rest[3 + f], UP, _fd, _refN.copy(LEFT).multiplyScalar(sx), _q);
      a.setModel(w.fingers[f][1], _q, weight);
    }
    // Claws point forward along the ground.
    _fd.copy(fwdG).addScaledVector(up, -0.25).addScaledVector(LEFT, 0.2 * sx).normalize();
    aimRotation(FWD, UP, _fd, up, _q);
    a.setModel(w.claw, _q, weight);
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
    const weight = 1 - this.f.legAirW;
    const l = rig.idx.legs[side];
    const G = rig.props.leg;
    const rest = this.legRestDir[side];
    const foot = this.gait.feet[side];
    const up = a.upM;
    const fwdG = this.fwdG.copy(FWD).addScaledVector(up, -up.z).normalize();
    // Ball of the foot above the planted sole.
    const ball = a.toModel(foot.pos, _v).addScaledVector(up, G.sole);
    // Metatarsus leans forward; more when the heel lifts during a swing.
    const ang = LEG_ANGLES.meta + foot.airborne * 0.5;
    const metaDir = _v3.copy(up).multiplyScalar(-Math.cos(ang)).addScaledVector(fwdG, Math.sin(ang));
    const ankle = _v4.copy(ball).addScaledVector(metaDir, -G.meta);
    const hip = a.modelP[l.thigh];
    const pole = _v5.copy(fwdG).addScaledVector(LEFT, 0.12 * SIDE_SIGN[side]);
    const knee = _hum;
    solveTwoBone(hip, G.thigh, G.shin, ankle, pole, knee);
    const lat = _ref.copy(LEFT).applyQuaternion(a.modelQ[a.parent[l.thigh]]);
    aimRotation(rest[0], LEFT, _fore.subVectors(knee, hip), lat, _q);
    a.setModel(l.thigh, _q, weight);
    aimRotation(rest[1], LEFT, _fore.subVectors(ankle, a.pivot(l.shin)), lat, _q);
    a.setModel(l.shin, _q, weight);
    aimRotation(rest[2], LEFT, _fore.subVectors(ball, a.pivot(l.meta)), lat, _q);
    a.setModel(l.meta, _q, weight);
    // Toes flat on the ground in stance, pointing down as the foot lifts.
    _fd.copy(fwdG).addScaledVector(up, -0.9 * foot.airborne).normalize();
    aimRotation(FWD, UP, _fd, up, _q);
    a.setModel(l.toes, _q, weight);
  }
}
