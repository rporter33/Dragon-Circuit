// Quadrupedal ground gait on the hind feet and the folded wing-knuckles (like a pterosaur).
//
// Feet are planted in world space during stance (they never slide, whatever the body does) and
// swing along an arc to a predicted landing spot. A shared gait phase decides which feet are in
// the air while moving; standing still, feet that drift too far from their rest spot take a
// corrective step one at a time, so turning in place and settling after a landing look natural.
//
// The timing is the breed's GaitProfile (core/gait.ts), the same numbers the gameplay walker runs
// its footstep clock on: a lateral-sequence walk (touchdowns LH, LF, RH, RF) blending into a
// bound, the stride and duty factor by dynamic similarity (froudeStride). Given that clock
// (GaitContext.phase), the feet follow it, so each foot comes down on its footstep.

import { Vector3 } from 'three';
import { clamp, smoothstep } from '../../core/math';
import { GAIT_PROFILES, TURN_CYCLE, froudeStride, type GaitProfile } from '../../core/gait';

/** Foot order: left hind, right hind, left fore (wing knuckle), right fore. */
export const FOOT_COUNT = 4;
export const isFore = (f: number) => f >= 2;

export interface FootPhase {
  swing: boolean;
  /** Progress 0..1 within the stance or the swing. */
  t: number;
}

/** Where in its own cycle a foot is. Writes into `out` (allocation-free). */
export function footPhase(phase: number, offset: number, duty: number, out: FootPhase = { swing: false, t: 0 }): FootPhase {
  let p = (phase + offset) % 1;
  if (p < 0) p += 1;
  out.swing = p >= duty;
  out.t = out.swing ? (p - duty) / (1 - duty) : p / duty;
  return out;
}

export interface GaitContext {
  dt: number;
  /** Body center (world) and the transform body → world for rest foot spots. */
  toWorld(model: Vector3, out: Vector3): Vector3;
  /**
   * Ground height under (x, z) near height y (world), its surface normal written into `n`; NaN
   * where there is no ground a foot could stand on (a drop, a ledge's foot, a wall's top): the
   * foot then steps back toward the body onto ground that is.
   */
  groundAt(x: number, z: number, y: number, n: Vector3): number;
  /** Where a foot stands when no ground near it will do (world height). Absent: where it is. */
  fallbackY?: number;
  /**
   * Anything else groundAt's answers depend on (e.g. the ground height under the body it falls
   * back to): a cached answer is reused only while this is unchanged.
   */
  groundKey?: number;
  /** Horizontal body velocity (world, m/s). */
  velocity: Vector3;
  /** Yaw rate (rad/s, + = left). */
  yawRate: number;
  standHeight: number;
  /** 0 walk … 1 run. */
  runBlend: number;
  /** The breed's gait (offsets, run duty). Absent: the shared defaults. */
  profile?: GaitProfile;
  /**
   * The gameplay walker's gait clock (WyvernPose.gaitPhase, 0..1) to follow while moving, so
   * every foot lands on its footstep. Absent: the gait keeps its own clock.
   */
  phase?: number;
  /** True when the gait should cycle (moving or turning); false lets feet settle. */
  moving: boolean;
  /**
   * Standing still, the forefeet step as a pair, quicker and on a shorter drift (the kneel brings
   * them forward together). Absent: false.
   */
  foreTogether?: boolean;
  /**
   * Bit i set: planted foot i is out of its limb's reach (its IK can't get there): it lifts and
   * steps on early rather than hang a straight leg in the air. Absent: none.
   */
  overreach?: number;
}

