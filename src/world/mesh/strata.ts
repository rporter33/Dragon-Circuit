// Sedimentary strata shared by the meshers (geometric ledges) and the terrain shader (color
// bands). Both sides evaluate the same band function of world height so a ledge in the rock
// sits exactly on a color boundary. The GLSL twin lives in terrainMaterial.ts (STRATA_GLSL);
// keep them in sync.

/** Mean band thickness (m). */
export const STRATA_BAND = 2.6;

import { smoothstep } from '../../core/math';

/** Arithmetic hash (no sine) so the CPU and the GPU agree to float precision. */
export function hash11(p: number): number {
  let x = p * 0.1031;
  x -= Math.floor(x);
  x *= x + 33.33;
  x *= x + x;
  return x - Math.floor(x);
}

/** 2D value-noise hash, the same arithmetic as dwHash12 in the shader. */
export function hash12(px: number, py: number): number {
  let x = px * 0.1031;
  let y = py * 0.1031;
  let z = px * 0.1031;
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
  x += d;
  y += d;
  z += d;
  const r = (x + y) * z;
  return r - Math.floor(r);
}

/** Smooth 2D value noise in [0, 1]. */
export function valueNoise2(px: number, py: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash12(ix, iy);
  const b = hash12(ix + 1, iy);
  const c = hash12(ix, iy + 1);
  const d = hash12(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Mean thickness of a packet of beds (m): the bold color layers. */
export const STRATA_PACKET = 9.5;

/**
 * Wobbled height that both strata scales are measured on. A broad, slow warp tilts whole
 * formations a few degrees (beds dip across an island instead of running dead level, like a
 * stack of bricks), a medium one bends them, a fine one keeps the lines hand-drawn.
 */
function strataHeight(x: number, y: number, z: number): number {
  const wobble =
    (valueNoise2(x * 0.0035 + 41.3, z * 0.0035 - 17.9) - 0.5) * 22 +
    (valueNoise2(x * 0.011, z * 0.011) - 0.5) * 7 +
    (valueNoise2(x * 0.05 + 13.1, z * 0.05 - 7.7) - 0.5) * 1.6;
  return y + wobble;
}

/**
 * Continuous fine-bed coordinate at a world point: integer steps are bedding planes. Beds wobble
 * gently across the landscape and vary in thickness, but never fold (the warp is monotonic).
 */
export function strataCoord(x: number, y: number, z: number): number {
  const sy = strataHeight(x, y, z);
  return sy / STRATA_BAND + 0.3 * Math.sin(sy * 0.9);
}

/** Continuous packet coordinate: integer steps are the boundaries between bold layers. */
export function packetCoord(x: number, y: number, z: number): number {
  const sy = strataHeight(x, y, z);
  return sy / STRATA_PACKET + 0.25 * Math.sin(sy * 0.13);
}

/**
 * How far (m, >= 0, <= 1.35) the rock face is recessed at this point. Each packet has its own
 * hardness, so some layers stand proud and softer ones are undercut beneath them; the fine beds
 * add small steps within a packet.
 */
export function strataRecess(x: number, y: number, z: number): number {
  const v = packetCoord(x, y, z);
  const packet = Math.floor(v);
  const pf = v - packet; // 0 at the bottom of the packet, 1 at its top
  const hard = hash11(packet * 7.13 + 1.7);
  const u = strataCoord(x, y, z);
  const uf = u - Math.floor(u);
  return (1 - hard) * 0.8 + 0.4 * (1 - pf) * (1 - pf) + 0.15 * (1 - uf) * (1 - uf);
}

/**
 * 0..1 gully depth around the rim at direction (cs, sn) on an outline of radius R: narrow deep
 * gullies every ~15-25 m plus finer fluting, seamless around the island (sampled on a circle).
 */
export function gullyAt(cs: number, sn: number, R: number, seed: number): number {
  const o = (seed % 997) * 1.37;
  const k1 = R / 9;
  const k2 = R / 3.2;
  const a = valueNoise2(cs * k1 + o, sn * k1 - o);
  const b = valueNoise2(cs * k2 - o * 0.7, sn * k2 + o * 1.3);
  return Math.min(1, smoothstep(0.52, 0.82, a) + 0.35 * smoothstep(0.45, 0.9, b));
}

/** How deep (m) an island's cliff gullies cut, by island radius. */
export function gullyDepth(radius: number): number {
  return Math.min(3, 0.6 + radius * 0.011);
}

/** Gullies run on down the steep upper underside, fading out over its first third or so. */
export function gullyFade(depthBelowFoot: number, islandDepth: number): number {
  const fade = Math.max(14, islandDepth * 0.35);
  return 1 - smoothstep(fade * 0.3, fade, depthBelowFoot);
}
