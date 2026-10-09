// Wyvern animator core, ground motion and life: robustness, IK and gait, the folded stance,
// landing, bask, lids, tongue, breathing, tail, exertion, the head held through the beat, and the
// capture hooks (stream C). Shared poses and helpers: wyvern.testkit.ts.

import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
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
  it('holds the head steadier than the body, trailing the shoulders it hangs from (neck lag)', () => {
    // The harrier at its retuned 1.45 Hz beat. (All four breeds are the dragon fidelity pass's job:
    // the galewing's 0.95 Hz beat still lifts the head with the chest.)
    const h = beat('harrier');
    expect(h.headRange).toBeLessThan(h.saddleRange * 0.8);
    expect(h.headRange).toBeLessThan(h.shoulderRange * 0.8);
    // The head's high point comes after the shoulders' (modulo the cycle).
    const lag = (h.headPeak - h.shoulderPeak + 1) % 1;
    expect(lag).toBeGreaterThan(0.01);
    expect(lag).toBeLessThan(0.3);
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
