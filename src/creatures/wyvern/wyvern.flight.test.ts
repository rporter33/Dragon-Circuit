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
import { DEG } from '../../core/math';
import { BREEDS, BREED_ORDER } from '../../flight/breeds';
import { strokeForce } from '../../flight/FlightModel';
import { createWyvernPose } from '../../player/poses';
import { Wyvern } from './Wyvern';
import { FLAP_STYLES, W, bodyClock, flapPose, strokeLoad, strokePhase, strokeTravel, strokeWarp } from './wingPoses';
import { beat, gliding, look, standing } from './wyvern.testkit';

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
    for (const b of BREED_ORDER.filter((id) => id !== 'galewing')) expect(r.galewing.range, b).toBeLessThan(r[b].range - 25);
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
    for (const b of BREED_ORDER.filter((id) => id !== 'skimmer')) expect(r.skimmer.top, b).toBeGreaterThan(r[b].top);
    for (const b of BREED_ORDER.filter((id) => id !== 'ironback')) expect(r.ironback.bottom, b).toBeLessThan(r[b].bottom);
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

/** The animator's per-frame record (the cross-stream signals the flight layer writes). */
const frameOf = (w: Wyvern) => (w as unknown as { animator: { frame: { lookLead: number; tailSteer: number; lean: number } } }).animator.frame;

/**
 * A roll to the right from a level glide, as the flight model flies it: the stick goes over at
 * t = 0 and the body's roll rate spins up toward the breed's top rate over about a third of a
 * second (FlightModel.measureRoll), banking to `bankTo` and holding it. Calls `sample` every frame
 * from the step on with the time since the step. `stick` false: a ghost (no control recorded).
 */
function rollRight(breed: BreedId, sample: (t: number, w: Wyvern) => void, opts: { stick?: boolean; bankTo?: number; seconds?: number } = {}) {
  const { stick = true, bankTo = 0.6, seconds = 2 } = opts;
  const w = new Wyvern(look(breed));
  const p = gliding();
  if (stick) p.control = { pitch: 0, roll: 0, yaw: 0 };
  else delete p.control;
  const maxRate = BREEDS[breed].maxRollRate;
  let bank = 0;
  let rate = 0;
  const dt = 1 / 60;
  for (let i = 0; i < 60; i++) {
    p.position.z += 24 * dt;
    p.lookTarget.z += 24 * dt;
    w.update(dt, p);
  }
  for (let i = 0; i <= seconds / dt; i++) {
    const t = i * dt;
    const holding = bank < bankTo;
    if (p.control) p.control.roll = holding ? 1 : 0;
    // The body chases the commanded rate (spin-up ~0.3 s), then stops at the bank.
    rate += ((holding ? maxRate : 0) - rate) * (1 - Math.exp(-dt / 0.12));
    bank = Math.min(bankTo, bank + rate * dt);
    p.orientation.setFromAxisAngle(new Vector3(0, 0, 1), bank);
    p.angularVelocity.set(0, 0, rate);
    p.position.z += 24 * dt;
    p.lookTarget.z += 24 * dt;
    w.update(dt, p);
    sample(t, w);
  }
  w.dispose();
}

/** Span of each wing, shoulder joint to wingtip (m): [left (outer in a right turn), right (inner)]. */
function reaches(w: Wyvern): [number, number] {
  w.getWingtips(_p, _q);
  const bones = w.skinnedMesh!.skeleton.bones;
  const sl = bones.find((b) => b.name === 'humerusL')!.getWorldPosition(new Vector3());
  const sr = bones.find((b) => b.name === 'humerusR')!.getWorldPosition(new Vector3());
  return [_p.distanceTo(sl), _q.distanceTo(sr)];
}

