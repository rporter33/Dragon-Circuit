import { describe, expect, it } from 'vitest';
import { CameraShake, Trauma, type ShakeOffsets } from './shake';

describe('shake ignores frames where no time passed (DT-01)', () => {
  it('Trauma.update holds its value for 0, negative and NaN steps', () => {
    const t = new Trauma();
    t.add(0.6);
    for (const dt of [0, -0.5, Number.NaN, -Infinity]) {
      t.update(dt);
      expect(t.value).toBe(0.6);
    }
  });

  it('CameraShake.update returns the last offsets unchanged and keeps its clock', () => {
    const s = new CameraShake();
    const out: ShakeOffsets = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0 };
    s.add(1);
    s.update(1 / 60, out);
    const snap = { ...out };
    const trauma = s.trauma.value;
    for (const dt of [0, -1, Number.NaN]) {
      expect(s.update(dt, out)).toBe(out);
      expect(out).toEqual(snap);
      expect(s.trauma.value).toBe(trauma);
    }
    // Time resumes where it stopped: the next real step matches a shake that never saw the bad frames.
    const ref = new CameraShake();
    const refOut: ShakeOffsets = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0 };
    ref.add(1);
    ref.update(1 / 60, refOut);
    ref.update(1 / 60, refOut);
    s.update(1 / 60, out);
    expect(out).toEqual(refOut);
  });
});
