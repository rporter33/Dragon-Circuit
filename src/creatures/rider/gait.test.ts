import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { cadence, dutyFactor, Gait, runBlend, strideHalf } from './gait';

const flat = (_x: number, _z: number, y: number) => y;

describe('gait', () => {
  it('walks at slow speeds and runs at fast ones', () => {
    expect(runBlend(1.4)).toBe(0);
    expect(runBlend(7.5)).toBe(1);
    expect(dutyFactor(1.4)).toBeGreaterThan(0.5); // double support while walking
    expect(dutyFactor(7.5)).toBeLessThan(0.4); // a flight phase while running
    expect(cadence(7.5)).toBeGreaterThan(cadence(1.4));
  });

  it('keeps strides within a leg length at every speed', () => {
    for (let s = 0.5; s <= 9; s += 0.5) {
      expect(strideHalf(s)).toBeLessThan(0.62);
      expect(strideHalf(s)).toBeGreaterThan(0);
    }
  });

  it('never moves a planted foot (no skating) while walking and turning', () => {
    for (const speed of [1.2, 2.5, 4.2, 7.5]) {
      const g = new Gait({ stanceWidth: 0.11, scale: 1 });
      const center = new Vector3();
      const vel = new Vector3();
      g.reset(center, 0, flat);
      let yaw = 0;
      const dt = 1 / 60;
      const last = [g.feet[0].pos.clone(), g.feet[1].pos.clone()];
      const wasPlanted = [true, true];
      let maxSlip = 0;
      let swings = 0;
      for (let i = 0; i < 600; i++) {
        yaw += 0.4 * dt; // a gentle curve
        vel.set(Math.sin(yaw) * speed, 0, Math.cos(yaw) * speed);
        center.addScaledVector(vel, dt);
        g.update(dt, center, vel, yaw, flat);
        for (let k = 0; k < 2; k++) {
          const f = g.feet[k];
          if (f.planted && wasPlanted[k]) maxSlip = Math.max(maxSlip, f.pos.distanceTo(last[k]));
          if (!f.planted && wasPlanted[k]) swings++;
          last[k].copy(f.pos);
          wasPlanted[k] = f.planted;
        }
      }
      expect(maxSlip).toBeLessThan(1e-9);
      // Both feet keep stepping, at about the expected cadence.
      expect(swings).toBeGreaterThan(cadence(speed) * 10 * 0.8);
    }
  });

  it('keeps feet near the body while moving', () => {
    const g = new Gait({ stanceWidth: 0.11, scale: 1 });
    const center = new Vector3();
    const vel = new Vector3(0, 0, 4.2);
    g.reset(center, 0, flat);
    let worst = 0;
    for (let i = 0; i < 300; i++) {
      center.addScaledVector(vel, 1 / 60);
      g.update(1 / 60, center, vel, 0, flat);
      for (const f of g.feet) worst = Math.max(worst, Math.hypot(f.pos.x - center.x, f.pos.z - center.z));
    }
    expect(worst).toBeLessThan(0.75);
  });

  it('steps the feet back under the body after turning on the spot', () => {
    const g = new Gait({ stanceWidth: 0.11, scale: 1 });
    const center = new Vector3();
    const zero = new Vector3();
    g.reset(center, 0, flat);
    // Turn 90° in place over half a second, then stand.
    for (let i = 0; i < 30; i++) g.update(1 / 60, center, zero, (i / 30) * (Math.PI / 2), flat);
    for (let i = 0; i < 120; i++) g.update(1 / 60, center, zero, Math.PI / 2, flat);
    for (const f of g.feet) {
      const n = g.neutral(f.side, center, Math.PI / 2, new Vector3());
      expect(f.planted).toBe(true);
      expect(Math.hypot(n.x - f.pos.x, n.z - f.pos.z)).toBeLessThan(0.1);
      expect(Math.abs(f.yaw - Math.PI / 2)).toBeLessThan(0.15);
    }
  });

  it('plants feet on the ground function', () => {
    const g = new Gait({ stanceWidth: 0.11, scale: 1 });
    const slope = (x: number, z: number) => 0.3 * z;
    const center = new Vector3();
    const vel = new Vector3(0, 0, 2);
    g.reset(center, 0, slope);
    for (let i = 0; i < 200; i++) {
      center.addScaledVector(vel, 1 / 60);
      center.y = slope(center.x, center.z);
      g.update(1 / 60, center, vel, 0, slope);
      for (const f of g.feet) if (f.planted) expect(f.pos.y).toBeCloseTo(slope(f.pos.x, f.pos.z), 6);
    }
  });
});
