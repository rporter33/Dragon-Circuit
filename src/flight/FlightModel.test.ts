import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { EventBus } from '../core/events';
import type { BreedId, GameEvents } from '../core/types';
import { mulberry32 } from '../core/rng';
import { LAYOUT } from '../world/layout';
import { Terrain } from '../world/terrain';
import { BREEDS, BREED_ORDER } from './breeds';
import { FlightModel } from './FlightModel';
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
  measureRoll,
  measureStallSpeed,
  neutralInput,
  pathAngle,
  stillAir,
  yawQuat,
} from './telemetry';

const terrain = new Terrain(LAYOUT);

function bus() {
  const events = new EventBus<GameEvents>();
  const counts: Partial<Record<keyof GameEvents, number>> = {};
  const count = (k: keyof GameEvents) => events.on(k, () => (counts[k] = (counts[k] ?? 0) + 1));
  for (const k of ['flap', 'flapRefused', 'stallStart', 'stallEnd', 'tuckStart', 'tuckEnd', 'terrainHit'] as const) count(k);
  return { events, counts };
}

describe('glide and cruise', () => {
  const targets: Record<BreedId, [number, number]> = {
    harrier: [8.5, 9.6],
    galewing: [12, 13.5],
    skimmer: [6.6, 7.6],
    ironback: [7.5, 8.6],
  };
  for (const id of BREED_ORDER) {
    it(`${id}: hands-off cruise 22–30 m/s and best glide near its target`, () => {
      const cruise = measureGlide(BREEDS[id], 0);
      expect(cruise.speed).toBeGreaterThan(22);
      expect(cruise.speed).toBeLessThan(30);
      const best = measureBestGlide(BREEDS[id]);
      expect(best.ratio).toBeGreaterThan(targets[id][0]);
      expect(best.ratio).toBeLessThan(targets[id][1]);
    });
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
    it(`${id}: tucked dive reaches 70–95 m/s`, () => {
      const v = measureDive(BREEDS[id]);
      expect(v).toBeGreaterThan(70);
      expect(v).toBeLessThan(95);
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
  it('stalls past the critical angle, drops the nose, and recovers when the stick is released', () => {
    for (const id of BREED_ORDER) {
      const { events, counts } = bus();
      const m = launch(BREEDS[id], new FlightModel(BREEDS[id]).derived.vStall * 1.25);
      const env = stillAir();
      const input = neutralInput();
      // Slow, then haul back and hold.
      input.pitch = 1;
      let t = 0;
      while (m.state.stall < 0.5 && t < 20) {
        m.step(SIM_DT, input, env, events);
        t += SIM_DT;
      }
      expect(counts.stallStart, id).toBe(1);
      const fwd = () => new Vector3(0, 0, 1).applyQuaternion(m.state.orientation).y;
      const pitchAtBreak = fwd();
      for (let i = 0; i < 1.5 / SIM_DT; i++) m.step(SIM_DT, input, env, events);
      // Lift has collapsed: sinking, nose lower than at the break.
      expect(m.state.velocity.y, id).toBeLessThan(-2);
      expect(fwd(), id).toBeLessThan(pitchAtBreak);
      // Recovery: lower the nose and let speed build.
      input.pitch = -0.3;
      t = 0;
      while (m.state.stall > 0.05 && t < 6) {
        m.step(SIM_DT, input, env, events);
        t += SIM_DT;
      }
      expect(t, id).toBeLessThan(2.5);
      expect(counts.stallEnd, id).toBe(1);
      for (let i = 0; i < 2 / SIM_DT; i++) m.step(SIM_DT, neutralInput(), env, events);
      expect(m.state.airspeed, id).toBeGreaterThan(new FlightModel(BREEDS[id]).derived.vStall);
      expect(m.state.stall, id).toBeLessThan(0.05);
    }
  });

  it('stalls in the 12–17 m/s band when slowed in level flight', () => {
    for (const id of BREED_ORDER) {
      const v = measureStallSpeed(BREEDS[id]);
      expect(v, id).toBeGreaterThan(12);
      expect(v, id).toBeLessThan(17.5);
    }
  });

  it('drops a wing in a stall, always the same way for the same inputs', () => {
    const run = () => {
      const m = launch(BREEDS.skimmer, 22);
      const env = stillAir();
      const input = neutralInput();
      input.pitch = 1;
      for (let i = 0; i < 6 / SIM_DT; i++) m.step(SIM_DT, input, env);
      return new Vector3(1, 0, 0).applyQuaternion(m.state.orientation).y;
    };
    const a = run();
    expect(Math.abs(a)).toBeGreaterThan(0.05);
    expect(run()).toBe(a);
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
  it('flaps for about breed.staminaSeconds, then refuses until 35% recovered', () => {
    for (const id of BREED_ORDER) {
      const b = BREEDS[id];
      expect(Math.abs(measureEndurance(b) - b.staminaSeconds), id).toBeLessThan(b.staminaSeconds * 0.1);
    }
    const { events, counts } = bus();
    const b = BREEDS.harrier;
    const m = launch(b, 24);
    const env = stillAir();
    const input = neutralInput();
    input.flap = 1;
    while (!m.state.winded) m.step(SIM_DT, input, env, events);
    // Finish the committed beat, then try again: refused.
    for (let i = 0; i < 1.5 / SIM_DT; i++) m.step(SIM_DT, input, env, events);
    expect(counts.flapRefused).toBeGreaterThan(0);
    const beats = m.beats;
    for (let i = 0; i < 1 / SIM_DT; i++) m.step(SIM_DT, input, env, events);
    expect(m.beats).toBe(beats);
    // Stamina comes back from empty (even while the refused trigger is held); glide to recover.
    input.flap = 0;
    let t = 0;
    while (m.state.winded && t < 30) {
      m.step(SIM_DT, input, env, events);
      t += SIM_DT;
    }
    expect(m.state.stamina).toBeGreaterThanOrEqual(0.35);
    const fromEmpty = t + 2.5;
    expect(fromEmpty).toBeGreaterThan(0.35 / b.staminaRegen);
    expect(fromEmpty).toBeLessThan(0.35 / b.staminaRegen + 2);
    input.flap = 1;
    for (let i = 0; i < 0.5 / SIM_DT; i++) m.step(SIM_DT, input, env, events);
    expect(m.beats).toBeGreaterThan(beats);
  });

  it('commits to a beat once started and fires the flap event at the bottom of the stroke', () => {
    const events = new EventBus<GameEvents>();
    const phases: number[] = [];
    const m = launch(BREEDS.harrier, 24);
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
    expect(phases.length).toBe(1);
    expect(phases[0]).toBeGreaterThanOrEqual(0.5);
    expect(phases[0]).toBeLessThan(0.53);
    expect(steps * SIM_DT).toBeGreaterThan(0.5 / BREEDS.harrier.flapRate);
  });

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
