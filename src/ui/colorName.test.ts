import { describe, expect, it } from 'vitest';
import { PALETTES } from '../cosmetics/catalog';
import { colorName, hexToHsl } from './colorName';

describe('colorName', () => {
  it('parses hex to HSL', () => {
    expect(hexToHsl('#ff0000')).toMatchObject({ h: 0, s: 1, l: 0.5 });
    expect(hexToHsl('#808080').s).toBe(0);
  });
  it('names hues and greys', () => {
    expect(colorName('#2a2a30')).toBe('Charcoal');
    expect(colorName('#8e2f2f')).toMatch(/crimson/i);
    expect(colorName('#3f7d5a')).toMatch(/moss/i);
    expect(colorName('#2f4a7a')).toMatch(/blue/i);
    expect(colorName('#e8dcc0')).toMatch(/Sand|Cream|Bone|Ivory/);
  });
  it('names every palette swatch', () => {
    for (const list of Object.values(PALETTES)) for (const hex of list) expect(colorName(hex).length).toBeGreaterThan(2);
  });
});
