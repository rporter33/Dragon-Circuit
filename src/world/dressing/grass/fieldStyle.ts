// Per-island look of the ground cover: grass colors, height and density, heather, flower drifts.
// Colors are sRGB hex (decoded to linear in the shader).

import type { IslandDef } from '../../layout';

export interface FieldStyle {
  /** Blade root color (in shade under the canopy of blades). */
  base: string;
  /** Tip color, and a drier tip mixed in by patches. */
  tip: string;
  tipDry: string;
  /** Grass tufts per m² at density hint 1 and grassDensity 1. */
  density: number;
  /** Mean tuft height (m). */
  height: number;
  /** 0..1 how much of the ground is heather (plateaus). */
  heather: number;
  heatherBase: string;
  heatherTip: string;
  /** Flower petal colors; flower clusters per m² inside drifts. */
  flowers: string[];
  flowerDensity: number;
  /** 0..1 fraction of flowers that glow faintly after dusk. */
  flowerGlow: number;
}

const BASE: FieldStyle = {
  base: '#3a6a2c',
  tip: '#a3cb5a',
  tipDry: '#cfc46c',
  density: 6,
  height: 0.55,
  heather: 0,
  heatherBase: '#4a4532',
  heatherTip: '#a35ea8',
  flowers: ['#ebe6d6', '#ffd447', '#ff92b4', '#8db6ff'],
  flowerDensity: 0.06,
  flowerGlow: 0.15,
};

export function fieldStyle(def: IslandDef): FieldStyle {
  switch (def.kind) {
    case 'roost':
      return { ...BASE, base: '#3b6a2c', tip: '#a8cd5e', height: 0.46, flowers: ['#ebe6d6', '#ffd447', '#c79bff', '#ff92b4'], flowerDensity: 0.05 };
    case 'meadow':
      return def.landmark === 'gullrest'
        ? { ...BASE, base: '#41702e', tip: '#b6d769', height: 0.62, density: 7, flowers: ['#ebe6d6', '#ffd447', '#ff92b4', '#8db6ff', '#ff9a4d'], flowerDensity: 0.14, flowerGlow: 0.2 }
        : { ...BASE, base: '#3f6e2d', tip: '#addb62', height: 0.55, flowers: ['#ebe6d6', '#ffd447', '#ff92b4', '#8db6ff', '#ff9a4d'], flowerDensity: 0.1 };
    case 'forest':
      return { ...BASE, base: '#2c5530', tip: '#7aaa4d', tipDry: '#a8b45e', height: 0.42, density: 4.5, flowers: ['#ebe6d6', '#b9d7ff', '#e9c7ff'], flowerDensity: 0.035, flowerGlow: 0.35 };
    case 'rocky':
      return { ...BASE, base: '#4a5a32', tip: '#b9b465', tipDry: '#d6c37a', height: 0.34, density: 3.6, flowers: ['#ffd76a', '#ebe6d6'], flowerDensity: 0.02 };
    case 'plateau':
      return { ...BASE, base: '#56653a', tip: '#cbc070', tipDry: '#ddc98a', height: 0.5, density: 6, heather: 0.36, heatherBase: '#6a5d4a', heatherTip: '#b56fb8', flowers: ['#f2e9d8', '#ffd76a'], flowerDensity: 0.025 };
    case 'ruin':
      return { ...BASE, base: '#3f652f', tip: '#aac262', height: 0.46, density: 5.5, flowers: ['#ebe6d6', '#d8b3ff', '#ffd447'], flowerDensity: 0.07 };
    case 'cascade':
      return { ...BASE, base: '#2e622d', tip: '#8fcb5b', tipDry: '#b9cf66', height: 0.58, density: 6.5, flowers: ['#ebe6d6', '#ffd447', '#ff92b4', '#ff6b6b'], flowerDensity: 0.07 };
    case 'grove':
      return { ...BASE, base: '#275a4f', tip: '#6db99c', tipDry: '#8fc7a9', height: 0.45, density: 5, flowers: ['#7fe8ff', '#c49bff', '#9fffd6'], flowerDensity: 0.09, flowerGlow: 0.85 };
    case 'islet':
      return { ...BASE, base: '#40602f', tip: '#a8c15d', height: 0.42, density: 5, flowers: ['#ffd447', '#ebe6d6'], flowerDensity: 0.05 };
  }
}

/** "#rrggbb" → [r, g, b] bytes (sRGB). */
export function hexBytes(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