export class Foot {
  /** Current contact point (world): the sole under the ball of the foot / the knuckle. */
  readonly pos = new Vector3();
  readonly plant = new Vector3();
  readonly from = new Vector3();
  readonly target = new Vector3();
  swinging = false;
  /** Swing progress 0..1. */
  s = 0;
  /** Corrective (standing) step duration, or 0 for a gait-driven step. */
  stepTime = 0;
  /** Height of the arc this swing (m). */
  lift = 0;
  /**
   * How long ago (s) within this frame a gait-driven swing ended: the foot came down part-way
   * through the frame, where the landing spot was then.
   */
  late = 0.5;
  /** Where in its phase a gait-driven swing lifted (the duty factor, or earlier for an early lift). */
  liftPh = 0.5;
  /**
   * The foot's own phase (0..1, the clock plus its offset), held while a change of gait moves its
   * offset back faster than the clock runs (so it never swings twice), as the walker's footsteps do.
   */
  ph = NaN;
  /** 0..1 how much the foot is off the ground right now (for toe curl etc.). */
  airborne = 0;
  /** The ground's normal under the planted foot, and under its landing spot (world). */
  readonly normal = new Vector3(0, 1, 0);
  readonly targetNormal = new Vector3(0, 1, 0);
  /** The last ground query for this foot's landing spot (x, z, the height asked from, the answer). */
  // (All start as doubles, so the fields never change representation once the gait runs.)
  gx = NaN;
  gz = NaN;
  gFrom = NaN;
  gy = NaN;
  gKey = NaN;
  /** ...and how far that spot had to step back toward the body to find ground (x, z). */
  gdx = NaN;
  gdz = NaN;
}

/**
 * Ground under a foot's landing spot, re-queried only when the spot has moved more than this (m):
 * standing still the feet ask nothing, walking a few times a stride.
 */
const GROUND_CACHE = 0.05;

const _n = new Vector3();
const _v = new Vector3();
const _c = new Vector3();
const ZERO = new Vector3();
const DEFAULT_PROFILE = GAIT_PROFILES.harrier;

export class Gait {
  phase = 0;
  readonly feet: Foot[] = [new Foot(), new Foot(), new Foot(), new Foot()];
  /** Rest spots of the feet in body space (on the ground plane y = -standHeight). */
  readonly rest: Vector3[];
  /** This frame's phase offset per foot (LH, RH, LF, RF), duty factor and cycle length (m). */
  readonly offsets = new Float64Array(4);
  duty = 0.6;
  cycleLen = 2;
  /**
   * Each foot's progress through its stance this frame (0 touchdown … 1 lift-off), or -1 while it
   * swings. Standing still, a planted foot reads 0.5.
   */
  readonly stance = new Float64Array(4);
  /** Bit i set: foot i came down (swing → stance) during the last update. */
  contacts = 0;
  /** Seconds per cycle at this frame's speed. */
  private cycleTime = 0.5;
  private readonly stride = new Float64Array(2);
  private initialized = false;

  constructor(rest: Vector3[]) {
    this.rest = rest;
  }

  /** Plant every foot at its rest spot (after a teleport or touchdown). */
  reset(ctx: GaitContext): void {
    for (let f = 0; f < FOOT_COUNT; f++) {
      const foot = this.feet[f];
      ctx.toWorld(this.rest[f], foot.plant);
      this.plantOnGround(foot, ctx);
      foot.s = 0;
    }
    this.initialized = true;
  }

  /** Plant each foot where it is now (projected to the ground), e.g. at touchdown. */
  plantAt(positions: Vector3[], ctx: GaitContext): void {
    for (let f = 0; f < FOOT_COUNT; f++) {
      const foot = this.feet[f];
      foot.plant.copy(positions[f]);
      this.plantOnGround(foot, ctx);
    }
    this.initialized = true;
  }

  private plantOnGround(foot: Foot, ctx: GaitContext): void {
    const y = ctx.groundAt(foot.plant.x, foot.plant.z, foot.plant.y + ctx.standHeight, foot.normal);
    if (y === y) foot.plant.y = y;
    else {
      foot.plant.y = ctx.fallbackY ?? foot.plant.y;
      foot.normal.set(0, 1, 0);
    }
    foot.targetNormal.copy(foot.normal);
    foot.pos.copy(foot.plant);
    foot.swinging = false;
    foot.airborne = 0;
    foot.gx = NaN;
  }

