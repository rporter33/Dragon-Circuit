// Weather and the wind field. The seeded WeatherClock decides what the sky is doing; this system
// turns that into the wind every flyer feels (WindField), the shared wind/wetness uniforms, rain
// around the camera and distant lightning, and announces changes on the event bus.

import { Color, Vector3, type PerspectiveCamera, type Scene } from 'three';
import type { WeatherKind } from '../core/types';
import type { WeatherSystem } from '../game/contracts';
import type { GameEventBus } from '../core/events';
import type { QualityProfile } from '../render/quality';
import type { WorldLayout } from '../world/layout';
import { clamp01, damp } from '../core/math';

/** Thermal lift (m/s) at the focus that counts as "in a thermal", and the level to leave it. */
export const THERMAL_ENTER = 2;
export const THERMAL_EXIT = 1;
import { globalUniforms } from '../render/uniforms';
import { WeatherClock, type WeatherParams } from './weatherModel';
import { WindField, boundaryApproach01 } from './windField';
import { Rain } from './Rain';
import { LightningBolt } from './Lightning';

const MAX_RAIN_DROPS = 9000;
const tmpWind = new Vector3();
const tmpCam = new Vector3();

export class Weather implements WeatherSystem {
  readonly layout: WorldLayout;
  readonly clock: WeatherClock;
  readonly field: WindField;
  /** Prevailing wind (m/s, world). */
  readonly wind = new Vector3();
  /** Integral of the prevailing wind (m): clouds and gust patterns ride it. */
  readonly drift = new Vector3();
  /** Seconds of weather time. */
  time = 0;
  /** Distant lightning: current flash brightness and where it struck. */
  flash = 0;
  readonly flashPosition = new Vector3();
  /** Reduced motion tones lightning flashes down (the sky sets it from settings). */
  gentleFlashes = false;
  /** Rising air at the focus from thermals and ridges (m/s), lightly smoothed. */
  lift = 0;
  /** 0..1 how close the focus is to the storm at the world's edge. */
  boundary = 0;
  /** The thermal the focus is riding (layout index), or -1. */
  thermalId = -1;

  private events: GameEventBus;
  private rainFx: Rain;
  private bolt: LightningBolt;
  private camPrev = new Vector3();
  private camVel = new Vector3();
  private hasCam = false;
  private gustLevel = 0.3;
  private rainTint = new Color();

  constructor(scene: Scene, layout: WorldLayout, events: GameEventBus, quality: QualityProfile, seed = 0x5eed_c10d) {
    this.layout = layout;
    this.events = events;
    this.clock = new WeatherClock(seed, 'clear');
    this.field = new WindField(layout);
    this.rainFx = new Rain(scene, MAX_RAIN_DROPS);
    this.bolt = new LightningBolt(scene);
    this.setQuality(quality);
    this.syncWind();
  }

  // --- WeatherSystem ----------------------------------------------------------------------------

  get kind(): WeatherKind {
    return this.clock.kind;
  }
  get rain(): number {
    return this.clock.params.rain;
  }
  get mist(): number {
    return this.clock.params.mist;
  }
  get cloudCover(): number {
    return this.clock.params.cloudCover;
  }
  /** 0..1 grey-lid amount (desaturation, flat light). */
  get overcast(): number {
    return this.clock.params.overcast;
  }
  /** 0..1 how wet surfaces are (lags the rain). */
  get wetness(): number {
    return this.clock.wetness;
  }
  /** All blended weather parameters. */
  get params(): Readonly<WeatherParams> {
    return this.clock.params;
  }

  set(kind: WeatherKind, immediate = false): void {
    this.clock.set(kind, immediate);
    this.announce();
    if (immediate) this.syncWind();
  }

  windAt(p: Vector3, out: Vector3): Vector3 {
    return this.field.windAt(p, out);
  }

  setQuality(q: QualityProfile): void {
    this.rainFx.setMaxDrops(Math.round(MAX_RAIN_DROPS * Math.min(1, q.particles)));
  }

