// Wyvern animator core, ground motion and life: robustness, IK and gait, the folded stance,
// landing, bask, lids, tongue, breathing, tail, exertion, the head held through the beat, and the
// capture hooks (stream C). Shared poses and helpers: wyvern.testkit.ts.

import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import type { BreedId, WyvernPose } from '../../core/types';
import { BREEDS, BREED_ORDER } from '../../flight/breeds';
import { createWyvernPose } from '../../player/poses';
import { mulberry32 } from '../../core/rng';
import { Wyvern } from './Wyvern';
import { aimRotation, solveTwoBone } from './ik';
import { Gait, footPhase, type GaitContext } from './gait';
import { beat, boneWorld, gliding, look, standing } from './wyvern.testkit';

const _p = new Vector3();
const _q = new Vector3();

describe('animator robustness', { timeout: 60000 }, () => {
  it('never produces NaN under random poses, gaits, dt and teleports', () => {
    const rnd = mulberry32(42);
    const gaits = ['idle', 'walk', 'run', 'takeoff', 'landing', 'jump'] as const;
    for (const breed of BREED_ORDER) {
      const w = new Wyvern(look(breed, { tail: 'ribbon', frill: 'fan' }));
      const pose = createWyvernPose();
      const q = new Quaternion();
      for (let i = 0; i < 400; i++) {
        if (i % 50 === 0) pose.position.set((rnd() - 0.5) * 2000, 200 + rnd() * 400, (rnd() - 0.5) * 2000);
        else pose.position.addScaledVector(pose.velocity, 1 / 60);
        q.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
        pose.orientation.slerp(q, 0.05);
        pose.velocity.set((rnd() - 0.5) * 60, (rnd() - 0.5) * 30, (rnd() - 0.5) * 60);
        pose.angularVelocity.set((rnd() - 0.5) * 4, (rnd() - 0.5) * 4, (rnd() - 0.5) * 4);
        pose.airborne = rnd() > 0.3;
        pose.airspeed = rnd() * 80;
        pose.wingSpread = 0.2 + rnd() * 0.8;
        pose.flapPhase = rnd();
        pose.flapStrength = rnd();
        pose.flare = rnd();
        pose.stall = rnd();
        pose.fatigue = rnd();
        pose.gait = gaits[Math.floor(rnd() * gaits.length)];
        pose.gaitTime = rnd() * 2;
        pose.groundSpeed = rnd() * 10;
        pose.groundY = rnd() > 0.5 ? pose.position.y - BREEDS[breed].standHeight : null;
        pose.lookTarget.set(rnd() * 100, rnd() * 100, rnd() * 100);
        const dt = [0, 1 / 144, 1 / 60, 1 / 30, 0.1, 0.5][Math.floor(rnd() * 6)];
        w.update(dt, pose);
        let ok = true;
        for (const b of w.skinnedMesh!.skeleton.bones) {
          ok &&= Number.isFinite(b.quaternion.x + b.quaternion.y + b.quaternion.z + b.quaternion.w);
          ok &&= Number.isFinite(b.position.x + b.position.y + b.position.z + b.scale.x);
        }
        w.getWingtips(_p, _q);
        ok &&= Number.isFinite(_p.x + _p.y + _p.z + _q.x + _q.y + _q.z);
        if (!ok) throw new Error(`non-finite pose at step ${i} (${breed})`);
      }
      w.dispose();
    }
  });

  it('keeps the tail attached and its segments rigid while whipping through turns', () => {
    const w = new Wyvern(look('harrier'));
    const pose = gliding();
    const yaw = new Quaternion();
    for (let i = 0; i < 240; i++) {
      // Hard yaw back and forth.
      yaw.setFromAxisAngle(new Vector3(0, 1, 0), Math.sin(i / 20) * 1.2);
      pose.orientation.copy(yaw);
      pose.angularVelocity.set(0, Math.cos(i / 20) * 1.2 * 3, 0);
      pose.position.addScaledVector(pose.velocity, 1 / 60);
      w.update(1 / 60, pose);
    }
    const bones = w.skinnedMesh!.skeleton.bones;
    const names = Array.from({ length: 10 }, (_, i) => `tail${i}`);
    const rig = w.rigDef;
    for (let i = 0; i < names.length - 1; i++) {
      const a = bones.find((b) => b.name === names[i])!.getWorldPosition(new Vector3());
      const b = bones.find((b) => b.name === names[i + 1])!.getWorldPosition(new Vector3());
      const bind = rig.bones[rig.idx.tail[i]].pos.distanceTo(rig.bones[rig.idx.tail[i + 1]].pos);
      expect(a.distanceTo(b)).toBeCloseTo(bind, 3);
    }
    w.dispose();
  });
});

