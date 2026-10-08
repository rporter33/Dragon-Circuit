import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  autoFollowYaw,
  boomStep,
  filmOffsetForShift,
  fitDistance,
  lookReturn,
  speedFovKick,
  springDecay,
  type SpringState,
} from './cameraMath';
import { CameraShake, SHAKE_MAX, Trauma, type ShakeOffsets } from './shake';
import { liftClear, sphereCast } from './collision';
import { Terrain } from '../world/terrain';
import { LAYOUT } from '../world/layout';
import { PerspectiveCamera } from 'three';

describe('boomStep (collision pull-in)', () => {
  it('snaps in immediately when the camera would be inside rock', () => {
    expect(boomStep(20, 20, 6, Infinity, 1 / 60)).toBe(6);
  });

  it('eases in toward a soft (occlusion) limit rather than snapping', () => {
    const b = boomStep(20, 20, Infinity, 6, 1 / 60);
    expect(b).toBeLessThan(20);
    expect(b).toBeGreaterThan(6);
    let x = 20;
    for (let i = 0; i < 60; i++) x = boomStep(x, 20, Infinity, 6, 1 / 60);
    expect(x).toBeCloseTo(6, 1);
  });

  it('eases back out slowly once clear, never overshooting the desired length', () => {
    let x = 6;
    x = boomStep(x, 20, Infinity, Infinity, 1 / 60);
    expect(x).toBeGreaterThan(6);
    expect(x).toBeLessThan(7);
    for (let i = 0; i < 600; i++) x = boomStep(x, 20, Infinity, Infinity, 1 / 60);
    expect(x).toBeLessThanOrEqual(20);
    expect(x).toBeCloseTo(20, 2);
  });

  it('pulls in much faster than it eases out', () => {
    const inStep = 20 - boomStep(20, 20, Infinity, 10, 0.1);
    const outStep = boomStep(10, 20, Infinity, Infinity, 0.1) - 10;
    expect(inStep).toBeGreaterThan(outStep * 4);
  });

  it('initialises from the desired length', () => {
    expect(boomStep(-1, 12, Infinity, Infinity, 0.016)).toBe(12);
  });
});

describe('autoFollowYaw', () => {
  it('turns toward a sideways movement direction', () => {
    const y = autoFollowYaw(0, Math.PI / 2, 1, 0.1);
    expect(y).toBeGreaterThan(0);
    expect(autoFollowYaw(0, -Math.PI / 2, 1, 0.1)).toBeLessThan(0);
  });
  it('leaves the camera alone when running straight at it', () => {
    expect(Math.abs(autoFollowYaw(0, Math.PI, 1, 0.1))).toBeLessThan(1e-9);
    expect(autoFollowYaw(0, 0, 1, 0.1)).toBe(0);
  });
  it('converges onto the travel direction', () => {
    let y = 0;
    for (let i = 0; i < 600; i++) y = autoFollowYaw(y, 1.2, 1, 1 / 60);
    expect(y).toBeCloseTo(1.2, 2);
  });
});

describe('speedFovKick', () => {
  it('adds nothing at cruise and +18 at ~80 m/s tucked', () => {
    expect(speedFovKick(15, 0)).toBe(0);
    expect(speedFovKick(80, 1)).toBeCloseTo(18, 5);
    expect(speedFovKick(80, 0)).toBeCloseTo(16, 5);
    expect(speedFovKick(50, 0)).toBeGreaterThan(5);
    expect(speedFovKick(50, 0)).toBeLessThan(speedFovKick(70, 0));
  });
});

