import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { LAYOUT, type IslandDef, type WorldLayout } from '../world/layout';
import { BOUNDARY_PUSH, THERMAL_CORE, THERMAL_EDGE, WindField } from './windField';
import { BREEDS } from '../flight/breeds';
import { SIM_DT, launch, neutralInput, stillAir, yawQuat } from '../flight/telemetry';
import { FlightModel } from '../flight/FlightModel';
import { BREED_ORDER } from '../flight/breeds';
import { Autopilot, CoursePath } from '../race/autopilot';

/** A lonely island and a lonely thermal far apart, so each effect can be measured on its own. */
function testLayout(): WorldLayout {
  const island: IslandDef = {
    id: 0, kind: 'meadow', x: 0, y: 300, z: 0, radius: 100, outline: 0.15, hills: 8, depth: 120,
    lip: 9, flatCenter: 0.2, seed: 1, trees: 0, grass: 1, waterfalls: 0,
  };
  return {
    islands: [island],
    spires: [],
    arches: [],
    thermals: [{ id: 0, x: 1500, z: 0, radius: 60, strength: 10, baseY: 0, topY: 800 }],
    landmarks: [],
    spawn: { position: [0, 0, 0], yaw: 0 },
    wyvernSpawn: { position: [0, 0, 0], yaw: 0 },
    stable: { x: 0, z: 0, yaw: 0, interactRadius: 10 },
    boundaryRadius: 2900,
    cloudFloor: 25,
  };
}

function calmField(layout = testLayout()): WindField {
  const f = new WindField(layout);
  f.state.wind.set(8, 0, 0); // blowing toward +X: the island's west face is windward
  f.state.gust = 0;
  f.state.thermal = 1;
  return f;
}

describe('thermals', () => {
  const f = calmField();
  const t = testLayout().thermals[0];
  const at = (dx: number, y = 300) => f.thermalAt(new Vector3(t.x + dx, y, t.z));

  it('blows at full strength in the core', () => {
    expect(at(0)).toBeCloseTo(t.strength, 5);
    expect(at(t.radius * THERMAL_CORE * 0.95)).toBeCloseTo(t.strength, 5);
  });

  it('softens toward the edge', () => {
    const edge = at(t.radius * 0.85);
    expect(edge).toBeGreaterThan(0.5);
    expect(edge).toBeLessThan(t.strength * 0.9);
    // Monotonic falloff from core to edge.
    let prev = Infinity;
    for (let d = 0; d <= t.radius * THERMAL_EDGE; d += 3) {
      const v = at(d);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });

  it('does nothing outside the column or above its top', () => {
    expect(at(t.radius * THERMAL_EDGE + 1)).toBe(0);
    expect(at(t.radius * 3)).toBe(0);
    expect(at(0, t.topY + 1)).toBe(0);
    expect(at(0, t.baseY + 5)).toBeLessThan(t.strength * 0.1);
    expect(at(0, t.topY - 2)).toBeLessThan(t.strength * 0.1);
  });

  it('scales with the weather', () => {
    const g = calmField();
    g.state.thermal = 0.6;
    expect(g.thermalAt(new Vector3(t.x, 300, t.z))).toBeCloseTo(t.strength * 0.6, 5);
  });

  it('shows up in windAt as an updraft', () => {
    const out = f.windAt(new Vector3(t.x, 300, t.z), new Vector3());
    expect(out.y).toBeCloseTo(t.strength, 3);
    expect(out.x).toBeCloseTo(8, 5);
  });
});

describe('ridge lift', () => {
  const f = calmField();
  const isl = testLayout().islands[0];

  it('rises on the windward side and sinks on the lee side', () => {
    const windward = f.ridgeAt(new Vector3(isl.x - isl.radius - 10, isl.y + 10, isl.z));
    const leeward = f.ridgeAt(new Vector3(isl.x + isl.radius + 10, isl.y + 10, isl.z));
    expect(windward).toBeGreaterThan(1.5);
    expect(leeward).toBeLessThan(0);
    // The lee sink is gentler than the windward lift.
    expect(Math.abs(leeward)).toBeLessThan(windward);
  });

  it('is zero across the wind (flanks) and far from the island', () => {
    expect(Math.abs(f.ridgeAt(new Vector3(isl.x, isl.y + 10, isl.z + isl.radius + 10)))).toBeLessThan(1e-6);
    expect(f.ridgeAt(new Vector3(isl.x - isl.radius - 400, isl.y, isl.z))).toBe(0);
    expect(f.ridgeAt(new Vector3(isl.x - isl.radius - 10, isl.y + 600, isl.z))).toBe(0);
  });

  it('flips when the wind turns around', () => {
    const g = calmField();
    g.state.wind.set(-8, 0, 0);
    expect(g.ridgeAt(new Vector3(isl.x + isl.radius + 10, isl.y + 10, isl.z))).toBeGreaterThan(1.5);
    expect(g.ridgeAt(new Vector3(isl.x - isl.radius - 10, isl.y + 10, isl.z))).toBeLessThan(0);
  });

  it('grows with wind speed', () => {
    const g = calmField();
    const p = new Vector3(isl.x - isl.radius - 10, isl.y + 10, isl.z);
    const slow = g.ridgeAt(p);
    g.state.wind.set(16, 0, 0);
    expect(g.ridgeAt(p)).toBeCloseTo(slow * 2, 5);
  });
});

describe('boundary', () => {
  const f = calmField();
  f.state.wind.set(0, 0, 0);
  const b = testLayout().boundaryRadius;

  it('leaves the archipelago alone', () => {
    const out = f.windAt(new Vector3(b * 0.5, 300, b * 0.5), new Vector3());
    expect(out.length()).toBeLessThan(1e-9);
  });

  it('pushes back toward the center beyond the boundary, in every direction', () => {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
      const p = new Vector3(Math.cos(a) * (b + 200), 400, Math.sin(a) * (b + 200));
      const out = f.windAt(p, new Vector3());
      const inward = -(out.x * p.x + out.z * p.z) / Math.hypot(p.x, p.z);
      expect(inward).toBeGreaterThan(BOUNDARY_PUSH * 0.5);
      // Purely radial: no sideways component.
      expect(Math.abs(out.x * p.z - out.z * p.x) / Math.hypot(p.x, p.z)).toBeLessThan(1e-6);
    }
  });

  it('builds smoothly with distance', () => {
    let prev = -1;
    for (let r = b - 100; r < b + 500; r += 20) {
      const out = f.windAt(new Vector3(r, 300, 0), new Vector3());
      const inward = -out.x;
      expect(inward).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(inward - prev).toBeLessThan(5);
      prev = inward;
    }
    expect(prev).toBeCloseTo(BOUNDARY_PUSH, 0);
  });
});

