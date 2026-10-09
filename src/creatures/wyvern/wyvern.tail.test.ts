// The tail at real frame rates (hotfix for "the tail is freaking out while flying", d2be8a1).
//
// Round 1's tail was only ever tested and captured at fixed frame times (1/60 s with render-only
// dt 0 frames; the capture harness's 1/30 s). In a browser the animator runs once per rendered
// frame with whatever time the frame took, against physics stepped at 1/120 s: at 60 Hz a frame
// spans one, two or three physics steps and the tail took two or three sub-steps of its own. The
// tail then lashed ±30-50° frame to frame at the tip (a whip: a 13-15 Hz bending mode some 500
// times as large at the tip as at the root, driven by the sub-step count flipping, by the beat's
// phase standing still on one frame and jumping on the next, and at fixed dt by every manoeuvre).
//
// These tests fly real wyverns through the real game loop (wyvern.realloop.ts: a Player and its
// FlightModel at 1/120 s from an accumulator, the pose interpolated, the wyvern animated once per
// frame) at the frame times browsers produce, and hold the tail's motion to:
//   - no zig-zag: each frame's tip direction lies on the smooth path through its neighbours';
//   - the same motion at every frame rate: within a degree of a 120 Hz run of the same flight;
//   - joints off their cones: the chain bends, it is not pinned against its limits;
// and check the dynamics that cause it directly (synthetic bodies, fixed dt): a small body wobble
// in the whip's band is not amplified down the tail, a turn swings the tail out without a whip, and
// beats starting from a glide send no ring down it. The C1 character tests (wyvern.ground.test.ts)
// still hold for the shape: the wave per beat, the flare's S, the rest pose.

import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { BreedId, WyvernPose } from '../../core/types';
import { BREEDS, BREED_ORDER } from '../../flight/breeds';
import { createWyvernPose } from '../../player/poses';
import { Wyvern } from './Wyvern';
import { look } from './wyvern.testkit';
import { FLIGHTS, PROFILES, fly, maxJointBend, tailDirections, tipSpeed, vsReference, zigzag, zigzagWorst, type FrameProfile, type TailSeries } from './wyvern.realloop';

/** The joint limit past the root (tail.ts: 20° on the light skimmer's tail, 15° else). */
const jointLimit = (breed: BreedId) => (breed === 'skimmer' ? 20 : 15);

/** A whole flight (glide, beats, a banked turn, a climb, a tucked dive and pull-out, a flare, a stall). */
function wholeFlight(breed: BreedId, profile: FrameProfile): TailSeries {
  return fly({ breed, profile, flight: FLIGHTS.mixed, settle: 1, seconds: 21 });
}

/** Smooth, frame-rate independent and off the cones: the shared checks of a run against the 120 Hz reference. */
function expectSmooth(breed: BreedId, s: TailSeries, ref: TailSeries, label: string, opts: { zz: number; zzMax: number }) {
  const z = zigzag(s);
  // Measured with the fix: RMS ≤ 0.07° at 60 Hz and above, ≤ 0.21° at 30 Hz; max ≤ 1.3°. The
  // shipped tail: 7.9° at a steady 1/60 s, 18-42° RMS (max 60-90°) at a real 60 Hz.
  expect(z.rms, `${label}: tip zig-zag RMS`).toBeLessThan(opts.zz);
  expect(z.max, `${label}: tip zig-zag max`).toBeLessThan(opts.zzMax);
  expect(zigzagWorst(s), `${label}: worst segment's zig-zag RMS`).toBeLessThan(2 * opts.zz);
  // A heavy tail: the tip turns at tens of degrees a second, not thousands (shipped: p95 2000-4700°/s).
  expect(tipSpeed(s).p95, `${label}: tip angular speed p95`).toBeLessThan(300);
  // Bending, not pinned against the cone (shipped: every joint at 15.0° most of the flight).
  expect(maxJointBend(s), `${label}: largest joint bend`).toBeLessThan(jointLimit(breed) - 2);
  // The same motion as at 120 Hz (shipped: 20-32° RMS apart at 60 Hz, 4° at a steady 1/60 s).
  const v = vsReference(s, ref);
  expect(v.rms, `${label}: tip vs the 120 Hz run, RMS`).toBeLessThan(1);
  expect(v.max, `${label}: tip vs the 120 Hz run, max`).toBeLessThan(5);
}