describe('turns that lead (B3: the head turns first, the wings answer the stick, then the body banks)', { timeout: 60000 }, () => {
  it('rolls in with the inner wing flexed: its span 15% shorter than the outer’s on the harrier (10% on every breed), easing into the held turn', () => {
    for (const b of BREED_ORDER) {
      let rollIn = Infinity;
      let held = 0;
      rollRight(b, (t, w) => {
        const [outer, inner] = reaches(w);
        if (t > 0.05 && t < 0.3) rollIn = Math.min(rollIn, inner / outer);
        if (t > 1.9) held = inner / outer;
      });
      expect(rollIn, b).toBeLessThanOrEqual(b === 'harrier' ? 0.85 : 0.9);
      // The initiation dies away once the bank is held: the wings even out again.
      expect(held, b).toBeGreaterThan(rollIn + 0.05);
    }
  });

  it('turns the head into the turn before the body has turned (lookLead), for the player and for a ghost', () => {
    for (const stick of [true, false]) {
      let lead0 = 0;
      let leadHeld = NaN;
      rollRight(
        'harrier',
        (t, w) => {
          const f = frameOf(w);
          // + = toward the body's left: a right turn leads to the right (negative).
          if (t < 0.12) lead0 = Math.min(lead0, f.lookLead);
          if (t > 1.9) leadHeld = f.lookLead;
        },
        { stick },
      );
      expect(lead0, `stick ${stick}`).toBeLessThan(-0.15);
      // Once the bank is held and the stick centered, the lead is gone.
      expect(Math.abs(leadHeld), `stick ${stick}`).toBeLessThan(0.05);
    }
  });

  it('leans the chest into the roll further than before (up to 0.22 rad)', () => {
    let lean = 0;
    rollRight('harrier', (_t, w) => (lean = Math.max(lean, frameOf(w).lean)), { bankTo: 1.1 });
    expect(lean).toBeGreaterThan(0.14);
    expect(lean).toBeLessThanOrEqual(0.22 + 1e-9);
  });

  it('steers with the tail: a right yaw swings the tail right, and it swings through and back on the release', () => {
    const w = new Wyvern(look('harrier'));
    const p = gliding();
    p.control = { pitch: 0, roll: 0, yaw: 0 };
    const dt = 1 / 60;
    const run = (secs: number, yaw: number, each?: (s: number) => void) => {
      for (let i = 0; i < secs / dt; i++) {
        p.control!.yaw = yaw;
        p.position.z += 24 * dt;
        p.lookTarget.z += 24 * dt;
        w.update(dt, p);
        each?.(frameOf(w).tailSteer);
      }
    };
    run(1, 0);
    run(1, 1);
    const held = frameOf(w).tailSteer;
    expect(held).toBeLessThan(-0.1);
    expect(held).toBeGreaterThan(-0.14);
    let over = -Infinity;
    run(0.5, 0, (s) => (over = Math.max(over, s)));
    // Through center and back: a short overshoot to the other side.
    expect(over).toBeGreaterThan(0.01);
    run(1.5, 0);
    expect(Math.abs(frameOf(w).tailSteer)).toBeLessThan(0.005);
    w.dispose();
  });

  it('bows the tips of a pulling wing about 18° at 3 g, the outer wing more than the inner', () => {
    const tips = (gLoadTurn: boolean) => {
      const w = new Wyvern(look('harrier'));
      const p = gliding();
      p.control = { pitch: 0, roll: 0, yaw: 0 };
      // A steady banked turn pulling 3 g as the animator reads it (1 + V·pitch rate/g plus a little
      // for the bank): 70° of bank, the nose pitching up (−x) at 0.74 rad/s.
      if (gLoadTurn) {
        p.orientation.setFromAxisAngle(new Vector3(0, 0, 1), 1.23);
        p.angularVelocity.set(-0.74, 0, 0);
      }
      for (let i = 0; i < 180; i++) {
        p.position.z += 24 / 60;
        p.lookTarget.z += 24 / 60;
        w.update(1 / 60, p);
      }
      // The wingtip finger's bend: elevation of its distal segment over its proximal one (body frame).
      const bones = w.skinnedMesh!.skeleton.bones;
      const inv = p.orientation.clone().invert();
      const at = (name: string) => bones.find((x) => x.name === name)!.getWorldPosition(new Vector3()).applyQuaternion(inv);
      const tipsW = [new Vector3(), new Vector3()];
      w.getWingtips(tipsW[0], tipsW[1]);
      const bend = (side: 'L' | 'R', tip: Vector3) => {
        const a = at(`finger0a${side}`);
        const b = at(`finger0b${side}`);
        const t = tip.clone().applyQuaternion(inv);
        const el = (v: Vector3) => Math.asin(v.y / v.length()) / DEG;
        return el(t.sub(b)) - el(b.sub(a));
      };
      const r = { l: bend('L', tipsW[0]), r: bend('R', tipsW[1]) };
      w.dispose();
      return r;
    };
    const level = tips(false);
    const pull = tips(true);
    const bowL = pull.l - level.l;
    const bowR = pull.r - level.r;
    expect(bowL).toBeGreaterThan(10);
    expect(bowL).toBeLessThan(26);
    expect(bowR).toBeLessThan(bowL);
  });
});

