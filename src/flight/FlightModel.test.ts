import { describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { EventBus } from '../core/events';
import type { BreedId, GameEvents } from '../core/types';
import { mulberry32 } from '../core/rng';
import { DEG } from '../core/math';
import { LAYOUT } from '../world/layout';
import { Terrain } from '../world/terrain';
import { BREEDS, BREED_ORDER } from './breeds';
import { FlightModel, deriveFlight, strokeForce } from './FlightModel';
import {
  SIM_DT,
  bankAngle,
  energyHeight,
  launch,
  measureBestGlide,
  measureClimb,
  measureDive,
  measureEndurance,
  measureFlare,
  measureGlide,
  measureMush,
  measureRoll,
  measureTailSlide,
  neutralInput,
  pathAngle,
  stillAir,
  yawQuat,
} from './telemetry';

const terrain = new Terrain(LAYOUT);
// Many of these fly minutes of simulated time; give them room on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

function bus() {
  const events = new EventBus<GameEvents>();
  const counts: Partial<Record<keyof GameEvents, number>> = {};
  const count = (k: keyof GameEvents) => events.on(k, () => (counts[k] = (counts[k] ?? 0) + 1));
  for (const k of ['flap', 'flapRefused', 'stallStart', 'stallEnd', 'tuckStart', 'tuckEnd', 'terrainHit'] as const) count(k);
  return { events, counts };
}

describe('glide and cruise', () => {
  // B8's bigger wings (span +16–19%, area +8%, so a higher aspect ratio): every breed glides about
  // 12–15% flatter than on the 13 m wings (harrier 8.9 → 10.3), and the slightly lighter wing
  // loading lowers cruise by 4% (the client: "the stall speed may drop a little").
  const targets: Record<BreedId, [number, number]> = {
    harrier: [9.7, 10.8],
    galewing: [13.2, 14.5],
    skimmer: [8.3, 9.3],
    ironback: [9.0, 10.1],
  };
  for (const id of BREED_ORDER) {
    it(`${id}: hands-off cruise 21–30 m/s and best glide near its target`, () => {
      const cruise = measureGlide(BREEDS[id], 0);
      expect(cruise.speed).toBeGreaterThan(21);
      expect(cruise.speed).toBeLessThan(30);
      const best = measureBestGlide(BREEDS[id]);
      expect(best.ratio).toBeGreaterThan(targets[id][0]);
      expect(best.ratio).toBeLessThan(targets[id][1]);
    }, 30_000);
  }

  it('settles into a steady glide when the stick is let go', () => {
    const m = launch(BREEDS.harrier, 34);
    const env = stillAir();
    const input = neutralInput();
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 60 / SIM_DT; i++) {
      m.step(SIM_DT, input, env);
      if (i * SIM_DT > 40) {
        lo = Math.min(lo, m.state.velocity.y);
        hi = Math.max(hi, m.state.velocity.y);
      }
    }
    // The phugoid has died down to a gentle ripple.
    expect(hi - lo).toBeLessThan(1.5);
  });
});

