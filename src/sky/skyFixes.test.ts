import { describe, expect, it } from 'vitest';
import { DataTexture, Scene, ShaderChunk, Vector3 } from 'three';
import { EventBus } from '../core/events';
import type { GameEvents } from '../core/types';
import { LAYOUT } from '../world/layout';
import { QUALITY } from '../render/quality';
import { createPalette, samplePalette } from './palette';
import { CloudSea, MAX_SHADOWERS, type SeaQuality } from './CloudSea';
import { CLOUD_LEVELS } from './Sky';
import { BoundaryWall } from './BoundaryWall';
import { BOUNDARY_BUFFET, WindField, boundaryApproach01, boundaryPush01 } from './windField';
import { EDGE_FADE, OCCLUDER_FADE_FROM, OCCLUDER_FADE_TO, SHADOW_RANGE, SHADOW_UP, installShadowFade, pcfShadowGlsl } from './shadowFade';
import { THERMAL_ENTER, THERMAL_EXIT, Weather } from './Weather';

/** Brightness of the world's lighting after exposure (flat-lit proxy). */
function light(t: number): number {
  const p = samplePalette(t, createPalette());
  return (p.keyI * 2.6 + p.hemiI * 0.6) * p.exposure;
}

describe('day/night brightness (VIS-07)', () => {
  it('only ever darkens from golden hour into the night', () => {
    let prev = light(0.7);
    for (let t = 0.7; t <= 0.9; t += 0.0025) {
      const v = light(t);
      // (Interpolation wiggles under 0.3% are invisible.)
      expect(v, `t=${t.toFixed(4)}`).toBeLessThanOrEqual(prev * 1.003);
      prev = v;
    }
  });

  it('only ever brightens from the depth of night into the morning', () => {
    let prev = light(0.15);
    for (let t = 0.15; t <= 0.36; t += 0.0025) {
      const v = light(t);
      expect(v, `t=${t.toFixed(4)}`).toBeGreaterThanOrEqual(prev * 0.997);
      prev = v;
    }
  });

  it('keeps night darker than dusk but still playable', () => {
    expect(light(0.95)).toBeLessThan(light(0.78) * 0.9);
    expect(light(0.95)).toBeGreaterThan(0.8);
  });
});

