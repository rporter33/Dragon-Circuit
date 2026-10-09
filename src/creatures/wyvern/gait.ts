// Quadrupedal ground gait on the hind feet and the folded wing-knuckles (like a pterosaur).
//
// Feet are planted in world space during stance (they never slide, whatever the body does) and
// swing along an arc to a predicted landing spot. A shared gait phase decides which feet are in
// the air while moving; standing still, feet that drift too far from their rest spot take a
// corrective step one at a time, so turning in place and settling after a landing look natural.

import { Vector3 } from 'three';
import { clamp, lerp, smoothstep } from '../../core/math';

/** Foot order: left hind, right hind, left fore (wing knuckle), right fore. */
export const FOOT_COUNT = 4;
export const isFore = (f: number) => f >= 2;

export interface GaitTiming {
  /** Phase offsets per foot (0..1). */
  offsets: [number, number, number, number];
  /** Fraction of the cycle a foot is on the ground. */
  duty: number;
  /** Cycle length in units of standHeight (distance travelled per full cycle). */
  cycle: number;
}

/** Lateral-sequence walk: LH, LF, RH, RF. */
export const WALK: GaitTiming = { offsets: [0, 0.5, 0.25, 0.75], duty: 0.62, cycle: 1.55 };
/** Bounding run: the hind pair pushes off, then the knuckles catch. */
export const RUN: GaitTiming = { offsets: [0, 0.08, 0.5, 0.58], duty: 0.36, cycle: 2.5 };

/** Blend of walk → run timing by t (0..1). */
export function gaitTiming(t: number, out: GaitTiming): GaitTiming {
  for (let i = 0; i < 4; i++) out.offsets[i] = lerp(WALK.offsets[i], RUN.offsets[i], t);
  out.duty = lerp(WALK.duty, RUN.duty, t);
  out.cycle = lerp(WALK.cycle, RUN.cycle, t);
  return out;
}

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

const _ph: FootPhase = { swing: false, t: 0 };

export interface GaitContext {
  dt: number;
  /** Body center (world) and the transform body → world for rest foot spots. */
  toWorld(model: Vector3, out: Vector3): Vector3;
  /** Ground height under (x, z) near height y (world). */
  groundAt(x: number, z: number, y: number): number;
  /** Horizontal body velocity (world, m/s). */
  velocity: Vector3;
  /** Yaw rate (rad/s, + = left). */
  yawRate: number;
  standHeight: number;
  /** 0 walk … 1 run. */
  runBlend: number;
  /** True when the gait should cycle (moving or turning); false lets feet settle. */
  moving: boolean;
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
  /** 0..1 how much the foot is off the ground right now (for toe curl etc.). */
  airborne = 0;
}

const _n = new Vector3();
const _v = new Vector3();

export class Gait {
  phase = 0;
  readonly feet: Foot[] = [new Foot(), new Foot(), new Foot(), new Foot()];
  /** Rest spots of the feet in body space (on the ground plane y = -standHeight). */
  readonly rest: Vector3[];
  private timing: GaitTiming = { offsets: [0, 0, 0, 0], duty: 0.5, cycle: 2 };
  /** Seconds per cycle at this frame's speed. */
  private cycleTime = 1;
  private initialized = false;

  constructor(rest: Vector3[]) {
    this.rest = rest;
  }

  /** Plant every foot at its rest spot (after a teleport or touchdown). */
  reset(ctx: GaitContext): void {
    for (let f = 0; f < FOOT_COUNT; f++) {
      const foot = this.feet[f];
      ctx.toWorld(this.rest[f], foot.plant);
      foot.plant.y = ctx.groundAt(foot.plant.x, foot.plant.z, foot.plant.y + ctx.standHeight);
      foot.pos.copy(foot.plant);
      foot.swinging = false;
      foot.s = 0;
      foot.airborne = 0;
    }
    this.initialized = true;
  }