describe('energy', () => {
  for (const id of BREED_ORDER) {
    it(`${id}: tucked dive reaches 70–100 m/s`, () => {
      const v = measureDive(BREEDS[id]);
      expect(v).toBeGreaterThan(70);
      expect(v).toBeLessThan(100);
    });

    it(`${id}: tucking dives faster than diving with spread wings (45° and 85°)`, () => {
      const dive = (angle: number, tuck: number) => {
        const m = launch(BREEDS[id], 26, 40000);
        const input = neutralInput();
        input.tuck = tuck;
        for (let i = 0; i < 30 / SIM_DT; i++) {
          input.pitch = Math.max(-1, Math.min(1, (-angle * DEG - pathAngle(m)) * 3));
          m.step(SIM_DT, input, stillAir());
        }
        return m.state.airspeed;
      };
      for (const angle of [45, 85]) expect(dive(angle, 1), `${angle}°`).toBeGreaterThan(dive(angle, 0) * 1.12);
    });
  }

  it('the ironback dives fastest', () => {
    const v = Object.fromEntries(BREED_ORDER.map((id) => [id, measureDive(BREEDS[id])]));
    for (const id of BREED_ORDER) if (id !== 'ironback') expect(v.ironback).toBeGreaterThan(v[id]);
  });

  it('trades a dive for speed and the speed back for height, losing only to drag', () => {
    // Tucked, nose 60° down; an autopilot holds the dive, then the wings open and it pulls up.
    const m = launch(BREEDS.harrier, 25, 2000, 60 * (Math.PI / 180));
    const env = stillAir();
    const input = neutralInput();
    const y0 = m.state.position.y;
    let e = energyHeight(m);
    input.tuck = 1;
    for (let i = 0; i < 7 / SIM_DT; i++) {
      input.pitch = Math.max(-1, Math.min(1, (-60 * (Math.PI / 180) - pathAngle(m)) * 3));
      m.step(SIM_DT, input, env);
      // Gliding flight can only lose energy, never gain it.
      expect(energyHeight(m)).toBeLessThan(e + 0.05);
      e = energyHeight(m);
    }
    const yLow0 = m.state.position.y;
    expect(m.state.airspeed).toBeGreaterThan(55);
    // Pull out and zoom: wings open, firm back stick until the speed is spent.
    input.tuck = 0;
    input.pitch = 0.8;
    let yLow = yLow0;
    let yTop = -Infinity;
    for (let i = 0; i < 15 / SIM_DT && m.state.airspeed > 14; i++) {
      // Ease off once pointing up so the zoom stays a zoom rather than a loop.
      if (pathAngle(m) > 1.2) input.pitch = 0;
      m.step(SIM_DT, input, env);
      yLow = Math.min(yLow, m.state.position.y);
      yTop = Math.max(yTop, m.state.position.y);
      expect(energyHeight(m)).toBeLessThan(e + 0.05);
      e = energyHeight(m);
    }
    const lost = y0 - yLow;
    const regained = yTop - yLow;
    // A good part of the height comes back; drag (a wyvern is no sailplane) keeps the rest.
    expect(regained / lost).toBeGreaterThan(0.3);
    expect(yTop).toBeLessThan(y0);
  });

  it('bleeds speed in a hard turn', () => {
    // Both hold their altitude; one flies straight, the other holds a 60° bank.
    const env = stillAir();
    const fly = (bankTarget: number) => {
      const m = launch(BREEDS.harrier, 25);
      const y0 = m.state.position.y;
      const input = neutralInput();
      for (let i = 0; i < 3 / SIM_DT; i++) {
        input.roll = Math.max(-1, Math.min(1, (bankTarget - bankAngle(m)) * 2));
        input.pitch = Math.max(-1, Math.min(1, (y0 - m.state.position.y) * 0.3 - m.state.velocity.y * 0.4 + (bankTarget ? 0.35 : 0)));
        m.step(SIM_DT, input, env);
      }
      return m.state.airspeed;
    };
    const straight = fly(0);
    const turning = fly(1.05);
    // Induced drag (K·CL²) at 2 g: near cruise the turn scrubs off speed nearly twice as fast.
    expect(25 - turning).toBeGreaterThan(1.6 * (25 - straight));
  });

  it('rides a thermal up', () => {
    const thermal = (p: Vector3, out: Vector3) => out.set(0, Math.hypot(p.x, p.z) < 200 ? 5 : 0, 0);
    const m = launch(BREEDS.galewing, 22);
    const env = { windAt: thermal, terrain: stillAir().terrain };
    const input = neutralInput();
    const y0 = m.state.position.y;
    for (let i = 0; i < 10 / SIM_DT; i++) m.step(SIM_DT, input, env);
    // ~5 m/s of rising air beats the galewing's ~2 m/s sink.
    expect(m.state.position.y - y0).toBeGreaterThan(20);
  });
});