describe('the living glide (B4: a gliding wing is never still; gusts, load and flutter)', { timeout: 60000 }, () => {
  /** Glide hands-off for `secs`, sampling each wingtip's elevation from its shoulder (degrees, body frame). */
  function glideTips(breed: BreedId, secs: number, gust?: { l: number; r: number }) {
    const w = new Wyvern(look(breed));
    const p = gliding();
    p.control = { pitch: 0, roll: 0, yaw: 0 };
    if (gust) p.gust = gust;
    const bones = w.skinnedMesh!.skeleton.bones;
    const humL = bones.find((b) => b.name === 'humerusL')!;
    const humR = bones.find((b) => b.name === 'humerusR')!;
    const L: number[] = [];
    const R: number[] = [];
    const loads: [number, number][] = [];
    const el = (tip: Vector3, sh: Vector3) => (Math.atan2(tip.y - sh.y, Math.abs(tip.x - sh.x)) * 180) / Math.PI;
    for (let i = 0; i < secs * 60; i++) {
      p.position.z += 24 / 60;
      p.lookTarget.z += 24 / 60;
      w.update(1 / 60, p);
      w.getWingtips(_p, _q);
      const sl = humL.getWorldPosition(new Vector3());
      const sr = humR.getWorldPosition(new Vector3());
      L.push(el(_p, sl));
      R.push(el(_q, sr));
      loads.push([w.uniforms.uWingLoad.value.x, w.uniforms.uWingLoad.value.y]);
    }
    w.dispose();
    return { L, R, loads };
  }
  const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

  it('never holds still in a 3 s glide: the tips move at least 2°, each wing trimming on its own', () => {
    for (const b of BREED_ORDER) {
      // The capture strip's window: 1 s in, for 3 s (the first resettle comes a moment into a glide).
      const { L, R } = glideTips(b, 4);
      const l = L.slice(60);
      const r = R.slice(60);
      expect(range(l), b).toBeGreaterThanOrEqual(2);
      expect(range(r), b).toBeGreaterThanOrEqual(2);
      // Independent: the two tips' elevations are not the same curve (the resettle is shared, the
      // trim is not).
      const diff = l.map((x, i) => x - r[i]);
      expect(range(diff), b).toBeGreaterThan(0.4);
    }
  });

  it('lives more on the light breeds and on the galewing’s long tips than on the ironback', () => {
    const tipLife = (b: BreedId) => {
      // (The trim alone: between the first resettle and the next.)
      const { L, R } = glideTips(b, 7);
      return range(L.slice(4 * 60)) + range(R.slice(4 * 60));
    };
    expect(tipLife('galewing')).toBeGreaterThan(tipLife('ironback'));
  });

  it('resettles both wings every 5–9 s: the shoulders lift together and settle back', () => {
    const { L, R } = glideTips('harrier', 20);
    // Both tips rise together by a few degrees at least once in 20 s (above their own drift).
    const both = L.map((x, i) => Math.min(x - L[Math.max(0, i - 30)], R[i] - R[Math.max(0, i - 30)]));
    expect(Math.max(...both)).toBeGreaterThan(1.5);
  });

  it('a thermal’s edge under one tip loads and lifts that wing first', () => {
    const calm = glideTips('harrier', 2);
    const edge = glideTips('harrier', 2, { l: 4, r: 0 });
    const n = calm.loads.length - 1;
    expect(edge.loads[n][0]).toBeGreaterThan(edge.loads[n][1] + 0.1);
    // The lifted tip flexes up against the calm glide's.
    expect(edge.L[n] - calm.L[n]).toBeGreaterThan(1);
  });

  it('luffs the trailing edge at dive speed: 0.1 m at 55 m/s, at a rate a 60 fps frame never aliases', () => {
    const w = new Wyvern(look('harrier'));
    const p = gliding();
    p.airspeed = 55;
    p.velocity.set(0, -10, 54);
    for (let i = 0; i < 60; i++) w.update(1 / 60, p);
    const sh = BREEDS.harrier.standHeight;
    expect(w.uniforms.uFlutter.value).toBeGreaterThanOrEqual(0.1);
    expect(w.uniforms.uFlutter.value).toBeLessThan(0.05 * sh * 1.5);
    // The fastest component (the ×2.3 harmonic) stays well under the 60 fps Nyquist rate (30 Hz).
    expect((w.uniforms.uFlutterRate.value * 2.3) / (2 * Math.PI)).toBeLessThan(20);
    // Calm at cruise.
    p.airspeed = 24;
    p.velocity.set(0, 0, 24);
    for (let i = 0; i < 60; i++) w.update(1 / 60, p);
    expect(w.uniforms.uFlutter.value).toBeLessThan(0.03);
    w.dispose();
  });
});

