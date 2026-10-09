import { describe, expect, it } from 'vitest';
import {
  breedMassFactor,
  decay,
  flapDustAmount,
  flapTrailBurst,
  flapTrailFloor,
  seaDownwashAmount,
  isColdAir,
  planeBasis,
  scaledCount,
  speedBlurTarget,
  speedLineAmount,
  SPEED_LINES_FROM,
  SURFACE_DUST,
  trailIntensity,
  wispAmount,
  wrapLocal,
} from './fxMath';
import { launchDeckEnd } from './Fx';

describe('speed effects', () => {
  it('speed lines start above ~40 m/s and only while flying', () => {
    expect(speedLineAmount(SPEED_LINES_FROM - 1, true)).toBe(0);
    expect(speedLineAmount(80, true)).toBe(1);
    expect(speedLineAmount(55, true)).toBeGreaterThan(0);
    expect(speedLineAmount(80, false)).toBe(0);
  });

  it('speed blur rises with airspeed and tuck, and is off with reduced motion or on the ground', () => {
    expect(speedBlurTarget(30, 1, true, false)).toBe(0);
    const open = speedBlurTarget(75, 0, true, false);
    const tucked = speedBlurTarget(75, 1, true, false);
    expect(open).toBeGreaterThan(0);
    expect(tucked).toBeGreaterThan(open);
    expect(tucked).toBeLessThanOrEqual(1);
    expect(speedBlurTarget(90, 1, true, true)).toBe(0);
    expect(speedBlurTarget(90, 1, false, false)).toBe(0);
  });

  it('cloud wisps appear at speed, more low over the cloud sea or in mist', () => {
    expect(wispAmount(30, 150, 0, true)).toBe(0);
    const high = wispAmount(75, 900, 0, true);
    const low = wispAmount(75, 150, 0, true);
    const misty = wispAmount(75, 900, 1, true);
    expect(low).toBeGreaterThan(high);
    expect(misty).toBeGreaterThan(high);
    expect(wispAmount(75, 150, 0, false)).toBe(0);
  });

  it('wingtip vortices show at speed or when pulling hard', () => {
    expect(trailIntensity(20, 1, true)).toBe(0);
    expect(trailIntensity(70, 1, true)).toBeGreaterThan(0.5);
    expect(trailIntensity(28, 4, true)).toBeGreaterThan(0.5);
    expect(trailIntensity(70, 4, false)).toBe(0);
    // A hard pull while nearly stalled makes no vortex worth drawing.
    expect(trailIntensity(8, 4, true)).toBe(0);
  });
});

describe('flap dust', () => {
  it('is strongest at the ground and gone a couple of spans up', () => {
    expect(flapDustAmount(2, 12, 1)).toBeCloseTo(1);
    expect(flapDustAmount(30, 12, 1)).toBe(0);
    expect(flapDustAmount(8, 12, 1)).toBeGreaterThan(flapDustAmount(14, 12, 1));
    expect(flapDustAmount(2, 12, 0.3)).toBeCloseTo(0.3);
    expect(flapDustAmount(NaN, 12, 1)).toBe(0);
  });
});

describe('scaledCount', () => {
  it('scales with quality, keeps a minimum, and is zero for nothing', () => {
    expect(scaledCount(40, 1)).toBe(40);
    expect(scaledCount(40, 0.4)).toBe(16);
    expect(scaledCount(2, 0.1, 3)).toBe(3);
    expect(scaledCount(0, 1)).toBe(0);
    expect(scaledCount(10, 0)).toBe(0);
  });
});

describe('planeBasis', () => {
  it('returns two unit vectors perpendicular to the normal and each other', () => {
    const out = new Float32Array(6);
    for (const n of [
      [0, 0, 1],
      [0, 1, 0],
      [1, 0, 0],
      [0.3, -0.8, 0.52],
      [-1, -1, -1],
    ]) {
      planeBasis(n[0], n[1], n[2], out);
      const len = Math.hypot(n[0], n[1], n[2]);
      const nx = n[0] / len;
      const ny = n[1] / len;
      const nz = n[2] / len;
      const u = [out[0], out[1], out[2]];
      const v = [out[3], out[4], out[5]];
      expect(Math.hypot(...u)).toBeCloseTo(1, 5);
      expect(Math.hypot(...v)).toBeCloseTo(1, 5);
      expect(u[0] * nx + u[1] * ny + u[2] * nz).toBeCloseTo(0, 5);
      expect(v[0] * nx + v[1] * ny + v[2] * nz).toBeCloseTo(0, 5);
      expect(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]).toBeCloseTo(0, 5);
    }
  });
});