describe('springDecay (transition glide)', () => {
  it('starts gently, settles to zero, and never overshoots', () => {
    const s: SpringState = { x: 10, v: 0 };
    springDecay(s, 4, 1 / 60);
    expect(s.x).toBeGreaterThan(9.9); // ease-in: barely moves on the first frame
    let min = Infinity;
    for (let i = 0; i < 180; i++) {
      springDecay(s, 4, 1 / 60);
      min = Math.min(min, s.x);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(s.x).toBeLessThan(0.1);
  });
  it('is frame-rate independent', () => {
    const a: SpringState = { x: 5, v: 0 };
    const b: SpringState = { x: 5, v: 0 };
    for (let i = 0; i < 120; i++) springDecay(a, 3, 1 / 120);
    for (let i = 0; i < 30; i++) springDecay(b, 3, 1 / 30);
    expect(a.x).toBeCloseTo(b.x, 6);
  });
});

describe('lookReturn', () => {
  it('holds a look offset until the delay passes, then springs back', () => {
    expect(lookReturn(1, 0.5, 1.2, 2.4, 0.1)).toBe(1);
    expect(lookReturn(1, 1.3, 1.2, 2.4, 0.1)).toBeLessThan(1);
    let x = 1;
    for (let t = 0; t < 2; t += 1 / 60) x = lookReturn(x, 2, 1.2, 2.4, 1 / 60);
    expect(x).toBeLessThan(0.01);
  });
});

describe('framing', () => {
  it('fitDistance fits the sphere inside the requested part of the frame', () => {
    const d = fitDistance(5, 50, 16 / 9, 0.6, 0.8);
    const half = Math.asin(5 / d);
    const tv = Math.tan((50 * Math.PI) / 360);
    expect(Math.tan(half)).toBeLessThanOrEqual(Math.min(tv * 0.8, tv * (16 / 9) * 0.6) + 1e-9);
  });

  it('filmOffsetForShift puts the optical axis where asked', () => {
    const cam = new PerspectiveCamera(48, 16 / 9, 0.5, 100);
    cam.filmOffset = filmOffsetForShift(0.2, 48, 16 / 9);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    // A point straight down the view axis lands at 70% of the screen width.
    const p = new Vector3(0, 0, -10).project(cam);
    expect((p.x + 1) / 2).toBeCloseTo(0.7, 5);
  });
});

describe('Trauma and CameraShake', () => {
  it('trauma clamps at 1, decays linearly and shows as trauma²', () => {
    const t = new Trauma(1.1);
    t.add(0.7);
    t.add(0.7);
    expect(t.value).toBe(1);
    t.update(0.5);
    expect(t.value).toBeCloseTo(0.45, 6);
    expect(t.intensity).toBeCloseTo(0.2025, 6);
    t.update(1);
    expect(t.value).toBe(0);
  });

  it('a full hit settles within a second and stays within its limits', () => {
    const s = new CameraShake();
    const out: ShakeOffsets = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0 };
    s.add(1);
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      s.update(1 / 60, out);
      peak = Math.max(peak, Math.abs(out.roll));
      expect(Math.abs(out.yaw)).toBeLessThanOrEqual(SHAKE_MAX.yaw + 1e-9);
      expect(Math.abs(out.x)).toBeLessThanOrEqual(SHAKE_MAX.pos + 1e-9);
    }
    expect(peak).toBeGreaterThan(0);
    s.update(0.05, out);
    expect(out.yaw).toBe(0);
    expect(out.roll).toBe(0);
  });

  it('moves smoothly (noise, not jitter)', () => {
    const s = new CameraShake();
    const out: ShakeOffsets = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0 };
    s.add(1);
    s.trauma.decay = 0;
    s.update(1 / 240, out);
    let prev = out.roll;
    let maxStep = 0;
    for (let i = 0; i < 240; i++) {
      s.update(1 / 240, out);
      maxStep = Math.max(maxStep, Math.abs(out.roll - prev));
      prev = out.roll;
    }
    // At 240 Hz no step should be a big fraction of the range.
    expect(maxStep).toBeLessThan(SHAKE_MAX.roll * 0.35);
  });

  it('stall wobble and buffet are continuous sources independent of trauma', () => {
    const s = new CameraShake();
    const out: ShakeOffsets = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0 };
    s.wobble = 1;
    let any = 0;
    for (let i = 0; i < 120; i++) any = Math.max(any, Math.abs(s.update(1 / 60, out).roll));
    expect(any).toBeGreaterThan(0);
    expect(s.trauma.value).toBe(0);
  });
});

describe('sphereCast and liftClear against the real archipelago', () => {
  const terrain = new Terrain(LAYOUT);
  const roost = LAYOUT.islands.find((i) => i.landmark === 'roost')!;

  it('hits the Roost meadow when cast straight down', () => {
    const ground = terrain.groundAt(roost.x, roost.z, 1e6)!.y;
    const t = sphereCast(terrain, new Vector3(roost.x, ground + 30, roost.z), new Vector3(0, -1, 0), 100, 1);
    expect(t).toBeGreaterThan(30 - 1 - 3);
    expect(t).toBeLessThan(30);
  });

  it('reports a clear path in open sky', () => {
    expect(sphereCast(terrain, new Vector3(0, 1600, 0), new Vector3(1, 0, 0), 60, 1)).toBe(Infinity);
  });

  it('returns 0 when starting inside rock', () => {
    const ground = terrain.groundAt(roost.x, roost.z, 1e6)!.y;
    expect(sphereCast(terrain, new Vector3(roost.x, ground - 5, roost.z), new Vector3(0, 1, 0), 10, 0.5)).toBe(0);
  });

  it('liftClear raises a buried point above the surface', () => {
    const ground = terrain.groundAt(roost.x + 20, roost.z + 20, 1e6)!.y;
    const p = new Vector3(roost.x + 20, ground + 0.2, roost.z + 20);
    liftClear(terrain, p, 1.5);
    expect(terrain.distance(p)).toBeGreaterThanOrEqual(1.5 - 1e-6);
  });
});
