// Rigid-body wyvern flight: "weighty sim-lite".
//
// The model is a point mass with an orientation, flown by aerodynamic forces computed from the
// breed's physical numbers (mass, wing area, lift slope, drag polar). Nothing here knows about
// the player, the camera or rendering, so AI rivals and ghosts can run the same physics.
//
// Forces (world frame, all from the AIR-relative velocity so wind, gusts and thermals matter):
//   lift   = ½ρV²·S·CL(α)    perpendicular to the airflow and the wingspan
//   drag   = ½ρV²·(body + S·cd0 + S·K·CL² + flare + stall + folded wings)   — the induced term
//            K·CL² is why a hard turn bleeds speed
//   flap   = a committed wingbeat: a power curve on the downstroke (the first `downFrac` of the
//            beat) adds thrust + lift; the recovery loses a little lift
//   gravity
// Energy is never invented: a dive trades height for speed and a zoom trades it back, minus drag.
//
// Rotation is a rate-command system with inertia. Each axis has a TARGET body rate:
//   pitch: follow the flight path (weathervane) + steer the angle of attack toward the stick's
//          command (hands-off it trims to a gentle, speed-stable cruise α)
//   yaw:   follow the flight path, cancel sideslip (automatic turn coordination) + rudder
//   roll:  stick × the breed's max roll rate (+ a subtle auto-level when the stick is centered)
// and the body chases those targets with an angular acceleration capped by the breed's control
// authority × dynamic pressure, so controls go mushy near stall speed and crisp at speed, and
// heavy breeds visibly take longer to roll in and out.
//
// Integration is semi-implicit Euler at a fixed dt (the game runs 120 Hz). Everything is
// deterministic for a given input stream: no randomness, no wall-clock time.

import { Quaternion, Vector3 } from 'three';
import type { BreedStats, ContactInfo, FlightEnvironment, FlightInput, FlightState, GroundHit } from '../core/types';
import type { GameEventBus } from '../core/events';
import { clamp, clamp01, damp, DEG, lerp, smoothstep } from '../core/math';
import { SOFT_PUSH } from '../world/colliders';
import { DEFAULT_DOWN_FRAC } from './breeds';

export const GRAVITY = 9.81;
export const AIR_DENSITY = 1.1;

/**
 * Shared tuning constants. Per-breed character comes from BreedStats; these shape how the
 * physics is turned into a game that feels heavy but never cruel.
 */
