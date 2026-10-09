// Test helper: a wyvern flown through the real game loop at real browser frame rates.
//
// The physics runs exactly as in Game.frame: a real Player (and its FlightModel) stepped at
// FIXED_DT = 1/120 s from an accumulator (at most MAX_STEPS a frame, dt clamped to 0.1 s), then
// Player.update(dt, alpha) builds the render pose and Wyvern.update(dt, pose) animates it once per
// rendered frame with that frame's real dt. Frame times come from seeded generators shaped like a
// browser's requestAnimationFrame: vsync at 30-165 Hz with timestamp jitter and the timer's
// quantisation, the 16.6/16.8 ms alternation of a 60 Hz display, and dropped frames (hitches).
//
// The flight script is evaluated per physics step at the physics time, so every frame-rate
// profile flies the very same trajectory and any difference in the tail is the animation's.
// What is recorded per rendered frame: the body-frame direction of every tail segment.

import { Quaternion, Vector3 } from 'three';
import type { BreedId, GameEvents, InputFrame, WyvernPose } from '../../core/types';
import { EventBus } from '../../core/events';
import { emptyFrame } from '../../input/Input';
import { DEFAULT_SETTINGS } from '../../game/settings';
import { LAYOUT } from '../../world/layout';
import { Terrain } from '../../world/terrain';
import { Player } from '../../player/Player';
import { Wyvern } from './Wyvern';
import { look } from './wyvern.testkit';

/** The game's fixed physics step and its cap per rendered frame (Game.ts). */
export const FIXED_DT = 1 / 120;
const MAX_STEPS = 12;
const R2D = 180 / Math.PI;

let terrainCache: Terrain | null = null;
function terrain(): Terrain {
  return (terrainCache ??= new Terrain(LAYOUT));
}

// --- Frame times ---------------------------------------------------------------------------------

