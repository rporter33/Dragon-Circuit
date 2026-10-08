// The air the wyverns fly through. windAt(p) = prevailing wind + gusts + thermals + ridge lift
// + the boundary push. Deterministic for a given state, allocation-free, and cheap: the flight
// model calls it at 120 Hz and the fx module samples it for particles.
//
// Feel notes (it is a game, not a weather model):
//   - Gusts are bursty along the wind (strong pulses, gentle lulls), with a little lateral and
//     vertical buffeting that grows with gustiness, so breezy days feel alive under the wings.
//   - Thermals have a broad, full-strength core and a soft edge, so circling in one is forgiving.
//   - Ridge lift rises off the windward cliffs of every island and peaks around rim height; the
//     lee side sinks, but gently.
//   - Past the boundary a headwind builds smoothly and turns you back toward the Roost.

import { Vector3 } from 'three';
import { smoothstep } from '../core/math';
import { noise3, type Noise3 } from '../core/noise';
import type { IslandDef, ThermalDef, WorldLayout } from '../world/layout';

export interface WindState {
  /** Prevailing wind (m/s, world, horizontal). */
  wind: Vector3;
  /** 0..1 gust amplitude. */
  gust: number;
  /** Thermal strength multiplier. */
  thermal: number;
  /** Seconds, for gusts evolving in place. */
  time: number;
  /** Integral of the prevailing wind over time (m): gust patterns ride along with the air. */
  drift: Vector3;
}

/** Thermal core (fraction of radius) that blows at full strength. */
export const THERMAL_CORE = 0.45;
/** Beyond this fraction of the radius a thermal does nothing. */
export const THERMAL_EDGE = 1.2;
/** Height over which a thermal ramps in above its base, and the fraction of the column it fades over at the top. */
const THERMAL_RAMP_IN = 60;
const THERMAL_FADE_TOP = 0.18;

/** Ridge lift as a fraction of the prevailing wind speed (windward face, at peak). */
export const RIDGE_GAIN = 0.6;
/** Sink on the lee side relative to the windward lift. */
export const LEE_GAIN = 0.35;

/** Headwind past the boundary (m/s at full strength). */
export const BOUNDARY_PUSH = 34;
const BOUNDARY_RAMP_IN = 60;
const BOUNDARY_RAMP_OUT = 380;

const GUST_SCALE = 1 / 230;
const CELL = 400;

interface RidgeIsland {
  def: IslandDef;
  /** Width of the lift band outside the rim (m). */
  width: number;
  /** Radius beyond which the island has no influence. */
  reach: number;
  bottom: number;
  ceiling: number;
}

export class WindField {
  readonly state: WindState = {
    wind: new Vector3(3, 0, 1.5),
    gust: 0.25,
    thermal: 1,
    time: 0,
    drift: new Vector3(),
  };
  private layout: WorldLayout;
  private thermals: ThermalDef[];
  private grid = new Map<number, RidgeIsland[]>();
  private noise: Noise3;
  private empty: RidgeIsland[] = [];

