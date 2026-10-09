// Golden-pose test: the refactor safety net for the animator (WyvernAnimator and its layer files).
//
// Every breed plays one scripted 12 s sequence at 60 fps — idle, walk with a turn, run, the
// takeoff crouch and leap, a flapping climb, a banked turn, a stall, a tucked dive, a flared
// approach, the touchdown and a stretch-and-bask — and every frame's pose (bone local quaternions,
// the root offset, the tongue slide, rib breathing and the animated uniforms) is compared with the
// recorded fixture within 1e-6: a full snapshot every second, and a fixed random projection of
// the whole pose vector every frame (so a one-frame difference anywhere cannot slip through).
//
// The fixture records the behaviour BEFORE the C0 split. When a change is MEANT to change the
// motion (a new tail, a new gait, new bones from the anatomy pass), regenerate it deliberately:
//
//   UPDATE_GOLDEN=1 npx vitest run src/creatures/wyvern/wyvern.golden.test.ts
//
// and say so in the commit. Never loosen the tolerance to make it pass.

import { describe, expect, it } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three';
import type { BreedId, WyvernPose } from '../../core/types';
import { BREEDS, BREED_ORDER } from '../../flight/breeds';
import { DEFAULT_WYVERN } from '../../cosmetics/catalog';
import { createWyvernPose } from '../../player/poses';
import { mulberry32 } from '../../core/rng';
import { Wyvern } from './Wyvern';

const FPS = 60;
const SECONDS = 12;
const SAMPLE_EVERY = FPS;
const TOL = 1e-6;
const FIXTURE = new URL('./__golden__/pose.golden.json', import.meta.url);

interface Golden {
  version: number;
  note: string;
  frames: number;
  sampleEvery: number;
  breeds: Record<string, { length: number; proj: number[]; samples: number[][] }>;
}

// Node built-ins without @types/node in the project: imported by a computed name.
async function nodeFs(): Promise<{ readFileSync(p: URL, enc: string): string; writeFileSync(p: URL, s: string): void; mkdirSync(p: URL, o: object): void }> {
  const name = 'node:fs';
  return import(/* @vite-ignore */ name);
}
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const UP = new Vector3(0, 1, 0);
const _q = new Quaternion();
const _qr = new Quaternion();

/**
 * The scripted sequence: writes frame `i`'s pose (continuous path, no teleports after the first
 * frame). `s` carries the integrated position and heading between frames.
 */