export const FLIGHT_TUNING = {
  /** Wing chord incidence relative to the body axis (the body flies slightly nose-down of the wing). */
  incidence: 2.5 * DEG,
  /** Wing spread when fully tucked. */
  tuckedSpread: 0.22,
  /** Fraction of lifting area left at zero spread. */
  areaAtZeroSpread: 0.12,
  /**
   * Drag coefficient (per m² of wing) of folded wing membrane bunched against the body. Less
   * than the spread wing's profile drag plus its flutter at speed, so tucking always dives faster.
   */
  cdFolded: 0.028,
  /**
   * Spread membrane flutters at dive speeds: extra drag coefficient (per m² of wing) that fades
   * in between `flutterFrom` and `flutterTo` × cruise speed. Zero at cruise, so the glide polar
   * is untouched; it is why a spread-winged dive tops out well below a tucked one.
   */
  cdFlutter: 0.03,
  flutterFrom: 1.8,
  flutterTo: 3.2,
  /** Body drag area = bodyDrag × mass^(2/3) (m²). Cross-section grows with mass^(2/3). */
  bodyDrag: 0.00333,
  /** Extra drag coefficient (per m² of wing) of wings spread as an air brake. */
  cdFlare: 0.45,
  /** Extra drag coefficient of separated flow when fully stalled. */
  cdStall: 0.3,
  /** Side-force area (fraction of wing area) that turns sideslip into a sideways push. */
  sideArea: 0.12,
  /** Hands-off trim lift coefficient as a fraction of clMax (sets the cruise speed ~1.67 × stall). */
  cruiseClFraction: 0.36,
  /**
   * Above cruise speed the hands-off trim gets gentler: trim CL ∝ (q_cruise / q)^k, so letting go
   * after a dive is a firm pull-out rather than a violent one (k = 1 would hold 1 g at any speed;
   * k = 0 is a fixed α). Below cruise the trim α is fixed, so lift falls with q and a slow
   * wyvern lowers its nose: classic speed stability, which keeps powered climbs from hanging.
   */
  trimExponent: 0.55,
  /**
   * While beating its wings the wyvern trims for its best-climb speed instead of cruise (trim CL
   * × this, ≈ 0.86 × cruise speed), so holding flap with the stick centered climbs away.
   */
  climbTrim: 1.35,
  /** How hard the pitch loop chases the commanded angle of attack (1/s). */
  alphaGain: 4.2,
  /**
   * Phugoid damper: extra load factor per g of along-path acceleration (smoothed). Speeding up
   * (diving) adds a little lift, slowing down (climbing) eases it, so a released stick settles
   * into a steady glide instead of porpoising. Zero in any steady state, so it never biases trim.
   */
  phugoidDamp: 1.3,
  /**
   * Stick → α: most of the travel (up to `stallStick`) reaches just short of the critical angle;
   * the last part reaches `alphaOverStall` past it — a light buffet that says "this is the
   * limit". Full stick alone never breaks the stall (keyboard pitch is all-or-nothing); running
   * out of airspeed does (see `slowStall`).
   */
  stallStick: 0.85,
  alphaOverStall: 0.6 * DEG,
  /**
   * Soft stall protection: between `protectFrom` and `protectTo` × stall speed a held pull is
   * eased back to `protectMargin` short of the critical angle, so holding the stick back as the
   * speed bleeds away settles into a slow, nose-high mush (sinking when the wing can't hold the
   * weight) instead of breaking the stall. Only a zoom that runs out of air altogether, where the
   * airflow swings past the wing faster than the nose can follow, still stalls.
   */
  stallProtect: 1,
  protectFrom: 1.4,
  protectTo: 1.12,
  protectMargin: 3 * DEG,
  /**
   * Zoom limiter: below `zoomFrom` × stall speed in a climb, a held pull asks for only
   * `zoomLoad` × the lift the climb needs (fully by `protectTo`), so the path tops out.
   */
  zoomFrom: 2.6,
  zoomLoad: 0.4,
  /**
   * Pull-out after a stall: while stalled and for `recoverTime` s after, the hands-off trim
   * asks for at least `recoverCl` × clMax (capped at `recoverN` g) so letting go flies out of
   * the dive firmly instead of hanging nose-down.
   */
  recoverCl: 0.62,
  recoverN: 2.2,
  recoverTime: 2.5,
  /**
   * Below this × stall speed the flow starts to let go (pre-stall buffet), fully by another
   * `slowStallBand` × stall speed lower. Beating the wings keeps it attached down to
   * `slowStallFlapping` × stall speed.
   */
  slowStall: 1.1,
  slowStallFlapping: 0.55,
  slowStallBand: 0.15,
  /**
   * Slowness only lets the flow go when the wing is also working near its limit: the slow-stall
   * drive fades in from this far below the critical angle to 1° below it. A slow wyvern at a low
   * angle of attack (the top of a zoom, a hands-off glide that ran out of speed) just sinks and
   * weathervanes nose-down to fly again.
   */
  slowStallAlpha: 4 * DEG,
  /** Full forward stick. */
  alphaMin: -10 * DEG,
  /** α the flare pulls toward. */
  flareAlpha: 32 * DEG,
  /** Load-factor limits the wyvern will pull (it simply won't strain its wings harder). */
  nMaxLight: 5.5,
  nMaxHeavy: 4.2,
  nMaxFlare: 1.35,
  /**
   * Full forward stick asks for at most this much negative g: a heavy wyvern noses over into a
   * dive, it doesn't bunt (at −1.6 g a held push went past the vertical in 2 s).
   */
  nMin: -0.5,
  /** Reference airspeed for control authority (m/s). */
  authoritySpeed: 23,
  authorityMin: 0.14,
  authorityMax: 1.5,
  /** Rate tracking gain = angularDamping × this (1/s). */
  trackGainScale: 2.4,
  /**
   * Slow flight while beating the wings (a takeoff, a climb-out): the airflow is too weak to
   * weathervane the body, so the wyvern holds a nose-up climbing attitude instead, plus stick.
   */
  slowClimbAttitude: 9 * DEG,
  slowStickAttitude: 25 * DEG,
  attitudeGain: 3,
  /** Beating below this × stall speed, the wyvern holds its climb-out attitude. */
  climbOutSpeed: 1.3,
  /** Max pitch rate = pitchAuthority × this (rad/s). */
  pitchRateScale: 0.46,
  /** Rudder yaw rate at full deflection = yawAuthority × this (rad/s). */
  rudderRateScale: 0.42,
  /**
   * The tail steers the path directly: sideways acceleration at full rudder (m/s² at the
   * reference airspeed, scaled with dynamic pressure), its drag cost (× cd0 per m² of wing),
   * and the roll rate it couples in so the wyvern leans into a flat turn (rad/s).
   */
  rudderAccel: 3,
  rudderDrag: 0.25,
  rudderRoll: 0.15,
  /** How hard the yaw loop cancels sideslip (1/s). */
  betaGain: 3.2,
  /**
   * Auto-level: roll rate per radian of bank once the stick has rested centered for a moment
   * (subtle: a held bank decays over several seconds, it never fights the player).
   */
  autoLevelGain: 0.2,
  autoLevelMaxRate: 0.12,
  autoLevelDelay: 0.6,
  /**
   * Stopping a roll: the authority available to arrest a roll rate is this × the authority to
   * start one. A heavy wyvern still takes its time to roll in, but settles where it was put
   * instead of wallowing on past the bank it was given.
   */
  rollBrake: 2.6,
  /**
   * Gusts across the span: the vertical air at each wingtip (sampled `gustSpan` × half-span out)
   * is compared, and the difference rolls the wyvern (rad/s² per m/s of difference per m/s of
   * airspeed, × 17 / wing loading so light breeds feel the bumps most).
   */
  gustRoll: 0.6,
  gustSpan: 0.8,
  /** Stall dynamics. */
  stallBand: 6 * DEG,
  /** Hysteresis: once the flow has let go it doesn't reattach until α is this far below critical. */
  stallHysteresis: 3.5 * DEG,
  stallRise: 3.5,
  stallFall: 2.2,
  noseDropAccel: 2.4,
  noseDropRate: 0.7,
  wingDropAccel: 2.6,
  wingDropRate: 0.8,
  buffetAccel: 2.2,
  /** Flapping. */
  flapTiltUp: 10 * DEG,
  /** Thrust fades with airspeed: zero at vFlapMax = this × cruise speed. */
  flapMaxSpeedFactor: 2.3,
  /**
   * Below cruise speed the stroke loses bite (the wing can't load up in slow air), down to this
   * fraction at a standstill — except during the launch grace. Stops powered zooms from hanging.
   */
  flapSlowThrust: 0.55,
  /**
   * Flap lift scales with airspeed (the stroke adds to the airflow already over the wing), from
   * this fraction at a standstill up to full at cruise...
   */
  flapLiftAtRest: 0,
  /** ...except during the launch grace, when a standing takeoff gets this much lift at rest. */
  flapLiftLaunch: 2.0,
  /** Launch strokes (during the grace) are the strongest a wyvern makes: thrust × this. */
  launchThrust: 1.6,
  /** Upstroke recovery: a small fraction of peak lift lost. */
  upstrokeLoss: 0.1,
  /** Seconds after the last beat before stamina starts to come back. */
  regenDelay: 0.55,
  /**
   * Stamina never locks the wings. As the meter runs dry (the last `weakBand` of it) beats fade
   * to `weakBeat` of their strength: an empty wyvern can still labor along, sinking slowly,
   * but gliding (or landing) is how it gets its breath back. (0.185 of B8's bigger strokes is
   * the same push as the 0.22 of the 13 m wings': the bigger wings mustn't hold an empty
   * wyvern's height.)
   */
  weakBeat: 0.185,
  weakBand: 0.1,
  /**
   * Rising air is restful: regen × (1 + thermalRegen × how strong the updraft is), ramping in
   * from `thermalRegenFrom` m/s of rising air to full at `thermalRegenFull` m/s.
   */
  thermalRegen: 1.5,
  thermalRegenFrom: 1,
  thermalRegenFull: 4,
  /**
   * Backwinging: flaring within `backwingHeight` m (plus the legs) of the ground, the wyvern
   * beats against its sink: an upward push of `backwingGain` × (sink − `backwingFreeSink`) m/s²,
   * at most `backwingMaxG` g, paid for at `backwingCost` × the flapping rate. It touches down at
   * a walk instead of dropping out of the flare's parachute.
   */
  backwingHeight: 8,
  backwingFreeSink: 3,
  backwingGain: 3,
  backwingMaxG: 1.2,
  backwingCost: 0.6,
  /**
   * Feet first: flaring with the feet within `landPitchFrom` × standHeight of the ground, the body
   * pitches up toward `landPitch` (fully by `landPitchFull` × standHeight), so the hind feet reach
   * the ground before the chest and the wings brake in front of it (a deep, deliberate stall). The
   * braking wings give the pitch its authority however slow the air (`landAuthority`).
   */
  landPitch: 30 * DEG,
  landPitchFrom: 2.5,
  landPitchFull: 1,
  landAuthority: 0.6,
  /**
   * No balloon: in that low flare the wyvern rises about `zoomCap` m at most above the lowest point
   * of its approach: from half of it the wings spill their lift (upward speed damped at
   * `zoomSpill` /s).
   */
  zoomCap: 0.3,
  zoomSpill: 20,
  /**
   * Terrain queries, kept cheap. The clearance (a conservative distance to the nearest solid)
   * minus the distance flown since it was measured is still a safe bound, so it is re-measured
   * only once that bound drops under `clearanceRemeasure` m (or it is `clearanceMaxAge` s old,
   * for anything that moves). The ground below is re-queried every step within
   * `groundQueryNear` m of a solid, every 4th step within `groundQueryRange` m and every 8th
   * step beyond, and the wingtips' air every 4th step (the fields are smooth at that scale).
   */
  clearanceRemeasure: 45,
  clearanceMaxAge: 0.5,
  groundQueryNear: 15,
  groundQueryRange: 40,
  /** Ground effect: induced drag reduction near the ground. */
  groundEffectLift: 0.12,
  /** Collision. */
  bodyRadiusFactor: 0.55,
  tipRadius: 0.55,
  tipSpanFactor: 0.92,
  restitution: 0.18,
  scrapeFriction: 0.45,
  scrapeDecel: 5,
  stunImpact: 9,
  stunTime: 0.6,
  hitEventMin: 2.5,
  /**
   * Foliage (soft colliders) brushes rather than stops: speed decays at `brushDrag` per second ×
   * how deep the body is in it, with a gentle `brushPush` m/s² outward; never a stun.
   */
  brushDrag: 0.6,
  brushPush: 4,
  brushEventGap: 0.25,
} as const;