describe('stall', () => {
  it('a held pull mushes instead of stalling, and flies on when the stick is let go', () => {
    for (const id of BREED_ORDER) {
      const { events, counts } = bus();
      const d = new FlightModel(BREEDS[id]).derived;
      // Slow, then haul back and hold for 8 s (keyboard pitch is all or nothing).
      const m = launch(BREEDS[id], d.vStall * 1.25);
      const env = stillAir();
      const input = neutralInput();
      input.pitch = 1;
      let maxStall = 0;
      for (let i = 0; i < 8 / SIM_DT; i++) {
        m.step(SIM_DT, input, env, events);
        maxStall = Math.max(maxStall, m.state.stall);
      }
      expect(counts.stallStart ?? 0, id).toBe(0);
      expect(maxStall, id).toBeLessThan(0.45);
      // Let go: it is flying normally within a few seconds.
      input.pitch = 0;
      for (let i = 0; i < 4 / SIM_DT; i++) m.step(SIM_DT, input, env, events);
      expect(m.state.airspeed, id).toBeGreaterThan(d.vStall * 1.2);
      expect(m.state.stall, id).toBeLessThan(0.05);
    }
  });

  it('holding full pull from cruise for 5 s never stalls (it zooms, floats over and porpoises)', () => {
    for (const id of BREED_ORDER) {
      const { events, counts } = bus();
      const m = launch(BREEDS[id], new FlightModel(BREEDS[id]).derived.vCruise);
      const input = neutralInput();
      input.pitch = 1;
      for (let i = 0; i < 5 / SIM_DT; i++) m.step(SIM_DT, input, stillAir(), events);
      expect(counts.stallStart ?? 0, id).toBe(0);
    }
  });

  it('hauling back from above cruise zooms and floats over the top instead of stalling (FLT-04)', () => {
    for (const id of BREED_ORDER) {
      const { events, counts } = bus();
      const m = launch(BREEDS[id], 1.15 * new FlightModel(BREEDS[id]).derived.vCruise);
      const y0 = m.state.position.y;
      const input = neutralInput();
      input.pitch = 1;
      let top = y0;
      for (let i = 0; i < 6 / SIM_DT; i++) {
        m.step(SIM_DT, input, stillAir(), events);
        top = Math.max(top, m.state.position.y);
      }
      expect(counts.stallStart ?? 0, id).toBe(0);
      // Still a real zoom: the speed is traded for height.
      expect(top - y0, id).toBeGreaterThan(8);
    }
  });

  it('slowed in level flight it settles into a sinking mush just above stall speed', () => {
    for (const id of BREED_ORDER) {
      const d = new FlightModel(BREEDS[id]).derived;
      const r = measureMush(BREEDS[id]);
      expect(r.maxStall, id).toBeLessThan(0.45);
      expect(r.speed, id).toBeGreaterThan(d.vStall * 1.0);
      expect(r.speed, id).toBeLessThan(d.vStall * 1.35);
      // It can't hold its height that slowly: a gentle sink, not a plunge.
      expect(r.sink, id).toBeGreaterThan(0.3);
      expect(r.sink, id).toBeLessThan(4);
    }
  });

  it('a zoom that runs out of air stalls, drops the nose and flies out hands-off', () => {
    for (const id of BREED_ORDER) {
      const { events, counts } = bus();
      // Straight up, wing unloaded, coasting until the air runs out (a tail slide).
      const m = launch(BREEDS[id], 35, 3000, -88 * DEG);
      const input = neutralInput();
      input.pitch = -0.35;
      for (let t = 0; t < 8 && m.state.stall < 0.5; t += SIM_DT) m.step(SIM_DT, input, stillAir(), events);
      expect(counts.stallStart, id).toBe(1);
      const r = measureTailSlide(BREEDS[id]);
      expect(r.stalled, id).toBe(true);
      // Hands off, it is back on a normal glide within ~10 s, having lost a hill's worth of
      // height rather than a mountain's.
      expect(r.seconds, id).toBeLessThan(10);
      expect(r.lost, id).toBeLessThan(140);
    }
  });

  it('stall speeds sit in the 12–17 m/s band', () => {
    for (const id of BREED_ORDER) {
      const v = new FlightModel(BREEDS[id]).derived.vStall;
      expect(v, id).toBeGreaterThan(12);
      expect(v, id).toBeLessThan(17.5);
    }
  });

  it('drops a wing in a stall, always the same way for the same inputs', () => {
    const a = measureTailSlide(BREEDS.skimmer);
    expect(a.stalled).toBe(true);
    expect(Math.abs(a.bankAtRelease)).toBeGreaterThan(0.05);
    expect(measureTailSlide(BREEDS.skimmer).bankAtRelease).toBe(a.bankAtRelease);
  });

  it('does not report a stall while flaring', () => {
    const { events, counts } = bus();
    const m = launch(BREEDS.harrier, 20);
    const env = stillAir();
    const input = neutralInput();
    input.flare = 1;
    for (let i = 0; i < 3 / SIM_DT; i++) m.step(SIM_DT, input, env, events);
    expect(counts.stallStart ?? 0).toBe(0);
  });
});