  update(dt: number, camera: PerspectiveCamera, focus: Vector3): void {
    this.time += dt;
    this.clock.update(dt);
    this.announce();
    this.syncWind();
    this.drift.addScaledVector(this.wind, dt);
    const s = this.field.state;
    s.time = this.time;
    s.drift.copy(this.drift);

    // Shared uniforms: the wind as felt where the player is (gusts included, smoothed so
    // foliage swells with a gust instead of twitching), gust energy and wetness.
    this.field.windAt(focus, tmpWind);
    const speed = this.wind.length();
    const u = globalUniforms;
    const w = u.uWind.value;
    w.x = damp(w.x, tmpWind.x, 2.5, dt);
    w.y = 0;
    w.z = damp(w.z, tmpWind.z, 2.5, dt);
    const along = speed > 0.01 ? (tmpWind.x * this.wind.x + tmpWind.z * this.wind.z) / speed - speed : 0;
    const pulse = clamp01(0.5 + along / (speed * 0.6 + 0.5));
    this.gustLevel = damp(this.gustLevel, clamp01(s.gust * (0.55 + 0.9 * pulse)), 2, dt);
    u.uGust.value = this.gustLevel;
    u.uWetness.value = this.clock.wetness;

    this.updateLift(dt, focus);
    this.updateCamera(dt, camera);
    this.updateLightning(dt, camera);
    // Drops pick up the ambient light and read a little brighter than the air behind them.
    this.rainTint.copy(u.uFogColor.value).lerp(u.uSkyHorizon.value, 0.5).multiplyScalar(1.35);
    this.rainFx.update(dt, this.clock.params.rain, this.wind, this.camVel, this.rainTint);
  }

  // --- Internals --------------------------------------------------------------------------------

  private syncWind(): void {
    const p = this.clock.params;
    const h = this.clock.heading;
    this.wind.set(Math.cos(h) * p.windSpeed, 0, Math.sin(h) * p.windSpeed);
    const s = this.field.state;
    s.wind.copy(this.wind);
    s.gust = p.gust;
    s.thermal = p.thermal;
  }

  private announce(): void {
    const ch = this.clock.changed;
    if (!ch) return;
    this.clock.changed = null;
    this.events.emit('weatherChange', { from: ch.from, to: ch.to });
  }

  /** Lift at the focus for the HUD/audio, thermal enter/exit events, and the boundary cue. */
  private updateLift(dt: number, focus: Vector3): void {
    const thermal = this.field.thermalAt(focus);
    const ridge = this.field.ridgeAt(focus);
    this.lift = dt > 0 ? damp(this.lift, thermal + ridge, 6, dt) : thermal + ridge;
    this.boundary = boundaryApproach01(Math.hypot(focus.x, focus.z), this.layout.boundaryRadius);
    if (this.thermalId < 0 && thermal > THERMAL_ENTER) {
      this.thermalId = nearestThermal(this.layout, focus);
      this.events.emit('thermalEnter', { id: this.thermalId, lift: thermal, position: focus.clone() });
    } else if (this.thermalId >= 0 && thermal < THERMAL_EXIT) {
      const id = this.thermalId;
      this.thermalId = -1;
      this.events.emit('thermalExit', { id });
    }
  }

  private updateCamera(dt: number, camera: PerspectiveCamera): void {
    tmpCam.copy(camera.position);
    if (!this.hasCam || tmpCam.distanceToSquared(this.camPrev) > 150 * 150 || dt <= 0) {
      this.camVel.set(0, 0, 0);
      this.hasCam = true;
    } else {
      const k = 1 - Math.exp(-8 * dt);
      this.camVel.x += ((tmpCam.x - this.camPrev.x) / dt - this.camVel.x) * k;
      this.camVel.y += ((tmpCam.y - this.camPrev.y) / dt - this.camVel.y) * k;
      this.camVel.z += ((tmpCam.z - this.camPrev.z) / dt - this.camVel.z) * k;
    }
    this.camPrev.copy(tmpCam);
  }

  private updateLightning(dt: number, camera: PerspectiveCamera): void {
    const strike = this.clock.strike;
    if (strike) {
      const x = camera.position.x + Math.cos(strike.azimuth) * strike.distance;
      const z = camera.position.z + Math.sin(strike.azimuth) * strike.distance;
      this.bolt.strike(x, z, strike.seed, this.gentleFlashes ? 0.35 : 1);
      this.flashPosition.copy(this.bolt.position);
      this.events.emit('lightning', { position: this.bolt.position.clone(), distance: strike.distance });
    }
    this.bolt.update(dt);
    this.flash = this.bolt.flash;
  }
}

/** Index of the thermal whose column is horizontally nearest p. */
function nearestThermal(layout: WorldLayout, p: Vector3): number {
  let best = -1;
  let bestD = Infinity;
  layout.thermals.forEach((t, i) => {
    const d = Math.hypot(p.x - t.x, p.z - t.z) - t.radius;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}