const T = FLIGHT_TUNING;

/** Per-breed quantities derived once from BreedStats. */
export interface FlightDerived {
  weight: number;
  /** 1 g stall speed, wings spread (m/s). */
  vStall: number;
  /** Hands-off glide speed in still air (m/s). */
  vCruise: number;
  clCruise: number;
  qCruise: number;
  bodyCdA: number;
  bodyRadius: number;
  halfSpan: number;
  nMax: number;
  maxPitchRate: number;
  maxYawRate: number;
  qRef: number;
  vFlapMax: number;
}

export function deriveFlight(b: BreedStats): FlightDerived {
  const weight = b.mass * GRAVITY;
  const vStall = Math.sqrt((2 * weight) / (AIR_DENSITY * b.wingArea * b.clMax));
  const clCruise = b.clMax * T.cruiseClFraction;
  const vCruise = Math.sqrt((2 * weight) / (AIR_DENSITY * b.wingArea * clCruise));
  // Heavier breeds won't pull as many g.
  const heavy = clamp01((b.mass - 450) / 500);
  return {
    weight,
    vStall,
    vCruise,
    clCruise,
    qCruise: 0.5 * AIR_DENSITY * vCruise * vCruise,
    bodyCdA: T.bodyDrag * Math.pow(b.mass, 2 / 3),
    bodyRadius: b.standHeight * T.bodyRadiusFactor,
    halfSpan: b.wingspan / 2,
    nMax: lerp(T.nMaxLight, T.nMaxHeavy, heavy),
    maxPitchRate: b.pitchAuthority * T.pitchRateScale,
    maxYawRate: b.yawAuthority * T.rudderRateScale,
    qRef: 0.5 * AIR_DENSITY * T.authoritySpeed * T.authoritySpeed,
    vFlapMax: vCruise * T.flapMaxSpeedFactor,
  };
}

/**
 * The power curve of one beat at phase 0..1 (peak 1): a rounded sin² pulse over the downstroke
 * [0, down), then a small lift loss while the wing feathers up through the recovery. The wing
 * animation (creatures/wyvern/wingPoses.ts) runs on the same clock, so the membrane loads and
 * the wing drives down exactly while this pushes. Averages down/2 − upstrokeLoss·(1 − down)·2/π.
 */
export function strokeForce(phase: number, down: number): number {
  const p = phase - Math.floor(phase);
  if (p < down) {
    const sn = Math.sin((Math.PI * p) / down);
    return sn * sn;
  }
  return -T.upstrokeLoss * Math.sin((Math.PI * (p - down)) / (1 - down));
}

export interface FlightStepResult {
  contact: boolean;
  contactNormal: Vector3;
  /** Speed lost into the surface this step (m/s). */
  impact: number;
  /** A wingbeat began this step. */
  beatStarted: boolean;
  /** 0..1 how deep the body or a wing brushed through foliage this step (soft colliders). */
  brush: number;
}

export function createFlightState(): FlightState {
  return {
    position: new Vector3(),
    velocity: new Vector3(),
    orientation: new Quaternion(),
    angularVelocity: new Vector3(),
    stamina: 1,
    winded: false,
    flapPhase: 0,
    flapStrength: 0,
    wingSpread: 1,
    flare: 0,
    stall: 0,
    airspeed: 0,
    angleOfAttack: 0,
    gLoad: 1,
    timeSinceContact: 99,
  };
}

// Scratch vectors (module-level: the model never re-enters itself).
const fwd = new Vector3();
const up = new Vector3();
const left = new Vector3();
const wind = new Vector3();
const airVel = new Vector3();
const vhat = new Vector3();
const liftDir = new Vector3();
const force = new Vector3();
const aeroAcc = new Vector3();
const pathRate = new Vector3();
const target = new Vector3();
const tmp = new Vector3();
const tmp2 = new Vector3();
const push = new Vector3();
const nrm = new Vector3();
const prevPos = new Vector3();
const probe = new Vector3();
const tipWind = new Vector3();
const brushN = new Vector3();
const invQ = new Quaternion();
const dq = new Quaternion();

/** Smooth saturation: linear near zero, approaching ±limit without a kink. */
function softClamp(x: number, lo: number, hi: number): number {
  const knee = 0.85;
  if (x > hi * knee) {
    const room = hi * (1 - knee);
    return hi * knee + room * Math.tanh((x - hi * knee) / room);
  }
  if (x < lo * knee) {
    const room = lo * (1 - knee);
    return lo * knee + room * Math.tanh((x - lo * knee) / room);
  }
  return x;
}

export class FlightModel {
  breed: BreedStats;
  derived: FlightDerived;
  state: FlightState = createFlightState();
  /** Ground under the body found during the last step (null over open air). */
  ground: GroundHit | null = null;
  /** Stamina regeneration multiplier (the player raises it while rested). */
  regenMultiplier = 1;
  /**
   * Stamina capacity multiplier: beats drain the meter this much more slowly (the player's
   * Rested bonus raises it). The meter still reads 0..1 of the larger pool.
   */
  capacity = 1;
  /** Count of wingbeats started (lets a caller detect beats without events). */
  beats = 0;

  private result: FlightStepResult = { contact: false, contactNormal: new Vector3(), impact: 0, beatStarted: false, brush: 0 };
  private time = 0;
  private beatActive = false;
  private beatStrength = 0;
  /** The current beat is a backwing (landing) beat: its force comes from the backwing term. */
  private backwingBeat = false;
  private backwing = 0;
  private sinceBeat = 99;
  /** Unscaled stall depth (lift collapse); state.stall is the felt/visible stall. */
  private stallRaw = 0;
  private stalled = false;
  /** Seconds since the last stall ended (the firm pull-out window). */
  private sinceStall = 99;
  private tucked = false;
  private wingDropSign = 1;
  private stallCount = 0;
  private stun = 0;
  private grace = 0;
  /** A takeoff grace ends early once the wyvern reaches flying speed. */
  private graceUntilFlying = false;
  private graceAge = 0;
  private vDotSmooth = 0;
  /** Seconds the roll stick has rested near center (for the auto-level). */
  private rollRest = 0;
  private hitCooldown = 0;
  private brushCooldown = 0;
  private smoothG = 1;
  private dt = 1 / 120;
  /** The event bus the last step reported to (so reset() can close open stall/tuck events). */
  private bus: GameEventBus | undefined;
  /** Cycle-averaged lift of the current beat (N), which the hands-off trim doesn't ask the wing for. */
  private flapLiftMean = 0;
  /** Distance from the body to the nearest solid at the start of this step (conservative). */
  private clearance = Infinity;
  /** The last measured clearance, where and how long ago (the bound decays with distance flown). */
  private clearanceMeasured = -Infinity;
  private clearanceAt = new Vector3();
  private clearanceAge = 0;
  private groundTick = 0;
  private gustTick = 0;
  /** Roll rate the difference in vertical air across the span asks for (rad/s). */
  private gustRate = 0;
  /** Vertical air at each wingtip (m/s) at the last gust sample. */
  private readonly tipUp = { l: 0, r: 0 };
  /** Smoothed vertical air at the body (m/s): thermals and ridge lift make for a restful glide. */
  private updraft = 0;
  private contactInfo: ContactInfo = { soft: false };
  /** The lowest point of a low landing flare so far (m; Infinity when not in one). */
  private landLow = Infinity;
  /** How far into the landing flare's feet-first pitch (0..1) this step. */
  private landW = 0;

  constructor(breed: BreedStats) {
    this.breed = breed;
    this.derived = deriveFlight(breed);
  }