describe('flaps and stamina', () => {
  it('flaps for about breed.staminaSeconds, then keeps beating weakly: never refused', () => {
    for (const id of BREED_ORDER) {
      const b = BREEDS[id];
      expect(Math.abs(measureEndurance(b) - b.staminaSeconds), id).toBeLessThan(b.staminaSeconds * 0.12);
    }
    const { events, counts } = bus();
    const b = BREEDS.harrier;
    const m = launch(b, 24);
    const env = stillAir();
    const input = neutralInput();
    input.flap = 1;
    while (m.state.stamina > 1e-4) m.step(SIM_DT, input, env, events);
    // Empty: the beats go on, weaker, and nothing is refused.
    const beats = m.beats;
    let strength = 0;
    const off = events.on('flap', (p) => (strength = p.strength));
    const y0 = m.state.position.y;
    for (let i = 0; i < 10 / SIM_DT; i++) m.step(SIM_DT, input, env, events);
    off();
    expect(counts.flapRefused ?? 0).toBe(0);
    expect(m.state.winded).toBe(false);
    expect(m.beats - beats).toBeGreaterThan(10);
    expect(strength).toBeGreaterThan(0.15);
    expect(strength).toBeLessThan(0.4);
    // Weak beats slow the sink but don't hold altitude: gliding (or landing) is how to rest.
    const vy = (m.state.position.y - y0) / 10;
    expect(vy).toBeLessThan(-0.3);
    expect(vy).toBeGreaterThan(-2.5);
    // Let go and glide: the meter refills at the breed's regen rate.
    input.flap = 0;
    let t = 0;
    while (m.state.stamina < 0.999 && t < 30) {
      m.step(SIM_DT, input, env, events);
      t += SIM_DT;
    }
    expect(t).toBeGreaterThan(1 / b.staminaRegen);
    expect(t).toBeLessThan(1 / b.staminaRegen + 1.5);
  });

  it('rising air is restful: regen is faster gliding in a thermal', () => {
    const b = BREEDS.galewing;
    const regen = (up: number) => {
      const m = launch(b, 22);
      m.state.stamina = 0;
      const env = { windAt: (_p: Vector3, out: Vector3) => out.set(0, up, 0), terrain: stillAir().terrain };
      for (let i = 0; i < 3 / SIM_DT; i++) m.step(SIM_DT, neutralInput(), env);
      return m.state.stamina;
    };
    expect(regen(6)).toBeGreaterThan(regen(0) * 1.8);
  });

  it('a larger capacity (the Rested bonus) makes the meter last proportionally longer', () => {
    const b = BREEDS.harrier;
    expect(measureEndurance(b, 1.4) / measureEndurance(b)).toBeCloseTo(1.4, 1);
  });

  it('commits to a beat once started and fires the flap event at the bottom of the stroke', () => {
    for (const id of BREED_ORDER) {
      const b = BREEDS[id];
      const D = b.downFrac!;
      const events = new EventBus<GameEvents>();
      const phases: number[] = [];
      const m = launch(b, 24);
      events.on('flap', () => phases.push(m.state.flapPhase));
      const env = stillAir();
      const input = neutralInput();
      input.flap = 1;
      m.step(SIM_DT, input, env, events);
      // Let go immediately: the stroke still completes.
      input.flap = 0;
      let steps = 0;
      while (m.flapping && steps < 1000) {
        m.step(SIM_DT, input, env, events);
        steps++;
      }
      expect(phases.length, id).toBe(1);
      // The flap event marks the bottom: the end of the breed's downstroke.
      expect(phases[0], id).toBeGreaterThanOrEqual(D);
      expect(phases[0], id).toBeLessThan(D + 0.03);
      // One whole beat at the breed's rate.
      expect((steps + 1) * SIM_DT, id).toBeCloseTo(1 / b.flapRate, 1);
    }
  });

  it('a press starts the downstroke on that very step (weighty, but no wind-up delay)', () => {
    for (const id of BREED_ORDER) {
      const b = BREEDS[id];
      const m = launch(b, deriveFlight(b).vCruise);
      const env = stillAir();
      const input = neutralInput();
      // A long glide first: the wings are idle.
      for (let i = 0; i < 2 / SIM_DT; i++) m.step(SIM_DT, input, env);
      expect(m.flapping).toBe(false);
      input.flap = 1;
      const r = m.step(SIM_DT, input, env);
      expect(r.beatStarted, id).toBe(true);
      // Already into the downstroke (phase 0 is the top of the stroke).
      expect(m.state.flapPhase, id).toBeGreaterThan(0);
      expect(m.state.flapPhase, id).toBeLessThan(b.flapRate * SIM_DT * 1.01);
      // ...and pushing within a tenth of the downstroke.
      expect(strokeForce(m.state.flapPhase + 0.1 * b.downFrac!, b.downFrac!)).toBeGreaterThan(0.09);
    }
  });

  it('the power curve: sin² over the downstroke [0, D), a small loss on the recovery', () => {
    for (const D of [0.5, 0.54, 0.57, 0.6, 0.62]) {
      let mean = 0;
      let down = 0;
      const N = 20000;
      for (let i = 0; i < N; i++) {
        const f = strokeForce(i / N, D);
        mean += f / N;
        if (i / N < D) down += f / N;
        if (i / N >= D) expect(f).toBeLessThanOrEqual(0);
      }
      expect(strokeForce(D / 2, D)).toBeCloseTo(1, 9);
      expect(down).toBeCloseTo(D / 2, 3);
      expect(mean).toBeCloseTo(D / 2 - (0.1 * (1 - D) * 2) / Math.PI, 3);
    }
  });

  it('a slower, longer stroke delivers the same per second: beat timing never changes the climb', () => {
    // The flight model advances the phase at flapRate, so thrust per second is set by the
    // cycle-mean of the power curve (peak × D/2), never by the rate. A breed's numbers keep the
    // mean: peak thrust and lift × 1/(2D) against an even (D = 0.5) stroke.
    for (const id of ['harrier', 'ironback'] as const) {
      const b = BREEDS[id];
      const D = b.downFrac!;
      const even = { ...b, flapRate: b.flapRate * 1.3, downFrac: 0.5, flapThrust: b.flapThrust * 2 * D, flapLift: b.flapLift * 2 * D };
      const a = measureClimb(b).climb;
      const c = measureClimb(even).climb;
      expect(Math.abs(a - c) / c, id).toBeLessThan(0.03);
    }
  }, 120_000);

  it('a lighter trigger makes a weaker, cheaper beat', () => {
    const run = (flap: number) => {
      const m = launch(BREEDS.harrier, 24);
      const input = neutralInput();
      input.flap = flap;
      for (let i = 0; i < 3 / SIM_DT; i++) m.step(SIM_DT, input, stillAir());
      return { stamina: m.state.stamina, speed: m.state.airspeed, y: m.state.position.y };
    };
    const full = run(1);
    const half = run(0.4);
    expect(half.stamina).toBeGreaterThan(full.stamina);
    expect(full.y + full.speed * full.speed / 19.6).toBeGreaterThan(half.y + half.speed * half.speed / 19.6);
  });

  it('sustained flapping climbs 3–7 m/s for every breed', () => {
    for (const id of BREED_ORDER) {
      const c = measureClimb(BREEDS[id]);
      expect(c.climb, id).toBeGreaterThan(3);
      expect(c.climb, id).toBeLessThan(7);
    }
  });
});