  /** Advance the feet one frame. Returns the feet that came down (see `contacts`). */
  update(ctx: GaitContext): number {
    if (!this.initialized) this.reset(ctx);
    const sh = ctx.standHeight;
    const prof = ctx.profile ?? DEFAULT_PROFILE;
    // (The profile's timing and the foot phases inline: numbers passed into a call the JIT doesn't
    // inline are boxed on the heap, every foot, every frame.)
    const rb = ctx.runBlend;
    const off = this.offsets;
    for (let k = 0; k < 4; k++) off[k] = prof.walkOffsets[k] + (prof.runOffsets[k] - prof.walkOffsets[k]) * rb;
    const speed = Math.hypot(ctx.velocity.x, ctx.velocity.z);
    const turnEff = Math.abs(ctx.yawRate) * 0.9 * sh;
    const speedEff = Math.max(speed, turnEff);
    // The stride by dynamic similarity: longer and with less of it on the ground the faster it
    // goes, the bound's duty below the walk's.
    froudeStride(speedEff, sh, this.stride);
    const duty = this.stride[1] + (prof.runDuty - this.stride[1]) * rb;
    // Turning on the spot the feet step short and quick round the pivot (TURN_CYCLE), not the
    // long strides of a straight walk.
    const turning = speedEff > 1e-6 ? clamp((turnEff - speed) / speedEff, 0, 1) : 0;
    const cycleLen = this.stride[0] + (TURN_CYCLE * sh - this.stride[0]) * turning;
    this.duty = duty;
    this.cycleLen = cycleLen;
    this.cycleTime = cycleLen / Math.max(0.3, speedEff);
    if (ctx.moving) {
      const ext = ctx.phase;
      this.phase = ext !== undefined && ext === ext ? ext - Math.floor(ext) : (this.phase + (speedEff / cycleLen) * ctx.dt) % 1;
    }

    let swingingCount = 0;
    for (const f of this.feet) if (f.swinging) swingingCount++;
    this.contacts = 0;

    for (let i = 0; i < FOOT_COUNT; i++) {
      const foot = this.feet[i];
      const fore = isFore(i);
      this.stance[i] = 0.5;
      // First the foot's state this frame (lifting, how far through its swing), then where it is
      // headed from there: the landing spot is predicted from the swing time actually left, so an
      // update that takes no time (a render-only frame) changes nothing.
      let want = (this.phase + off[i]) % 1;
      if (want < 0) want += 1;
      if (!ctx.moving || foot.ph !== foot.ph) foot.ph = want;
      if (ctx.moving) {
        let d = want - foot.ph;
        d -= Math.round(d);
        // (Held while the offset runs back; a jump of the clock, a re-phase, is followed.)
        if (d > 0 || d < -0.25) {
          const now = foot.ph + d;
          foot.ph = now - Math.floor(now);
        }
        const p = foot.ph;
        const swing = p >= duty;
        this.stance[i] = swing ? -1 : p / duty;
        // A gait-driven swing lands as the foot's phase wraps (on its footstep). A stance foot left
        // far behind (a gait started from a standstill) or out of its limb's reach (a slope that
        // tips the stride's end away from it) lifts early instead, and swings the longer.
        if (!foot.swinging) {
          let early = false;
          if (!swing && ctx.dt > 0) {
            ctx.toWorld(this.rest[i], _v);
            const dx = foot.plant.x - _v.x;
            const dz = foot.plant.z - _v.z;
            // (Out of reach ahead, lifting would only land it ahead again: the body lowers to it.)
            const behind = dx * ctx.velocity.x + dz * ctx.velocity.z < 0;
            const far = dx * dx + dz * dz > 0.45 * 0.45 * cycleLen * cycleLen;
            early = behind && (far || ((ctx.overreach ?? 0) & (1 << i)) !== 0);
          }
          if (swing || early) {
            foot.swinging = true;
            foot.stepTime = 0;
            foot.s = 0;
            foot.liftPh = swing ? duty : p;
            foot.from.copy(foot.plant);
            foot.lift = sh * (fore ? 0.16 : 0.2) * (0.6 + 0.6 * rb);
          }
        }
        foot.late = 0;
        if (foot.swinging && foot.stepTime === 0) {
          if (p >= foot.liftPh) foot.s = Math.max(foot.s, (p - foot.liftPh) / (1 - foot.liftPh));
          else {
            foot.s = 1;
            foot.late = Math.min(ctx.dt, p * this.cycleTime);
          }
        }
      }
      this.predict(foot, i, ctx);
      if (!ctx.moving && !foot.swinging) {
        // Standing: step only if this foot has drifted, one foot at a time (or the forefeet as a
        // pair, quicker, when they are brought forward together).
        _v.subVectors(foot.target, foot.plant);
        _v.y = 0;
        const pair = fore && ctx.foreTogether === true;
        if (_v.length() > (pair ? 0.1 : 0.28) * sh && (swingingCount === 0 || pair)) {
          foot.swinging = true;
          foot.s = 0;
          foot.stepTime = pair ? 0.3 : 0.42;
          foot.from.copy(foot.plant);
          foot.lift = sh * (fore ? 0.12 : 0.14);
          swingingCount++;
        }
      }
      if (foot.swinging && foot.stepTime > 0) foot.s = Math.min(1, foot.s + ctx.dt / foot.stepTime);

      if (foot.swinging) {
        const e = smoothstep(0, 1, foot.s);
        foot.pos.lerpVectors(foot.from, foot.target, e);
        foot.pos.y += foot.lift * Math.sin(Math.PI * Math.min(1, foot.s * 1.1));
        foot.airborne = Math.sin(Math.PI * foot.s);
        if (this.stance[i] >= 0 && !ctx.moving) this.stance[i] = -1;
        if (foot.s >= 1) {
          foot.swinging = false;
          foot.s = 0;
          foot.plant.copy(foot.target);
          foot.normal.copy(foot.targetNormal);
          foot.pos.copy(foot.plant);
          foot.airborne = 0;
          swingingCount = Math.max(0, swingingCount - 1);
          this.contacts |= 1 << i;
        }
      } else {
        foot.pos.copy(foot.plant);
        foot.airborne = 0;
      }
    }
    return this.contacts;
  }