function script(breed: BreedId, i: number, p: WyvernPose, s: { yaw: number; roll: number; pitch: number }): void {
  const dt = 1 / FPS;
  const t = i * dt;
  const b = BREEDS[breed];
  const sh = b.standHeight;
  const ground = 10;
  const fwd = (speed: number, up = 0) => p.velocity.set(Math.sin(s.yaw) * speed, up, Math.cos(s.yaw) * speed);
  const orient = () => {
    _q.setFromAxisAngle(UP, s.yaw);
    _qr.setFromEuler(_e.set(-s.pitch, 0, s.roll, 'YXZ'));
    p.orientation.copy(_q).multiply(_qr);
  };
  p.ruffle = 0;
  p.stall = 0;
  p.flare = 0;
  p.fatigue = 0;
  p.angularVelocity.set(0, 0, 0);
  if (t < 4.4) {
    // On the ground: idle, walk (turning), run, then the takeoff crouch.
    p.airborne = false;
    p.groundY = ground;
    p.flapStrength = 0;
    p.flapPhase = 0;
    let speed = 0;
    let yawRate = 0;
    if (t < 1.5) {
      p.gait = 'idle';
      p.gaitTime = t;
      p.wingSpread = 0.22;
    } else if (t < 3) {
      p.gait = 'walk';
      p.gaitTime = t - 1.5;
      p.wingSpread = 0.22;
      speed = 2;
      yawRate = 0.3;
    } else if (t < 4) {
      p.gait = 'run';
      p.gaitTime = t - 3;
      p.wingSpread = 0.22;
      speed = 8;
      yawRate = -0.15;
    } else {
      p.gait = 'takeoff';
      p.gaitTime = t - 4;
      p.wingSpread = 0.22 + 0.78 * Math.min(1, (t - 4) / 0.4);
      speed = 8 * Math.max(0, 1 - (t - 4) / 0.3);
    }
    s.yaw += yawRate * dt;
    s.pitch = 0;
    s.roll = 0;
    fwd(speed);
    p.angularVelocity.set(0, yawRate, 0);
    p.position.addScaledVector(p.velocity, dt);
    p.position.y = ground + sh;
    p.airspeed = speed;
    p.groundSpeed = speed;
    orient();
    p.lookTarget.set(p.position.x + Math.sin(s.yaw + Math.sin(t * 1.3) * 0.9) * 30, p.position.y + 1.5, p.position.z + Math.cos(s.yaw + Math.sin(t * 1.3) * 0.9) * 30);
    return;
  }
  p.groundSpeed = 0;
  if (t < 10) {
    p.airborne = true;
    let speed = 0;
    let climb = 0;
    p.flapPhase = (t * b.flapRate) % 1;
    p.groundY = null;
    if (t < 5) {
      // Leaping off: the takeoff gait for its first 0.6 s, legs pushing off.
      p.gait = 'takeoff';
      p.gaitTime = t - 4.4;
      p.wingSpread = 1;
      p.flapStrength = 1;
      speed = 7 + 8 * (t - 4.4);
      climb = 5.5 - 6 * (t - 4.4);
      s.pitch = 0.17;
      p.groundY = ground;
    } else if (t < 6.5) {
      p.gait = 'idle';
      p.gaitTime = t - 5;
      p.wingSpread = 1;
      p.flapStrength = 1;
      p.fatigue = 0.3 * (t - 5);
      speed = 12 + 6 * (t - 5);
      climb = 3;
      s.pitch = 0.12;
    } else if (t < 7.5) {
      // A banked turn to the right, rolling in and holding.
      const u = t - 6.5;
      p.wingSpread = 1;
      p.flapStrength = 0.5;
      s.roll = -0.7 * Math.min(1, u / 0.4);
      const yawRate = -0.5 * Math.min(1, u / 0.4);
      s.yaw += yawRate * dt;
      s.pitch = 0.02;
      p.angularVelocity.set(0, yawRate, u < 0.4 ? -1.75 : 0);
      speed = 21;
      climb = 0;
    } else if (t < 8) {
      // Rolled level, mushing into a stall.
      p.wingSpread = 1;
      p.flapStrength = 0.2;
      s.roll *= 0.9;
      s.pitch = 0.35;
      p.stall = Math.min(1, (t - 7.5) / 0.2);
      p.angularVelocity.set(0.3, 0, 1.2);
      speed = 9;
      climb = -2;
    } else if (t < 9) {
      // Tucked dive.
      p.wingSpread = 0.22;
      p.flapStrength = 0;
      s.roll = 0;
      s.pitch = -0.6;
      p.angularVelocity.set(-0.4, 0, 0);
      speed = 30 + 20 * (t - 8);
      climb = -20;
    } else {
      // Flared approach to the ground ahead: height 3·sh → 1·sh, slowing, beating gently.
      const u = t - 9;
      p.gait = 'landing';
      p.gaitTime = u;
      p.wingSpread = 1;
      p.flare = Math.min(1, u / 0.5);
      p.flapStrength = 0.6;
      s.pitch = 0.3;
      p.groundY = ground;
      speed = 14 - 8 * u;
      climb = -2 * sh;
      p.position.y = ground + sh * (3 - 2 * u);
    }
    fwd(speed, climb);
    p.airspeed = Math.hypot(speed, climb);
    p.position.x += p.velocity.x * dt;
    p.position.z += p.velocity.z * dt;
    if (t < 9) p.position.y += climb * dt;
    orient();
    p.lookTarget.copy(p.position).addScaledVector(p.velocity, 2).add(_v.set(0, 1, 0));
    return;
  }
  // Touchdown at 10 s, the landing settle, then resting with the stretch-and-bask (ruffle rising
  // over 1.4 s from 10.6 s).
  p.airborne = false;
  p.groundY = ground;
  p.gait = t < 10.55 ? 'landing' : 'idle';
  p.gaitTime = t < 10.55 ? t - 10 : t - 10.55;
  p.wingSpread = 0.22;
  p.flapStrength = 0;
  s.pitch = 0;
  s.roll = 0;
  fwd(0);
  p.airspeed = 0;
  p.position.y = ground + sh;
  p.ruffle = t >= 10.6 ? Math.min(1, (t - 10.6) / 1.4) : 0;
  if (p.ruffle >= 1) p.ruffle = 0;
  orient();
  p.lookTarget.set(p.position.x + Math.sin(s.yaw + 0.6) * 25, p.position.y + 2, p.position.z + Math.cos(s.yaw + 0.6) * 25);
}

const _e = new Euler();
const _v = new Vector3();