  setBreed(breed: BreedStats): void {
    this.breed = breed;
    this.derived = deriveFlight(breed);
  }

  /** Place the body. Keeps stamina; clears rates, stall and any beat in progress. */
  reset(position: Vector3, orientation: Quaternion, velocity?: Vector3): void {
    const s = this.state;
    s.position.copy(position);
    s.orientation.copy(orientation).normalize();
    if (velocity) s.velocity.copy(velocity);
    else s.velocity.set(0, 0, this.derived.vCruise).applyQuaternion(s.orientation);
    s.angularVelocity.set(0, 0, 0);
    s.flapPhase = 0;
    s.flapStrength = 0;
    s.wingSpread = 1;
    s.flare = 0;
    s.stall = 0;
    s.airspeed = s.velocity.length();
    s.angleOfAttack = 0;
    s.gLoad = 1;
    s.timeSinceContact = 99;
    this.beatActive = false;
    this.backwingBeat = false;
    this.backwing = 0;
    this.beatStrength = 0;
    this.vDotSmooth = 0;
    this.stallRaw = 0;
    this.sinceStall = 99;
    this.gustRate = 0;
    this.tipUp.l = 0;
    this.tipUp.r = 0;
    this.clearance = Infinity;
    this.clearanceMeasured = -Infinity;
    this.groundTick = 0;
    this.landLow = Infinity;
    this.landW = 0;
    // Listeners saw a stall/tuck start: tell them it's over.
    if (this.stalled) this.bus?.emit('stallEnd', {});
    if (this.tucked) this.bus?.emit('tuckEnd', {});
    this.stalled = false;
    this.tucked = false;
    this.stun = 0;
    this.smoothG = 1;
    this.ground = null;
  }

  /**
   * A few seconds of forgiveness after leaving the ground (takeoff, cliff jump, catch, respawn):
   * the stall can't build and the controls keep a floor of authority while airspeed builds.
   */
  setGrace(seconds: number, untilFlying = false): void {
    this.grace = Math.max(this.grace, seconds);
    this.graceUntilFlying = untilFlying;
    this.graceAge = 0;
  }

  /**
   * How much of a beat the wyvern can put in right now: full until the meter runs dry, then
   * fading to a weak (but never refused) stroke.
   */
  /** Rising air at each wingtip (m/s, left and right; sampled every 4th step), for the animation. */
  get tipUpdraft(): { readonly l: number; readonly r: number } {
    return this.tipUp;
  }

  get effort(): number {
    return lerp(T.weakBeat, 1, smoothstep(0, T.weakBand, this.state.stamina));
  }

  /** Start a wingbeat immediately at the top of the stroke (takeoff leap). Costs stamina. */
  forceBeat(strength: number): boolean {
    const s = this.state;
    this.beatActive = true;
    this.backwingBeat = false;
    this.beatStrength = clamp01(strength) * this.effort;
    s.flapPhase = 0;
    this.sinceBeat = 0;
    this.beats++;
    return true;
  }

  /**
   * Stamina recovery while not simulating flight (standing on the ground). `rate`, when given,
   * is an absolute refill rate (fraction of the meter per second) instead of the breed's regen.
   */
  regenStamina(dt: number, multiplier: number, rate?: number): void {
    const s = this.state;
    this.sinceBeat += dt;
    this.beatActive = false;
    this.backwingBeat = false;
    this.backwing = 0;
    s.winded = false;
    s.flapStrength = damp(s.flapStrength, 0, 4, dt);
    if (this.sinceBeat < T.regenDelay) return;
    s.stamina = clamp01(s.stamina + (rate ?? this.breed.staminaRegen) * multiplier * dt);
  }

  /** True while a committed wingbeat is in progress. */
  get flapping(): boolean {
    return this.beatActive;
  }

  /** 0..1 how hard the wyvern is backwinging against its sink (flaring just above the ground). */
  get backwinging(): number {
    return clamp01(this.backwing / (T.backwingMaxG * GRAVITY));
  }

  /** Seconds of control stun left after a big impact. */
  get stunned(): number {
    return this.stun;
  }

  /** Remaining launch grace (s). */
  get graceLeft(): number {
    return this.grace;
  }