describe('handling', () => {
  it('rolls skimmer > harrier > ironback > galewing, heavy breeds slower to roll in and out', () => {
    const r = Object.fromEntries(BREED_ORDER.map((id) => [id, measureRoll(BREEDS[id])]));
    expect(r.skimmer.peakRate).toBeGreaterThan(r.harrier.peakRate);
    expect(r.harrier.peakRate).toBeGreaterThan(r.ironback.peakRate);
    expect(r.ironback.peakRate).toBeGreaterThan(r.galewing.peakRate);
    for (const heavy of ['ironback', 'galewing'] as const) {
      for (const light of ['skimmer', 'harrier'] as const) {
        expect(r[heavy].spinUp).toBeGreaterThan(r[light].spinUp * 1.2);
        expect(r[heavy].rollOut).toBeGreaterThan(r[light].rollOut);
      }
    }
  });

  it('settles where it is put: a released roll overshoots by less than 12° for every breed', () => {
    for (const id of BREED_ORDER) {
      const m = launch(BREEDS[id], new FlightModel(BREEDS[id]).derived.vCruise);
      const input = neutralInput();
      for (let i = 0; i < 1 / SIM_DT; i++) m.step(SIM_DT, input, stillAir());
      input.roll = 1;
      while (bankAngle(m) < 45 * DEG) m.step(SIM_DT, input, stillAir());
      const released = bankAngle(m);
      input.roll = 0;
      let peak = released;
      for (let i = 0; i < 3 / SIM_DT; i++) {
        m.step(SIM_DT, input, stillAir());
        peak = Math.max(peak, bankAngle(m));
      }
      expect((peak - released) / DEG, id).toBeLessThan(12);
    }
  });

  it('the rudder swings the heading (a flat turn with a little lean)', () => {
    const m = launch(BREEDS.harrier, 24);
    const h0 = Math.atan2(m.state.velocity.x, m.state.velocity.z);
    const input = neutralInput();
    input.yaw = 1;
    for (let i = 0; i < 3 / SIM_DT; i++) m.step(SIM_DT, input, stillAir());
    // Yaw right turns toward -X (heading decreases), by a useful amount but far less than a bank.
    const turned = h0 - Math.atan2(m.state.velocity.x, m.state.velocity.z);
    expect(turned / DEG).toBeGreaterThan(15);
    expect(turned / DEG).toBeLessThan(70);
    expect(bankAngle(m)).toBeGreaterThan(0);
    expect(bankAngle(m) / DEG).toBeLessThan(30);
  });

  it('a beat wins over a tuck: holding both opens the wings and beats', () => {
    const { events, counts } = bus();
    const m = launch(BREEDS.harrier, 40, 3000, 30 * DEG);
    const input = neutralInput();
    input.tuck = 1;
    for (let i = 0; i < 1 / SIM_DT; i++) m.step(SIM_DT, input, stillAir(), events);
    expect(m.state.wingSpread).toBeLessThan(0.3);
    const beats = m.beats;
    input.flap = 1;
    for (let i = 0; i < 1.5 / SIM_DT; i++) m.step(SIM_DT, input, stillAir(), events);
    expect(m.beats - beats).toBeGreaterThanOrEqual(2);
    expect(counts.flap).toBeGreaterThanOrEqual(1);
    expect(m.state.wingSpread).toBeGreaterThan(0.8);
    // Let go of the flap: the wings fold back into the dive once the stroke is done.
    input.flap = 0;
    for (let i = 0; i < 1.5 / SIM_DT; i++) m.step(SIM_DT, input, stillAir(), events);
    expect(m.state.wingSpread).toBeLessThan(0.3);
  });

  it('air rising under one wing rolls the wyvern away from it, light breeds most', () => {
    const roll = (id: BreedId) => {
      const m = launch(BREEDS[id], 24);
      // A gust front: rising air to the left of x = 0 (the left wing points +X).
      const env = { windAt: (p: Vector3, out: Vector3) => out.set(0, p.x > 0 ? 2.5 : 0, 0), terrain: stillAir().terrain };
      for (let i = 0; i < 0.8 / SIM_DT; i++) m.step(SIM_DT, neutralInput(), env);
      return bankAngle(m);
    };
    // Lifted left wing: banks right (positive).
    expect(roll('harrier') / DEG).toBeGreaterThan(2);
    expect(roll('skimmer')).toBeGreaterThan(roll('ironback'));
  });

  it('a bank and a slight pull make a coordinated carving turn', () => {
    const m = launch(BREEDS.harrier, 26);
    const env = stillAir();
    const input = neutralInput();
    let maxSlip = 0;
    const heading0 = Math.atan2(m.state.velocity.x, m.state.velocity.z);
    for (let i = 0; i < 6 / SIM_DT; i++) {
      const t = i * SIM_DT;
      input.roll = t < 0.6 ? 1 : 0;
      input.pitch = t > 0.5 ? 0.3 : 0;
      m.step(SIM_DT, input, env);
      const v = m.state.velocity.clone().normalize();
      const left = new Vector3(1, 0, 0).applyQuaternion(m.state.orientation);
      if (t > 1) maxSlip = Math.max(maxSlip, Math.abs(Math.asin(v.dot(left))));
    }
    const heading1 = Math.atan2(m.state.velocity.x, m.state.velocity.z);
    // Turned right (heading decreases toward -X) by a good amount, with little sideslip.
    expect(heading0 - heading1).toBeGreaterThan(0.8);
    expect(maxSlip).toBeLessThan(4 * (Math.PI / 180));
  });

  it('controls go mushy near stall speed and crisp at speed', () => {
    const rollIn = (speed: number) => {
      const m = launch(BREEDS.harrier, speed);
      const input = neutralInput();
      input.roll = 1;
      for (let i = 0; i < 0.25 / SIM_DT; i++) m.step(SIM_DT, input, stillAir());
      return m.state.angularVelocity.z;
    };
    expect(rollIn(35)).toBeGreaterThan(rollIn(15) * 1.6);
  });

  it('flares from 30 to 12 m/s in about 2–3 s', () => {
    for (const id of BREED_ORDER) {
      const f = measureFlare(BREEDS[id]);
      expect(f.seconds, id).toBeGreaterThan(1.7);
      expect(f.seconds, id).toBeLessThan(3.2);
    }
  });

  it('tucks into a dive and opens again with events', () => {
    const { events, counts } = bus();
    const m = launch(BREEDS.harrier, 24);
    const input = neutralInput();
    input.tuck = 1;
    for (let i = 0; i < 2 / SIM_DT; i++) m.step(SIM_DT, input, stillAir(), events);
    expect(m.state.wingSpread).toBeLessThan(0.3);
    input.tuck = 0;
    for (let i = 0; i < 2 / SIM_DT; i++) m.step(SIM_DT, input, stillAir(), events);
    expect(m.state.wingSpread).toBeGreaterThan(0.95);
    expect(counts.tuckStart).toBe(1);
    expect(counts.tuckEnd).toBe(1);
  });

  it('full forward stick noses over into a dive without bunting (INP-01)', () => {
    for (const id of BREED_ORDER) {
      const m = launch(BREEDS[id], new FlightModel(BREEDS[id]).derived.vCruise);
      const input = neutralInput();
      input.pitch = -1;
      let gMin = Infinity;
      for (let i = 0; i < 2 / SIM_DT; i++) {
        m.step(SIM_DT, input, stillAir());
        gMin = Math.min(gMin, m.state.gLoad);
      }
      expect(pathAngle(m) / DEG, id).toBeGreaterThan(-60);
      expect(pathAngle(m) / DEG, id).toBeLessThan(-20);
      expect(gMin, id).toBeGreaterThan(-1);
    }
    // A light push held for 6 s settles into a dive rather than bending on toward the vertical.
    const m = launch(BREEDS.harrier, new FlightModel(BREEDS.harrier).derived.vCruise);
    const input = neutralInput();
    input.pitch = -0.35;
    for (let i = 0; i < 6 / SIM_DT; i++) m.step(SIM_DT, input, stillAir());
    expect(pathAngle(m) / DEG).toBeGreaterThan(-45);
  });

  it('pulling out of a dive loads up the g', () => {
    const m = launch(BREEDS.harrier, 60, 3000, 40 * (Math.PI / 180));
    const input = neutralInput();
    input.pitch = 0.8;
    let gMax = 0;
    for (let i = 0; i < 3 / SIM_DT; i++) {
      m.step(SIM_DT, input, stillAir());
      gMax = Math.max(gMax, m.state.gLoad);
    }
    expect(gMax).toBeGreaterThan(3);
    expect(gMax).toBeLessThan(6);
  });
});

