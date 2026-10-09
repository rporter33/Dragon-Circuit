// Per-breed body plans. Everything the model builder and the animator need to know about a
// breed's shape lives here as plain numbers, so it can be unit-tested without WebGL.
//
// The two numbers the rest of the game relies on are honored exactly:
//   - BreedStats.wingspan is the tip-to-tip distance of the fully spread (bind) pose: the arm and
//     finger lengths are scaled from ratios until the wingtips land there.
//   - BreedStats.standHeight: the legs are sized so that, in the natural standing pose with the
//     body center that high, the soles of the feet rest on the ground.
//
// Body frame (see core/types.ts): +Z forward, +Y up, +X left. The origin is the body center.

import type { BreedId } from '../../core/types';
import { BREEDS } from '../../flight/breeds';
import { DEG } from '../../core/math';

export interface WingShape {
  /** Bone length ratios of one arm "unit" (solved per breed so the span comes out right). */
  humerus: number;
  forearm: number;
  hand: number;
  /** Finger segment ratios [proximal, distal]: finger 0 forms the wingtip, 2 is innermost. */
  fingers: [number, number][];
  /** Bind-pose azimuths (radians, measured from +X toward +Z: negative = swept back). */
  azHumerus: number;
  azForearm: number;
  azHand: number;
  azFingers: number[];
  /** Where the inner trailing edge meets the flank, as a fraction of torso length (− = back). */
  trailZ: number;
  /** Depth of the scalloped trailing edge between finger tips (fraction of the gap). */
  scallop: number;
}

export interface BreedShape {
  torsoLength: number;
  torsoHalfWidth: number;
  torsoHalfHeight: number;
  /** Extra depth of the chest keel below the torso (m). */
  keel: number;
  neckLength: number;
  neckBaseRadius: number;
  neckTopRadius: number;
  /** Bind-pose rise of the neck above horizontal (radians). */
  neckRise: number;
  headLength: number;
  headHalfWidth: number;
  headHalfHeight: number;
  tailLength: number;
  tailBaseRadius: number;
  /** Shoulder joint: x as a fraction of torso half-width, y of half-height, z of torso length. */
  shoulder: [number, number, number];
  hip: [number, number, number];
  wing: WingShape;
  /** Bind-pose leg angles from vertical (radians, + = the lower end forward). */
  legAngles: LegAngles;
  /** Leg ratios; the leg unit is solved from standHeight. */
  thigh: number;
  shin: number;
  meta: number;
  /** Toe length as a fraction of the leg unit. */
  toe: number;
  /** Thigh radius at the hip (m). */
  thighRadius: number;
  /** Extra girth of the arm, hand and digits (the heavy-boned breed); 1 = none. */
  armBulk?: number;
  /** Eye radius as a fraction of head length. */
  eye: number;
  /** Overlapping armor plates down the back (ironback). */
  plates: boolean;
}

export interface LegAngles {
  thigh: number;
  shin: number;
  /** The metatarsus: steep on a runner, near flat on the plantigrade-leaning ironback. */
  meta: number;
}

/**
 * Bind-pose leg angles from vertical (radians, + = the lower end forward) of the default
 * (harrier) leg. Each breed has its own in BreedShape.legAngles, which the leg IK should read.
 */
export const LEG_ANGLES: Readonly<LegAngles> = { thigh: 30 * DEG, shin: -40 * DEG, meta: 24 * DEG };

const W = (w: Partial<WingShape>): WingShape => ({
  humerus: 0.22,
  forearm: 0.36,
  hand: 0.075,
  fingers: [
    [0.235, 0.2],
    [0.225, 0.19],
    [0.205, 0.175],
  ],
  azHumerus: -16 * DEG,
  azForearm: 14 * DEG,
  azHand: -4 * DEG,
  azFingers: [-10 * DEG, -47 * DEG, -86 * DEG],
  trailZ: -0.52,
  scallop: 0.16,
  ...w,
});

