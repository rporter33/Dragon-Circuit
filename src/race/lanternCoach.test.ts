import { describe, expect, it } from 'vitest';
import { LanternCoach, LANTERN_LIFT_ID, type LanternCoachFrame } from './lanternCoach';
import { LAYOUT } from '../world/layout';
import { WindField } from '../sky/windField';
import { Vector3 } from 'three';

const thermal = LAYOUT.thermals.find(t => t.id === LANTERN_LIFT_ID)!;
const frame = (patch: Partial<LanternCoachFrame> = {}): LanternCoachFrame => ({ x: thermal.x, z: thermal.z, y: 600, lift: 10, vy: 5, stall: 0, missedFinish: false, finishX: -1115, finishY: 690, finishZ: 821, ...patch });

describe('optional Lantern advice', () => {
  it('uses a real thermal at the suggested entry and exit heights', () => {
    const wind = new WindField(LAYOUT);
    for (const y of [400, 600, 730]) expect(wind.thermalAt(new Vector3(thermal.x, y, thermal.z))).toBeGreaterThan(2);
    const c = new LanternCoach();
    expect(c.update(frame(), thermal).phase).toBe('climb');
    const a = c.update(frame({ y: 630 }), thermal);
    expect(a.title).toContain('+30 m');
    expect(c.update(frame({ y: 730 }), thermal).phase).toBe('exit');
  });
  it('reports actual descent in rising air without claiming a climb', () => {
    const c = new LanternCoach(); c.update(frame(), thermal);
    expect(c.update(frame({ y: 595, vy: -2 }), thermal).title).toContain('−5 m · −2.0 m/s');
  });
  it('offers recovery after leaving lift too low and permits re-entry', () => {
    const c = new LanternCoach(); c.update(frame(), thermal);
    expect(c.update(frame({ x: thermal.x + 160, lift: 0 }), thermal).phase).toBe('recover');
    expect(c.update(frame({ y: 590 }), thermal).title).toContain('+0 m');
    expect(c.update(frame({ y: 620 }), thermal).title).toContain('+30 m');
  });
  it('does not call unrelated ridge lift or air beyond the top this thermal', () => {
    for (const patch of [{ x: 0 }, { y: thermal.topY }, { y: thermal.baseY }]) {
      const a = new LanternCoach().update(frame(patch), thermal);
      expect(a.phase).not.toBe('climb');
    }
  });
  it('prioritizes stall recovery and a missed finish over the suggested climb', () => {
    const c = new LanternCoach();
    expect(c.update(frame({ stall: 0.3, missedFinish: true }), thermal).phase).toBe('stall');
    expect(c.update(frame({ missedFinish: true }), thermal).phase).toBe('finish');
  });
  it('holds a single stall recovery cue through threshold jitter until speed recovers', () => {
    const c = new LanternCoach();
    for (const stall of [0.3, 0.14, 0.16, 0.08]) expect(c.update(frame({ stall }), thermal).phase).toBe('stall');
    expect(c.update(frame({ stall: 0.04 }), thermal).phase).toBe('climb');
    c.reset();
    expect(c.update(frame({ stall: 0.08 }), thermal).phase).toBe('climb');
  });
  it('does not require the suggested thermal if the rider already has height', () => {
    const a = new LanternCoach().update(frame({ x: 0, lift: 0, y: 750 }), thermal);
    expect(a.phase).toBe('exit'); expect(a.suggestLift).toBe(false);
  });
  it('uses hysteresis and clears all prior attempt feedback on reset', () => {
    const c = new LanternCoach(); c.update(frame(), thermal);
    expect(c.update(frame({ lift: 1.5 }), thermal).phase).toBe('climb');
    c.update(frame({ x: 0, lift: 0 }), thermal); c.reset();
    expect(c.update(frame({ x: 0, lift: 0 }), thermal).phase).toBe('seek');
  });
  it('keeps a completed climb aimed toward the lower finish during the descent', () => {
    const c = new LanternCoach(); c.update(frame(), thermal); c.update(frame({ y: 735 }), thermal);
    expect(c.update(frame({ x: -1300, z: 330, y: 706, lift: 0 }), thermal).phase).toBe('exit');
    for (const y of [706, 700, 690]) {
      const a = c.update(frame({ x: -970, z: 740, y, lift: 0 }), thermal);
      expect(a.phase).toBe('approach'); expect(a.suggestLift).toBe(false);
    }
  });
  it('recognizes a valid final approach without requiring the suggested lift visit', () => {
    const a = new LanternCoach().update(frame({ x: -970, z: 740, y: 706, lift: 0 }), thermal);
    expect(a.phase).toBe('approach'); expect(a.title).toContain('690 m');
  });
  it('offers local height recovery on a low final approach without requiring a thermal detour', () => {
    const a = new LanternCoach().update(frame({ x: -1100, z: 820, y: 650, lift: 0 }), thermal);
    expect(a.phase).toBe('recover'); expect(a.title).toContain('Below finish height');
    expect(a.body).toContain('gentle flaps'); expect(a.body).not.toContain('circle back');
  });
  it('still offers recovery when a prior climb has been lost below finish height', () => {
    const c = new LanternCoach(); c.update(frame({ y: 735 }), thermal);
    const a = c.update(frame({ x: -1100, z: 480, y: 620, lift: 0 }), thermal);
    expect(a.phase).toBe('recover'); expect(a.suggestLift).toBe(true);
    c.reset();
    expect(c.update(frame({ x: 0, z: 0, y: 706, lift: 0 }), thermal).phase).toBe('seek');
  });
});