describe('landing (B5: a height-driven flare, backwing beats, legs reaching)', { timeout: 60000 }, () => {
  /** One beat flared and flapping at `feet` m above flat ground; the left tip against the shoulder (body frame). */
  function flaredBeat(breed: BreedId, feet: number) {
    const w = new Wyvern(look(breed));
    const p = gliding();
    const sh = BREEDS[breed].standHeight;
    p.position.set(0, 10 + sh + feet, 0);
    p.groundY = 10;
    p.velocity.set(0, -3, 10);
    p.airspeed = 10.4;
    p.flare = 1;
    p.flapStrength = 1;
    const rate = BREEDS[breed].flapRate * 1.4;
    const hum = w.skinnedMesh!.skeleton.bones.find((b) => b.name === 'humerusL')!;
    const els: number[] = [];
    const zs: number[] = [];
    const ys: number[] = [];
    const n = Math.round(60 / rate);
    for (let i = 0; i < 4 * n; i++) {
      p.flapPhase = ((i / 60) * rate) % 1;
      w.update(1 / 60, p);
      if (i < 3 * n) continue;
      w.getWingtips(_p, _q);
      const sl = hum.getWorldPosition(new Vector3());
      els.push((Math.atan2(_p.y - sl.y, _p.x - sl.x) * 180) / Math.PI);
      zs.push(_p.z - sl.z);
      ys.push(_p.y - sl.y);
    }
    w.dispose();
    const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    return { top: Math.max(...els), bottom: Math.min(...els), plane: range(zs) / range(ys) };
  }

  it('beats backwing strokes over the last metres: high, short and swept far forward, with real travel', () => {
    for (const b of BREED_ORDER) {
      const low = flaredBeat(b, 1);
      const high = flaredBeat(b, 40);
      // A short stroke that stays high (never driven down past the shoulder's level by much)...
      expect(low.bottom, b).toBeGreaterThan(high.bottom + 5);
      // ...with real travel (the strip's ≥ 40° between the extremes)...
      expect(low.top - low.bottom, b).toBeGreaterThan(30);
      // ...and the stroke plane laid back toward the horizontal: more fore-aft travel per metre
      // of rise and fall than a flaring beat up high.
      expect(low.plane, b).toBeGreaterThan(1.3 * high.plane);
    }
  });
});

describe('the launch stroke (B6: after the vault, out of the fold into labored beats)', { timeout: 60000 }, () => {
  /** A takeoff: the wrists leave the ground at t = 0 (frame.launchT, which C6 writes; set here). */
  function launch(breed: BreedId, sample: (t: number, w: Wyvern) => void) {
    const w = new Wyvern(look(breed));
    const frame = (w as unknown as { animator: { frame: { launchT: number } } }).animator.frame;
    const p = standing(breed);
    for (let i = 0; i < 60; i++) w.update(1 / 60, p);
    p.airborne = true;
    p.gait = 'takeoff';
    p.flapStrength = 1;
    p.wingSpread = 1;
    p.velocity.set(0, 4, 6);
    const rate = BREEDS[breed].flapRate;
    for (let i = 0; i < 3 * 60; i++) {
      const t = i / 60;
      p.flapPhase = (t * rate) % 1;
      p.gaitTime = t;
      p.position.y += 4 / 60;
      frame.launchT = t;
      w.update(1 / 60, p);
      sample(t, w);
    }
    w.dispose();
  }

  it('stays folded at the wrist release and has unfolded by 0.12 s, without a pop', () => {
    for (const b of BREED_ORDER) {
      const spans: number[] = [];
      launch(b, (_t, w) => {
        w.getWingtips(_p, _q);
        spans.push(_p.distanceTo(_q));
      });
      const span = BREEDS[b].wingspan;
      // Folded (well under half the span tip to tip) on the first frame, open by 0.15 s.
      expect(spans[0], b).toBeLessThan(0.5 * span);
      expect(spans[9], b).toBeGreaterThan(0.6 * span);
      // No frame-to-frame jump bigger than a fifth of the span.
      for (let i = 1; i < spans.length; i++) expect(Math.abs(spans[i] - spans[i - 1]), `${b} frame ${i}`).toBeLessThan(0.2 * span);
    }
  });

  it('labors the first two beats: they reach deeper than the next ones', () => {
    const b = 'harrier';
    const rate = BREEDS[b].flapRate;
    const low = [Infinity, Infinity, Infinity];
    launch(b, (t, w) => {
      const beat = Math.floor(t * rate);
      if (beat > 2) return;
      w.getWingtips(_p, _q);
      const sh = w.skinnedMesh!.skeleton.bones.find((x) => x.name === 'humerusL')!.getWorldPosition(new Vector3());
      low[beat] = Math.min(low[beat], (Math.atan2(_p.y - sh.y, _p.x - sh.x) * 180) / Math.PI);
    });
    expect(low[1]).toBeLessThan(low[2] - 2);
  });
});