export const BREED_SHAPES: Record<BreedId, BreedShape> = {
  harrier: {
    torsoLength: 3.6,
    torsoHalfWidth: 0.8,
    torsoHalfHeight: 0.92,
    keel: 0.34,
    neckLength: 2.25,
    neckBaseRadius: 0.7,
    neckTopRadius: 0.38,
    neckRise: 28 * DEG,
    headLength: 1.32,
    headHalfWidth: 0.44,
    headHalfHeight: 0.42,
    tailLength: 4.4,
    tailBaseRadius: 0.62,
    shoulder: [0.62, 0.28, 0.3],
    hip: [0.74, -0.3, -0.33],
    wing: W({}),
    legAngles: { ...LEG_ANGLES },
    thigh: 0.36,
    shin: 0.38,
    meta: 0.26,
    toe: 0.2,
    thighRadius: 0.52,
    eye: 0.095,
    plates: false,
  },
  skimmer: {
    torsoLength: 2.3,
    torsoHalfWidth: 0.54,
    torsoHalfHeight: 0.62,
    keel: 0.2,
    neckLength: 1.9,
    neckBaseRadius: 0.46,
    neckTopRadius: 0.28,
    neckRise: 30 * DEG,
    headLength: 1.12,
    headHalfWidth: 0.35,
    headHalfHeight: 0.33,
    tailLength: 3.2,
    tailBaseRadius: 0.44,
    shoulder: [0.62, 0.28, 0.3],
    hip: [0.74, -0.3, -0.33],
    // A sprinter's broad, rounded bat-like hand-wing: short, even fingers fanned wide.
    wing: W({
      fingers: [
        [0.2, 0.17],
        [0.2, 0.17],
        [0.19, 0.16],
      ],
      azFingers: [-4 * DEG, -34 * DEG, -68 * DEG],
      scallop: 0.24,
      trailZ: -0.6,
    }),
    legAngles: { ...LEG_ANGLES },
    thigh: 0.36,
    shin: 0.4,
    meta: 0.33,
    toe: 0.22,
    thighRadius: 0.33,
    eye: 0.12,
    plates: false,
  },
  galewing: {
    torsoLength: 3.1,
    torsoHalfWidth: 0.58,
    torsoHalfHeight: 0.68,
    keel: 0.26,
    neckLength: 2.8,
    neckBaseRadius: 0.5,
    neckTopRadius: 0.29,
    neckRise: 24 * DEG,
    headLength: 1.45,
    headHalfWidth: 0.31,
    headHalfHeight: 0.34,
    tailLength: 4.5,
    tailBaseRadius: 0.44,
    shoulder: [0.62, 0.3, 0.3],
    hip: [0.74, -0.3, -0.33],
    wing: W({
      humerus: 0.18,
      forearm: 0.3,
      hand: 0.07,
      fingers: [
        [0.29, 0.25],
        [0.17, 0.14],
        [0.12, 0.1],
      ],
      azHumerus: -12 * DEG,
      azForearm: 10 * DEG,
      azFingers: [-6 * DEG, -32 * DEG, -66 * DEG],
      trailZ: -0.3,
      scallop: 0.12,
    }),
    legAngles: { ...LEG_ANGLES },
    thigh: 0.36,
    shin: 0.38,
    meta: 0.26,
    toe: 0.19,
    thighRadius: 0.36,
    eye: 0.098,
    plates: false,
  },
  ironback: {
    torsoLength: 3.8,
    torsoHalfWidth: 1.1,
    torsoHalfHeight: 1.16,
    keel: 0.42,
    neckLength: 2.0,
    neckBaseRadius: 0.9,
    neckTopRadius: 0.52,
    neckRise: 20 * DEG,
    headLength: 1.55,
    headHalfWidth: 0.66,
    headHalfHeight: 0.54,
    tailLength: 4.0,
    tailBaseRadius: 0.84,
    shoulder: [0.6, 0.26, 0.3],
    hip: [0.8, -0.28, -0.32],
    // A short, broad, heavy wing: the fingers swept back, a shallow trailing edge.
    wing: W({
      humerus: 0.23,
      forearm: 0.35,
      fingers: [
        [0.22, 0.19],
        [0.21, 0.18],
        [0.19, 0.16],
      ],
      azFingers: [-12 * DEG, -44 * DEG, -80 * DEG],
      trailZ: -0.6,
      scallop: 0.1,
    }),
    legAngles: { ...LEG_ANGLES, meta: 50 * DEG },
    thigh: 0.36,
    shin: 0.37,
    meta: 0.19,
    toe: 0.2,
    thighRadius: 0.7,
    armBulk: 1.25,
    eye: 0.078,
    plates: true,
  },
};