  /** Plant each foot where it is now (projected to the ground), e.g. at touchdown. */
  plantAt(positions: Vector3[], ctx: GaitContext): void {
    for (let f = 0; f < FOOT_COUNT; f++) {
      const foot = this.feet[f];
      foot.plant.copy(positions[f]);
      foot.plant.y = ctx.groundAt(foot.plant.x, foot.plant.z, foot.plant.y + ctx.standHeight);
      foot.pos.copy(foot.plant);
      foot.swinging = false;
      foot.airborne = 0;
    }
    this.initialized = true;
  }

  update(ctx: GaitContext): void {
    if (!this.initialized) this.reset(ctx);
    const sh = ctx.standHeight;
    const T = gaitTiming(ctx.runBlend, this.timing);
    const speed = Math.hypot(ctx.velocity.x, ctx.velocity.z);
    const speedEff = Math.max(speed, Math.abs(ctx.yawRate) * 0.9 * sh);
    const cycleLen = T.cycle * sh;
    this.cycleTime = cycleLen / Math.max(0.3, speedEff);
    if (ctx.moving) this.phase = (this.phase + (speedEff / cycleLen) * ctx.dt) % 1;

    let swingingCount = 0;
    for (const f of this.feet) if (f.swinging) swingingCount++;

    for (let i = 0; i < FOOT_COUNT; i++) {
      const foot = this.feet[i];
      const fore = isFore(i);
      // First the foot's state this frame (lifting, how far through its swing), then where it is
      // headed from there: the landing spot is predicted from the swing time actually left, so an
      // update that takes no time (a render-only frame) changes nothing.
      if (ctx.moving) {
        const ph = footPhase(this.phase, T.offsets[i], T.duty, _ph);
        if (ph.swing && !foot.swinging) {
          foot.swinging = true;
          foot.stepTime = 0;
          foot.from.copy(foot.plant);
          foot.lift = sh * (fore ? 0.16 : 0.2) * (0.6 + 0.6 * ctx.runBlend);
        }
        if (foot.swinging && foot.stepTime === 0) {
          if (ph.swing) foot.s = Math.max(foot.s, ph.t);
          else foot.s = 1;
        }
      }
      this.predict(foot, i, ctx);
      if (!ctx.moving && !foot.swinging) {
        // Standing: step only if this foot has drifted, one foot at a time.
        _v.subVectors(foot.target, foot.plant);
        _v.y = 0;
        if (_v.length() > 0.28 * sh && swingingCount === 0) {
          foot.swinging = true;
          foot.s = 0;
          foot.stepTime = 0.42;
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
        if (foot.s >= 1) {
          foot.swinging = false;
          foot.s = 0;
          foot.plant.copy(foot.target);
          foot.pos.copy(foot.plant);
          foot.airborne = 0;
          swingingCount = Math.max(0, swingingCount - 1);
        }
      } else {
        foot.pos.copy(foot.plant);
        foot.airborne = 0;
      }
    }
  }

  /**
   * Predicted landing spot for foot i: its rest spot, carried forward by the body's motion and
   * turn over the swing time it has left plus half a stance (nothing ahead when standing).
   */
  private predict(foot: Foot, i: number, ctx: GaitContext): void {
    const T = this.timing;
    const cycleTime = this.cycleTime;
    const swingLeft = foot.swinging ? (1 - foot.s) * (foot.stepTime > 0 ? foot.stepTime : (1 - T.duty) * cycleTime) : 0;
    const ahead = ctx.moving ? swingLeft + 0.5 * T.duty * cycleTime : 0;
    const turn = clamp(ctx.yawRate * ahead, -0.6, 0.6);
    const r = this.rest[i];
    _n.set(r.x * Math.cos(turn) + r.z * Math.sin(turn), r.y, -r.x * Math.sin(turn) + r.z * Math.cos(turn));
    ctx.toWorld(_n, foot.target);
    foot.target.addScaledVector(ctx.velocity, Math.min(ahead, 1.2));
    foot.target.y = ctx.groundAt(foot.target.x, foot.target.z, foot.target.y + ctx.standHeight);
  }
}