  /**
   * Where foot i will land if it is in the air (its predicted landing spot), or where it stands
   * (world): a footstep heard for this foot belongs here.
   */
  landing(i: number, out: Vector3): Vector3 {
    const foot = this.feet[i];
    return out.copy(foot.swinging ? foot.target : foot.plant);
  }

  /**
   * Predicted landing spot for foot i: its rest spot, carried forward by the body's motion and
   * turn over the swing time it has left plus half a stance (nothing ahead when standing).
   */
  private predict(foot: Foot, i: number, ctx: GaitContext): void {
    const cycleTime = this.cycleTime;
    const duty = this.duty;
    const swingLeft = foot.swinging ? (1 - foot.s) * (foot.stepTime > 0 ? foot.stepTime : (1 - foot.liftPh) * cycleTime) : 0;
    const ahead = ctx.moving ? swingLeft + 0.5 * duty * cycleTime - foot.late : 0;
    const turn = clamp(ctx.yawRate * ahead, -0.6, 0.6);
    const r = this.rest[i];
    _n.set(r.x * Math.cos(turn) + r.z * Math.sin(turn), r.y, -r.x * Math.sin(turn) + r.z * Math.cos(turn));
    ctx.toWorld(_n, foot.target);
    foot.target.addScaledVector(ctx.velocity, Math.min(ahead, 1.2));
    // A planted foot of a moving gait doesn't need its next landing's height until it lifts.
    if (ctx.moving && !foot.swinging && foot.gy === foot.gy) {
      foot.target.y = foot.gy;
      return;
    }
    const x = foot.target.x;
    const z = foot.target.z;
    const from = foot.target.y + ctx.standHeight;
    const dx = x - foot.gx;
    const dz = z - foot.gz;
    // (NaN after a reset fails the test: always ask then.)
    const key = ctx.groundKey ?? 0;
    if (!(dx * dx + dz * dz < GROUND_CACHE * GROUND_CACHE && Math.abs(from - foot.gFrom) < 0.5 && key === foot.gKey)) {
      foot.gx = x;
      foot.gz = z;
      foot.gFrom = from;
      foot.gKey = key;
      foot.gdx = 0;
      foot.gdz = 0;
      let y = ctx.groundAt(x, z, from, foot.targetNormal);
      if (y !== y) {
        // No ground to stand on there (over a ledge, down a drop): step back toward the body until
        // there is, else stand where the body's own ground is.
        ctx.toWorld(ZERO, _c);
        for (let k = 1; k <= 3 && y !== y; k++) {
          const t = k / 4;
          foot.gdx = (_c.x - x) * t;
          foot.gdz = (_c.z - z) * t;
          y = ctx.groundAt(x + foot.gdx, z + foot.gdz, from, foot.targetNormal);
        }
        if (y !== y) {
          foot.gdx = 0;
          foot.gdz = 0;
          y = ctx.fallbackY ?? foot.plant.y;
          foot.targetNormal.set(0, 1, 0);
        }
      }
      foot.gy = y;
    }
    foot.target.x += foot.gdx;
    foot.target.z += foot.gdz;
    foot.target.y = foot.gy;
  }
}
