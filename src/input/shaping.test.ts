import { describe, expect, it } from 'vitest';
import {
  RepeatTimer,
  SHAPING,
  StickNav,
  TapPulse,
  circleToSquare,
  detectPadStyle,
  dominant,
  expo,
  radialDeadzone,
  rampAxis,
  triggerDeadzone,
  wheelNotches,
  type Vec2,
} from './shaping';

const v = (): Vec2 => ({ x: 0, y: 0 });

describe('radialDeadzone', () => {
  it('reads zero anywhere inside the inner radius, including diagonally', () => {
    const out = v();
    expect(radialDeadzone(0.1, 0, 0.13, 0.05, out)).toEqual({ x: 0, y: 0 });
    expect(radialDeadzone(0.09, 0.09, 0.13, 0.05, out)).toEqual({ x: 0, y: 0 });
    expect(radialDeadzone(-0.12, 0.02, 0.13, 0.05, out)).toEqual({ x: 0, y: 0 });
  });

  it('starts from zero just past the edge (no jump) and reaches 1 before the rim', () => {
    const out = v();
    radialDeadzone(0.14, 0, 0.13, 0.05, out);
    expect(out.x).toBeGreaterThan(0);
    expect(out.x).toBeLessThan(0.02);
    radialDeadzone(0.96, 0, 0.13, 0.05, out);
    expect(out.x).toBeCloseTo(1, 5);
    radialDeadzone(0, -1, 0.13, 0.05, out);
    expect(out.y).toBeCloseTo(-1, 5);
  });

  it('preserves direction', () => {
    const out = v();
    radialDeadzone(0.3, 0.4, 0.13, 0.05, out);
    expect(Math.atan2(out.y, out.x)).toBeCloseTo(Math.atan2(0.4, 0.3), 6);
  });

  it('is monotonic in magnitude', () => {
    const out = v();
    let last = -1;
    for (let m = 0; m <= 1.0001; m += 0.02) {
      radialDeadzone(m * 0.6, m * 0.8, 0.13, 0.05, out);
      const mag = Math.hypot(out.x, out.y);
      expect(mag).toBeGreaterThanOrEqual(last);
      expect(mag).toBeLessThanOrEqual(1 + 1e-9);
      last = mag;
    }
  });
});

describe('circleToSquare', () => {
  it('gives full deflection on both axes at a full diagonal', () => {
    const s = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
    circleToSquare(s);
    expect(s.x).toBeCloseTo(1, 5);
    expect(s.y).toBeCloseTo(-1, 5);
  });
  it('leaves pure axis input unchanged', () => {
    const s = { x: 0.4, y: 0 };
    circleToSquare(s);
    expect(s).toEqual({ x: 0.4, y: 0 });
  });
});

describe('triggerDeadzone', () => {
  it('ignores resting noise and saturates near the top of travel', () => {
    expect(triggerDeadzone(0)).toBe(0);
    expect(triggerDeadzone(0.05)).toBe(0);
    expect(triggerDeadzone(0.5)).toBeGreaterThan(0.45);
    expect(triggerDeadzone(0.97)).toBe(1);
    expect(triggerDeadzone(NaN)).toBe(0);
  });
});

describe('expo response curve', () => {
  it('keeps the endpoints and sign', () => {
    expect(expo(0, SHAPING.flightExpo)).toBe(0);
    expect(expo(1, SHAPING.flightExpo)).toBeCloseTo(1, 9);
    expect(expo(-1, SHAPING.flightExpo)).toBeCloseTo(-1, 9);
    expect(expo(-0.3, 0.5)).toBeCloseTo(-expo(0.3, 0.5), 9);
  });
  it('makes small inputs smaller (precise centre) and stays monotonic', () => {
    expect(expo(0.2, SHAPING.flightExpo)).toBeLessThan(0.12);
    let last = -Infinity;
    for (let x = -1; x <= 1; x += 0.05) {
      const y = expo(x, SHAPING.flightExpo);
      expect(y).toBeGreaterThan(last);
      last = y;
    }
  });
});