describe('fatigue, hover and the pull-out (B7)', { timeout: 60000 }, () => {
  /** One beat (after settling) of the left wingtip relative to its shoulder, body frame. */
  function stroke(breed: BreedId, set: (p: ReturnType<typeof gliding>) => void, rate = BREEDS[breed].flapRate) {
    const w = new Wyvern(look(breed));
    const p = gliding();
    set(p);
    const hum = w.skinnedMesh!.skeleton.bones.find((b) => b.name === 'humerusL')!;
    const ys: number[] = [];
    const zs: number[] = [];
    let hover = 0;
    const n = Math.round(60 / rate);
    for (let i = 0; i < 4 * n; i++) {
      p.flapPhase = ((i / 60) * rate) % 1;
      w.update(1 / 60, p);
      hover = Math.max(hover, (w as unknown as { animator: { frame: { hover: number } } }).animator.frame.hover);
      if (i < 3 * n) continue;
      w.getWingtips(_p, _q);
      const sl = hum.getWorldPosition(new Vector3());
      ys.push(_p.y - sl.y);
      zs.push(_p.z - sl.z);
    }
    w.dispose();
    const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    return { vertical: range(ys), foreAft: range(zs), hover };
  }

  it('hovers with the stroke plane laid back 45°, and says so for the tail (frame.hover)', () => {
    for (const b of BREED_ORDER) {
      const hov = stroke(b, (p) => {
        p.airspeed = 7;
        p.velocity.set(0, 0, 7);
        p.flare = 1;
        p.flapStrength = 1;
      });
      const fast = stroke(b, (p) => {
        p.flare = 1;
        p.flapStrength = 1;
      });
      expect(hov.hover, b).toBeGreaterThan(0.8);
      expect(fast.hover, b).toBeLessThan(0.05);
      expect(hov.foreAft / hov.vertical, b).toBeGreaterThan(1.3 * (fast.foreAft / fast.vertical));
    }
  });

  it('beats raggedly when told (pose.beatAmp, sideLag): a shallower stroke, the right wing behind', () => {
    const w = new Wyvern(look('harrier'));
    const p = gliding();
    p.flapStrength = 1;
    p.beatAmp = 0.8;
    p.sideLag = 0.05;
    let maxDiff = 0;
    for (let i = 0; i < 120; i++) {
      p.flapPhase = ((i / 60) * BREEDS.harrier.flapRate) % 1;
      w.update(1 / 60, p);
      w.getWingtips(_p, _q);
      maxDiff = Math.max(maxDiff, Math.abs(_p.y - _q.y));
    }
    w.dispose();
    // The two wingtips are no longer mirror images through the beat.
    expect(maxDiff).toBeGreaterThan(0.3);
  });

  it('pulls out of a fast dive with the hands still swept back while the arms open', () => {
    const tipBehindWrist = (speed: number, g: number) => {
      const w = new Wyvern(look('harrier'));
      const p = gliding();
      p.airspeed = speed;
      p.velocity.set(0, 0, speed);
      p.wingSpread = 0.25;
      for (let i = 0; i < 90; i++) w.update(1 / 60, p);
      // Open the wings and pull: the arm follows the spread, the hand its own (lagging) tuck.
      p.wingSpread = 1;
      p.angularVelocity.set(-((g - 1) * 9.81) / speed, 0, 0);
      for (let i = 0; i < 30; i++) w.update(1 / 60, p);
      const bones = w.skinnedMesh!.skeleton.bones;
      const wrist = bones.find((b) => b.name === 'handL')!.getWorldPosition(new Vector3());
      w.getWingtips(_p, _q);
      w.dispose();
      return wrist.z - _p.z;
    };
    // Half a second after opening at 45 m/s pulling 3 g the tips trail the wrists further than
    // opening gently at cruise.
    expect(tipBehindWrist(45, 3)).toBeGreaterThan(tipBehindWrist(24, 1) + 0.3);
  });
});