describe('terrain', () => {
  const env = { windAt: (_p: Vector3, out: Vector3) => out.set(0, 0, 0), terrain };

  it('scrapes along the ground, losing speed, without passing through', () => {
    const { events, counts } = bus();
    const m = new FlightModel(BREEDS.harrier);
    const g = terrain.groundAt(0, -60, 1e6)!;
    // Shallow descent into the Roost at speed (legs aren't the flight model's business).
    const q = yawQuat(0, 6 * (Math.PI / 180));
    m.reset(new Vector3(0, g.y + 4, -60), q, new Vector3(0, -3, 28));
    const v0 = m.state.velocity.length();
    for (let i = 0; i < 1.5 / SIM_DT; i++) {
      m.step(SIM_DT, neutralInput(), env, events);
      expect(terrain.distance(m.state.position)).toBeGreaterThan(-0.5);
    }
    expect(m.state.velocity.length()).toBeLessThan(v0 - 3);
    expect(m.state.timeSinceContact).toBeLessThan(1.5);
  });

  it('a big impact stuns and emits a terrain hit, never anything worse', () => {
    const { events, counts } = bus();
    const m = new FlightModel(BREEDS.ironback);
    const g = terrain.groundAt(20, 20, 1e6)!;
    m.reset(new Vector3(20, g.y + 6, 20), yawQuat(0, 50 * (Math.PI / 180)), new Vector3(0, -30, 10));
    let stunned = 0;
    for (let i = 0; i < 1 / SIM_DT; i++) {
      m.step(SIM_DT, neutralInput(), env, events);
      stunned = Math.max(stunned, m.stunned);
      expect(Number.isFinite(m.state.position.y)).toBe(true);
    }
    expect(counts.terrainHit).toBeGreaterThan(0);
    expect(stunned).toBeGreaterThan(0.4);
    expect(m.state.position.y).toBeGreaterThan(g.y);
  });

  it('flies into a building wall and bounces off it (structures collide like rock)', () => {
    const t = new Terrain(LAYOUT);
    // A tower in open sky, flown straight at.
    t.colliders.add({ x: 0, z: 0, radius: 5, y0: 2900, y1: 3100 });
    const { events, counts } = bus();
    const m = launch(BREEDS.harrier, 26, 3000);
    m.reset(new Vector3(0, 3000, -60), yawQuat(0), new Vector3(0, 0, 26));
    let closest = Infinity;
    for (let i = 0; i < 4 / SIM_DT; i++) {
      m.step(SIM_DT, neutralInput(), { windAt: (_p, o) => o.set(0, 0, 0), terrain: t }, events);
      closest = Math.min(closest, Math.hypot(m.state.position.x, m.state.position.z));
    }
    expect(closest).toBeGreaterThan(5 + m.derived.bodyRadius * 0.8);
    expect(counts.terrainHit).toBeGreaterThan(0);
  });

  it('brushes through foliage: slowed and nudged, never stopped or stunned', () => {
    const t = new Terrain(LAYOUT);
    // A big soft canopy in open sky.
    t.colliders.add({ kind: 'sphere', x: 0, y: 3000, z: 0, radius: 8, soft: true });
    const { events, counts } = bus();
    let brushes = 0;
    events.on('foliageBrush', () => brushes++);
    const m = new FlightModel(BREEDS.harrier);
    m.reset(new Vector3(0, 3002, -40), yawQuat(0), new Vector3(0, 0, 26));
    let stunned = 0;
    for (let i = 0; i < 3 / SIM_DT; i++) {
      m.step(SIM_DT, neutralInput(), { windAt: (_p, o) => o.set(0, 0, 0), terrain: t }, events);
      stunned = Math.max(stunned, m.stunned);
    }
    // Went through (past the canopy), slower than an untouched glide, with leaves flying.
    expect(m.state.position.z).toBeGreaterThan(20);
    expect(brushes).toBeGreaterThan(0);
    expect(counts.terrainHit ?? 0).toBe(0);
    expect(stunned).toBe(0);
    const free = new FlightModel(BREEDS.harrier);
    free.reset(new Vector3(0, 3002, -40), yawQuat(0), new Vector3(0, 0, 26));
    for (let i = 0; i < 3 / SIM_DT; i++) free.step(SIM_DT, neutralInput(), stillAir());
    expect(m.state.velocity.length()).toBeLessThan(free.state.velocity.length() - 1);
  });

  it('flaring low over the ground backwings against the sink (stamina pays for it)', () => {
    const fall = (backwing: boolean) => {
      const m = new FlightModel(BREEDS.ironback);
      const g = terrain.groundAt(0, -60, 1e6)!;
      m.reset(new Vector3(0, g.y + (backwing ? 9 : 60), -60), yawQuat(0), new Vector3(0, -9, 14));
      const input = neutralInput();
      input.flare = 1;
      m.state.flare = 1;
      let sink = 0;
      for (let i = 0; i < 0.9 / SIM_DT; i++) {
        m.step(SIM_DT, input, { windAt: (_p, o) => o.set(0, 0, 0), terrain });
        sink = -m.state.velocity.y;
      }
      return { sink, stamina: m.state.stamina };
    };
    const low = fall(true);
    const high = fall(false);
    expect(low.sink).toBeLessThan(high.sink - 3);
    expect(low.stamina).toBeLessThan(high.stamina);
  });

  it('a wingtip clipping a spire yaws the wyvern away from it', () => {
    const sp = LAYOUT.spires.find((s) => s.landmark === 'lantern')!;
    const m = new FlightModel(BREEDS.galewing);
    const y = sp.bellyY;
    const R = sp.bellyRadius * 0.97;
    // Fly north (+Z) past the spire's east flank. Facing +Z the left wing points +X (away from
    // the spire) and the right wing (-X) reaches about 2 m into the rock.
    const x0 = sp.x + R + BREEDS.galewing.wingspan * 0.46 - 2;
    m.reset(new Vector3(x0, y, sp.z - 30), yawQuat(0), new Vector3(0, 0, 24));
    for (let i = 0; i < 2.5 / SIM_DT; i++) m.step(SIM_DT, neutralInput(), env);
    // Shoved east and turned east, away from the rock.
    expect(m.state.position.x).toBeGreaterThan(x0 + 0.5);
    expect(Math.atan2(m.state.velocity.x, m.state.velocity.z)).toBeGreaterThan(0.02);
  });
});