  constructor(layout: WorldLayout, seed = 0x77a1d) {
    this.layout = layout;
    this.thermals = layout.thermals;
    this.noise = noise3(seed);
    for (const def of layout.islands) {
      const width = 30 + def.radius * 0.35;
      const isl: RidgeIsland = {
        def,
        width,
        reach: def.radius * (1 + def.outline) + width * 1.6,
        bottom: def.y - def.depth * 0.7,
        ceiling: def.y + 45 + def.radius * 0.5,
      };
      const x0 = Math.floor((def.x - isl.reach) / CELL);
      const x1 = Math.floor((def.x + isl.reach) / CELL);
      const z0 = Math.floor((def.z - isl.reach) / CELL);
      const z1 = Math.floor((def.z + isl.reach) / CELL);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const k = key(cx, cz);
          let list = this.grid.get(k);
          if (!list) this.grid.set(k, (list = []));
          list.push(isl);
        }
      }
    }
  }

  /** Air velocity at p (m/s). Writes into and returns `out`. */
  windAt(p: Vector3, out: Vector3): Vector3 {
    const s = this.state;
    const w = s.wind;
    const speed = Math.hypot(w.x, w.z);
    out.set(w.x, 0, w.z);

    // Gusts: noise advected with the air so a gust front sweeps across the sky, not in place.
    if (s.gust > 0 && speed > 0.01) {
      const dx = w.x / speed;
      const dz = w.z / speed;
      const nx = (p.x - s.drift.x) * GUST_SCALE;
      const nz = (p.z - s.drift.z) * GUST_SCALE;
      const ny = p.y * GUST_SCALE * 0.7 + s.time * 0.045;
      const n1 = this.noise(nx, ny, nz);
      const n2 = this.noise(nx + 37.1, ny - 11.3, nz + 5.7);
      const n3 = this.noise(nx * 1.7 - 21.4, ny * 1.7 + 8.2, nz * 1.7 + 13.9);
      // Bursty: pulses push harder than lulls slacken.
      const along = (n1 > 0 ? n1 * 1.25 : n1 * 0.6) * speed * s.gust * 0.6;
      const lateral = n2 * speed * s.gust * 0.28;
      out.x += dx * along - dz * lateral;
      out.z += dz * along + dx * lateral;
      out.y += n3 * s.gust * (0.6 + speed * 0.1);
    }

    out.y += this.thermalAt(p) + this.ridgeAt(p, speed);
    this.addBoundary(p, out);
    return out;
  }

  /** Vertical speed from thermals at p (m/s). */
  thermalAt(p: Vector3): number {
    let up = 0;
    for (const t of this.thermals) {
      const dx = p.x - t.x;
      const dz = p.z - t.z;
      const reach = t.radius * THERMAL_EDGE;
      const d2 = dx * dx + dz * dz;
      if (d2 >= reach * reach) continue;
      if (p.y <= t.baseY || p.y >= t.topY) continue;
      const d = Math.sqrt(d2);
      const radial = 1 - smoothstep(t.radius * THERMAL_CORE, reach, d);
      const fadeTop = (t.topY - t.baseY) * THERMAL_FADE_TOP;
      const vertical = smoothstep(t.baseY, t.baseY + THERMAL_RAMP_IN, p.y) * (1 - smoothstep(t.topY - fadeTop, t.topY, p.y));
      up += t.strength * this.state.thermal * radial * vertical;
    }
    return up;
  }

  /**
   * Vertical speed from wind deflected by island cliffs (m/s): positive on the windward side,
   * a gentle sink on the lee. `speed` defaults to the prevailing wind speed.
   */
  ridgeAt(p: Vector3, speed = Math.hypot(this.state.wind.x, this.state.wind.z)): number {
    if (speed < 0.01) return 0;
    const list = this.grid.get(key(Math.floor(p.x / CELL), Math.floor(p.z / CELL))) ?? this.empty;
    if (list.length === 0) return 0;
    const wx = this.state.wind.x / speed;
    const wz = this.state.wind.z / speed;
    let lift = 0;
    for (const isl of list) {
      if (p.y < isl.bottom || p.y > isl.ceiling) continue;
      const d = isl.def;
      const dx = p.x - d.x;
      const dz = p.z - d.z;
      const r2 = dx * dx + dz * dz;
      if (r2 > isl.reach * isl.reach || r2 < 1e-6) continue;
      const r = Math.sqrt(r2);
      // Signed distance outside the mean rim; the lift band starts a little inside the rim.
      const s = r - d.radius;
      const inner = -0.3 * d.radius;
      if (s < inner || s > isl.width * 1.6) continue;
      // Outward normal · wind: −1 on the face the wind blows into (windward).
      const facing = -(dx * wx + dz * wz) / r;
      const band = smoothstep(inner, 0, s) * (1 - smoothstep(isl.width * 0.25, isl.width * 1.6, s));
      const vertical = smoothstep(isl.bottom, d.y - d.lip, p.y) * (1 - smoothstep(d.y, isl.ceiling, p.y));
      const k = facing > 0 ? RIDGE_GAIN : RIDGE_GAIN * LEE_GAIN;
      lift += speed * k * facing * band * vertical;
    }
    return lift;
  }

  /** Adds the headwind that turns flyers back beyond the boundary radius. */
  addBoundary(p: Vector3, out: Vector3): Vector3 {
    const r = Math.hypot(p.x, p.z);
    const b = this.layout.boundaryRadius;
    if (r < b - BOUNDARY_RAMP_IN || r < 1e-3) return out;
    const k = BOUNDARY_PUSH * smoothstep(b - BOUNDARY_RAMP_IN, b + BOUNDARY_RAMP_OUT, r);
    out.x -= (p.x / r) * k;
    out.z -= (p.z / r) * k;
    return out;
  }
}

function key(cx: number, cz: number): number {
  return (cx + 1000) * 4096 + (cz + 1000);
}