/** The pose vector of a frame: every bone's local quaternion, then the animated extras. */
function poseVector(w: Wyvern, out: number[]): number[] {
  out.length = 0;
  const bones = w.skinnedMesh!.skeleton.bones;
  for (const b of bones) out.push(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
  const rig = w.rigDef;
  const root = bones[rig.idx.root];
  const tongue = bones[rig.idx.tongue[0]];
  const breath = bones[rig.idx.breath];
  out.push(root.position.x, root.position.y, root.position.z, tongue.position.z, breath.scale.x, breath.scale.y, breath.scale.z);
  const u = w.uniforms;
  out.push(u.uBlink.value, u.uNictitate.value, u.uFlutter.value, u.uFlutterRate.value / 50, u.uRipple.value, u.uWingLoad.value.x, u.uWingLoad.value.y, u.uFold.value);
  return out;
}

/** Run the sequence for a breed: per-frame projections and per-second snapshots. */
function record(breed: BreedId): { length: number; proj: number[]; samples: number[][] } {
  const w = new Wyvern({ ...DEFAULT_WYVERN, breed });
  const p = createWyvernPose();
  p.position.set(0, 10 + BREEDS[breed].standHeight, 0);
  const s = { yaw: 0.3, roll: 0, pitch: 0 };
  const vec: number[] = [];
  const proj: number[] = [];
  const samples: number[][] = [];
  let weights: Float64Array | null = null;
  for (let i = 0; i < FPS * SECONDS; i++) {
    script(breed, i, p, s);
    w.update(1 / FPS, p);
    poseVector(w, vec);
    if (!weights) {
      const rnd = mulberry32(0x601de);
      weights = new Float64Array(vec.length);
      for (let k = 0; k < vec.length; k++) weights[k] = (rnd() * 2 - 1) * (0.5 + rnd());
    }
    let sum = 0;
    for (let k = 0; k < vec.length; k++) sum += vec[k] * weights[k];
    proj.push(sum);
    if ((i + 1) % SAMPLE_EVERY === 0) samples.push(vec.slice());
  }
  w.dispose();
  return { length: vec.length, proj, samples };
}

const round = (x: number) => Math.round(x * 1e9) / 1e9;

describe('golden pose (animator refactor safety net)', { timeout: 120_000 }, () => {
  it('plays the scripted 12 s sequence exactly as recorded, for every breed', async () => {
    const fs = await nodeFs();
    const runs = Object.fromEntries(BREED_ORDER.map((b) => [b, record(b)]));
    if (env.UPDATE_GOLDEN) {
      const golden: Golden = {
        version: 1,
        note: 'Regenerate deliberately: UPDATE_GOLDEN=1 npx vitest run src/creatures/wyvern/wyvern.golden.test.ts',
        frames: FPS * SECONDS,
        sampleEvery: SAMPLE_EVERY,
        breeds: Object.fromEntries(
          Object.entries(runs).map(([b, r]) => [b, { length: r.length, proj: r.proj.map(round), samples: r.samples.map((v) => v.map(round)) }]),
        ),
      };
      fs.mkdirSync(new URL('./__golden__/', import.meta.url), { recursive: true });
      fs.writeFileSync(FIXTURE, JSON.stringify(golden) + '\n');
      return;
    }
    const golden = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Golden;
    expect(golden.frames).toBe(FPS * SECONDS);
    for (const breed of BREED_ORDER) {
      const g = golden.breeds[breed];
      const r = runs[breed];
      expect(r.length, `${breed}: the pose vector changed size (bones added?) — regenerate deliberately`).toBe(g.length);
      for (let i = 0; i < g.proj.length; i++) {
        const d = Math.abs(r.proj[i] - g.proj[i]);
        if (d > TOL) throw new Error(`${breed}: frame ${i} (t=${((i + 1) / FPS).toFixed(3)} s) differs from the golden pose by ${d.toExponential(2)}`);
      }
      for (let k = 0; k < g.samples.length; k++) {
        for (let j = 0; j < g.length; j++) {
          const d = Math.abs(r.samples[k][j] - g.samples[k][j]);
          if (d > TOL) throw new Error(`${breed}: snapshot ${k + 1} s, channel ${j} differs by ${d.toExponential(2)}`);
        }
      }
    }
  });

  it('exercises every layer: ground and air, flapping, stall, tuck, flare, touchdown and the bask', () => {
    // The script itself: a guard against a sequence that silently stops covering a state.
    const p = createWyvernPose();
    const s = { yaw: 0, roll: 0, pitch: 0 };
    const seen = new Set<string>();
    for (let i = 0; i < FPS * SECONDS; i++) {
      script('harrier', i, p, s);
      if (!p.airborne) seen.add(`ground:${p.gait}`);
      if (p.airborne && p.flapStrength > 0.9) seen.add('flap');
      if (p.stall > 0.5) seen.add('stall');
      if (p.airborne && p.wingSpread < 0.3) seen.add('tuck');
      if (p.flare > 0.9) seen.add('flare');
      if (Math.abs(s.roll) > 0.5) seen.add('bank');
      if ((p.ruffle ?? 0) > 0.5) seen.add('ruffle');
    }
    for (const k of ['ground:idle', 'ground:walk', 'ground:run', 'ground:takeoff', 'ground:landing', 'flap', 'stall', 'tuck', 'flare', 'bank', 'ruffle']) {
      expect(seen.has(k), k).toBe(true);
    }
  });
});