  step(dt: number, input: FlightInput, env: FlightEnvironment, events?: GameEventBus): FlightStepResult {
    const b = this.breed;
    const d = this.derived;
    const s = this.state;
    const r = this.result;
    r.contact = false;
    r.impact = 0;
    r.beatStarted = false;
    r.brush = 0;
    this.bus = events;
    this.dt = dt;
    this.time += dt;
    this.grace = Math.max(0, this.grace - dt);
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    this.brushCooldown = Math.max(0, this.brushCooldown - dt);
    this.sinceStall += dt;
    s.timeSinceContact += dt;
    s.winded = false;

    // --- Controls (a big impact damps them for a moment) ------------------------------------
    this.stun = Math.max(0, this.stun - dt);
    const ctl = 1 - 0.85 * clamp01(this.stun / T.stunTime);
    const pitchIn = clamp(input.pitch, -1, 1) * ctl;
    const rollIn = clamp(input.roll, -1, 1) * ctl;
    const yawIn = clamp(input.yaw, -1, 1) * ctl;
    const flapIn = clamp01(input.flap);
    // A beat wins over a tuck: the wings open for the downstroke, so a tucked dive can end in a
    // strong beat at the bottom (hold both), and fold again once the stroke is done.
    const wantsBeat = flapIn > 0.1;
    const tuckIn = wantsBeat || (this.beatActive && !this.backwingBeat) ? 0 : clamp01(input.tuck);
    const flareIn = clamp01(input.flare) * (1 - tuckIn);

    // --- Body axes and the air-relative velocity --------------------------------------------
    fwd.set(0, 0, 1).applyQuaternion(s.orientation);
    up.set(0, 1, 0).applyQuaternion(s.orientation);
    left.set(1, 0, 0).applyQuaternion(s.orientation);
    env.windAt(s.position, wind);
    this.updraft = damp(this.updraft, wind.y, 1.5, dt);
    airVel.copy(s.velocity).sub(wind);
    const V = airVel.length();
    s.airspeed = V;
    const vf = airVel.dot(fwd);
    const vu = airVel.dot(up);
    const vl = airVel.dot(left);
    const alpha = Math.atan2(-vu, vf);
    const beta = Math.atan2(vl, Math.sqrt(vf * vf + vu * vu));
    s.angleOfAttack = alpha;
    const q = 0.5 * AIR_DENSITY * V * V;
    this.graceAge += dt;
    if (this.graceUntilFlying && this.grace > 0.35 && this.graceAge > 0.8 && V > 1.25 * d.vStall) this.grace = 0.35;

    // Gusts across the span: compare the air rising at each wingtip (every 4th step; the fields
    // are smooth at that scale). A wing lifted by a gust or a thermal's edge rolls away.
    if ((this.gustTick++ & 3) === 0) {
      const reachTip = d.halfSpan * T.gustSpan * (0.35 + 0.65 * s.wingSpread);
      tmp.copy(s.position).addScaledVector(left, reachTip);
      const upL = env.windAt(tmp, tipWind).dot(up);
      tmp.copy(s.position).addScaledVector(left, -reachTip);
      const upR = env.windAt(tmp, tipWind).dot(up);
      this.tipUp.l = upL;
      this.tipUp.r = upR;
      this.gustRate = (T.gustRoll * (17 / (b.mass / b.wingArea)) * (upL - upR)) / Math.max(V, 10);
    }

    // --- Wing configuration -------------------------------------------------------------------
    const spreadTarget = 1 - (1 - T.tuckedSpread) * tuckIn;
    // Folding is quicker than opening against the airflow.
    s.wingSpread = damp(s.wingSpread, spreadTarget, spreadTarget < s.wingSpread ? 9 : 5, dt);
    s.flare = damp(s.flare, flareIn, 5, dt);
    if (!this.tucked && tuckIn > 0.5) {
      this.tucked = true;
      events?.emit('tuckStart', {});
    } else if (this.tucked && tuckIn < 0.3) {
      this.tucked = false;
      events?.emit('tuckEnd', {});
    }
    const sf = T.areaAtZeroSpread + (1 - T.areaAtZeroSpread) * s.wingSpread;
    const area = b.wingArea * sf;

    // --- Ground effect --------------------------------------------------------------------------
    // One conservative distance serves the ground lookup and the collision test. Far from
    // everything it needn't be re-measured every step, and the ground below barely matters.
    this.clearanceAge += dt;
    let clear = this.clearanceMeasured - s.position.distanceTo(this.clearanceAt);
    if (clear < T.clearanceRemeasure || this.clearanceAge > T.clearanceMaxAge) {
      clear = env.terrain.distance(s.position);
      this.clearanceMeasured = clear;
      this.clearanceAt.copy(s.position);
      this.clearanceAge = 0;
    }
    this.clearance = clear;
    const groundEvery = clear < T.groundQueryNear ? 0 : clear < T.groundQueryRange ? 3 : 7;
    if ((this.groundTick++ & groundEvery) === 0) {
      this.ground = env.terrain.groundAt(s.position.x, s.position.z, s.position.y);
    }
    let geInduced = 1;
    let geLift = 0;
    if (this.ground) {
      // Classic (16h/b)² / (1 + (16h/b)²) induced-drag factor, using the wing's height.
      const h = Math.max(0.1, s.position.y - this.ground.y);
      const x = (16 * h) / b.wingspan;
      geInduced = (x * x) / (1 + x * x);
      geLift = T.groundEffectLift * (1 - geInduced);
    }

    // A low landing flare: the feet-first pitch (rotate) and the cap on its zoom (below).
    this.landW = 0;
    if (s.flare > 0.3 && this.ground) {
      const feet = s.position.y - this.ground.y - b.standHeight;
      this.landW = smoothstep(0.3, 0.6, s.flare) * smoothstep(T.landPitchFrom * b.standHeight, T.landPitchFull * b.standHeight, feet);
      this.landLow = feet < T.backwingHeight ? Math.min(this.landLow, s.position.y) : Infinity;
    } else this.landLow = Infinity;

    // --- Lift coefficient and stall -----------------------------------------------------------
    const aw = alpha + T.incidence;
    const clAttached = softClamp(b.liftSlope * aw, -b.clMax * 0.65, b.clMax);
    // Separated flow behaves like a flat plate.
    const clSeparated = 0.9 * Math.sin(2 * aw);
    const reattach = T.stallHysteresis * smoothstep(0.15, 0.45, this.stallRaw);
    const stallAngle = (aw >= 0 ? b.stallAngle : b.stallAngle * 0.75) - reattach;
    let drive = clamp01((Math.abs(aw) - stallAngle) / T.stallBand);
    // Too slow to fly: the wing can't hold the body up and the flow lets go. Beating the wings
    // keeps the flow attached a little longer, but not at a near-standstill.
    const slowEdge = s.flapStrength < 0.3 ? T.slowStall : T.slowStallFlapping;
    if (V < d.vStall * slowEdge) {
      const critical = aw >= 0 ? b.stallAngle : b.stallAngle * 0.75;
      // ...though at a near standstill (the top of a vertical zoom) nothing holds it.
      const loaded = Math.max(smoothstep(critical - T.slowStallAlpha, critical - 1 * DEG, Math.abs(aw)), smoothstep(0.75 * d.vStall, 0.4 * d.vStall, V));
      drive = Math.max(drive, clamp01((d.vStall * slowEdge - V) / (d.vStall * T.slowStallBand)) * loaded);
    }
    if (this.grace > 0) drive *= 1 - smoothstep(0, 0.6, this.grace);
    this.stallRaw = damp(this.stallRaw, drive, drive > this.stallRaw ? T.stallRise : T.stallFall, dt);
    // A flare is a deliberate stall: the lift still collapses but the wyvern stays composed.
    s.stall = this.stallRaw * (1 - s.flare);
    const cl = lerp(clAttached, clSeparated, this.stallRaw) * (1 + geLift);
    if (!this.stalled && s.stall > 0.5) {
      this.stalled = true;
      this.stallCount++;
      // The wing that is already dropping (or the one the yaw is swinging back) lets go first;
      // with no hint, alternate so the tendency is deterministic but not always the same side.
      const w = s.angularVelocity;
      const hint = w.z * 2 - w.y + beta;
      this.wingDropSign = Math.abs(hint) > 0.02 ? Math.sign(hint) : this.stallCount % 2 === 0 ? 1 : -1;
      events?.emit('stallStart', {});
    } else if (this.stalled && s.stall < 0.2) {
      this.stalled = false;
      this.sinceStall = 0;
      events?.emit('stallEnd', {});
    }

    // --- Aerodynamic forces -------------------------------------------------------------------
    force.set(0, -d.weight, 0);
    if (V > 0.2) {
      vhat.copy(airVel).multiplyScalar(1 / V);
      liftDir.crossVectors(vhat, left);
      const ll = liftDir.length();
      if (ll > 1e-4) force.addScaledVector(liftDir, (q * area * cl) / ll);
      const sinB = Math.sin(beta);
      // Spread membrane flutters at dive speeds (none at cruise, so the glide is untouched).
      const flutter = T.cdFlutter * smoothstep(0.6, 1, s.wingSpread) * smoothstep(T.flutterFrom * d.vCruise, T.flutterTo * d.vCruise, V);
      const dragArea =
        d.bodyCdA * (1 + 2 * sinB * sinB) +
        b.wingArea * (b.cd0 * sf + T.cdFolded * (1 - s.wingSpread) + T.cdFlare * s.flare + flutter + Math.abs(yawIn) * T.rudderDrag * b.cd0) +
        area * (b.inducedK * geInduced * cl * cl + T.cdStall * this.stallRaw);
      force.addScaledVector(vhat, -q * dragArea);
      // Sideslip pushes the body sideways (the keel effect).
      force.addScaledVector(left, -q * b.wingArea * T.sideArea * sinB);
      // Rudder: the tail swings the path itself into a flat, skidding turn (+yaw = right = −left).
      if (yawIn !== 0) force.addScaledVector(left, -yawIn * b.mass * T.rudderAccel * clamp(q / d.qRef, 0.3, 1.5));
    }
    // The flight path's curvature from aerodynamics + gravity only (flap pulses are left out so
    // the nose doesn't bob with every beat; the α loop absorbs them).
    aeroAcc.copy(force).multiplyScalar(1 / b.mass);

    // --- Backwinging: flaring just above the ground, the wings beat against the sink --------
    this.backwing = 0;
    if (s.flare > 0.3 && this.ground) {
      const h = s.position.y - this.ground.y - b.standHeight;
      const sink = -s.velocity.y;
      if (h < T.backwingHeight && sink > T.backwingFreeSink) {
        this.backwing = Math.min((sink - T.backwingFreeSink) * T.backwingGain, T.backwingMaxG * GRAVITY) * s.flare * this.effort;
      }
    }
    if (this.backwing > 0) {
      force.y += b.mass * this.backwing;
      s.stamina = Math.max(0, s.stamina - (T.backwingCost * this.backwinging * dt) / (b.staminaSeconds * this.capacity));
      this.sinceBeat = 0;
    }

    // --- Flapping: committed strokes ---------------------------------------------------------
    // A press starts the downstroke at once (the wings rise from the glide as they begin to drive
    // down, so there is no wind-up delay); the 'flap' event marks the bottom of the stroke.
    this.sinceBeat += dt;
    let strokeF = 0;
    const down = b.downFrac ?? DEFAULT_DOWN_FRAC;
    const wantsBackwing = this.backwinging > 0.2;
    if (!this.beatActive && (wantsBeat || wantsBackwing)) {
      this.beatActive = true;
      this.backwingBeat = !wantsBeat;
      this.beatStrength = wantsBeat ? flapIn * this.effort : this.backwinging;
      s.flapPhase = 0;
      if (wantsBeat) {
        this.beats++;
        r.beatStarted = true;
      }
    }
    if (this.beatActive) {
      const prev = s.flapPhase;
      // Backwing strokes are short and quick; real ones follow the breed's rhythm.
      s.flapPhase += b.flapRate * (this.backwingBeat ? 1.4 : 1) * dt;
      // Pressing harder mid-downstroke deepens the beat; easing off doesn't cancel it.
      if (s.flapPhase < down && !this.backwingBeat) this.beatStrength = Math.max(this.beatStrength, flapIn * this.effort);
      if (prev < down && s.flapPhase >= down) {
        events?.emit('flap', { strength: this.beatStrength, position: s.position.clone() });
      }
      if (s.flapPhase >= 1) {
        s.flapPhase -= 1;
        if (wantsBeat) {
          this.backwingBeat = false;
          this.beatStrength = flapIn * this.effort;
          this.beats++;
          r.beatStarted = true;
        } else if (wantsBackwing) {
          this.backwingBeat = true;
          this.beatStrength = this.backwinging;
        } else {
          this.beatActive = false;
          this.backwingBeat = false;
          s.flapPhase = 0;
        }
      }
      if (this.beatActive && !this.backwingBeat) {
        strokeF = strokeForce(s.flapPhase, down) * this.beatStrength;
        s.stamina = Math.max(0, s.stamina - (this.beatStrength * dt) / (b.staminaSeconds * this.capacity));
        this.sinceBeat = 0;
      }
    }
    const graceT = smoothstep(0, 0.5, this.grace);
    const speed01 = clamp01(V / d.vCruise);
    const liftScale = Math.max(lerp(T.flapLiftAtRest, 1, speed01), lerp(T.flapLiftLaunch, 1, speed01) * graceT);
    const spreadLift = 0.35 + 0.65 * s.wingSpread;
    // The sin² downstroke averages half its peak over the downstroke, down/2 over a whole beat.
    this.flapLiftMean = this.beatActive && !this.backwingBeat ? 0.5 * down * b.flapLift * this.beatStrength * spreadLift * liftScale : 0;
    if (strokeF !== 0) {
      const slow = lerp(T.flapSlowThrust, 1, Math.max(graceT, speed01));
      const thrustFade = slow * clamp01(1 - Math.max(0, vf) / d.vFlapMax);
      const thrust = b.flapThrust * Math.max(0, strokeF) * thrustFade * lerp(1, T.launchThrust, graceT);
      // Stroke plane tilted up: thrust along forward-and-up, lift along the body's up.
      force.addScaledVector(fwd, thrust * Math.cos(T.flapTiltUp)).addScaledVector(up, thrust * Math.sin(T.flapTiltUp));
      const flapLift = b.flapLift * strokeF * liftScale * spreadLift;
      force.addScaledVector(up, flapLift);
    }
    if (!this.beatActive && this.sinceBeat > T.regenDelay) {
      // Gliding gets the breath back; rising air (a thermal, a ridge) is more restful still.
      const rising = smoothstep(T.thermalRegenFrom, T.thermalRegenFull, this.updraft);
      s.stamina = clamp01(s.stamina + b.staminaRegen * this.regenMultiplier * (1 + T.thermalRegen * rising) * dt);
    }
    s.flapStrength = damp(s.flapStrength, this.beatActive ? this.beatStrength : 0, this.beatActive ? 10 : 3, dt);

    // No balloon: above the cap the flared wings spill lift rather than zoom the wyvern up.
    if (this.landLow < Infinity && s.position.y > this.landLow + 0.5 * T.zoomCap && s.velocity.y > 0) {
      force.y -= b.mass * T.zoomSpill * s.velocity.y;
    }

    // --- Linear integration ---------------------------------------------------------------------
    // Along-path acceleration, smoothed over a beat, for the phugoid damper.
    if (V > 0.5) this.vDotSmooth = damp(this.vDotSmooth, force.dot(airVel) / (V * b.mass), 2.5, dt);
    s.velocity.addScaledVector(force, dt / b.mass);
    // Felt load factor: everything but gravity, along the body's up axis.
    const nRaw = (force.y + d.weight) * up.y + force.x * up.x + force.z * up.z;
    this.smoothG = damp(this.smoothG, nRaw / d.weight, 12, dt);
    s.gLoad = this.smoothG;

    // --- Rotation: rate targets chased with limited authority ------------------------------
    this.rotate(dt, V, q, alpha, beta, pitchIn, rollIn, yawIn, area);

    // --- Position and terrain ---------------------------------------------------------------
    prevPos.copy(s.position);
    s.position.addScaledVector(s.velocity, dt);
    this.collide(env, events);
    return r;
  }

