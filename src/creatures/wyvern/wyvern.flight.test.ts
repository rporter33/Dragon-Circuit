// Wyvern flight motion: the wingbeat, heave, air load and turns (stream B).
//
// The wingbeat as the player sees it: each breed's stroke is sampled on the real model (rig,
// animator, skinning bones) over one beat at its own beat rate, and measured the way the capture
// sheets are read: the wingtip's elevation from the shoulder in front view, its fore-aft travel
// in side view, how far apart the tips are over the rider, and when the tip is lowest against the
// flight model's 'flap' event. Shared poses and helpers (beat(), the per-beat heights probe):
// wyvern.testkit.ts.

import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import type { BreedId } from '../../core/types';
import { BREEDS, BREED_ORDER } from '../../flight/breeds';
import { strokeForce } from '../../flight/FlightModel';
import { createWyvernPose } from '../../player/poses';
import { Wyvern } from './Wyvern';
import { FLAP_STYLES, W, bodyClock, flapPose, strokeLoad, strokePhase, strokeTravel, strokeWarp } from './wingPoses';
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

interface Sample {
  phase: number;
  /** Left wingtip relative to the left shoulder, body frame (m): x out, y up, z forward. */
  x: number;
  y: number;
  z: number;
  /** Front-view elevation of the tip from the shoulder (degrees). */
  el: number;
  /** Tip to tip (m). */
  tips: number;
  /** Membrane billow uniform of the left wing. */
  load: number;
}

/** One beat of steady flapping in a glide at 24 m/s, sampled at 240 Hz after five settling beats. */
function sampleBeat(breed: BreedId): Sample[] {
  const w = new Wyvern(look(breed));
  const p = createWyvernPose();
  p.position.set(0, 300, 0);
  p.velocity.set(0, 0, 24);
  p.airspeed = 24;
  p.airborne = true;
  p.wingSpread = 1;
  p.flapStrength = 1;
  p.lookTarget.set(0, 300, 40);
  const rate = BREEDS[breed].flapRate;
  const humerus = w.skinnedMesh!.skeleton.bones.find((b) => b.name === 'humerusL')!;
  const inv = new Quaternion();
  const L = new Vector3();
  const R = new Vector3();
  const S = new Vector3();
  const fps = 240;
  const n = Math.round(fps / rate);
  const out: Sample[] = [];
  for (let i = 0; i < 6 * n; i++) {
    p.flapPhase = ((i / fps) * rate) % 1;
    p.position.z += 24 / fps;
    p.lookTarget.z += 24 / fps;
    w.update(1 / fps, p);
    if (i < 5 * n) continue;
    w.getWingtips(L, R);
    humerus.getWorldPosition(S);
    inv.copy(p.orientation).invert();
    L.sub(p.position).applyQuaternion(inv);
    R.sub(p.position).applyQuaternion(inv);
    S.sub(p.position).applyQuaternion(inv);
    const x = L.x - S.x;
    const y = L.y - S.y;
    out.push({ phase: p.flapPhase, x, y, z: L.z - S.z, el: (Math.atan2(y, x) * 180) / Math.PI, tips: L.distanceTo(R), load: w.uniforms.uWingLoad.value.x });
  }
  w.dispose();
  return out;
}

const beats = new Map<BreedId, Sample[]>();
const stroke = (b: BreedId) => {
  let s = beats.get(b);
  if (!s) beats.set(b, (s = sampleBeat(b)));
  return s;
};

function stats(s: Sample[]) {
  let iTop = 0;
  let iBot = 0;
  for (let i = 1; i < s.length; i++) {
    if (s[i].el > s[iTop].el) iTop = i;
    if (s[i].el < s[iBot].el) iBot = i;
  }
  const top = s[iTop].el;
  const bottom = s[iBot].el;
  const range = top - bottom;
  return { s, iTop, iBot, top, bottom, range, top10: s.filter((x) => x.el > top - 0.1 * range).length / s.length };
}

const phaseDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
};

/** Tip elevation at the top of the stroke at most this (degrees): big wings beat shallow. */
const TOP_MAX: Record<BreedId, number> = { skimmer: 70, harrier: 60, galewing: 40, ironback: 55 };

