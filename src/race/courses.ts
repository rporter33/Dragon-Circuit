// The seven races, authored against the real layout (src/world/layout.ts) and checked against
// the analytic terrain, Rootfall's roots and the waterfalls by courses.test.ts. Ring normals
// follow the line unless a ring threads a feature (an arch, the Eye) and must face along it.
//
// Ids are save keys and the cosmetic catalog references them: never rename one.

import type { RaceDef, RingDef } from '../game/contracts';
import type { RaceKind } from '../core/types';
import { DEG } from '../core/math';
import { coursePoints, flowNormals, medalTimes } from './courseMath';

/** A point the course line passes through between rings (a thermal to climb in, for sprints). */
export interface CourseVia {
  before: number;
  point: [number, number, number];
  /** Circle in a thermal here until this altitude (the autopilot's route; players choose). */
  climbTo?: number;
}

interface RingSpec {
  p: [number, number, number];
  /** Inner radius (default by difficulty). */
  r?: number;
  /** Explicit facing (threading an arch); otherwise it follows the line. */
  n?: [number, number, number];
}

interface CourseSpec {
  id: string;
  name: string;
  kind: RaceKind;
  description: string;
  difficulty: number;
  landmark: string;
  /** Inner radius of every ring (default by difficulty: 10, 9 at 3, 7 from 4; sprints 12). */
  ringRadius?: number;
  /** Gate position; it faces `yawDeg`, or straight at the first ring when omitted. */
  start: { p: [number, number, number]; yawDeg?: number };
  rings: RingSpec[];
  via?: CourseVia[];
}

function build(spec: CourseSpec): RaceDef {
  const defaultR = spec.ringRadius ?? (spec.kind === 'sprint' ? 12 : spec.difficulty >= 4 ? 7 : spec.difficulty === 3 ? 9 : 10);
  const pts = spec.rings.map((r) => r.p);
  const normals = flowNormals(pts, spec.start.p);
  const rings: RingDef[] = spec.rings.map((r, i) => ({ position: r.p, normal: r.n ?? normals[i], radius: r.r ?? defaultR }));
  const def: RaceDef = {
    id: spec.id,
    name: spec.name,
    kind: spec.kind,
    description: spec.description,
    difficulty: spec.difficulty,
    start: { position: spec.start.p, yaw: spec.start.yawDeg !== undefined ? spec.start.yawDeg * DEG : Math.atan2(pts[0][0] - spec.start.p[0], pts[0][2] - spec.start.p[2]) },
    rings,
    medals: { gold: 0, silver: 0, bronze: 0 },
    landmark: spec.landmark,
  };
  def.medals = medalTimes(coursePoints(def, spec.via ?? []));
  return def;
}

// Arch normals (from the layout's arch yaws) for rings that thread them.
const ARCH_N0: [number, number, number] = [-0.487, 0, 0.873];
const ARCH_N1: [number, number, number] = [-0.368, 0, 0.93];
const ARCH_N2: [number, number, number] = [-0.247, 0, 0.969];
const EYE_N: [number, number, number] = [-0.637, -0.139, 0.759];
const neg = (n: [number, number, number]): [number, number, number] => [-n[0], -n[1], -n[2]];