describe('determinism and gusts', () => {
  it('returns the same air for the same state and point', () => {
    const a = new WindField(LAYOUT);
    const b = new WindField(LAYOUT);
    for (const f of [a, b]) {
      f.state.wind.set(7, 0, -3);
      f.state.gust = 0.7;
      f.state.time = 123.4;
      f.state.drift.set(860, 0, -370);
    }
    const p = new Vector3(260, 330, -40);
    const va = a.windAt(p, new Vector3());
    const vb = b.windAt(p, new Vector3());
    const va2 = a.windAt(p, new Vector3());
    expect(va.toArray()).toEqual(vb.toArray());
    expect(va2.toArray()).toEqual(va.toArray());
  });

  it('gusts vary in space and time around the prevailing wind', () => {
    const f = new WindField(testLayout());
    f.state.wind.set(9, 0, 0);
    f.state.gust = 0.8;
    const p = new Vector3(-1200, 500, 900);
    const out = new Vector3();
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      f.state.time = i * 1.7;
      f.state.drift.set(i * 15, 0, 0);
      f.windAt(p, out);
      min = Math.min(min, out.x);
      max = Math.max(max, out.x);
      sum += out.x;
      expect(Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z)).toBe(true);
    }
    expect(max - min).toBeGreaterThan(3);
    // Gusts ride on the prevailing wind; they never reverse it.
    expect(min).toBeGreaterThan(0);
    expect(sum / n).toBeGreaterThan(6);
    expect(sum / n).toBeLessThan(13);
  });

  it('is calm-free of gusts when gustiness is zero', () => {
    const f = calmField();
    const out = f.windAt(new Vector3(-900, 200, 1500), new Vector3());
    expect(out.toArray()).toEqual([8, 0, 0]);
  });
});

describe('flying the field', () => {
  /** A galewing gliding hands-off along +Z for `seconds` through the field; returns height change. */
  function glide(strength: number, seconds = 8): number {
    const layout = testLayout();
    layout.islands = [];
    // A broad 5 m/s column around the glide path (launch is at the origin heading +Z).
    layout.thermals = [{ id: 0, x: 0, z: 90, radius: 400, strength, baseY: 0, topY: 6000 }];
    const field = new WindField(layout);
    field.state.wind.set(0, 0, 4);
    field.state.gust = 0.3;
    field.state.thermal = 1;
    const m = launch(BREEDS.galewing, 22);
    const env = { windAt: (p: Vector3, out: Vector3) => field.windAt(p, out), terrain: stillAir().terrain };
    const input = neutralInput();
    const y0 = m.state.position.y;
    for (let i = 0; i < seconds / SIM_DT; i++) {
      field.state.time += SIM_DT;
      field.state.drift.z += 4 * SIM_DT;
      m.step(SIM_DT, input, env);
    }
    // Stayed inside the column's full-strength core the whole way.
    expect(Math.hypot(m.state.position.x, m.state.position.z - 90)).toBeLessThan(400 * THERMAL_CORE);
    return m.state.position.y - y0;
  }

  it('a 5 m/s thermal carries a galewing upward', () => {
    expect(glide(5)).toBeGreaterThan(15);
  });

  it('without it the same glide sinks', () => {
    expect(glide(0)).toBeLessThan(-5);
  });
});