describe('rampAxis (keyboard flight keys)', () => {
  const step = (from: number, target: number, seconds: number, dt = 1 / 200) => {
    let x = from;
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) x = rampAxis(x, target, dt);
    return x;
  };

  it('reaches full deflection in ~0.12 s, not instantly', () => {
    expect(rampAxis(0, 1, 1 / 60)).toBeCloseTo(1 / 60 / SHAPING.keyAttack, 6);
    expect(step(0, 1, 0.06)).toBeCloseTo(0.5, 1);
    expect(step(0, 1, 0.12)).toBeCloseTo(1, 6);
  });

  it('a short tap gives a partial deflection', () => {
    const tap = step(0, 1, 0.04);
    expect(tap).toBeGreaterThan(0.2);
    expect(tap).toBeLessThan(0.5);
  });

  it('settles back to centre over the release time', () => {
    expect(step(1, 0, 0.04)).toBeCloseTo(0.5, 1);
    expect(step(1, 0, SHAPING.keyRelease)).toBe(0);
  });

  it('reverses through zero: release first, then attack', () => {
    const t = SHAPING.keyRelease + SHAPING.keyAttack;
    expect(step(1, -1, SHAPING.keyRelease)).toBeCloseTo(0, 6);
    expect(step(1, -1, t)).toBeCloseTo(-1, 6);
    // One big frame spanning the zero crossing spends the leftover time attacking.
    const x = rampAxis(1, -1, SHAPING.keyRelease + SHAPING.keyAttack / 2);
    expect(x).toBeCloseTo(-0.5, 6);
  });

  it('never overshoots', () => {
    expect(rampAxis(0.9, 1, 1)).toBe(1);
    expect(rampAxis(0.5, 0.3, 1)).toBe(0.3);
  });
});

describe('RepeatTimer (menu auto-repeat)', () => {
  it('fires on press, after 380 ms, then every 90 ms', () => {
    const r = new RepeatTimer();
    const dt = 0.005;
    const fires: number[] = [];
    for (let i = 0; i <= 200; i++) {
      if (r.update(true, i === 0 ? 0 : dt)) fires.push(Math.round(i * dt * 1000));
    }
    expect(fires[0]).toBe(0);
    expect(fires[1]).toBe(380);
    expect(fires[2]).toBe(470);
    expect(fires[3]).toBe(560);
    expect(fires[4]).toBe(650);
  });

  it('restarts after release', () => {
    const r = new RepeatTimer();
    expect(r.update(true, 0.016)).toBe(true);
    expect(r.update(true, 0.016)).toBe(false);
    expect(r.update(false, 0.016)).toBe(false);
    expect(r.update(true, 0.016)).toBe(true);
  });

  it('does not burst after a long hitch', () => {
    const r = new RepeatTimer();
    r.update(true, 0);
    expect(r.update(true, 2)).toBe(true);
    expect(r.update(true, 0.016)).toBe(false);
  });
});

describe('StickNav', () => {
  it('engages past the on threshold and holds until below the off threshold', () => {
    const n = new StickNav();
    expect(n.update(0.5, 0)).toBe(null);
    expect(n.update(0.6, 0)).toBe('right');
    expect(n.update(0.4, 0)).toBe('right');
    expect(n.update(0.3, 0)).toBe(null);
    expect(n.update(0, -0.8)).toBe('up');
    expect(n.update(0, 0.8)).toBe('down');
  });
  it('reports only the dominant axis', () => {
    const n = new StickNav();
    expect(n.update(0.7, 0.6)).toBe('right');
  });
});

describe('TapPulse (tap-to-flap)', () => {
  it('gives one pulse per press, carrying the peak strength', () => {
    const t = new TapPulse(0.14);
    const dt = 1 / 60;
    const out: number[] = [];
    const raw = [0, 0.4, 0.8, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0];
    for (const r of raw) out.push(t.update(r, dt));
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(0.4);
    expect(out[3]).toBe(1);
    // Holding does not repeat once the pulse has run out.
    expect(out[13]).toBe(0);
    // Release and press again: another pulse.
    expect(t.update(1, dt)).toBe(1);
  });
});

describe('detectPadStyle', () => {
  it('recognises the common ids', () => {
    expect(detectPadStyle('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('xbox');
    expect(detectPadStyle('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)')).toBe('xbox');
    expect(detectPadStyle('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)')).toBe('playstation');
    expect(detectPadStyle('054c-0ce6-DualSense Wireless Controller')).toBe('playstation');
    expect(detectPadStyle('DualShock 4')).toBe('playstation');
    expect(detectPadStyle('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)')).toBe('generic');
    expect(detectPadStyle('8BitDo SN30 Pro')).toBe('generic');
  });
});

describe('misc', () => {
  it('wheelNotches normalises pixel and line modes, + = zoom in', () => {
    expect(wheelNotches(-100, 0)).toBeCloseTo(1);
    expect(wheelNotches(3, 1)).toBeCloseTo(-1);
    expect(wheelNotches(-100000, 0)).toBe(5);
  });
  it('dominant keeps the larger deflection with its sign', () => {
    expect(dominant(0.2, -0.7)).toBe(-0.7);
    expect(dominant(-1, 0.5)).toBe(-1);
  });
});