describe('wrapLocal (streak shader wrap)', () => {
  it('always lands inside the box around the camera', () => {
    for (const travel of [-1234.5, -3, 0, 7.25, 99999]) {
      for (const seed of [0, 0.25, 0.5, 0.999]) {
        const x = wrapLocal(seed, travel, 60);
        expect(x).toBeGreaterThanOrEqual(-30);
        expect(x).toBeLessThan(30);
      }
    }
  });

  it('moves opposite to travel and is periodic in the box size', () => {
    const a = wrapLocal(0.5, 0, 60);
    const b = wrapLocal(0.5, 5, 60);
    expect(b - a).toBeCloseTo(-5);
    expect(wrapLocal(0.3, 17, 60)).toBeCloseTo(wrapLocal(0.3, 17 + 60 * 9, 60), 6);
  });
});

describe('misc', () => {
  it('decay falls toward zero, frame-rate independent', () => {
    const once = decay(1, 3, 0.2);
    const twice = decay(decay(1, 3, 0.1), 3, 0.1);
    expect(once).toBeCloseTo(twice, 10);
    expect(once).toBeLessThan(1);
  });

  it('every surface has dust colors in range', () => {
    for (const d of Object.values(SURFACE_DUST)) {
      for (const c of [d.a, d.b, d.bits]) {
        for (const v of c) {
          expect(v).toBeGreaterThan(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('cold air only over the moor', () => {
    const moor = { x: 0, y: 760, z: 0, radius: 180 };
    expect(isColdAir(10, 770, 10, moor)).toBe(true);
    expect(isColdAir(10, 400, 10, moor)).toBe(false);
    expect(isColdAir(800, 770, 0, moor)).toBe(false);
    expect(isColdAir(10, 770, 10, null)).toBe(false);
  });

  it('finds the end of the longest wooden deck, facing out', () => {
    const end = launchDeckEnd([
      { x: 0, z: 0, yaw: 0, halfWidth: 2, length: 5, y: 10, surface: 'stone' },
      { x: 10, z: 20, yaw: Math.PI / 2, halfWidth: 2.5, length: 30, y: 12, surface: 'wood' },
      { x: 0, z: 0, yaw: 0, halfWidth: 2, length: 8, y: 10, surface: 'wood' },
    ])!;
    expect(end.x).toBeCloseTo(40);
    expect(end.z).toBeCloseTo(20);
    expect(end.y).toBe(12);
    expect(end.dirX).toBeCloseTo(1);
    expect(end.dirZ).toBeCloseTo(0);
    expect(launchDeckEnd([])).toBeNull();
    expect(launchDeckEnd(undefined)).toBeNull();
  });
});

describe('wingbeat air', () => {
  it('sheds a tip-vortex burst over the end of each downstroke, following the breed\'s stroke timing', () => {
    const at = (phase: number, downFrac = 0.5) => flapTrailBurst(phase, 1, downFrac, 1, 28);
    // Nothing early in the downstroke or on the upstroke; full at the end of the downstroke.
    expect(at(0.1)).toBe(0);
    expect(at(0.45)).toBeCloseTo(1, 6);
    expect(at(0.7)).toBe(0);
    // A longer downstroke (big breeds) moves the burst later.
    expect(at(0.45, 0.6)).toBeLessThan(at(0.55, 0.6));
    // Scaled by the beat and the animal's mass; nothing while hovering or gliding.
    expect(flapTrailBurst(0.45, 0.5, 0.5, 1, 28)).toBeCloseTo(0.5, 6);
    expect(flapTrailBurst(0.45, 1, 0.5, 1, 6)).toBe(0);
    expect(flapTrailBurst(0.45, 0, 0.5, 1, 28)).toBe(0);
  });

  it('keeps a faint vortex floor while the wings work at speed', () => {
    expect(flapTrailFloor(1, 28)).toBeCloseTo(0.2, 6);
    expect(flapTrailFloor(0, 28)).toBe(0);
    expect(flapTrailFloor(1, 8)).toBe(0);
  });

  it('weights air effects by mass (sqrt, against the harrier), within bounds', () => {
    expect(breedMassFactor(650)).toBeCloseTo(1, 6);
    expect(breedMassFactor(920)).toBeGreaterThan(1.15);
    expect(breedMassFactor(470)).toBeLessThan(0.9);
    expect(breedMassFactor(5000)).toBe(1.25);
    expect(breedMassFactor(10)).toBe(0.8);
  });

  it('presses the cloud sea only within a few spans of the billows', () => {
    expect(seaDownwashAmount(10, 13, 1)).toBe(1);
    expect(seaDownwashAmount(26, 13, 1)).toBeGreaterThan(0.3);
    expect(seaDownwashAmount(45, 13, 1)).toBe(0);
    expect(seaDownwashAmount(Number.NaN, 13, 1)).toBe(0);
  });
});