/** A named source of rendered-frame times (s). `gen()` starts a fresh, seeded sequence. */
export interface FrameProfile {
  name: string;
  gen: () => () => number;
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Every frame exactly `dt`. */
export const fixedRate = (name: string, dt: number): FrameProfile => ({ name, gen: () => () => dt });

/**
 * Vsync at `hz`: frame timestamps on the display's ticks with ±`jitterUs` of noise, rounded to the
 * browser timer's `quantUs` (Chrome 100 µs, Firefox/Safari 1 ms), and a dropped frame (one or two
 * ticks missed) with probability `hitch` per frame.
 */
export function vsync(name: string, hz: number, jitterUs: number, quantUs: number, hitch = 0, seed = 1): FrameProfile {
  return {
    name,
    gen: () => {
      const r = lcg(seed);
      let k = 0;
      let last = 0;
      return () => {
        k += 1;
        if (hitch > 0 && r() < hitch) k += r() < 0.7 ? 1 : 2;
        const t = (k / hz) * 1e6 + (r() * 2 - 1) * jitterUs;
        const tq = Math.round(t / quantUs) * quantUs;
        const dt = (tq - last) / 1e6;
        last = tq;
        return Math.max(0, dt);
      };
    },
  };
}

/** A repeating pattern of frame times (ms), e.g. a 60 Hz display's 16.6, 16.8. */
export function pattern(name: string, ms: number[]): FrameProfile {
  return {
    name,
    gen: () => {
      let k = 0;
      return () => ms[k++ % ms.length] / 1000;
    },
  };
}

export const PROFILES = {
  ref120: fixedRate('fixed 1/120', 1 / 120),
  fixed60: fixedRate('fixed 1/60', 1 / 60),
  fixed30: fixedRate('fixed 1/30', 1 / 30),
  alt60: pattern('60 Hz 16.6/16.8 ms', [16.6, 16.8]),
  chrome60: vsync('60 Hz (0.1 ms timer)', 60, 30, 100),
  firefox60: vsync('60 Hz (1 ms timer)', 60, 30, 1000),
  chrome120: vsync('120 Hz', 120, 30, 100, 0, 2),
  chrome144: vsync('144 Hz', 144, 30, 100, 0, 3),
  chrome165: vsync('165 Hz', 165, 30, 100, 0, 4),
  chrome30: vsync('30 Hz', 30, 300, 100, 0, 5),
  hitch60: vsync('60 Hz + hitches', 60, 600, 100, 0.015, 7),
  hitch144: vsync('144 Hz + hitches', 144, 400, 100, 0.015, 9),
} satisfies Record<string, FrameProfile>;

// --- Flight scripts (stick input by physics time) -------------------------------------------------

export type FlightScript = (inp: InputFrame, t: number) => void;

export const FLIGHTS: Record<string, FlightScript> = {
  glide: () => {},
  flap: (i) => {
    i.flight.flap = 1;
  },
  /** Bank hard into a turn, then hold a climbing turn with bursts of beats. */
  turn: (i, t) => {
    i.flight.roll = t < 1.6 ? -1 : -0.25;
    i.flight.pitch = t < 1.6 ? 0 : 0.7;
    i.flight.flap = t > 1.6 && t % 3 < 1.5 ? 1 : 0;
  },
  /** Beating up a steep climb. */
  climb: (i) => {
    i.flight.pitch = 0.8;
    i.flight.flap = 1;
  },
  /** A tucked dive, then a hard pull-out. */
  dive: (i, t) => {
    if (t < 3.5) {
      i.flight.tuck = 1;
      i.flight.pitch = -0.6;
    } else i.flight.pitch = 1;
  },
  /** Pull up without beating into the stall and hold it there. */
  stall: (i) => {
    i.flight.pitch = 1;
  },
  /** Flare and beat: the hover's air brake. */
  flare: (i, t) => {
    i.flight.flare = t > 1 ? 1 : 0;
    i.flight.flap = t > 1 ? 1 : 0;
  },
  /** Rolling from one bank to the other every 0.8 s, beating every other second. */
  weave: (i, t) => {
    i.flight.roll = Math.floor(t / 0.8) % 2 ? 1 : -1;
    i.flight.flap = t % 2 < 1 ? 1 : 0;
  },
  /**
   * A whole flight: glide, beats from a glide, a banked turn with the beats restarted in it, a
   * climb, a push-over into a tucked dive, the pull-out, a flare with beats, a stall, recovery.
   */
  mixed: (i, t) => {
    if (t < 2) return;
    if (t < 5) i.flight.flap = 1;
    else if (t < 8) {
      i.flight.roll = t < 6 ? -1 : -0.3;
      i.flight.pitch = 0.4;
      i.flight.flap = t > 6.5 ? 1 : 0;
    } else if (t < 10.5) {
      i.flight.pitch = 0.8;
      i.flight.flap = 1;
    } else if (t < 13.5) {
      i.flight.pitch = -0.7;
      i.flight.tuck = t > 11 ? 1 : 0;
    } else if (t < 15.5) i.flight.pitch = 1;
    else if (t < 18) {
      i.flight.flare = 1;
      i.flight.flap = 1;
    } else if (t < 21) i.flight.pitch = 1;
    else if (t < 22) i.flight.flap = 1;
  },
};

// --- The loop -------------------------------------------------------------------------------------

/** Per rendered frame: time, dt, and the body-frame direction of each tail segment (x, y, z). */
export interface TailSeries {
  t: number[];
  dt: number[];
  dirs: Float64Array[];
  /** Number of tail segments. */
  n: number;
}

export interface FlyOptions {
  breed: BreedId;
  profile: FrameProfile;
  flight: FlightScript;
  /** Seconds recorded, after `settle` seconds of the same flight unrecorded. */
  seconds: number;
  settle?: number;
  start?: { position: Vector3; yaw: number; speed: number };
  /** Called after every rendered frame. */
  onFrame?: (ctx: { t: number; dt: number; pose: WyvernPose; wyvern: Wyvern; player: Player; steps: number }) => void;
}

/** Body-frame direction of every tail segment of `w` after its last update, into `out` (x, y, z per segment). */
export function tailDirections(w: Wyvern, out?: Float64Array): Float64Array {
  const a = (w as unknown as { animator: { modelQ: Quaternion[] } }).animator;
  const rig = w.rigDef;
  const T = rig.idx.tail;
  const o = out ?? new Float64Array(T.length * 3);
  const v = new Vector3();
  for (let i = 0; i < T.length; i++) {
    const q = i + 1 < T.length ? rig.bones[T[i + 1]].pos : rig.tailTip;
    v.copy(q).sub(rig.bones[T[i]].pos).normalize().applyQuaternion(a.modelQ[T[i]]);
    o[i * 3] = v.x;
    o[i * 3 + 1] = v.y;
    o[i * 3 + 2] = v.z;
  }
  return o;
}

/** Fly a real Player and a Wyvern through the game loop at `profile`'s frame times. */
export function fly(o: FlyOptions): TailSeries {
  const events = new EventBus<GameEvents>();
  const settings = { ...DEFAULT_SETTINGS, holdToFlap: true };
  const player = new Player({
    terrain: terrain(),
    env: { windAt: (_p, out) => out.set(0, 0, 0), terrain: terrain() },
    events,
    breed: o.breed,
    settings: () => settings,
  });
  const st = o.start ?? { position: new Vector3(0, 1400, 0), yaw: 0, speed: 24 };
  player.teleport(st.position, st.yaw, 'flying', st.speed);
  const w = new Wyvern(look(o.breed));
  const next = o.profile.gen();
  const settle = o.settle ?? 1;
  const series: TailSeries = { t: [], dt: [], dirs: [], n: w.rigDef.idx.tail.length };
  // The first rendered frame (rAF's first tick takes no time).
  w.update(0, player.wyvernPose);
  let acc = 0;
  let t = 0;
  let simT = 0;
  while (t < settle + o.seconds) {
    const dt = Math.min(0.1, next());
    acc += dt;
    let steps = 0;
    while (acc >= FIXED_DT && steps < MAX_STEPS) {
      const inp = emptyFrame();
      o.flight(inp, simT);
      player.latchPresses(inp);
      player.fixedUpdate(FIXED_DT, inp, 0);
      simT += FIXED_DT;
      acc -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS) acc = 0;
    player.update(dt, acc / FIXED_DT);
    w.update(dt, player.wyvernPose);
    t += dt;
    o.onFrame?.({ t, dt, pose: player.wyvernPose, wyvern: w, player, steps });
    if (t >= settle) {
      series.t.push(t);
      series.dt.push(dt);
      series.dirs.push(tailDirections(w));
    }
  }
  w.dispose();
  return series;
}

// --- Metrics --------------------------------------------------------------------------------------

function rms(a: number[]): number {
  return Math.sqrt(a.reduce((s, x) => s + x * x, 0) / Math.max(1, a.length));
}

/**
 * "Zig-zag" of a segment (default: the tip): per rendered frame, the angle (deg) between its
 * direction and the time-weighted blend of its directions on the frames before and after. Zero for
 * any smooth motion at any frame rate, whatever the frame times; frame-to-frame flailing and rings
 * at 10-20 Hz show up as large values.
 */
export function zigzag(s: TailSeries, seg = s.n - 1): { rms: number; max: number; p99: number } {
  const res: number[] = [];
  for (let k = 1; k < s.dirs.length - 1; k++) {
    const d0 = s.dt[k];
    const d1 = s.dt[k + 1];
    if (d0 <= 0 || d1 <= 0) continue;
    const w = d0 / (d0 + d1);
    let e2 = 0;
    let p2 = 0;
    const c: number[] = [0, 0, 0];
    for (let j = 0; j < 3; j++) {
      const a = s.dirs[k - 1][seg * 3 + j];
      const b = s.dirs[k + 1][seg * 3 + j];
      c[j] = a + (b - a) * w;
      p2 += c[j] * c[j];
    }
    const pl = Math.sqrt(p2) || 1;
    let dot = 0;
    for (let j = 0; j < 3; j++) dot += (c[j] / pl) * s.dirs[k][seg * 3 + j];
    e2 = Math.acos(Math.min(1, dot)) * R2D;
    res.push(e2);
  }
  const sorted = [...res].sort((x, y) => x - y);
  return { rms: rms(res), max: sorted[sorted.length - 1] ?? 0, p99: sorted[Math.floor(0.99 * (sorted.length - 1))] ?? 0 };
}

/** The worst segment's zig-zag RMS. */
export function zigzagWorst(s: TailSeries): number {
  let m = 0;
  for (let g = 0; g < s.n; g++) m = Math.max(m, zigzag(s, g).rms);
  return m;
}

/** Tip angular speed (deg/s): 95th percentile and max. */
export function tipSpeed(s: TailSeries): { p95: number; max: number } {
  const seg = s.n - 1;
  const w: number[] = [];
  for (let k = 1; k < s.dirs.length; k++) {
    if (s.dt[k] <= 0) continue;
    let dot = 0;
    for (let j = 0; j < 3; j++) dot += s.dirs[k][seg * 3 + j] * s.dirs[k - 1][seg * 3 + j];
    w.push((Math.acos(Math.min(1, dot)) * R2D) / s.dt[k]);
  }
  w.sort((x, y) => x - y);
  return { p95: w[Math.floor(0.95 * (w.length - 1))] ?? 0, max: w[w.length - 1] ?? 0 };
}

/** Largest bend (deg) between consecutive segments past the root, over the whole series. */
export function maxJointBend(s: TailSeries): number {
  let m = 0;
  for (const d of s.dirs) {
    for (let i = 1; i < s.n; i++) {
      const dot = d[i * 3] * d[i * 3 - 3] + d[i * 3 + 1] * d[i * 3 - 2] + d[i * 3 + 2] * d[i * 3 - 1];
      m = Math.max(m, Math.acos(Math.min(1, dot)) * R2D);
    }
  }
  return m;
}

/**
 * Frame-rate independence: the RMS and max angle (deg) between `s`'s tip direction and the
 * reference run's (`ref`, usually fixed 1/120 s frames) at the same times (the reference linearly
 * interpolated between its frames).
 */
export function vsReference(s: TailSeries, ref: TailSeries, seg = s.n - 1): { rms: number; max: number } {
  const res: number[] = [];
  let j = 0;
  for (let k = 0; k < s.t.length; k++) {
    const t = s.t[k];
    while (j + 1 < ref.t.length && ref.t[j + 1] < t) j++;
    if (j + 1 >= ref.t.length || ref.t[j] > t) continue;
    const u = (t - ref.t[j]) / (ref.t[j + 1] - ref.t[j]);
    let p2 = 0;
    const c: number[] = [0, 0, 0];
    for (let q = 0; q < 3; q++) {
      c[q] = ref.dirs[j][seg * 3 + q] + (ref.dirs[j + 1][seg * 3 + q] - ref.dirs[j][seg * 3 + q]) * u;
      p2 += c[q] * c[q];
    }
    const pl = Math.sqrt(p2) || 1;
    let dot = 0;
    for (let q = 0; q < 3; q++) dot += (c[q] / pl) * s.dirs[k][seg * 3 + q];
    res.push(Math.acos(Math.min(1, dot)) * R2D);
  }
  return { rms: rms(res), max: Math.max(0, ...res) };
}

/** Tip pitch and yaw (deg, body frame: + up, + to the body's left) per frame. */
export function tipAngles(s: TailSeries): { pitch: number[]; yaw: number[] } {
  const seg = s.n - 1;
  const pitch: number[] = [];
  const yaw: number[] = [];
  for (const d of s.dirs) {
    const x = d[seg * 3];
    const y = d[seg * 3 + 1];
    const z = d[seg * 3 + 2];
    pitch.push(Math.atan2(y, Math.hypot(x, z)) * R2D);
    yaw.push(Math.atan2(x, -z) * R2D);
  }
  return { pitch, yaw };
}
