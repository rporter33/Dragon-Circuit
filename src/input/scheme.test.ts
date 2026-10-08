import { describe, expect, it } from 'vitest';
import { KEYS, PAD, PAD_BUTTON, SCHEME, bindingFor, glyph, keyLabel, padLabel, type ControlAction } from './scheme';

describe('control scheme', () => {
  it('lists every action exactly once with non-empty labels', () => {
    const seen = new Set<ControlAction>();
    for (const b of SCHEME) {
      expect(seen.has(b.action), b.action).toBe(false);
      seen.add(b.action);
      expect(b.label.length).toBeGreaterThan(0);
      expect(b.xbox.length, b.action).toBeGreaterThan(0);
      expect(b.playstation.length, b.action).toBeGreaterThan(0);
      expect(b.keyboard.length, b.action).toBeGreaterThan(0);
    }
  });

  it('derives display strings from the physical bindings', () => {
    expect(bindingFor('flap')!.xbox).toBe('RT');
    expect(bindingFor('flap')!.playstation).toBe('R2');
    expect(bindingFor('flap')!.keyboard).toBe('Space / Left click');
    expect(bindingFor('tuck')!.playstation).toBe('✕ (hold)');
    expect(bindingFor('interact')!.playstation).toBe('△');
    expect(bindingFor('pitch')!.xbox).toBe('LS ↕');
    expect(bindingFor('flare')!.keyboard).toBe('C / Right click');
  });

  it('never binds flight controls to Ctrl (Ctrl+W closes the tab)', () => {
    for (const list of Object.values(KEYS)) {
      for (const code of list) expect(code.startsWith('Control')).toBe(false);
    }
  });

  it('only uses real standard-mapping buttons', () => {
    for (const list of Object.values(PAD)) for (const c of list) expect(PAD_BUTTON[c]).toBeGreaterThanOrEqual(0);
  });

  it('glyph picks the right family', () => {
    expect(glyph('interact', 'gamepad', 'xbox')).toBe('Y');
    expect(glyph('interact', 'gamepad', 'playstation')).toBe('△');
    expect(glyph('interact', 'gamepad', 'generic')).toBe('Y');
    expect(glyph('interact', 'keyboard', 'xbox')).toBe('F');
    expect(padLabel('Menu', 'playstation')).toBe('Options');
    expect(keyLabel('KeyQ')).toBe('Q');
    expect(keyLabel('ArrowUp')).toBe('↑');
  });
});
