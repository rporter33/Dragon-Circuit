// The creature light rig: per-shot kick and rim lights for the wyverns and the rider.

import { describe, expect, it } from 'vitest';
import { Color, Vector3 } from 'three';
import { createLightRigState, lightRigTargets, presetFor } from './creatureLight';

const sunRight = new Vector3(0.8, 0.4, -0.45).normalize();
const sunLeft = new Vector3(-0.8, 0.4, -0.45).normalize();
const warm = new Color(1, 0.8, 0.6);

describe('creature light rig presets', () => {
  it('picks a preset per camera rig', () => {
    expect(presetFor('stable')).toBe('stable');
    expect(presetFor('title')).toBe('title');
    for (const r of ['flight', 'mounted', 'foot', 'falling', 'photo', null]) expect(presetFor(r)).toBe('chase');
  });

  it('chase: a cool kick from above and a rim from the side away from the sun, behind the subject', () => {
    for (const sun of [sunRight, sunLeft]) {
      const s = lightRigTargets('chase', sun, 0, warm, createLightRigState());
      expect(s.kickDir.y).toBeGreaterThan(0.8);
      expect(s.kickColor.b).toBeGreaterThan(s.kickColor.r);
      expect(s.kickI).toBeCloseTo(0.25, 6);
      expect(s.rimI).toBeCloseTo(0.35, 6);
      // Opposite the sun across the frame, and from behind (view space looks down -Z).
      expect(Math.sign(s.rimDir.x)).toBe(-Math.sign(sun.x));
      expect(s.rimDir.z).toBeLessThan(0);
      expect(s.rimDir.length()).toBeCloseTo(1, 6);
    }
  });

  it('dims the kick and cools the rim toward moonlight at night', () => {
    const day = lightRigTargets('chase', sunRight, 0, warm, createLightRigState());
    const night = lightRigTargets('chase', sunRight, 1, warm, createLightRigState());
    expect(night.kickI).toBeLessThan(day.kickI * 0.5);
    expect(night.rimColor.b).toBeGreaterThan(night.rimColor.r);
    expect(night.rimI).toBeGreaterThan(0.3);
  });

  it('stable: a warm fill from camera-left and a strong rim from behind-right; title: rim only, from the backlit side', () => {
    const st = lightRigTargets('stable', sunRight, 0, warm, createLightRigState());
    expect(st.kickDir.x).toBeLessThan(0);
    expect(st.rimDir.x).toBeGreaterThan(0);
    expect(st.rimDir.z).toBeLessThan(0);
    expect(st.rimI).toBeGreaterThan(st.kickI);
    const ti = lightRigTargets('title', sunLeft, 0, warm, createLightRigState());
    expect(ti.kickI).toBe(0);
    expect(Math.sign(ti.rimDir.x)).toBe(Math.sign(sunLeft.x));
    expect(ti.rimDir.z).toBeLessThan(0);
    // The sun's hue at full value (normalised), never brighter than white.
    expect(Math.max(ti.rimColor.r, ti.rimColor.g, ti.rimColor.b)).toBeCloseTo(1, 6);
  });
});