describe('circling the real thermals', () => {
  /** Climb rate (m/s) of a breed circling one of the layout's thermals with the race autopilot. */
  function circle(breedId: (typeof BREED_ORDER)[number], thermal: number): number {
    const th = LAYOUT.thermals[thermal];
    const field = new WindField({ ...LAYOUT, thermals: [th] });
    field.state.wind.set(0, 0, 0);
    field.state.gust = 0;
    const env = { windAt: (p: Vector3, out: Vector3) => field.windAt(p, out), terrain: stillAir().terrain };
    const m = new FlightModel(BREEDS[breedId]);
    m.reset(new Vector3(th.x, 300, th.z - 160), yawQuat(0), new Vector3(0, 0, m.derived.vCruise));
    const pilot = new Autopilot(
      new CoursePath([
        { position: new Vector3(th.x, 300, th.z - 160), tangent: new Vector3(0, 0, 1) },
        { position: new Vector3(th.x, 300, th.z), tangent: new Vector3(0, 0, 1), climbTo: 3000 },
        { position: new Vector3(th.x, 300, th.z + 400), tangent: new Vector3(0, 0, 1) },
      ]),
    );
    const input = neutralInput();
    let y0 = NaN;
    for (let i = 0; i < 70 / SIM_DT; i++) {
      pilot.steer(m.state, m.derived, BREEDS[breedId].maxRollRate, SIM_DT, input);
      m.step(SIM_DT, input, env);
      if (i === Math.round(15 / SIM_DT)) y0 = m.state.position.y;
    }
    return (m.state.position.y - y0) / 55;
  }

  // Cores wider than any wyvern's circling turn: a thermal is a real way up.
  it('a harrier circling thermal 0 climbs over 2 m/s without a wingbeat', () => {
    expect(circle('harrier', 0)).toBeGreaterThan(2);
  });

  it('even the ironback climbs over 1 m/s in the 12 m/s thermal, and every breed in every one of the first four', () => {
    expect(circle('ironback', 3)).toBeGreaterThan(1);
    for (const id of BREED_ORDER) for (let t = 0; t < 4; t++) expect(circle(id, t), `${id} thermal ${t}`).toBeGreaterThan(0.5);
  }, 60_000);
});

describe('small-scale turbulence (FLT-07)', () => {
  /** Peak and spread of the vertical air at one height across a stretch of sky, for a weather. */
  function vertical(windSpeed: number, gust: number) {
    const f = new WindField(testLayout());
    f.state.wind.set(windSpeed, 0, 0);
    f.state.gust = gust;
    const out = new Vector3();
    const p = new Vector3();
    let peak = 0;
    let maxStep = 0;
    let prev = 0;
    for (let i = 0; i < 800; i++) {
      // Fly 3.2 km at 4 m spacing (a wing's span or two), inside the boundary and away from the
      // island and the thermal.
      p.set(-1500, 520, -1600 + i * 4);
      f.state.time = i * 0.1;
      f.windAt(p, out);
      peak = Math.max(peak, Math.abs(out.y));
      if (i > 0) maxStep = Math.max(maxStep, Math.abs(out.y - prev));
      prev = out.y;
    }
    return { peak, maxStep };
  }

  it('bumps a breezy day and stays gentle in clear air', () => {
    const breezy = vertical(9.5, 0.7);
    const clear = vertical(4, 0.22);
    // Large-scale gust (~1.1 m/s) plus the 35 m octave (~1.7 m/s at peak).
    expect(breezy.peak).toBeGreaterThan(1.5);
    expect(breezy.peak).toBeLessThan(4);
    expect(clear.peak).toBeLessThan(0.9);
    // Small scale: neighbouring samples 4 m apart differ noticeably in breezy air...
    expect(breezy.maxStep).toBeGreaterThan(0.08);
    // ...but the field stays smooth (no jitter).
    expect(breezy.maxStep).toBeLessThan(1.5);
  });
});