describe('the tail at real frame rates: no freaking out in flight', { timeout: 300000 }, () => {
  for (const breed of BREED_ORDER) {
    it(`${breed}: a whole flight is as smooth at 60 Hz (16.6/16.8 ms), 144 Hz, 30 Hz and through hitches as at a steady rate`, () => {
      const ref = wholeFlight(breed, PROFILES.ref120);
      const fixed60 = wholeFlight(breed, PROFILES.fixed60);
      const fixed = zigzag(fixed60).rms;
      expectSmooth(breed, fixed60, ref, `${breed} fixed 1/60`, { zz: 0.5, zzMax: 3 });
      for (const p of [PROFILES.alt60, PROFILES.hitch60, PROFILES.chrome144]) {
        const s = wholeFlight(breed, p);
        expectSmooth(breed, s, ref, `${breed} ${p.name}`, { zz: 0.5, zzMax: 3 });
        // No worse for the jitter than a steady 60 Hz (shipped: 7.9° steady → 42° jittered).
        if (p !== PROFILES.chrome144) expect(zigzag(s).rms, `${breed} ${p.name} vs steady 1/60`).toBeLessThan(fixed + 0.3);
      }
      // 30 Hz: twice the time between frames, so twice the curvature per frame, still smooth.
      expectSmooth(breed, wholeFlight(breed, PROFILES.chrome30), ref, `${breed} 30 Hz`, { zz: 1, zzMax: 4 });
    });
  }

  it('moves the same whatever the refresh rate and the browser timer: 60 Hz (0.1 ms and 1 ms timers), 120, 165 Hz, 144 Hz with hitches', () => {
    for (const breed of ['harrier', 'ironback'] as const) {
      const ref = wholeFlight(breed, PROFILES.ref120);
      for (const p of [PROFILES.chrome60, PROFILES.firefox60, PROFILES.chrome120, PROFILES.chrome165, PROFILES.hitch144]) {
        expectSmooth(breed, wholeFlight(breed, p), ref, `${breed} ${p.name}`, { zz: 0.5, zzMax: 3 });
      }
    }
  });
});

// --- The dynamics behind it (synthetic bodies, fixed frame times) ---------------------------------

const R2D = 180 / Math.PI;

function glidePose(): WyvernPose {
  const p = createWyvernPose();
  p.position.set(0, 900, 0);
  p.velocity.set(0, 0, 24);
  p.airspeed = 24;
  p.airborne = true;
  p.wingSpread = 1;
  p.lookTarget.set(0, 900, 40);
  return p;
}

const tipPitch = (d: Float64Array) => {
  const k = d.length - 3;
  return Math.atan2(d[k + 1], Math.hypot(d[k], d[k + 2])) * R2D;
};
const tipYaw = (d: Float64Array) => {
  const k = d.length - 3;
  return Math.atan2(d[k], -d[k + 2]) * R2D;
};

/**
 * Gliding at 24 m/s with the body pitching ±`amp`° at `hz`, steady frames of `dt`: the tip's pitch
 * swing in the body frame over the body's (the tail's gain at that frequency).
 */
function wobbleGain(breed: BreedId, hz: number, dt = 1 / 120, amp = 0.1): number {
  const w = new Wyvern(look(breed));
  const pose = glidePose();
  const X = new Vector3(1, 0, 0);
  const T = 3 + 6 / hz;
  let lo = Infinity;
  let hi = -Infinity;
  for (let t = dt; t < T; t += dt) {
    const ph = 2 * Math.PI * hz * t;
    pose.orientation.setFromAxisAngle(X, (amp / R2D) * Math.sin(ph));
    pose.angularVelocity.set((amp / R2D) * 2 * Math.PI * hz * Math.cos(ph), 0, 0);
    pose.position.addScaledVector(pose.velocity, dt);
    pose.lookTarget.copy(pose.position).add(new Vector3(0, 0, 40));
    w.update(dt, pose);
    if (t > T - 3 / hz) {
      const p = tipPitch(tailDirections(w));
      lo = Math.min(lo, p);
      hi = Math.max(hi, p);
    }
  }
  w.dispose();
  return (hi - lo) / 2 / amp;
}

/**
 * A level turn at 0.8 rad/s held for 3 s from straight flight, then straight again, steady frames
 * of `dt`: the tip's yaw (body frame) in the held turn, its peak beyond that, and the swing past
 * straight once the turn ends.
 */