export interface ArmLengths {
  humerus: number;
  forearm: number;
  hand: number;
  fingers: [number, number][];
}

export interface LegLengths {
  thigh: number;
  shin: number;
  meta: number;
  toe: number;
  /** Ground clearance of the ankle-ball joint: the sole thickness under the toes (m). */
  sole: number;
}

export interface WyvernProportions {
  breed: BreedId;
  shape: BreedShape;
  standHeight: number;
  wingspan: number;
  /** Left shoulder joint (body space); the right one mirrors x. */
  shoulder: [number, number, number];
  /** Left hip joint (body space). */
  hip: [number, number, number];
  arm: ArmLengths;
  leg: LegLengths;
}

/** Azimuth/elevation (radians) → unit direction; azimuth from +X toward +Z. */
export function azDir(az: number, el = 0): [number, number, number] {
  const c = Math.cos(el);
  return [c * Math.cos(az), Math.sin(el), c * Math.sin(az)];
}

export function computeProportions(breed: BreedId): WyvernProportions {
  const stats = BREEDS[breed];
  const s = BREED_SHAPES[breed];
  const shoulder: [number, number, number] = [
    s.shoulder[0] * s.torsoHalfWidth,
    s.shoulder[1] * s.torsoHalfHeight,
    s.shoulder[2] * s.torsoLength,
  ];
  const hip: [number, number, number] = [s.hip[0] * s.torsoHalfWidth, s.hip[1] * s.torsoHalfHeight, s.hip[2] * s.torsoLength];

  // Wing: the spread bind pose lies flat at shoulder height; scale the arm unit so the tip of
  // finger 0 sits at half the wingspan.
  const w = s.wing;
  const reach =
    w.humerus * Math.cos(w.azHumerus) +
    w.forearm * Math.cos(w.azForearm) +
    w.hand * Math.cos(w.azHand) +
    (w.fingers[0][0] + w.fingers[0][1]) * Math.cos(w.azFingers[0]);
  const unit = (stats.wingspan / 2 - shoulder[0]) / reach;
  const arm: ArmLengths = {
    humerus: w.humerus * unit,
    forearm: w.forearm * unit,
    hand: w.hand * unit,
    fingers: w.fingers.map(([a, b]) => [a * unit, b * unit] as [number, number]),
  };

  // Legs: the standing bind pose drops from the hip to the ground at standHeight.
  const sole = 0.045 * stats.standHeight;
  const drop = stats.standHeight + hip[1] - sole;
  const A = s.legAngles;
  const per = s.thigh * Math.cos(A.thigh) + s.shin * Math.cos(A.shin) + s.meta * Math.cos(A.meta);
  const legUnit = drop / per;
  const leg: LegLengths = {
    thigh: s.thigh * legUnit,
    shin: s.shin * legUnit,
    meta: s.meta * legUnit,
    toe: s.toe * legUnit,
    sole,
  };

  return { breed, shape: s, standHeight: stats.standHeight, wingspan: stats.wingspan, shoulder, hip, arm, leg };
}
