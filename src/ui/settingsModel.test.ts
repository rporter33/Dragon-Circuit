import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../game/settings';
import { SETTINGS_TABS, cycleChoice, sliderFraction, sliderValueAt, stepSlider } from './settingsModel';

describe('settings rows', () => {
  it('cover every setting exactly once', () => {
    const keys = SETTINGS_TABS.flatMap((t) => t.rows).flatMap((r) => (r.kind === 'action' ? [] : [r.key]));
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys)).toEqual(new Set(Object.keys(DEFAULT_SETTINGS)));
  });
  it('slider ranges contain the defaults', () => {
    for (const row of SETTINGS_TABS.flatMap((t) => t.rows)) {
      if (row.kind !== 'slider') continue;
      const v = DEFAULT_SETTINGS[row.key] as number;
      expect(v).toBeGreaterThanOrEqual(row.min);
      expect(v).toBeLessThanOrEqual(row.max);
    }
  });
});

describe('stepSlider', () => {
  const row = { min: 0, max: 1, step: 0.05 };
  it('steps on the grid without float noise', () => {
    expect(stepSlider(0.1, row, 1)).toBe(0.15);
    expect(stepSlider(0.3, row, -1)).toBe(0.25);
  });
  it('snaps off-grid values and clamps at the ends', () => {
    expect(stepSlider(0.12, row, 1)).toBe(0.15);
    expect(stepSlider(1, row, 1)).toBe(1);
    expect(stepSlider(0, row, -1)).toBe(0);
  });
  it('maps track positions to snapped values and back', () => {
    const fov = { min: 50, max: 90, step: 1 };
    expect(sliderValueAt(0.5, fov)).toBe(70);
    expect(sliderValueAt(1.4, fov)).toBe(90);
    expect(sliderFraction(70, fov)).toBeCloseTo(0.5);
  });
});

describe('cycleChoice', () => {
  const opts = [{ value: 'low' }, { value: 'medium' }, { value: 'high' }];
  it('clamps on left/right', () => {
    expect(cycleChoice('high', opts, 1)).toBe('high');
    expect(cycleChoice('low', opts, -1)).toBe('low');
    expect(cycleChoice('medium', opts, 1)).toBe('high');
  });
  it('wraps when asked (A on the row)', () => {
    expect(cycleChoice('high', opts, 1, true)).toBe('low');
    expect(cycleChoice('low', opts, -1, true)).toBe('high');
  });
});