/** Tail segment directions (body frame) after the last update, root → tip, plus the pelvis's rest direction for segment 0. */
function tailDirs(w: Wyvern): { dirs: Vector3[]; base: Vector3 } {
  const a = (w as unknown as { animator: { modelQ: Quaternion[]; parent: number[] } }).animator;
  const rig = w.rigDef;
  const T = rig.idx.tail;
  const dirs = T.map((b, i) => {
    const q = i + 1 < T.length ? rig.bones[T[i + 1]].pos : rig.tailTip;
    return q.clone().sub(rig.bones[b].pos).normalize().applyQuaternion(a.modelQ[b]);
  });
  const base = rig.bones[T[1]].pos.clone().sub(rig.bones[T[0]].pos).normalize().applyQuaternion(a.modelQ[a.parent[T[0]]]);
  return { dirs, base };
}

const angleDeg = (a: Vector3, b: Vector3) => (Math.acos(Math.min(1, a.dot(b))) * 180) / Math.PI;

/**
 * Two seconds (after a settle) of a ground walk or run, a flapping climb, or a flared landing, at
 * 60 fps with a render-only (dt 0) frame after every second update, as the capture harness and a
 * paused game do. Reports the largest bend between tail segments (joints past the root), the root
 * joint's, and the tip's pitch excursion over the last wingbeat.
 */
function tailRun(breed: BreedId, kind: 'walk' | 'run' | 'flap' | 'landing') {
  const B = BREEDS[breed];
  const sh = B.standHeight;
  const w = new Wyvern(look(breed));
  const pose: WyvernPose = kind === 'flap' ? gliding() : standing(breed);
  if (kind === 'flap') pose.flapStrength = 1;
  let maxJoint = 0;
  let maxRoot = 0;
  const tip: number[] = [];
  const frames = kind === 'landing' ? 90 + 150 : 60 + 120;
  for (let i = 0; i < frames; i++) {
    if (kind === 'walk' || kind === 'run') {
      const v = kind === 'walk' ? 0.4 * B.groundSpeed : B.groundSpeed;
      pose.gait = kind;
      pose.groundSpeed = v;
      pose.velocity.set(0, 0, v);
      pose.position.z += v / 60;
      pose.lookTarget.z += v / 60;
    } else if (kind === 'flap') {
      pose.flapPhase = ((i / 60) * B.flapRate) % 1;
      pose.position.z += 24 / 60;
      pose.lookTarget.z += 24 / 60;
    } else if (i < 90) {
      // Flaring in, sinking at 6 m/s, then down hard.
      pose.airborne = true;
      pose.wingSpread = 1;
      pose.flare = 1;
      pose.flapStrength = 0.5;
      pose.flapPhase = ((i / 60) * B.flapRate) % 1;
      pose.velocity.set(0, -6, 6);
      pose.position.y = 10 + sh + (90 - i) * 0.05;
    } else {
      pose.airborne = false;
      pose.wingSpread = 0.22;
      pose.flare = 0;
      pose.flapStrength = 0;
      pose.velocity.set(0, 0, 0);
      pose.position.y = 10 + sh;
      pose.gait = i < 130 ? 'landing' : 'idle';
    }
    w.update(1 / 60, pose);
    if (i % 2 === 1) w.update(0, pose);
    if (kind !== 'landing' && i < 60) continue;
    const { dirs, base } = tailDirs(w);
    for (let j = 1; j < dirs.length; j++) maxJoint = Math.max(maxJoint, angleDeg(dirs[j], dirs[j - 1]));
    maxRoot = Math.max(maxRoot, angleDeg(dirs[0], base));
    const d = dirs[dirs.length - 1];
    tip.push((Math.atan2(d.y, -d.z) * 180) / Math.PI);
  }
  w.dispose();
  const beat = tip.slice(-Math.round(60 / B.flapRate));
  return { maxJoint, maxRoot, tipExcursion: (Math.max(...beat) - Math.min(...beat)) / 2 };
}