describe('wingbeat: a stroke true to each breed (FANIM-01..03)', { timeout: 60000 }, () => {
  it('never claps over the back: tip elevation at the top within each breed’s limit, the tips apart over the rider', () => {
    for (const b of BREED_ORDER) {
      const { s, iTop, top } = stats(stroke(b));
      expect(top, b).toBeLessThanOrEqual(TOP_MAX[b]);
      // Well above level at the top: it is still a real wingbeat.
      expect(top, b).toBeGreaterThan(20);
      const span = BREEDS[b].wingspan;
      expect(s[iTop].tips / span, b).toBeGreaterThanOrEqual(0.25);
      for (const x of s) expect(x.tips / span, `${b} at phase ${x.phase.toFixed(3)}`).toBeGreaterThanOrEqual(0.25);
    }
  });

  it('beats differently by breed: shallow galewing, deep skimmer, deep heavy ironback', () => {
    const r = Object.fromEntries(BREED_ORDER.map((b) => [b, stats(stroke(b))])) as Record<BreedId, ReturnType<typeof stats>>;
    // The galewing glider beats through a far shallower arc than anything else.
    for (const b of ['skimmer', 'harrier', 'ironback'] as const) expect(r.galewing.range, b).toBeLessThan(r[b].range - 25);
    // Every pair of breeds differs in its top elevation or in its arc.
    for (let i = 0; i < BREED_ORDER.length; i++) {
      for (let j = i + 1; j < BREED_ORDER.length; j++) {
        const a = r[BREED_ORDER[i]];
        const c = r[BREED_ORDER[j]];
        const differ = Math.max(Math.abs(a.top - c.top), Math.abs(a.bottom - c.bottom));
        expect(differ, `${BREED_ORDER[i]} vs ${BREED_ORDER[j]}`).toBeGreaterThan(4);
      }
    }
    // The skimmer reaches highest, the ironback drives deepest.
    for (const b of ['harrier', 'galewing', 'ironback'] as const) expect(r.skimmer.top, b).toBeGreaterThan(r[b].top);
    for (const b of ['harrier', 'galewing', 'skimmer'] as const) expect(r.ironback.bottom, b).toBeLessThan(r[b].bottom);
  });

  it('drives down for most of the beat and reverses briskly at the top (no hang)', () => {
    for (const b of BREED_ORDER) {
      const { s, iTop, iBot, top10 } = stats(stroke(b));
      const down = (s[iBot].phase - s[iTop].phase + 1) % 1;
      expect(down, b).toBeGreaterThanOrEqual(0.54);
      expect(top10, b).toBeLessThanOrEqual(0.15);
    }
  });

  it('the flap event (the end of the power stroke) lands on the wingtip’s lowest point', () => {
    for (const b of BREED_ORDER) {
      const { s, iBot } = stats(stroke(b));
      expect(phaseDist(s[iBot].phase, BREEDS[b].downFrac!), b).toBeLessThanOrEqual(0.03);
    }
  });

  it('the wing is well into its travel when the stroke pushes hardest', () => {
    for (const b of BREED_ORDER) {
      const { s, top, range } = stats(stroke(b));
      const D = BREEDS[b].downFrac!;
      // strokeForce peaks at D/2.
      const at = s.reduce((a, c) => (phaseDist(c.phase, D / 2) < phaseDist(a.phase, D / 2) ? c : a));
      expect((top - at.el) / range, b).toBeGreaterThanOrEqual(0.4);
      expect((top - at.el) / range, b).toBeLessThanOrEqual(0.8);
    }
  });

  it('traces a tilted loop in side view: back at the top, ahead of the shoulder at the bottom', () => {
    for (const b of BREED_ORDER) {
      const { s, iTop, iBot, top, bottom } = stats(stroke(b));
      expect(s[iBot].z, b).toBeGreaterThan(0.3);
      expect(s[iTop].z, b).toBeLessThan(-0.3);
      // Stroke plane 20–28° from the body's vertical (down and forward).
      const tilt = (Math.atan2(s[iBot].z - s[iTop].z, s[iTop].y - s[iBot].y) * 180) / Math.PI;
      expect(tilt, b).toBeGreaterThan(20);
      expect(tilt, b).toBeLessThan(28);
      // A loop, not a line: at mid-height the tip passes ahead on the way down and behind on the
      // way up.
      const mid = (top + bottom) / 2;
      let zDown = NaN;
      let zUp = NaN;
      for (let i = 0; i < s.length; i++) {
        const a = s[i];
        const c = s[(i + 1) % s.length];
        if ((a.el - mid) * (c.el - mid) >= 0) continue;
        const z = a.z + ((mid - a.el) / (c.el - a.el)) * (c.z - a.z);
        if (c.el < a.el) zDown = z;
        else zUp = z;
      }
      expect(zDown - zUp, b).toBeGreaterThan(0.12 * BREEDS[b].wingspan);
    }
  });

  it('bows the membrane on the power stroke and lets it go slack on the recovery', () => {
    for (const b of BREED_ORDER) {
      const s = stroke(b);
      const D = BREEDS[b].downFrac!;
      const down = Math.max(...s.filter((x) => x.phase > 0.25 * D && x.phase < D).map((x) => x.load));
      const up = Math.max(...s.filter((x) => x.phase > D + 0.4 * (1 - D) && x.phase < 0.98).map((x) => x.load));
      expect(down, b).toBeGreaterThan(0.1);
      expect(up, b).toBeLessThan(down * 0.5);
    }
  });
});