  private rotate(
    dt: number,
    V: number,
    q: number,
    alpha: number,
    beta: number,
    pitchIn: number,
    rollIn: number,
    yawIn: number,
    area: number,
  ): void {
    const b = this.breed;
    const d = this.derived;
    const s = this.state;
    const w = s.angularVelocity;
    invQ.copy(s.orientation).invert();

    // Angular velocity of the flight path itself (world → body frame): the rate the body needs
    // just to keep its nose on the airflow.
    pathRate.set(0, 0, 0);
    if (V > 1) {
      pathRate.crossVectors(airVel, aeroAcc).multiplyScalar(1 / (V * V));
      pathRate.applyQuaternion(invQ);
    }

    // Pitch: the commanded angle of attack. Hands-off trim gets gentler with speed so a dive
    // doesn't end in a violent pull-up, and a slow wyvern lowers its nose on its own.
    const qSafe = Math.max(q, 1);
    const clBase = d.clCruise * lerp(1, T.climbTrim, clamp01(s.flapStrength / 0.7));
    const qBase = (d.qCruise * d.clCruise) / clBase;
    let clTrim = qSafe > qBase ? Math.max(0.05, clBase * Math.pow(qBase / qSafe, T.trimExponent)) : clBase;
    // While beating, the wing needn't carry what the stroke already lifts, so flapping turns into
    // climb at cruise speed rather than a zoom that runs out of air. Not when slow: then every
    // newton of lift is welcome.
    const comp = smoothstep(d.vStall * 0.6, d.vStall, V) * (1 - smoothstep(0, 0.5, this.grace));
    if (comp > 0) clTrim = Math.max(0.05, clTrim - (comp * this.flapLiftMean) / (qSafe * area));
    // Out of a stall, hands-off flies out firmly: the trim asks for a solid pull (capped in g)
    // so the nose comes back up as soon as the flow is attached, instead of hanging in a dive.
    if (this.stalled || this.sinceStall < T.recoverTime) {
      clTrim = Math.max(clTrim, Math.min(T.recoverCl * b.clMax, (T.recoverN * d.weight) / (qSafe * area)));
    }
    let alphaTrim = clTrim / b.liftSlope - T.incidence;
    // Phugoid damper: hands-off only. With the stick held the player is flying (and may well
    // want to loop), so it fades out by about a third of the travel.
    const handsOff = 1 - smoothstep(0.05, 0.35, Math.abs(pitchIn));
    if (V > 2) {
      const dn = T.phugoidDamp * clamp(this.vDotSmooth / GRAVITY, -1, 1) * handsOff;
      alphaTrim += (dn * d.weight) / (qSafe * area * b.liftSlope);
    }
    // Stick adds a fixed α offset on top of trim (so at a held stick, lift still grows with
    // speed: speed-stable), capped just short of the stall until the last of the travel.
    const alphaCruise = d.clCruise / b.liftSlope - T.incidence;
    const alphaEdge = b.stallAngle - 0.5 * DEG - T.incidence;
    const alphaMax = b.stallAngle + T.alphaOverStall - T.incidence;
    let alphaCmd: number;
    if (pitchIn >= 0) {
      const pull = Math.min(pitchIn / T.stallStick, 1);
      alphaCmd = Math.min(alphaTrim + pull * (alphaEdge - alphaCruise), Math.max(alphaEdge, alphaTrim));
      if (pitchIn > T.stallStick) alphaCmd = lerp(alphaCmd, alphaMax, (pitchIn - T.stallStick) / (1 - T.stallStick));
      // Soft stall protection: as the airspeed bleeds toward the stall a held pull is eased back
      // short of the critical angle, so the wyvern mushes (nose high, sinking) instead of
      // breaking the stall.
      const protect = T.stallProtect * smoothstep(T.protectFrom * d.vStall, T.protectTo * d.vStall, V) * (1 - s.flare);
      if (protect > 0) alphaCmd = lerp(alphaCmd, Math.min(alphaCmd, Math.max(alphaTrim, alphaEdge - T.protectMargin)), protect);
      // Zoom limiter: hauling back in a steep, unpowered climb as the speed runs out, the pull
      // eases to less lift than the climb needs, so the path tops out and the wyvern floats over
      // into a dive instead of hanging until the air runs out. (A big zoom from dive speeds, or
      // coasting straight up, still ends in a stall.)
      const climb = airVel.y / Math.max(V, 1);
      const zoom =
        smoothstep(T.zoomFrom * d.vStall, T.protectTo * d.vStall, V) *
        smoothstep(0.15, 0.45, climb) *
        smoothstep(0.05, 0.5, pitchIn) *
        (1 - clamp01(s.flapStrength / 0.5)) *
        (1 - s.flare);
      if (zoom > 0) {
        const nOver = Math.sqrt(Math.max(0, 1 - climb * climb)) * T.zoomLoad;
        alphaCmd = lerp(alphaCmd, Math.min(alphaCmd, (nOver * d.weight) / (qSafe * area * b.liftSlope) - T.incidence), zoom);
      }
    } else {
      // Forward stick asks for a load factor between trim and nMin (not a fixed α offset, which
      // would steepen a dive into a bunt as speed builds).
      const kq = (qSafe * area * b.liftSlope) / d.weight;
      const nTrim = (alphaTrim + T.incidence) * kq;
      alphaCmd = Math.max(lerp(nTrim, T.nMin, -pitchIn) / kq - T.incidence, T.alphaMin * 1.5);
    }
    alphaCmd = lerp(alphaCmd, T.flareAlpha, s.flare);
    // Load-factor limit: never ask the wing for more lift than the wyvern will pull.
    const nMax = lerp(d.nMax, T.nMaxFlare, s.flare);
    const alphaLimHi = (nMax * d.weight) / (qSafe * area * b.liftSlope) - T.incidence;
    const alphaLimLo = (T.nMin * d.weight) / (qSafe * area * b.liftSlope) - T.incidence;
    alphaCmd = clamp(alphaCmd, Math.min(alphaLimLo, alphaTrim), Math.max(alphaLimHi, alphaTrim));
    // Positive body x is nose-down: to raise α the nose must come up (negative x).
    const pathX = Math.abs(pathRate.x);
    let wx = clamp(pathRate.x - T.alphaGain * (alphaCmd - alpha), -d.maxPitchRate - pathX, d.maxPitchRate + pathX);
    // The climb-out attitude hold lasts until there's speed to spare.
    const beating = (this.beatActive && !this.backwingBeat) || s.flapStrength > 0.3;
    const slowTop = T.climbOutSpeed * d.vStall;
    // Only while beating: a slow glider (a cliff jump, a stall) weathervanes down the airflow
    // to build speed, and a pull at low speed stalls.
    const slow = beating && !this.backwingBeat ? 1 - smoothstep(0.45 * d.vStall, slowTop, V) : 0;
    if (slow > 0) {
      const theta = Math.asin(clamp(fwd.y, -1, 1));
      const thetaTarget = T.slowClimbAttitude + pitchIn * T.slowStickAttitude;
      const wxAttitude = clamp(-T.attitudeGain * (thetaTarget - theta), -d.maxPitchRate, d.maxPitchRate);
      wx = lerp(wx, wxAttitude, slow);
    }

    // A low landing flare pitches the body up toward the feet-first attitude (the flight path
    // falls away below it: the wings brake in a deep stall, the hind feet reach down first).
    if (this.landW > 0) {
      const theta = Math.asin(clamp(fwd.y, -1, 1));
      const wxLand = clamp(-T.attitudeGain * (T.landPitch - theta), -d.maxPitchRate, d.maxPitchRate);
      wx = lerp(wx, wxLand, this.landW);
    }

    // Yaw: follow the path, swing the nose into the relative wind, plus rudder.
    const wy = pathRate.y + T.betaGain * beta - yawIn * d.maxYawRate;

    // Roll: stick sets a roll rate about the flight path (a stability-axis roll, so a roll at
    // high α doesn't fling the nose sideways). Centered stick: a subtle drift back to level.
    // The rudder leans the wyvern into its flat turn, and a gust across the span rocks it.
    let wz = rollIn * b.maxRollRate + yawIn * T.rudderRoll + this.gustRate;
    this.rollRest = Math.abs(rollIn) < 0.1 ? this.rollRest + dt : 0;
    const centered = smoothstep(T.autoLevelDelay, T.autoLevelDelay + 0.8, this.rollRest);
    if (centered > 0) {
      const bank = Math.atan2(left.y, up.y);
      wz += centered * clamp(-T.autoLevelGain * bank, -T.autoLevelMaxRate, T.autoLevelMaxRate);
    }
    target.set(wx, wy, 0);
    if (V > 1) {
      // Body-frame unit airflow direction: (vl, vu, vf) / V.
      tmp.set(airVel.dot(left), airVel.dot(up), airVel.dot(fwd)).multiplyScalar(1 / V);
      if (tmp.z < 0.2) tmp.set(0, 0, 1);
      target.addScaledVector(tmp, wz);
    } else {
      target.z += wz;
    }

    // Authority: proportional to dynamic pressure, with a floor while beating the wings (the
    // stroke makes its own airflow over the wing) and during the launch grace.
    let auth = clamp(q / d.qRef, T.authorityMin, T.authorityMax);
    auth = Math.max(auth, 0.5 * s.flapStrength, this.grace > 0 ? 0.45 : 0, T.landAuthority * this.landW);
    const rollAuth = auth * (0.55 + 0.45 * s.wingSpread) * (1 - 0.55 * s.stall);
    const gain = b.angularDamping * T.trackGainScale;
    w.x += clamp((target.x - w.x) * gain, -b.pitchAuthority * auth, b.pitchAuthority * auth) * dt;
    w.y += clamp((target.y - w.y) * gain, -b.yawAuthority * auth, b.yawAuthority * auth) * dt;
    // Rolling in takes the breed's muscle; stopping a roll gets more of it (`rollBrake`), so the
    // bank settles where it was put rather than wallowing on past it.
    const dz = target.z - w.z;
    const braking = w.z * dz < 0 && Math.abs(w.z) > 0.02 ? T.rollBrake : 1;
    const rollLim = b.rollAuthority * rollAuth * braking;
    w.z += clamp(dz * gain * Math.min(braking, 1.6), -rollLim, rollLim) * dt;

    // Stall: the nose drops (gravity, not muscle, so no authority limit), a wing lets go, and
    // the airframe buffets. All deterministic.
    const st = s.stall;
    if (st > 0.01) {
      const sign = Math.sign(alpha + T.incidence) || 1;
      if (sign * w.x < T.noseDropRate) w.x += sign * T.noseDropAccel * st * dt;
      // A wing lets go and the wyvern rolls toward it, up to a lazy rate (a wing drop, not a spin).
      if (this.wingDropSign * w.z < T.wingDropRate) w.z += this.wingDropSign * T.wingDropAccel * st * st * dt;
      const t = this.time;
      const buffet = T.buffetAccel * st * (Math.sin(t * 37.3) * 0.6 + Math.sin(t * 23.1 + 1.7) * 0.4);
      w.x += buffet * dt;
      w.z += buffet * 0.7 * Math.sin(t * 17.9) * dt;
    }
    // Keep rates sane whatever happens.
    w.clampLength(0, 6);

    const rate = w.length();
    if (rate * dt > 1e-9) {
      tmp2.copy(w).multiplyScalar(1 / rate);
      dq.setFromAxisAngle(tmp2, rate * dt);
      s.orientation.multiply(dq).normalize();
    }
  }

