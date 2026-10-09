// The wyvern's hide and light (stream D): the creature light replaces the painterly lift for
// creatures only, the hide is shouldered under the bloom threshold, pale palettes are capped,
// and the world's shaders are left exactly as they were.

import { describe, expect, it } from 'vitest';
import { Color, ShaderLib, type WebGLProgramParametersWithUniforms } from 'three';
import { PAINTERLY_RIM_GLSL, toonMaterial } from '../../render/painterly';
import { BREED_DEFAULT_COLORS, DEFAULT_WYVERN, PALETTES } from '../../cosmetics/catalog';
import {
  BELLY_MAX_LUMINANCE,
  SCALES_MAX_LUMINANCE,
  applyLookUniforms,
  createBodyMaterial,
  createMembraneMaterial,
  createWyvernUniforms,
  luminance,
} from './materials';
import { CREATURE_LIGHT, CREATURE_LIGHT_BLOCK, shoulder } from './shading/light';
import type { Material } from 'three';

/** Run a material's onBeforeCompile on three's toon source, as the renderer would. */
function compiled(m: Material): WebGLProgramParametersWithUniforms {
  const shader = {
    vertexShader: ShaderLib.toon.vertexShader,
    fragmentShader: ShaderLib.toon.fragmentShader,
    uniforms: {},
  } as unknown as WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(shader, undefined as never);
  return shader;
}

const hex = (c: string) => new Color(c);

describe('creature light replaces the painterly lift (creatures only)', () => {
  it('the body and membrane shaders carry the creature light, not the flat lift', () => {
    for (const m of [createBodyMaterial(createWyvernUniforms()), createMembraneMaterial(createWyvernUniforms())]) {
      const s = compiled(m);
      expect(s.fragmentShader).toContain(CREATURE_LIGHT_BLOCK);
      expect(s.fragmentShader).not.toContain(PAINTERLY_RIM_GLSL);
      expect(s.uniforms).toHaveProperty('uDwBloomT');
    }
  });

  it('world materials still compile the painterly lift, byte for byte', () => {
    const s = compiled(toonMaterial({ color: 0x808080 }));
    expect(s.fragmentShader.split(PAINTERLY_RIM_GLSL).length - 1).toBe(1);
    expect(s.fragmentShader).not.toContain('uDwBloomT');
    expect(s.uniforms).not.toHaveProperty('uDwBloomT');
  });
});

describe('highlight shoulder', () => {
  it('leaves light below the knee alone and never reaches the bloom threshold', () => {
    for (const thr of [0.72, 0.75, 0.78, 0.82, 0.9]) {
      const knee = thr - CREATURE_LIGHT.kneeBelow;
      expect(shoulder(knee * 0.9, thr)).toBeCloseTo(knee * 0.9, 9);
      let prev = 0;
      for (let l = 0; l < 40; l += 0.05) {
        const y = shoulder(l, thr);
        expect(y).toBeLessThan(thr - CREATURE_LIGHT.ceilingBelow + 1e-9);
        expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = y;
      }
      // Continuous slope at the knee: the curve starts at the given compression.
      const e = 1e-4;
      expect((shoulder(knee + e, thr) - shoulder(knee, thr)) / e).toBeCloseTo(CREATURE_LIGHT.kneeSlope, 2);
    }
  });
});

describe('pale palettes are capped', () => {
  it('caps a look’s belly and scales luminance, keeping the hue', () => {
    const u = createWyvernUniforms();
    applyLookUniforms(u, { ...DEFAULT_WYVERN, belly: '#ffffff', primary: '#f8f4ec', secondary: '#2a2a30' });
    expect(luminance(u.uBelly.value)).toBeCloseTo(BELLY_MAX_LUMINANCE, 6);
    expect(luminance(u.uPrimary.value)).toBeCloseTo(SCALES_MAX_LUMINANCE, 6);
    // Dark colors pass through untouched.
    expect(u.uSecondary.value.getHex()).toBe(hex('#2a2a30').getHex());
    // Hue kept: channel ratios unchanged.
    const c = hex('#f8f4ec');
    expect(u.uPrimary.value.r / u.uPrimary.value.g).toBeCloseTo(c.r / c.g, 6);
  });

  it('offers no belly swatch or breed default paler than before the bloom fix', () => {
    for (const b of PALETTES.belly) expect(luminance(hex(b))).toBeLessThan(0.71);
    for (const id of Object.keys(BREED_DEFAULT_COLORS) as (keyof typeof BREED_DEFAULT_COLORS)[]) {
      expect(luminance(hex(BREED_DEFAULT_COLORS[id].belly))).toBeLessThan(0.66);
    }
  });

  it('gives the galewing a slate a full step under the cloud', () => {
    const g = BREED_DEFAULT_COLORS.galewing;
    expect(luminance(hex(g.primary))).toBeLessThan(0.15);
    expect(luminance(hex(g.secondary))).toBeLessThan(luminance(hex(g.primary)));
  });
});