describe('the tail: a heavy reptile counterweight (C1)', { timeout: 120000 }, () => {
  it('never kinks: every joint stays inside its cone in the walk, run, flapping and landing, for every breed', () => {
    for (const breed of BREED_ORDER) {
      // 20° on the light skimmer's whippy tail, 15° on the others.
      const limit = breed === 'skimmer' ? 20 : 15;
      for (const kind of ['walk', 'run', 'flap', 'landing'] as const) {
        const r = tailRun(breed, kind);
        expect(r.maxJoint, `${breed} ${kind}`).toBeLessThan(limit + 0.01);
        // The root joint follows the authored curve (down to −14° in the flare) within its cone.
        expect(r.maxRoot, `${breed} ${kind} root`).toBeLessThan(24);
      }
    }
  });

  it('sends a gentle wave down the tail on each wingbeat, not a flick at the tip', () => {
    for (const breed of BREED_ORDER) {
      const r = tailRun(breed, 'flap');
      expect(r.tipExcursion, breed).toBeLessThan(breed === 'ironback' ? 15 : 20);
    }
  });

  it('hangs in an S air brake while flaring: dropped at the root, curling back up toward the tip', () => {
    for (const breed of BREED_ORDER) {
      const w = new Wyvern(look(breed));
      const pose = gliding();
      pose.airspeed = 12;
      pose.velocity.set(0, -1, 12);
      pose.flare = 1;
      pose.flapStrength = 0.6;
      for (let i = 0; i < 180; i++) {
        pose.flapPhase = ((i / 60) * BREEDS[breed].flapRate) % 1;
        pose.position.addScaledVector(pose.velocity, 1 / 60);
        w.update(1 / 60, pose);
      }
      const { dirs, base } = tailDirs(w);
      const pitch = (v: Vector3) => Math.atan2(v.y, Math.hypot(v.x, v.z));
      // The root bends down from the pelvis...
      expect(pitch(dirs[0]) - pitch(base), breed).toBeLessThan(-0.12);
      // ...and the distal half curls back up.
      expect(pitch(dirs[dirs.length - 1]) - pitch(dirs[4]), breed).toBeGreaterThan(0.12);
      w.dispose();
    }
  });

  it('settles at rest: the tail sinks to the ground in a sideways S, and holds still', () => {
    for (const breed of ['harrier', 'ironback'] as const) {
      const sh = BREEDS[breed].standHeight;
      const w = new Wyvern(look(breed));
      const pose = standing(breed);
      for (let i = 0; i < 60 * 8; i++) w.update(1 / 60, pose);
      const pts = Array.from({ length: 10 }, (_, k) => boneWorld(w, `tail${k}`));
      // Low at the tip (lying out along the ground)...
      expect(pts[9].y - 10, breed).toBeLessThan(0.35 * sh);
      // ...curved to one side and back (the lateral offset's slope changes sign: an S, not a C).
      const slopes = pts.slice(1).map((p, k) => (p.x - pts[k].x) / Math.max(1e-6, pts[k].z - p.z));
      expect(Math.max(...slopes) * Math.min(...slopes), breed).toBeLessThan(0);
      // Still: over the next two seconds the tip moves less than 5 cm.
      const tip0 = pts[9].clone();
      let drift = 0;
      for (let i = 0; i < 120; i++) {
        w.update(1 / 60, pose);
        drift = Math.max(drift, boneWorld(w, 'tail9').distanceTo(tip0));
      }
      expect(drift, breed).toBeLessThan(0.05);
      w.dispose();
    }
  });

  it('ignores render-only frames: a dt 0 update changes nothing', () => {
    const a = new Wyvern(look('harrier'));
    const b = new Wyvern(look('harrier'));
    const pa = standing('harrier');
    const pb = standing('harrier');
    for (let i = 0; i < 120; i++) {
      for (const p of [pa, pb]) {
        p.gait = 'run';
        p.groundSpeed = 9;
        p.velocity.set(0, 0, 9);
        p.position.z += 9 / 60;
        p.lookTarget.z += 9 / 60;
      }
      a.update(1 / 60, pa);
      b.update(1 / 60, pb);
      b.update(0, pb);
    }
    const ba = a.skinnedMesh!.skeleton.bones;
    const bb = b.skinnedMesh!.skeleton.bones;
    // (Component differences: an angle from acos near 1 turns 1e-13 of rounding into 1e-6 rad.)
    for (let i = 0; i < ba.length; i++) {
      const qa = ba[i].quaternion;
      const qb = bb[i].quaternion;
      const d = Math.max(Math.abs(qa.x - qb.x), Math.abs(qa.y - qb.y), Math.abs(qa.z - qb.z), Math.abs(qa.w - qb.w));
      expect(d, ba[i].name).toBeLessThan(1e-9);
    }
    a.dispose();
    b.dispose();
  });
});