  /** Body sphere (swept) + wingtip probes against the terrain, structures and foliage. */
  private collide(env: FlightEnvironment, events?: GameEventBus): void {
    const s = this.state;
    const d = this.derived;
    const r = this.result;
    const move = prevPos.distanceTo(s.position);
    const reach = d.halfSpan + d.bodyRadius + move + 1.5;
    // The clearance was measured at the start of the step; the body has moved `move` since.
    if (this.clearance - move > reach) return;
    const info = this.contactInfo;
    brushN.set(0, 0, 0);

    // Body: sweep so even a 90 m/s dive can't step through a thin rim or a wall. Foliage doesn't
    // stop the sweep (the body pushes through it); it is brushed at the end of the move.
    const R = d.bodyRadius;
    const n = Math.min(8, Math.max(1, Math.ceil(move / (R * 0.5))));
    let solid = false;
    for (let i = 1; i <= n; i++) {
      probe.lerpVectors(prevPos, s.position, i / n);
      if (env.terrain.collideSphere(probe, R, push, nrm, info) && !info.soft) {
        s.position.copy(probe).add(push);
        this.respond(nrm, 1, events);
        solid = true;
        break;
      }
    }
    if (!solid && env.terrain.collideSphere(s.position, R, push, nrm, info) && info.soft) {
      // Not pushed back out (leaves don't hold a dragon up): slowed and nudged instead.
      this.brush(nrm, push.length() / (R * SOFT_PUSH), 1);
    }

    // Wingtips: only while the wings are out.
    if (s.wingSpread > 0.45) {
      left.set(1, 0, 0).applyQuaternion(s.orientation);
      const reachTip = d.halfSpan * T.tipSpanFactor * s.wingSpread;
      for (let side = 1; side >= -1; side -= 2) {
        probe.copy(s.position).addScaledVector(left, side * reachTip);
        if (!env.terrain.collideSphere(probe, T.tipRadius, push, nrm, info)) continue;
        const w = s.angularVelocity;
        if (info.soft) {
          // A wing dragging through leaves: a little drag on that side swings the nose toward it.
          const depth = push.length() / (T.tipRadius * SOFT_PUSH);
          this.brush(nrm, depth, 0.4);
          w.y = clamp(w.y + side * 0.06 * clamp01(depth), -2, 2);
          continue;
        }
        // Most of the correction moves the body; the rest is absorbed by the wing folding back.
        s.position.addScaledVector(push, 0.75);
        this.respond(nrm, 0.5, events);
        // Yaw away from the side that hit (+y yaws left) and roll away, lifting that wing
        // (+z banks right, which lifts the left wing).
        w.y = clamp(w.y - side * 0.12, -2, 2);
        w.z = clamp(w.z + side * 0.08, -3, 3);
      }
    }
    this.applyBrush(events);
    if (r.contact) s.timeSinceContact = 0;
  }