describe('determinism and robustness', () => {
  it('same inputs → identical state', () => {
    const run = () => {
      const m = new FlightModel(BREEDS.skimmer);
      const g = terrain.groundAt(0, 0, 1e6)!;
      m.reset(new Vector3(0, g.y + 30, 0), yawQuat(0.3), new Vector3(0, 0, 24));
      const rnd = mulberry32(42);
      const input = neutralInput();
      const env = { windAt: (p: Vector3, out: Vector3) => out.set(Math.sin(p.x * 0.01) * 3, 0, 1.5), terrain };
      for (let i = 0; i < 20 / SIM_DT; i++) {
        if (i % 30 === 0) {
          input.pitch = rnd() * 2 - 1;
          input.roll = rnd() * 2 - 1;
          input.flap = rnd() < 0.4 ? rnd() : 0;
          input.tuck = rnd() < 0.15 ? 1 : 0;
          input.flare = rnd() < 0.1 ? 1 : 0;
        }
        m.step(SIM_DT, input, env);
      }
      const s = m.state;
      return [...s.position.toArray(), ...s.velocity.toArray(), ...s.orientation.toArray(), s.stamina, s.flapPhase, s.stall];
    };
    expect(run()).toEqual(run());
  });

  it('fuzz: random inputs near terrain never produce NaN or tunnel inside it', () => {
    const rnd = mulberry32(1234);
    const spots: [number, number][] = [[0, 0], [820, -520], [-1150, 760], [1350, 650], [-450, 420], [1110, -1950]];
    for (const id of BREED_ORDER) {
      for (const [sx, sz] of spots) {
        const m = new FlightModel(BREEDS[id]);
        const g = terrain.groundAt(sx, sz, 1e6);
        const y = g ? g.y + 15 : 500;
        m.reset(new Vector3(sx, y, sz), yawQuat(rnd() * 6.28), new Vector3(0, -5, 30).applyQuaternion(yawQuat(rnd() * 6.28)));
        const input = neutralInput();
        const env = { windAt: (_p: Vector3, out: Vector3) => out.set(rnd() * 6 - 3, rnd() * 4 - 2, rnd() * 6 - 3), terrain };
        for (let i = 0; i < 8 / SIM_DT; i++) {
          if (i % 20 === 0) {
            input.pitch = rnd() * 2 - 1;
            input.roll = rnd() * 2 - 1;
            input.yaw = rnd() * 2 - 1;
            input.flap = rnd() < 0.5 ? rnd() : 0;
            input.tuck = rnd() < 0.3 ? 1 : 0;
            input.flare = rnd() < 0.2 ? rnd() : 0;
          }
          m.step(SIM_DT, input, env);
          const s = m.state;
          for (const v of [...s.position.toArray(), ...s.velocity.toArray(), ...s.orientation.toArray(), s.stamina, s.stall, s.gLoad]) {
            expect(Number.isFinite(v)).toBe(true);
          }
          // The body sphere's center never ends a step buried in rock.
          if (i % 3 === 0) expect(terrain.distance(s.position)).toBeGreaterThan(-m.derived.bodyRadius * 0.5);
        }
      }
    }
  }, 30000);
});