describe('pure helpers', () => {
  it('two-bone IK preserves segment lengths and bends toward the pole', () => {
    const root = new Vector3(0, 0, 0);
    const target = new Vector3(0, -1.5, 0.3);
    const mid = new Vector3();
    solveTwoBone(root, 1, 1, target, new Vector3(0, 0, 1), mid);
    expect(mid.distanceTo(root)).toBeCloseTo(1, 5);
    expect(mid.distanceTo(target)).toBeCloseTo(1, 5);
    expect(mid.z).toBeGreaterThan(0.3);
    // Out of reach: stays straight toward the target.
    const far = solveTwoBone(root, 1, 1, new Vector3(0, -5, 0), new Vector3(0, 0, 1), mid);
    expect(far).toBeGreaterThan(2.9);
    expect(mid.y).toBeLessThan(-0.99);
  });

  it('aimRotation maps a rest direction onto a target direction', () => {
    const q = new Quaternion();
    const rest = new Vector3(1, 0, 0);
    const dir = new Vector3(0.2, -0.9, 0.4).normalize();
    aimRotation(rest, new Vector3(0, 1, 0), dir, new Vector3(0, 0, 1), q);
    const out = rest.clone().applyQuaternion(q);
    expect(out.distanceTo(dir)).toBeLessThan(1e-6);
  });

  it('gait: planted feet never slide while the body walks and turns', () => {
    const rest = [new Vector3(0.5, -2.6, -0.8), new Vector3(-0.5, -2.6, -0.8), new Vector3(1.2, -2.6, 1.5), new Vector3(-1.2, -2.6, 1.5)];
    const gait = new Gait(rest);
    const body = new Vector3(0, 2.6, 0);
    let yaw = 0;
    const q = new Quaternion();
    const ctx: GaitContext = {
      dt: 1 / 60,
      toWorld: (m, out) => out.copy(m).applyQuaternion(q).add(body),
      groundAt: () => 0,
      velocity: new Vector3(),
      yawRate: 0.4,
      standHeight: 2.6,
      runBlend: 0,
      moving: true,
    };
    const last = rest.map(() => new Vector3());
    const wasPlanted = [false, false, false, false];
    let swings = 0;
    for (let i = 0; i < 600; i++) {
      yaw += 0.4 / 60;
      q.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
      ctx.velocity.set(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(3);
      body.addScaledVector(ctx.velocity, 1 / 60);
      gait.update(ctx);
      gait.feet.forEach((f, k) => {
        if (!f.swinging && wasPlanted[k]) expect(f.pos.distanceTo(last[k])).toBeLessThan(1e-9);
        if (f.swinging && wasPlanted[k]) swings++;
        // Feet stay near the body.
        expect(Math.hypot(f.pos.x - body.x, f.pos.z - body.z)).toBeLessThan(4);
        wasPlanted[k] = !f.swinging;
        last[k].copy(f.pos);
      });
    }
    expect(swings).toBeGreaterThan(20);
    expect(footPhase(0.1, 0, 0.6).swing).toBe(false);
    expect(footPhase(0.7, 0, 0.6).swing).toBe(true);
  });
});

describe('weight and life (client direction: a big, heavy dragon)', { timeout: 60000 }, () => {
  it('holds the head steadier than the body, trailing the shoulders it hangs from (neck lag), on every breed and beat rate', () => {
    // The head-height hold (C12) holds it on the slow galewing and ironback beats as well as the
    // quick ones (before it, the galewing's 0.95 Hz beat lifted the head with the chest: 1.05× the
    // saddle's travel).
    for (const breed of BREED_ORDER) {
      const h = beat(breed);
      expect(h.headRange, breed).toBeLessThan(h.saddleRange * 0.55);
      expect(h.headRange, breed).toBeLessThan(h.shoulderRange * 0.55);
      // The head's high point comes after the shoulders' (modulo the cycle).
      const lag = (h.headPeak - h.shoulderPeak + 1) % 1;
      expect(lag, breed).toBeGreaterThan(0.01);
      expect(lag, breed).toBeLessThan(0.3);
    }
  });

  it('folds the wings back along the flank on the ground: tips up off the ground, behind the shoulder (VIS-17)', () => {
    for (const breed of BREED_ORDER) {
      const w = new Wyvern(look(breed));
      const pose = standing(breed);
      for (let i = 0; i < 120; i++) w.update(1 / 60, pose);
      const l = new Vector3();
      const r = new Vector3();
      w.getWingtips(l, r);
      const sh = BREEDS[breed].standHeight;
      const shoulder = boneWorld(w, 'humerusL');
      for (const tip of [l, r]) {
        // Not a second pair of stilts: the tips ride well above the ground...
        expect(tip.y - 10).toBeGreaterThan(0.5 * sh);
        // ...back along the body, behind the shoulder, and close in to the flank.
        expect(tip.z).toBeLessThan(shoulder.z - 0.4);
        expect(Math.abs(tip.x)).toBeLessThan(BREEDS[breed].wingspan * 0.2);
      }
      expect(w.uniforms.uFold.value).toBeGreaterThan(0.95);
      w.dispose();
    }
  });

  it('settles on landing: the body sinks into the legs and springs back', () => {
    const w = new Wyvern(look('harrier'));
    const sh = BREEDS.harrier.standHeight;
    const pose = standing('harrier');
    pose.airborne = true;
    pose.wingSpread = 1;
    pose.velocity.set(0, -6, 6);
    for (let i = 0; i < 30; i++) w.update(1 / 60, pose);
    pose.airborne = false;
    pose.wingSpread = 0.22;
    pose.velocity.set(0, 0, 0);
    const ys: number[] = [];
    for (let i = 0; i < 150; i++) {
      w.update(1 / 60, pose);
      ys.push(w.saddle.getWorldPosition(_p).y);
    }
    const rest = ys[ys.length - 1];
    const low = Math.min(...ys.slice(0, 40));
    // A visible sink (several cm on a hard landing), then back to rest.
    expect(rest - low).toBeGreaterThan(0.04);
    expect(rest - low).toBeLessThan(0.5 * sh);
    expect(Math.abs(ys[ys.length - 2] - rest)).toBeLessThan(0.005);
    w.dispose();
  });

  it('stretches and basks after resting: neck up, a slight gape, wings spread wide, then folds away', () => {
    const w = new Wyvern(look('harrier'));
    const pose = standing('harrier');
    for (let i = 0; i < 120; i++) w.update(1 / 60, pose);
    const l0 = new Vector3();
    const r0 = new Vector3();
    w.getWingtips(l0, r0);
    const head0 = w.getHead(new Vector3()).y;
    const jaw = w.skinnedMesh!.skeleton.bones.find((b) => b.name === 'jaw')!;
    let span = 0;
    let headUp = 0;
    let gape = 0;
    let lids = 1;
    let fold = 1;
    const dur = (w as unknown as { animator: { baskDuration: number } }).animator.baskDuration;
    expect(dur).toBeGreaterThan(2.5);
    // The player drives ruffle 0 -> 1 over 1.4 s; the animator plays its own, slower bask.
    for (let i = 0; i < 60 * 4.5; i++) {
      pose.ruffle = i < 84 ? i / 84 : 0;
      w.update(1 / 60, pose);
      w.getWingtips(_p, _q);
      span = Math.max(span, _p.distanceTo(_q));
      headUp = Math.max(headUp, w.getHead(_p).y - head0);
      gape = Math.max(gape, 2 * Math.acos(Math.min(1, Math.abs(jaw.quaternion.w))));
      // Through the full bask the eyes stay half-lidded (a blink only closes them further).
      const u = i / 60 / dur;
      if (u > 0.55 && u < 0.75) lids = Math.min(lids, w.uniforms.uBlink.value);
      fold = Math.min(fold, w.uniforms.uFold.value);
    }
    // Wings spread wide (most of the span), membranes unfolded to the light.
    expect(span).toBeGreaterThan(0.7 * BREEDS.harrier.wingspan);
    expect(fold).toBeLessThan(0.2);
    // The neck reaches up; a slight gape, not a yawn; eyes half-lidded in the sun.
    expect(headUp).toBeGreaterThan(0.25);
    expect(gape).toBeGreaterThan(0.08);
    expect(gape).toBeLessThan(0.3);
    expect(lids).toBeGreaterThan(0.3);
    // ...and settles back into the folded stance.
    for (let i = 0; i < 120; i++) w.update(1 / 60, pose);
    w.getWingtips(_p, _q);
    expect(_p.distanceTo(l0)).toBeLessThan(0.1);
    expect(w.uniforms.uFold.value).toBeGreaterThan(0.95);
    w.dispose();
  });

  it('cuts the bask short, smoothly, when the wyvern walks off', () => {
    const w = new Wyvern(look('harrier'));
    const pose = standing('harrier');
    for (let i = 0; i < 60; i++) w.update(1 / 60, pose);
    for (let i = 0; i < 100; i++) {
      pose.ruffle = Math.min(1, i / 84);
      w.update(1 / 60, pose);
    }
    expect(w.uniforms.uFold.value).toBeLessThan(0.6);
    pose.gait = 'walk';
    pose.groundSpeed = 2;
    pose.velocity.set(0, 0, 2);
    let last = w.uniforms.uFold.value;
    let maxStep = 0;
    for (let i = 0; i < 90; i++) {
      pose.position.z += 2 / 60;
      pose.lookTarget.z += 2 / 60;
      w.update(1 / 60, pose);
      maxStep = Math.max(maxStep, Math.abs(w.uniforms.uFold.value - last));
      last = w.uniforms.uFold.value;
    }
    expect(last).toBeGreaterThan(0.9);
    expect(maxStep).toBeLessThan(0.12);
    w.dispose();
  });

  it('blinks like a reptile: sideways sweeps of the nictitating membrane, held half-drawn in a fast dive', () => {
    const w = new Wyvern(look('harrier'));
    const pose = standing('harrier');
    let nict = 0;
    let both = 0;
    for (let i = 0; i < 60 * 12; i++) {
      w.update(1 / 60, pose);
      nict = Math.max(nict, w.uniforms.uNictitate.value);
      if (w.uniforms.uNictitate.value > 0.5 && w.uniforms.uBlink.value > 0.5) both++;
    }
    expect(nict).toBeGreaterThan(0.9);
    // The inner and outer lids are separate.
    expect(both).toBeLessThan(5);
    const dive = gliding();
    dive.airspeed = 62;
    dive.velocity.set(0, -40, 47);
    let minN = 1;
    for (let i = 0; i < 120; i++) {
      w.update(1 / 60, dive);
      if (i > 60) minN = Math.min(minN, w.uniforms.uNictitate.value);
    }
    expect(minN).toBeGreaterThan(0.4);
    w.dispose();
  });

  it('flicks a forked tongue out past the snout to taste the air when idle, never in flight', () => {
    const w = new Wyvern(look('harrier'));
    const anim = (w as unknown as { animator: { tongueExt: number } }).animator;
    const pose = standing('harrier');
    const L = w.rigDef.props.shape.headLength;
    let out = 0;
    for (let i = 0; i < 60 * 14; i++) {
      w.update(1 / 60, pose);
      out = Math.max(out, anim.tongueExt);
    }
    // The fork (0.92 of the head length at rest) slides out beyond the snout tip (1.0).
    expect(out / L).toBeGreaterThan(0.3);
    const air = gliding();
    let flying = 0;
    for (let i = 0; i < 60 * 14; i++) {
      w.update(1 / 60, air);
      flying = Math.max(flying, anim.tongueExt);
    }
    expect(flying).toBe(0);
    w.dispose();
  });

  it('breathes with its ribs: the flanks swell sideways, the body hardly rises', () => {
    const w = new Wyvern(look('harrier'));
    const pose = standing('harrier');
    const br = w.skinnedMesh!.skeleton.bones.find((b) => b.name === 'breath')!;
    let sx = 0;
    let sy = 0;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < 60 * 8; i++) {
      w.update(1 / 60, pose);
      sx = Math.max(sx, Math.abs(br.scale.x - 1));
      sy = Math.max(sy, Math.abs(br.scale.y - 1));
      if (i > 120) {
        const y = w.saddle.getWorldPosition(_p).y;
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
    expect(sx).toBeGreaterThan(0.025);
    expect(sx).toBeGreaterThan(sy * 3);
    expect(y1 - y0).toBeLessThan(0.02);
    w.dispose();
  });

  it('swings the tail against the head as a counterweight on the ground', () => {
    const tailX = (target: number) => {
      const w = new Wyvern(look('harrier'));
      const pose = standing('harrier');
      pose.lookTarget.set(target, 13, 6);
      for (let i = 0; i < 240; i++) w.update(1 / 60, pose);
      const x = boneWorld(w, 'tail9').x;
      w.dispose();
      return x;
    };
    // Looking left (+x), the tail swings right (-x), and the other way round.
    expect(tailX(30)).toBeLessThan(tailX(-30) - 0.5);
  });

  it('greets its rider on a called arrival: the head comes down and round to them, a nictitating sweep, a tongue burst (C2)', () => {
    for (const breed of BREED_ORDER) {
      const sh = BREEDS[breed].standHeight;
      const w = new Wyvern(look(breed));
      const pose = standing(breed);
      // The rider beside its near (left) shoulder, where a called wyvern stops (player/companion.ts).
      const riderHead = new Vector3(0.42 * sh + 1.2, 10 + 1.6, 0.4 * sh);
      pose.lookTarget.copy(riderHead);
      w.cueIdle(null, 1e4);
      for (let i = 0; i < 180; i++) w.update(1 / 60, pose);
      const y0 = w.getHead(_p).y;
      const d0 = _p.distanceTo(riderHead);
      pose.cue = { kind: 'greet', id: 1 };
      let nict = 0;
      let tongue = 0;
      for (let i = 0; i < 90; i++) {
        w.update(1 / 60, pose);
        nict = Math.max(nict, w.uniforms.uNictitate.value);
        tongue = Math.max(tongue, (w as unknown as { animator: { tongueExt: number } }).animator.tongueExt);
      }
      // Within 1.5 s the head is well down and in toward the rider, the mouth still clear of them.
      const mouth = w.getHead(_p);
      expect(y0 - mouth.y).toBeGreaterThan(0.25 * sh);
      expect(d0 - mouth.distanceTo(riderHead)).toBeGreaterThan(0.25 * sh);
      expect(mouth.distanceTo(riderHead)).toBeGreaterThan(0.8);
      // ...facing them (the head's forward within 60° of the way to their face).
      const head = w.skinnedMesh!.skeleton.bones.find((b) => b.name === 'head')!;
      const fwd = new Vector3(0, 0, 1).applyQuaternion(head.getWorldQuaternion(new Quaternion()));
      expect(fwd.dot(riderHead.clone().sub(mouth).normalize())).toBeGreaterThan(Math.cos((60 * Math.PI) / 180));
      expect(nict).toBeGreaterThan(0.9);
      expect(tongue).toBeGreaterThan(0);
      // A cue plays once: the same id again does nothing; and the head comes back up afterwards.
      for (let i = 0; i < 180; i++) w.update(1 / 60, pose);
      expect(w.getHead(_p).y).toBeGreaterThan(y0 - 0.15);
      w.dispose();
    }
  });

  it('builds up exertion on a long climb and pants it off at rest', () => {
    const w = new Wyvern(look('harrier'));
    const pose = gliding();
    pose.flapStrength = 1;
    for (let i = 0; i < 60 * 12; i++) {
      pose.flapPhase = ((i / 60) * 1.6) % 1;
      w.update(1 / 60, pose);
    }
    const anim = (w as unknown as { animator: { exertion: number } }).animator;
    const after = anim.exertion;
    expect(after).toBeGreaterThan(0.4);
    const rest = standing('harrier');
    for (let i = 0; i < 60 * 10; i++) w.update(1 / 60, rest);
    expect(anim.exertion).toBeLessThan(after - 0.4);
    w.dispose();
  });
});

describe('debug capture hooks (scripts/dragon-capture.mjs)', () => {
  const tongueOf = (w: Wyvern) => (w as unknown as { animator: { tongueExt: number } }).animator.tongueExt;

  it('holds the natural idle events off, then plays each cued one', () => {
    const w = new Wyvern(look('harrier'));
    const pose = standing('harrier');
    w.cueIdle(null, 1e4);
    const peak = { lid: 0, nict: 0, tongue: 0 };
    const run = (seconds: number) => {
      peak.lid = peak.nict = peak.tongue = 0;
      for (let i = 0; i < seconds * 60; i++) {
        w.update(1 / 60, pose);
        peak.lid = Math.max(peak.lid, w.uniforms.uBlink.value);
        peak.nict = Math.max(peak.nict, w.uniforms.uNictitate.value);
        peak.tongue = Math.max(peak.tongue, tongueOf(w));
      }
    };
    run(12);
    expect(peak).toEqual({ lid: 0, nict: 0, tongue: 0 });
    w.cueIdle('blink');
    run(0.5);
    expect(peak.lid).toBeGreaterThan(0.9);
    expect(peak.nict + peak.tongue).toBe(0);
    w.cueIdle('nictitate');
    run(0.5);
    expect(peak.nict).toBeGreaterThan(0.9);
    w.cueIdle('tongue');
    run(0.5);
    expect(peak.tongue).toBeGreaterThan(0.01);
    w.dispose();
  });

  it('resetAnimation makes a re-staged wyvern move exactly like a new one', () => {
    const a = new Wyvern(look('ironback'));
    const b = new Wyvern(look('ironback'));
    const pose = standing('ironback');
    for (let i = 0; i < 150; i++) a.update(1 / 60, gliding());
    a.resetAnimation();
    for (let i = 0; i < 45; i++) {
      a.update(1 / 60, pose);
      b.update(1 / 60, pose);
    }
    const ba = a.skinnedMesh!.skeleton.bones;
    const bb = b.skinnedMesh!.skeleton.bones;
    for (let i = 0; i < ba.length; i++) {
      expect(ba[i].quaternion.angleTo(bb[i].quaternion)).toBeLessThan(1e-6);
      expect(ba[i].position.distanceTo(bb[i].position)).toBeLessThan(1e-9);
    }
    a.dispose();
    b.dispose();
  });
});
