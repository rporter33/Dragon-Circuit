// Wyvern flight motion: the wingbeat, heave, air load and turns (stream B).
// Shared poses and helpers (beat(), the per-beat heights probe): wyvern.testkit.ts.

import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { BREEDS, BREED_ORDER } from '../../flight/breeds';
import { Wyvern } from './Wyvern';
import { flapPose, heavyStroke, stroke, strokeLoad, upstrokeFold, W } from './wingPoses';
import { beat, gliding, look } from './wyvern.testkit';

const _p = new Vector3();
const _q = new Vector3();

describe('accessors', () => {
  it('reports wingtips about a span apart in a glide and close together in a tuck', () => {
    for (const breed of BREED_ORDER) {
      const w = new Wyvern(look(breed));
      const pose = gliding();
      for (let i = 0; i < 30; i++) w.update(1 / 60, pose);
      const l = new Vector3();
      const r = new Vector3();
      w.getWingtips(l, r);
      const span = BREEDS[breed].wingspan;
      expect(l.distanceTo(r)).toBeGreaterThan(0.85 * span);
      expect(l.distanceTo(r)).toBeLessThan(1.01 * span);
      // Left wing is +X in body space.
      expect(l.x).toBeGreaterThan(r.x);
      pose.wingSpread = 0.25;
      pose.airspeed = 60;
      for (let i = 0; i < 60; i++) w.update(1 / 60, pose);
      w.getWingtips(l, r);
      expect(l.distanceTo(r)).toBeLessThan(0.45 * span);
      w.dispose();
    }
  });
});

describe('pure helpers', () => {
  it('flap cycle: wings high at 0, low at 0.5, folded on the upstroke', () => {
    expect(stroke(0)).toBeCloseTo(0);
    expect(stroke(0.5)).toBeCloseTo(1);
    expect(upstrokeFold(0.25)).toBe(0);
    expect(upstrokeFold(0.75)).toBeCloseTo(1, 3);
    const top = flapPose(0, 0, new Float32Array(26));
    const bottom = flapPose(0.5, 0, new Float32Array(26));
    const up = flapPose(0.75, 0, new Float32Array(26));
    expect(top[W.humEl]).toBeGreaterThan(0.6);
    expect(bottom[W.humEl]).toBeLessThan(-0.4);
    // Upstroke: elbow flexed forward, wrist folded back.
    expect(up[W.foreSw]).toBeLessThan(-0.4);
    expect(up[W.handSw]).toBeGreaterThan(0.5);
  });
});

describe('weight and life (client direction: a big, heavy dragon)', { timeout: 60000 }, () => {
  it('heaves the saddle up through the downstroke and lets it sink on the recovery; heavier breeds heave more', () => {
    const h = beat('harrier');
    // Highest around the bottom of the stroke (phase 0.5), lowest near the top.
    expect(h.saddlePeak).toBeGreaterThan(0.35);
    expect(h.saddlePeak).toBeLessThan(0.65);
    expect(h.saddleRange).toBeGreaterThan(0.15);
    expect(h.saddleRange).toBeLessThan(0.6);
    expect(beat('ironback').saddleRange).toBeGreaterThan(beat('skimmer').saddleRange * 1.4);
  });

  it('hangs at the top of the stroke and loads the wing hardest on the way down', () => {
    // Same endpoints as the plain stroke, so the flap event still lands at the bottom.
    expect(heavyStroke(0, 1)).toBeCloseTo(0);
    expect(heavyStroke(0.5, 1)).toBeCloseTo(1);
    // The heavy wing has barely left the top a fifth of the way into the downstroke.
    expect(heavyStroke(0.1, 1)).toBeLessThan(stroke(0.1) * 0.75);
    // Load: positive through the downstroke, slack (negative) on the recovery.
    expect(strokeLoad(0.3)).toBeGreaterThan(0.8);
    expect(strokeLoad(0.75)).toBeLessThan(0);
    // A loaded wing bows its membrane up (billow uniform) on the downstroke.
    const w = new Wyvern(look('harrier'));
    const pose = gliding();
    pose.flapStrength = 1;
    let down = 0;
    let up = 0;
    for (let i = 0; i < 240; i++) {
      pose.flapPhase = ((i / 60) * 1.6) % 1;
      w.update(1 / 60, pose);
      const b = w.uniforms.uWingLoad.value.x;
      if (pose.flapPhase > 0.3 && pose.flapPhase < 0.45) down = Math.max(down, b);
      if (pose.flapPhase > 0.75 && pose.flapPhase < 0.95) up = Math.max(up, b);
    }
    expect(down).toBeGreaterThan(0.15);
    expect(up).toBeLessThan(down * 0.5);
    w.dispose();
  });

  it('works the outer wing harder in a banked turn', () => {
    const w = new Wyvern(look('harrier'));
    const pose = gliding();
    pose.flapStrength = 1;
    // Banked 35° right and turning right: the left wing (+X) is the outer one.
    pose.orientation.setFromAxisAngle(new Vector3(0, 0, 1), 0.6);
    pose.angularVelocity.set(0, -0.5, 0.1);
    let hiL = -Infinity;
    let loL = Infinity;
    let hiR = -Infinity;
    let loR = Infinity;
    let loadL = 0;
    let loadR = 0;
    for (let i = 0; i < 300; i++) {
      pose.flapPhase = ((i / 60) * 1.6) % 1;
      w.update(1 / 60, pose);
      if (i < 120) continue;
      w.getWingtips(_p, _q);
      // Tip heights in the body frame.
      const inv = pose.orientation.clone().invert();
      const l = _p.clone().sub(pose.position).applyQuaternion(inv).y;
      const r = _q.clone().sub(pose.position).applyQuaternion(inv).y;
      hiL = Math.max(hiL, l);
      loL = Math.min(loL, l);
      hiR = Math.max(hiR, r);
      loR = Math.min(loR, r);
      loadL = Math.max(loadL, w.uniforms.uWingLoad.value.x);
      loadR = Math.max(loadR, w.uniforms.uWingLoad.value.y);
    }
    expect(hiL - loL).toBeGreaterThan((hiR - loR) * 1.1);
    expect(loadL).toBeGreaterThan(loadR * 1.15);
    w.dispose();
  });
});
