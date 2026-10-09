import { describe, expect, it } from 'vitest';
import { bindingFor } from '../input/scheme';
import { bindingKeyboardHtml, bindingPadHtml, controlLabel, controlsFor, glyphDevice, glyphHtml, keyGlyph, padGlyph } from './glyphs';

describe('glyph device', () => {
  it('follows the last-used device and pad family', () => {
    expect(glyphDevice('keyboard', 'playstation')).toBe('keyboard');
    expect(glyphDevice('gamepad', 'playstation')).toBe('playstation');
    expect(glyphDevice('gamepad', null)).toBe('xbox');
  });
});

describe('controlsFor', () => {
  it('reads the control scheme, one control for prompts', () => {
    expect(controlsFor('flare', 'xbox')).toMatchObject({ pad: ['LT'], keys: [] });
    expect(controlsFor('flap', 'keyboard')).toMatchObject({ pad: [], keys: ['Space'] });
    expect(controlsFor('tuck', 'xbox').hold).toBe(true);
    expect(controlsFor('pitch', 'xbox').axis).toBe('↕');
  });
  it('shows every control of a chord (tuck is LB + RB held together)', () => {
    expect(controlsFor('tuck', 'xbox').pad).toEqual(['LB', 'RB']);
    expect(controlsFor('flap', 'xbox').pad).toEqual(['RT']);
    const html = glyphHtml('tuck', 'xbox');
    expect(html).toContain('>LB<');
    expect(html).toContain('>RB<');
    expect(html).toContain('dw-glyph-sep">+<');
    expect(bindingPadHtml(bindingFor('tuck')!, 'playstation')).toContain('dw-glyph-sep">+<');
    // Alternatives still read as "or".
    expect(bindingPadHtml(bindingFor('yaw')!, 'xbox')).toContain('dw-glyph-sep">/<');
  });
  it('collapses left/right key variants', () => {
    expect(controlsFor('tuck', 'keyboard', true).keys).toEqual(['ShiftLeft']);
  });
});

describe('glyph markup', () => {
  it('draws face buttons per family', () => {
    expect(padGlyph('A', 'xbox')).toContain('>A<');
    // PlayStation draws shapes, not letters.
    expect(padGlyph('A', 'playstation')).not.toContain('>A<');
    expect(padGlyph('LB', 'playstation')).toContain('L1');
    expect(padGlyph('Menu', 'playstation')).toContain('Options');
  });
  it('draws keys as keycaps and mouse buttons as a mouse', () => {
    expect(keyGlyph('KeyF')).toContain('>F<');
    expect(keyGlyph('Mouse0')).toContain('dw-g-mouse');
    expect(keyGlyph('ArrowUp')).toContain('dw-key--icon');
  });
  it('builds prompt glyphs for both devices', () => {
    expect(glyphHtml('interact', 'keyboard')).toContain('>F<');
    expect(glyphHtml('interact', 'xbox')).toContain('>Y<');
    expect(glyphHtml('navigate', 'keyboard')).toContain('dw-key--icon');
  });
  it('renders controls-screen columns', () => {
    const look = bindingFor('look')!;
    const kb = bindingKeyboardHtml(look);
    expect(kb).toContain('dw-g-mouse');
    expect(kb).toContain('click to capture');
    expect(bindingPadHtml(bindingFor('tuck')!, 'xbox')).toContain('hold');
  });
});

describe('device-correct copy', () => {
  it('shows the whole WASD cluster for walking on the keyboard, not just W', () => {
    expect(glyphHtml('move', 'keyboard')).toContain('>WASD<');
    expect(glyphHtml('flap', 'keyboard')).toContain('>Space<');
  });
  it('drops gamepad-only notes from keyboard control labels', () => {
    expect(controlLabel('Run (hold, or click L3 to keep running)', 'keyboard')).toBe('Run (hold)');
    expect(controlLabel('Run (hold, or click L3 to keep running)', 'xbox')).toBe('Run (hold, or click L3 to keep running)');
    expect(controlLabel('Dismount (when landed)', 'keyboard')).toBe('Dismount (when landed)');
    expect(controlLabel('Turn (right stick)', 'keyboard')).toBe('Turn');
    expect(controlLabel('Beat wings (costs stamina; pull harder for a stronger beat)', 'keyboard')).toBe('Beat wings (costs stamina)');
  });
});