  /**
   * Brushing through foliage (`depth` 0..1 of the probe buried, `weight` for a wingtip): noted
   * here and applied once per step by applyBrush (the body and a wing in the same tree don't
   * double the drag).
   */
  private brush(n: Vector3, depth: number, weight: number): void {
    const k = clamp01(depth) * weight;
    if (k <= 0) return;
    brushN.addScaledVector(n, k);
    this.result.brush = Math.max(this.result.brush, k);
  }

  /** Drag and a gentle push out of foliage, no bounce, no stun; reported for leaves and rustling. */
  private applyBrush(events?: GameEventBus): void {
    const k = this.result.brush;
    if (k <= 0) return;
    const s = this.state;
    const dt = this.dt;
    s.velocity.multiplyScalar(Math.exp(-T.brushDrag * k * dt));
    if (brushN.lengthSq() > 1e-8) s.velocity.addScaledVector(brushN.normalize(), T.brushPush * k * dt);
    if (this.brushCooldown <= 0) {
      this.brushCooldown = T.brushEventGap;
      events?.emit('foliageBrush', { position: s.position.clone(), speed: s.velocity.length() });
    }
  }

  /** Velocity response to a contact with normal n. `weight` scales friction (tips scrape less). */
  private respond(n: Vector3, weight: number, events?: GameEventBus): void {
    const s = this.state;
    const r = this.result;
    const v = s.velocity;
    const speedBefore = v.length();
    const vn = v.dot(n);
    let impact = 0;
    if (vn < 0) {
      impact = -vn;
      const e = impact > T.stunImpact ? 0.3 : T.restitution;
      v.addScaledVector(n, -vn * (1 + e * weight));
    }
    // Scrape: Coulomb-ish friction from the impact plus a steady rub.
    tmp.copy(v).addScaledVector(n, -v.dot(n));
    const vt = tmp.length();
    if (vt > 1e-3) {
      const loss = Math.min(vt, (T.scrapeFriction * impact + T.scrapeDecel * this.dt) * weight);
      v.addScaledVector(tmp, -loss / vt);
    }
    const lost = Math.max(0, speedBefore - v.length());
    r.contact = true;
    r.contactNormal.copy(n);
    r.impact = Math.max(r.impact, impact);
    if (impact > T.stunImpact) {
      this.stun = T.stunTime;
      // A little tumble about the axis between the surface and the direction of travel.
      tmp.crossVectors(n, v);
      if (tmp.lengthSq() > 1e-6) {
        tmp.normalize().applyQuaternion(invQ.copy(s.orientation).invert());
        s.angularVelocity.addScaledVector(tmp, Math.min(2.5, impact * 0.08));
      }
    }
    if (impact > T.hitEventMin && this.hitCooldown <= 0) {
      this.hitCooldown = 0.25;
      events?.emit('terrainHit', { impulse: Math.max(lost, impact), point: s.position.clone(), normal: n.clone() });
    }
  }
}