function turnStep(breed: BreedId, dt: number) {
  const w = new Wyvern(look(breed));
  const pose = glidePose();
  const Y = new Vector3(0, 1, 0);
  let heading = 0;
  const ts: number[] = [];
  const ys: number[] = [];
  for (let t = dt; t < 7; t += dt) {
    const rate = t >= 1 && t < 4 ? 0.8 : 0;
    heading += rate * dt;
    pose.velocity.set(Math.sin(heading), 0, Math.cos(heading)).multiplyScalar(24);
    pose.orientation.setFromAxisAngle(Y, heading);
    pose.position.addScaledVector(pose.velocity, dt);
    pose.angularVelocity.set(0, rate || 1e-5, 0);
    pose.lookTarget.copy(pose.position).addScaledVector(pose.velocity, 2);
    w.update(dt, pose);
    ts.push(t);
    ys.push(tipYaw(tailDirections(w)));
  }
  w.dispose();
  const before = ys[ts.findIndex((t) => t >= 1) - 1];
  const held = ys[ts.findIndex((t) => t >= 4) - 1] - before;
  const inTurn = ys.filter((_, k) => ts[k] >= 1 && ts[k] < 4).map((y) => y - before);
  const peak = inTurn.reduce((m, y) => (Math.abs(y) > Math.abs(m) ? y : m), 0);
  const after = ys.filter((_, k) => ts[k] >= 4).map((y) => y - before);
  const past = after.reduce((m, y) => (Math.sign(y) !== Math.sign(held) && Math.abs(y) > m ? Math.abs(y) : m), 0);
  return { held, overshoot: Math.abs(peak) / Math.abs(held) - 1, past };
}

/** Gliding, then beats from t = 2 s (the strength rising over 0.1 s), steady 1/60 s frames: the tip's pitch range over the first 0.6 s of beats. */
function beatOnset(breed: BreedId): number {
  const w = new Wyvern(look(breed));
  const pose = glidePose();
  const rate = BREEDS[breed].flapRate;
  const dt = 1 / 60;
  let phase = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let t = dt; t < 2.6; t += dt) {
    const on = t > 2;
    pose.flapStrength = on ? Math.min(1, pose.flapStrength + dt * 10) : 0;
    if (on) phase = (phase + rate * dt) % 1;
    pose.flapPhase = phase;
    pose.position.addScaledVector(pose.velocity, dt);
    pose.lookTarget.copy(pose.position).add(new Vector3(0, 0, 40));
    w.update(dt, pose);
    if (on) {
      const p = tipPitch(tailDirections(w));
      lo = Math.min(lo, p);
      hi = Math.max(hi, p);
    }
  }
  w.dispose();
  return hi - lo;
}

describe('the tail is heavy, not a whip (its dynamics)', { timeout: 120000 }, () => {
  it('does not amplify a small body wobble in the 8-14 Hz band down to the tip', () => {
    for (const breed of BREED_ORDER) {
      for (const hz of [8, 10, 12, 14]) {
        // Measured: at most 2.7. The shipped chain: 85-600 (a 0.1° wobble lashed the tip ±60°).
        expect(wobbleGain(breed, hz), `${breed} ${hz} Hz`).toBeLessThan(5);
      }
    }
  });

  it('swings out to the outside of a turn and back without a whip, the same at 60 and 144 Hz', () => {
    for (const breed of BREED_ORDER) {
      const a = turnStep(breed, 1 / 60);
      const b = turnStep(breed, 1 / 144);
      // A left turn (+ yaw rate) swings the tail out to the right (− yaw): a counterweight of
      // 10-20° (measured 13.5-15.9°; the shipped chain held 12-15°).
      expect(a.held, breed).toBeLessThan(-10);
      expect(a.held, breed).toBeGreaterThan(-20);
      // It lags into the swing without flicking past it (measured 12-14%; shipped 240-560%)...
      expect(a.overshoot, breed).toBeLessThan(0.4);
      // ...and swings a little past straight when the turn ends, not lashing back (measured
      // 3.1-3.7°; shipped 32-54°).
      expect(a.past, breed).toBeGreaterThan(0.5);
      expect(a.past, breed).toBeLessThan(0.5 * Math.abs(a.held));
      // The same at 144 Hz.
      expect(Math.abs(b.held - a.held), breed).toBeLessThan(0.1 * Math.abs(a.held));
      expect(Math.abs(b.past - a.past), breed).toBeLessThan(1);
    }
  });

  it('takes up the beats from a glide without a ring down the tail', () => {
    for (const breed of BREED_ORDER) {
      // Measured 4.6-10.8° (the wave of the first beat); the shipped chain rang ±45° (83-107°).
      expect(beatOnset(breed), breed).toBeLessThan(20);
    }
  });
});
