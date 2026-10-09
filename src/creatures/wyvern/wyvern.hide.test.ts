// Wyvern hide and light (stream D): patterns, the ghost shell, reptile scales and armour, region
// seams; the creature light that replaces the painterly lift for creatures only, the highlight
// shoulder under the bloom threshold, the pale-palette caps, and the world's shaders left exactly
// as they were. Shared poses and helpers: wyvern.testkit.ts.

import { describe, expect, it } from 'vitest';
import { Color, ShaderLib, type Material, type WebGLProgramParametersWithUniforms } from 'three';
import { PAINTERLY_RIM_GLSL, toonMaterial } from '../../render/painterly';
import { BREED_DEFAULT_COLORS, DEFAULT_WYVERN, PALETTES, cosmeticsFor } from '../../cosmetics/catalog';
import { Wyvern } from './Wyvern';
import {
  BELLY_MAX_LUMINANCE,
  PATTERN_IDS,
  SCALES_MAX_LUMINANCE,
  applyLookUniforms,
  createBodyMaterial,
  createMembraneMaterial,
  createWyvernUniforms,
  luminance,
} from './materials';
import { CREATURE_LIGHT, CREATURE_LIGHT_BLOCK, shoulder } from './shading/light';
import { gliding, look } from './wyvern.testkit';

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

describe('model budget and cosmetics', () => {
  it('maps every pattern id to a distinct shader pattern', () => {
    const ids = cosmeticsFor('wyvernPattern').map((c) => PATTERN_IDS[c.id]);
    expect(ids.every((v) => v !== undefined)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('ghost', () => {
  it('is translucent and casts no shadows', () => {
    const w = new Wyvern(look('galewing'), { ghost: true });
    const m = w.skinnedMesh!;
    expect(m.castShadow).toBe(false);
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      expect(mat.transparent).toBe(true);
      expect(mat.depthWrite).toBe(false);
    }
    w.update(1 / 60, gliding());
    w.dispose();
  });
});

describe('reptile hide', { timeout: 60000 }, () => {
  it('armors the ironback like a crocodile: paired keeled osteoderms from nape to tail, none under the saddle', () => {
    const w = new Wyvern(look('ironback'));
    const g = w.skinnedMesh!.geometry;
    const pos = g.getAttribute('position');
    const mat = g.getAttribute('aMat');
    const rig = w.rigDef;
    let left = 0;
    let right = 0;
    let zMax = -Infinity;
    let zMin = Infinity;
    let underSaddle = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.round(mat.getX(i)) !== 8) continue;
      const x = pos.getX(i);
      const z = pos.getZ(i);
      if (x > 0.01) left++;
      else if (x < -0.01) right++;
      zMax = Math.max(zMax, z);
      zMin = Math.min(zMin, z);
      if (Math.abs(z - rig.seat.z) < 0.35 && pos.getY(i) > rig.seat.y - 0.6) underSaddle++;
    }
    // Paired rows, mirror-symmetric.
    expect(left).toBeGreaterThan(400);
    expect(Math.abs(left - right)).toBeLessThan(left * 0.02);
    // From up the neck (well ahead of the shoulders) to far down the tail.
    expect(zMax).toBeGreaterThan(rig.props.shoulder[2] + 1);
    expect(zMin).toBeLessThan(rig.tailTip.z * 0.6);
    expect(underSaddle).toBe(0);
    w.dispose();
    // The other breeds go unarmored.
    const h = new Wyvern(look('harrier'));
    const hm = h.skinnedMesh!.geometry.getAttribute('aMat');
    let plates = 0;
    for (let i = 0; i < hm.count; i++) if (Math.round(hm.getX(i)) === 8) plates++;
    expect(plates).toBe(0);
    h.dispose();
  });

  it('paints every triangle in one material region (no seams of the ids in between)', () => {
    for (const saddle of ['rider', 'royal', 'nomad', 'racing']) {
      const w = new Wyvern(look('ironback', { saddle }));
      const g = w.skinnedMesh!.geometry;
      const mat = g.getAttribute('aMat');
      const idx = g.index!.array;
      let mixed = 0;
      for (let t = 0; t < idx.length; t += 3) {
        const r0 = mat.getX(idx[t]);
        if (mat.getX(idx[t + 1]) !== r0 || mat.getX(idx[t + 2]) !== r0) mixed++;
      }
      expect(mixed, saddle).toBe(0);
      w.dispose();
    }
  });

  it('tells the body shader the angle around the tube for its rows of keeled scales', () => {
    const w = new Wyvern(look('harrier'));
    const geo = w.skinnedMesh!.geometry;
    const mat = geo.getAttribute('aMat');
    // Body group only (membranes use the channel for their flutter).
    const body = new Set<number>();
    const idx = geo.index!.array;
    for (let i = geo.groups[0].start; i < geo.groups[0].start + geo.groups[0].count; i++) body.add(idx[i]);
    let tube = 0;
    let bad = 0;
    for (const i of body) {
      if (Math.round(mat.getX(i)) !== 0) continue;
      const a = mat.getW(i);
      if (a > 0.5) {
        tube++;
        if (a < 1 - 1e-6 || a > 3 + 1e-6) bad++;
      }
    }
    expect(tube).toBeGreaterThan(1000);
    expect(bad).toBe(0);
    w.dispose();
  });
});

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