describe('shadow fades (VIS-03, PERF-05)', () => {
  it('patches three once, keeping the PCF signature', () => {
    expect(installShadowFade()).toBe(true);
    const once = ShaderChunk.shadowmap_pars_fragment;
    expect(installShadowFade()).toBe(true);
    expect(ShaderChunk.shadowmap_pars_fragment).toBe(once);
    expect(once).toContain('DW_SHADOW_FADE');
    expect(once.match(/float getShadow\( sampler2DShadow shadowMap/g)?.length).toBe(1);
    // The other variants (VSM, basic) are still there.
    expect(once).toContain('float getShadow( sampler2D shadowMap');
  });

  it('lifts the far test between the fade distances, as fractions of the depth range', () => {
    const body = /dwShadowLift\( int i \) \{\s*return ([^;]*);/.exec(pcfShadowGlsl())?.[1] ?? '';
    const lifts = [...body.matchAll(/\b0\.\d+/g)].map((m) => Number(m[0]));
    expect(lifts.length).toBe(5);
    for (let i = 1; i < lifts.length; i++) expect(lifts[i]).toBeGreaterThan(lifts[i - 1]);
    expect(lifts[0] * SHADOW_RANGE).toBeGreaterThan(OCCLUDER_FADE_FROM);
    expect(lifts[lifts.length - 1] * SHADOW_RANGE).toBeLessThan(OCCLUDER_FADE_TO);
    expect(EDGE_FADE).toBeGreaterThan(0.05);
  });

  it('keeps every cast shadow that can still show inside the camera range', () => {
    // Anything farther up the ray than the fade's end casts nothing anyway, so the near plane can
    // sit just past it and cull distant overhead islands from the shadow pass.
    expect(SHADOW_UP).toBeGreaterThan(OCCLUDER_FADE_TO);
    expect(SHADOW_UP).toBeLessThan(400);
  });
});

describe('cloud sea cost per quality (PERF-02)', () => {
  it('does strictly less work at each lower level', () => {
    const [low, med, high] = CLOUD_LEVELS.map((l) => l.sea);
    const work = (q: SeaQuality) => (q.steps * 2 + q.secant * 2 + q.shadowSteps * 2 + (q.detail ? 3 : 0) + q.shadowers * 0.3) * (q.half ? 0.25 : 1);
    expect(work(low)).toBeLessThan(work(med));
    expect(work(med)).toBeLessThan(work(high));
    expect(low.half && med.half).toBe(true);
    expect(high.half).toBe(false);
    expect(high.shadowers).toBe(MAX_SHADOWERS);
    // Every preset maps to a level.
    for (const q of Object.values(QUALITY)) expect(CLOUD_LEVELS[Math.round(q.clouds)]).toBeDefined();
  });

  it('switches between the full-resolution march and the half-resolution composite', () => {
    const tex = new DataTexture(new Uint8Array(4), 1, 1);
    const shared = {
      uCloudLit: { value: null as never },
      uCloudShade: { value: null as never },
      uFlashPos: { value: new Vector3() },
      uFlash: { value: 0 },
      uCloudDirect: { value: 1 },
    };
    const sea = new CloudSea(new Scene(), tex, 512, shared, CLOUD_LEVELS[2].sea);
    expect(sea.mesh.material).toBe(sea.material);
    expect(sea.material.defines.SEA_HALF).toBeUndefined();
    sea.setQuality(CLOUD_LEVELS[0].sea);
    expect(sea.mesh.material).not.toBe(sea.material);
    expect(sea.material.defines.SEA_HALF).toBe('');
    expect(sea.material.defines.SEA_DETAIL).toBe(0);
    expect(sea.material.defines.SEA_STEPS).toBe(CLOUD_LEVELS[0].sea.steps);
    sea.setQuality(CLOUD_LEVELS[2].sea);
    expect(sea.mesh.material).toBe(sea.material);
    expect(sea.material.defines.SEA_DETAIL).toBe(1);
  });
});

describe('the storm at the edge of the world (VIS-26, PLAY-16)', () => {
  const b = LAYOUT.boundaryRadius;

  it('stands beyond the boundary and only shows as you approach it', () => {
    const wall = new BoundaryWall(new Scene(), b + 480, { uCloudLit: { value: null as never }, uCloudShade: { value: null as never }, uFlash: { value: 0 } });
    const cam = { position: new Vector3() };
    wall.update(1 / 60, cam);
    expect(wall.mesh.visible).toBe(false);
    cam.position.set(b * 0.3, 400, 0);
    wall.update(1 / 60, cam);
    expect(wall.mesh.visible).toBe(false);
    cam.position.set(b - 600, 400, 0);
    wall.update(1 / 60, cam);
    expect(wall.mesh.visible).toBe(true);
    // A ring around the whole world, rising out of the sea.
    wall.mesh.geometry.computeBoundingBox();
    const box = wall.mesh.geometry.boundingBox!;
    expect(box.max.x).toBeCloseTo(b + 480, 0);
    expect(box.min.z).toBeCloseTo(-(b + 480), 0);
    expect(box.min.y).toBeLessThan(0);
    expect(box.max.y).toBeGreaterThan(900);
    wall.dispose();
  });

  it('buffets flyers vertically in the storm, nowhere else', () => {
    const f = new WindField(LAYOUT);
    f.state.wind.set(0, 0, 0);
    f.state.gust = 0;
    const out = new Vector3();
    let maxUp = 0;
    for (let i = 0; i < 64; i++) {
      f.state.time = i * 0.37;
      f.windAt(new Vector3((b + 300) * Math.cos(i), 400, (b + 300) * Math.sin(i)), out);
      maxUp = Math.max(maxUp, Math.abs(out.y));
      expect(Math.abs(out.y)).toBeLessThanOrEqual(BOUNDARY_BUFFET + 1e-6);
      f.windAt(new Vector3(b * 0.6, 400, 0), out);
      expect(out.y).toBe(0);
    }
    expect(maxUp).toBeGreaterThan(BOUNDARY_BUFFET * 0.3);
  });

  it('warns before the push begins', () => {
    expect(boundaryApproach01(b * 0.5, b)).toBe(0);
    expect(boundaryApproach01(b - 100, b)).toBeGreaterThan(0.1);
    expect(boundaryPush01(b - 100, b)).toBe(0);
    expect(boundaryApproach01(b + 400, b)).toBe(1);
  });
});

describe('thermal lift signal (FX-01)', () => {
  it('announces entering and leaving a thermal once each, with hysteresis', () => {
    const events = new EventBus<GameEvents>();
    const weather = new Weather(new Scene(), LAYOUT, events, QUALITY.low);
    weather.set('clear', true);
    const log: string[] = [];
    events.on('thermalEnter', (p) => log.push(`enter ${p.id} ${p.lift > THERMAL_ENTER}`));
    events.on('thermalExit', (p) => log.push(`exit ${p.id}`));
    const cam = { position: new Vector3() } as never;
    const t = LAYOUT.thermals[0];
    const at = (x: number) => new Vector3(x, (t.baseY + t.topY) / 2, t.z);
    // Approach from far outside, sit in the core, drift back out.
    for (const x of [t.x - 600, t.x - 300, t.x, t.x + 1, t.x - 2, t.x, t.x + 700, t.x + 800]) {
      weather.update(1 / 60, cam, at(x));
    }
    expect(log).toEqual([`enter 0 true`, `exit 0`]);
    expect(THERMAL_EXIT).toBeLessThan(THERMAL_ENTER);
  });

  it('reports lift and the boundary approach for the HUD', () => {
    const events = new EventBus<GameEvents>();
    const weather = new Weather(new Scene(), LAYOUT, events, QUALITY.low);
    const cam = { position: new Vector3() } as never;
    const t = LAYOUT.thermals[0];
    for (let i = 0; i < 120; i++) weather.update(1 / 60, cam, new Vector3(t.x, (t.baseY + t.topY) / 2, t.z));
    expect(weather.lift).toBeGreaterThan(THERMAL_ENTER);
    expect(weather.boundary).toBe(0);
    weather.update(1 / 60, cam, new Vector3(LAYOUT.boundaryRadius + 500, 400, 0));
    expect(weather.boundary).toBe(1);
  });
});