describe('the beat’s shared clock', () => {
  it('strokePhase and strokeWarp reach the bottom (0.5) exactly at the breed’s downstroke fraction', () => {
    for (const b of BREED_ORDER) {
      const D = FLAP_STYLES[b].down;
      expect(D, b).toBe(BREEDS[b].downFrac);
      expect(D, b).toBeGreaterThanOrEqual(0.54);
      expect(strokePhase(0, D)).toBe(0);
      expect(strokePhase(D, D)).toBeCloseTo(0.5, 9);
      expect(strokeWarp(D, D)).toBeCloseTo(0.5, 9);
      expect(strokeTravel(D, D)).toBeCloseTo(1, 9);
      expect(strokeTravel(0, D)).toBeCloseTo(0, 9);
      // Monotonic over the beat, continuous across the wrap.
      let prev = -1;
      for (let i = 0; i < 400; i++) {
        const w = strokeWarp(i / 400, D);
        expect(w).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = w;
      }
      expect(Math.abs(strokeTravel(0.9999, D) - strokeTravel(0, D))).toBeLessThan(1e-3);
    }
  });

  it('the body moves on a smooth twin of the clock: the same top, power peak, bottom and mid-recovery, no corners', () => {
    for (const b of BREED_ORDER) {
      const D = FLAP_STYLES[b].down;
      for (const p of [0, D / 2, D, (1 + D) / 2]) expect(bodyClock(p, D), `${b} at ${p}`).toBeCloseTo(strokePhase(p, D), 9);
      expect(bodyClock(0.999999, D)).toBeCloseTo(1, 4);
      // Monotonic, and its rate never jumps (strokePhase's jumps by 30-70 % at the top and the
      // bottom, which kicked the tail into a flick on every beat).
      const n = 2000;
      const rate0 = (bodyClock(1 / n, D) - bodyClock(0, D)) * n;
      let prevRate = rate0;
      for (let i = 1; i < n - 1; i++) {
        const rate = (bodyClock((i + 1) / n, D) - bodyClock(i / n, D)) * n;
        expect(rate, `${b} at ${i / n}`).toBeGreaterThan(0);
        expect(Math.abs(rate - prevRate), `${b} at ${i / n}`).toBeLessThan(0.01);
        prevRate = rate;
      }
      // ...nor across the wrap into the next beat.
      expect(Math.abs(prevRate - rate0), b).toBeLessThan(0.02);
    }
  });

  it('each style’s warp table (what flapPose reads) matches the exact curve', () => {
    for (const b of BREED_ORDER) {
      const st = FLAP_STYLES[b];
      let worst = 0;
      for (let i = 0; i < 5000; i++) {
        const ph = i / 5000;
        const f = ph * (st.warp.length - 1);
        const j = Math.floor(f);
        const w = st.warp[j] + (st.warp[j + 1] - st.warp[j]) * (f - j);
        worst = Math.max(worst, Math.abs(w - strokeWarp(ph, st.down)));
      }
      expect(worst, b).toBeLessThan(1e-3);
    }
  });

  it('the membrane load peaks with the flight model’s power stroke', () => {
    for (const b of BREED_ORDER) {
      const st = FLAP_STYLES[b];
      let pkLoad = 0;
      let pkForce = 0;
      for (let i = 0; i < 1000; i++) {
        const ph = i / 1000;
        if (strokeLoad(ph, st) > strokeLoad(pkLoad, st)) pkLoad = ph;
        if (strokeForce(ph, st.down) > strokeForce(pkForce, st.down)) pkForce = ph;
      }
      expect(Math.abs(pkLoad - pkForce), b).toBeLessThan(0.005);
      expect(pkForce, b).toBeCloseTo(st.down / 2, 2);
      expect(strokeLoad(st.down + 0.5 * (1 - st.down), st), b).toBeLessThan(0);
    }
  });

  it('flapPose: high at the top, low at the bottom, M-folded mid-recovery (scaled by the breed’s fold)', () => {
    for (const b of BREED_ORDER) {
      const st = FLAP_STYLES[b];
      const top = flapPose(-st.lead, 0, new Float32Array(26), st);
      const bottom = flapPose(st.down - st.lead, 0, new Float32Array(26), st);
      // Elbow forward, wrist back: the M-fold through the recovery, deepest on the full-folding breeds.
      let fore = 0;
      let hand = 0;
      for (let r = 0; r < 1; r += 0.02) {
        const p = flapPose(st.down + r * (1 - st.down) - st.lead, 0, new Float32Array(26), st);
        fore = Math.min(fore, p[W.foreSw]);
        hand = Math.max(hand, p[W.handSw]);
      }
      expect(fore, b).toBeLessThan(-0.5 * st.fold);
      expect(hand, b).toBeGreaterThan(0.7 * st.fold);
      // Pronated through the downstroke, flipped to supination early in the recovery.
      expect(flapPose(0.5 * st.down - st.lead, 0, new Float32Array(26), st)[W.humTw], b).toBeGreaterThan(0.2);
      expect(flapPose(st.down + 0.2 * (1 - st.down) - st.lead, 0, new Float32Array(26), st)[W.humTw], b).toBeLessThan(-0.3);
      // The pronation flip runs through the top reversal: the arm passes the top near neutral
      // (not already pronated, which rolls the raised wing root up into the rider's legs).
      expect(Math.abs(top[W.humTw]), b).toBeLessThan(0.17);
      expect(flapPose(0.15 * st.down - st.lead, 0, new Float32Array(26), st)[W.humTw], b).toBeGreaterThan(0.25);
    }
    expect(FLAP_STYLES.galewing.fold).toBeLessThan(FLAP_STYLES.harrier.fold);
  });
});