export const COURSE_SPECS: CourseSpec[] = [
  {
    id: 'roost-loop',
    name: 'Roost Loop',
    kind: 'rings',
    description: 'Off the launch deck, a lap of Gull’s Rest and home along the Roost’s cliffs. The first race every rider flies.',
    difficulty: 1,
    landmark: 'roost',
    start: { p: [219, 238, 137] },
    rings: [
      { p: [340, 232, 230] },
      { p: [520, 222, 300] },
      { p: [680, 213, 420] },
      { p: [560, 205, 545] },
      { p: [420, 197, 430] },
      { p: [180, 189, 290] },
      { p: [-60, 183, 200] },
      { p: [-215, 177, 40] },
      { p: [-140, 172, -200] },
      { p: [80, 168, -190] },
      { p: [230, 176, -75] },
    ],
  },
  {
    id: 'cascade-run',
    name: 'Cascade Run',
    kind: 'rings',
    description: 'Spiral down Cascade Isle past all five falls, threading behind the curtains of water.',
    difficulty: 2,
    landmark: 'cascade',
    ringRadius: 11,
    start: { p: [761, 415, -855] },
    // Dive in through the gap between two falls, then spiral down the corridor between the
    // underside and the curtains of water (a circle 195 m from the island's axis, the falls
    // 40–80 m outside it), and out through the next gap.
    rings: [
      { p: [901, 350, -769] },
      { p: [958, 300, -658] },
      { p: [1013, 280, -551] },
      { p: [994, 280, -431] },
      { p: [909, 270, -346] },
      { p: [789, 260, -327] },
      { p: [682, 250, -382] },
      { p: [627, 240, -489] },
      { p: [646, 230, -609] },
      { p: [731, 220, -694] },
      { p: [861, 200, -782] },
    ],
  },
  {
    id: 'archway-thread',
    name: 'Archway Thread',
    kind: 'rings',
    description: 'Weave north and south through the Archway Reach’s three arches, round the last islet, and back through the middle one.',
    difficulty: 3,
    landmark: 'archway',
    start: { p: [-413, 300, -1008] },
    rings: [
      { p: [-510, 290, -833], n: ARCH_N0 },
      { p: [-700, 280, -790] },
      { p: [-736, 268, -943], n: neg(ARCH_N1) },
      { p: [-890, 260, -1130] },
      { p: [-1043, 255, -1045], n: ARCH_N2 },
      { p: [-1230, 248, -960] },
      { p: [-1330, 240, -1100] },
      { p: [-1100, 232, -1230] },
      { p: [-880, 228, -1160] },
      { p: [-810, 225, -973], n: ARCH_N1 },
    ],
  },
  {
    id: 'underspan',
    name: 'Underspan',
    kind: 'rings',
    description: 'Through the Eye of the Gale, then a long dive under Rootfall to thread its hanging roots. Mind the tips.',
    difficulty: 4,
    landmark: 'eye',
    start: { p: [1516, 590, 453] },
    // Through the Eye, a long dive west to Rootfall, then half a lap beneath it threading the
    // hanging roots (~150 m out from the axis, where the long flank roots hang down around the
    // underside cone; every ring and line keeps 12 m from the nearest strand) and out into
    // the thermal on its south-west side.
    rings: [
      { p: [1350, 560, 650], n: EYE_N },
      { p: [900, 480, 800] },
      { p: [480, 388, 1124] },
      { p: [340, 368, 1162] },
      { p: [248, 341, 1124] },
      { p: [204, 343, 1030] },
      { p: [200, 335, 934] },
      { p: [160, 345, 780] },
    ],
  },
  {
    id: 'needle-slalom',
    name: 'Needle Slalom',
    kind: 'rings',
    description: 'Seven spires, seven gates, alternating sides. The Needles punish a lazy line.',
    difficulty: 5,
    landmark: 'needles',
    start: { p: [1085, 470, -1170] },
    // South down the field threading the gap between each pair of needles, a hairpin round the
    // last one, and back north along the western needles, easing down 130 m on the way.
    rings: [
      { p: [1070, 455, -1340] },
      { p: [1035, 440, -1455] },
      { p: [1068, 428, -1550] },
      { p: [1140, 416, -1650] },
      { p: [1175, 404, -1765] },
      { p: [1205, 393, -1890] },
      { p: [1170, 383, -2025] },
      { p: [1050, 374, -2045] },
      { p: [1000, 366, -1925] },
      { p: [980, 358, -1790] },
      { p: [975, 350, -1640] },
      { p: [965, 342, -1510] },
    ],
  },
  {
    id: 'lantern-dash',
    name: 'Lantern Dash',
    kind: 'sprint',
    description: 'Ride the Roost’s thermal to the gate, then race west to the Lantern Spire. It stands higher than you start: find lift on the way.',
    difficulty: 2,
    landmark: 'lantern',
    start: { p: [230, 630, -40] },
    // The finish hangs 70 m off the spire's north-east flank, facing the way you come from the
    // Roost (so you sweep past the spire, not into it), its light column rising past the
    // beacon. Gliding all the way loses ~200 m: flap hard, or take the thermal just south of
    // the spire (or Highmoor's, which hugs that island's cliff).
    rings: [{ p: [-1115, 690, 821], n: [-0.868, 0, 0.496] }],
    via: [
      { before: 0, point: [-1300, 720, 480], climbTo: 720 },
      { before: 0, point: [-930, 700, 740] },
    ],
  },
  {
    id: 'long-drift',
    name: 'The Long Drift',
    kind: 'sprint',
    description: 'From the top of the Mistveil Shelves clear across the Drift to the Old Observatory. Too far to glide: ride the thermals.',
    difficulty: 4,
    landmark: 'shelves',
    start: { p: [1280, 575, -1150] },
    rings: [{ p: [-1500, 472, 150], n: [-0.6, -0.25, -0.76] }],
    via: [
      { before: 0, point: [1180, 690, -1100], climbTo: 690 },
      { before: 0, point: [620, 650, -240], climbTo: 650 },
      { before: 0, point: [-1300, 640, 480], climbTo: 640 },
    ],
  },
];

export const COURSES: RaceDef[] = COURSE_SPECS.map(build);

export function courseById(id: string): RaceDef | undefined {
  return COURSES.find((c) => c.id === id);
}

export function courseVia(id: string): CourseVia[] {
  return COURSE_SPECS.find((c) => c.id === id)?.via ?? [];
}
