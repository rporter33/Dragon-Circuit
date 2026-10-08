// Sky, light and clouds: the mood of every frame. Each frame the sky
//   1. moves the sun and moon and picks the key light (sun by day, moon by night),
//   2. samples the time-of-day palette and lets the weather grey, fog or darken it,
//   3. writes every shared uniform (render/uniforms.ts), the lights, the shadow camera (texel-
//      snapped around the focus so shadows never shimmer), the grade and the bloom,
//   4. updates the dome, the cloud sea and the cumulus banks.

import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Matrix4,
  Vector3,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import type { Settings } from '../core/types';
import type { SkySystem } from '../game/contracts';
import type { QualityProfile } from '../render/quality';
import type { Renderer } from '../render/renderer';
import { globalUniforms } from '../render/uniforms';
import { LAYOUT, type WorldLayout } from '../world/layout';
import { clamp01, smoothstep } from '../core/math';
import { LATITUDE, keyLightDirection, moonDirection, nightAmount, shadowStrength, sunDirection } from './sunPath';
import { applyWeather, createPalette, samplePalette, type PaletteWeather, type SkyPalette } from './palette';
import { SkyDome } from './SkyDome';
import { CloudSea, MAX_SHADOWERS, SEA_BASE, SEA_TOP } from './CloudSea';
import { CloudBanks } from './CloudBanks';
import { CloudBankField, buildBanks } from './cloudBankField';
import { SEA_RANGE, generateSeaField, puffAtlas, seaHeight01, seaTexture, type SeaField } from './cloudTextures';
import type { Weather } from './Weather';

/** Directional light intensity at noon (palette keyI = 1). */
const KEY_SCALE = 2.7;
/** How far up the light direction the shadow camera sits (m). */
const SHADOW_DISTANCE = 700;
const SEA_TEX_SIZE = 512;

/** Cloud work per quality.clouds level: [sea march steps, sea shadow steps, banks, puffs per bank]. */
const CLOUD_LEVELS: [number, number, number, number][] = [
  [10, 2, 14, 9],
  [16, 3, 26, 13],
  [24, 4, 38, 16],
];

const NEUTRAL_WEATHER = { overcast: 0, mist: 0, rain: 0, fog: 1 };
const UP = new Vector3(0, 1, 0);
/** The celestial pole the stars wheel around: due north, raised by the latitude. */
const POLE = new Vector3(0, Math.sin(LATITUDE), Math.cos(LATITUDE)).normalize();

const tmpRight = new Vector3();
const tmpUp = new Vector3();
const tmpV = new Vector3();
const tmpM4 = new Matrix4();

export class Sky implements SkySystem {
  timeOfDay = 0.36;
  /** Direction toward the sun (may be below the horizon). */
  readonly sunDirection = new Vector3();
  /** Direction toward the moon. */
  readonly moonDirection = new Vector3();
  /** Direction toward the key light that shades the world (= uSunDir). */
  readonly keyDirection = new Vector3();
  /** 0 day … 1 night. */
  night = 0;
  /** The palette in effect this frame (time of day + weather). Read-only for other modules. */
  readonly palette: SkyPalette = createPalette();

  private scene: Scene;
  private renderer: Renderer;
  private quality: QualityProfile;
  private weather: Weather | null;
  private layout: WorldLayout;
  private sun: DirectionalLight;
  private hemi: HemisphereLight;
  private dome: SkyDome;
  private sea: CloudSea;
  private banks: CloudBanks | null = null;
  private bankField: CloudBankField;
  private seaField: SeaField;
  private seaMean01: number;
  private shared = {
    uCloudLit: { value: new Color() },
    uCloudShade: { value: new Color() },
    uFlashPos: { value: new Vector3() },
    uFlash: { value: 0 },
    uCloudDirect: { value: 1 },
  };
  private puffTex = puffAtlas();
  private cloudLevel = -1;
  private time = 0;
  private cirrusOffset = 0;
  private shadowerTimer = 0;
  private shadowerCount = 0;
  /** Candidates for casting shadows on the sea: x, y, z, signed radius (negative = soft cloud). */
  private occluders: Float32Array;
  private occluderScore: Float32Array;
  private staticOccluders: number;
  private fallbackDrift = new Vector3();
  private paletteWeather: PaletteWeather = { ...NEUTRAL_WEATHER };

  constructor(scene: Scene, renderer: Renderer, quality: QualityProfile, weather?: Weather) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;
    this.weather = weather ?? null;
    this.layout = weather?.layout ?? LAYOUT;

    this.sun = new DirectionalLight(0xfff0dd, KEY_SCALE);
    this.sun.name = 'keyLight';
    const sc = this.sun.shadow.camera;
    sc.near = 1;
    sc.far = SHADOW_DISTANCE * 2;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.5;
    scene.add(this.sun, this.sun.target);
    this.hemi = new HemisphereLight(0xbcd4f0, 0xd0d6e0, 1.0);
    this.hemi.name = 'skyFill';
    scene.add(this.hemi);

    const field = generateSeaField(SEA_TEX_SIZE);
    this.seaField = field;
    this.seaMean01 = field.mean01;
    this.sea = new CloudSea(scene, seaTexture(field), SEA_TEX_SIZE, this.shared, CLOUD_LEVELS[2][0]);
    this.sea.farField.uSeaMean01.value = field.mean01;
    this.dome = new SkyDome(scene, { ...this.shared, ...this.sea.farField });
    this.dome.uniforms.uSeaY.value = SEA_BASE + field.mean01 * SEA_RANGE;

    // Occluders: islands and spires are static; banks are appended per refresh.
    const statics = this.layout.islands.length + this.layout.spires.length;
    this.staticOccluders = statics;
    const maxBanks = CLOUD_LEVELS[CLOUD_LEVELS.length - 1][2];
    this.occluders = new Float32Array((statics + maxBanks) * 4);
    this.occluderScore = new Float32Array(statics + maxBanks);
    let k = 0;
    for (const isl of this.layout.islands) {
      this.occluders.set([isl.x, isl.y - isl.depth * 0.35, isl.z, isl.radius * 0.92], k * 4);
      k++;
    }
    for (const sp of this.layout.spires) {
      this.occluders.set([sp.x, sp.bellyY, sp.z, sp.bellyRadius * 0.85], k * 4);
      k++;
    }

    this.bankField = new CloudBankField(this.layout, []);
    this.setQuality(quality);
    this.setTimeOfDay(this.timeOfDay);
  }

  setTimeOfDay(t: number): void {
    this.timeOfDay = ((t % 1) + 1) % 1;
    sunDirection(this.timeOfDay, this.sunDirection);
    moonDirection(this.timeOfDay, this.moonDirection);
    keyLightDirection(this.sunDirection, this.moonDirection, this.keyDirection);
    this.night = nightAmount(this.sunDirection.y);
    globalUniforms.uSunDir.value.copy(this.keyDirection);
  }

  setQuality(q: QualityProfile): void {
    this.quality = q;
    this.sun.castShadow = q.shadows;
    if (this.sun.shadow.mapSize.x !== q.shadowMapSize) {
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    const e = q.shadowExtent;
    const sc = this.sun.shadow.camera;
    sc.left = -e;
    sc.right = e;
    sc.top = e;
    sc.bottom = -e;
    sc.updateProjectionMatrix();

    const level = Math.max(0, Math.min(CLOUD_LEVELS.length - 1, Math.round(q.clouds)));
    if (level !== this.cloudLevel) {
      this.cloudLevel = level;
      const [steps, shadowSteps, bankCount, puffs] = CLOUD_LEVELS[level];
      this.sea.setSteps(steps, shadowSteps);
      if (this.banks) {
        this.scene.remove(this.banks.mesh);
        this.banks.dispose();
      }
      this.bankField = new CloudBankField(this.layout, buildBanks(this.layout, bankCount, puffs));
      this.banks = new CloudBanks(this.scene, this.bankField, this.puffTex, this.shared);
      this.bankField.update(this.weather?.drift ?? this.fallbackDrift, this.time, this.weather?.cloudCover ?? 0.3, 1);
    }
    this.weather?.setQuality(q);
  }

  cloudVeilAt(p: Vector3): number {
    let sea = 0;
    if (p.y < SEA_TOP + 10) {
      // Into the billows: the veil follows the actual surface under the point.
      const drift = this.weather?.drift ?? this.fallbackDrift;
      const surface = this.seaSurfaceAt(p.x, p.z, drift);
      sea = smoothstep(surface + 6, surface - 22, p.y);
    }
    const bank = this.bankField.veilAt(p);
    return clamp01(1 - (1 - sea) * (1 - bank));
  }

  /** Height of the cloud-sea surface under (x, z) right now (m). */
  seaSurfaceAt(x: number, z: number, drift: Vector3 = this.weather?.drift ?? this.fallbackDrift): number {
    return SEA_BASE + seaHeight01(this.seaField, x, z, drift.x, drift.z) * SEA_RANGE;
  }

  update(dt: number, camera: PerspectiveCamera, focus: Vector3, settings: Settings): void {
    this.time += dt;
    globalUniforms.uTime.value += dt;
    this.setTimeOfDay(this.timeOfDay);
    const w = this.weather;
    if (w) w.gentleFlashes = settings.reducedMotion;
    const flash = w ? w.flash : 0;

    // --- Palette --------------------------------------------------------------------------
    const pal = samplePalette(this.timeOfDay, this.palette);
    const clearKey = pal.keyI;
    const pw = this.paletteWeather;
    if (w) {
      pw.overcast = w.overcast;
      pw.mist = w.mist;
      pw.rain = w.rain;
      pw.fog = w.params.fog;
    }
    applyWeather(pal, w ? pw : NEUTRAL_WEATHER);

    // --- Shared uniforms --------------------------------------------------------------------
    const u = globalUniforms;
    u.uSunDir.value.copy(this.keyDirection);
    u.uSunColor.value.copy(pal.key).multiplyScalar(pal.keyI);
    u.uSkyZenith.value.copy(pal.zenith);
    u.uSkyHorizon.value.copy(pal.horizon);
    u.uFogColor.value.copy(pal.fog);
    u.uFogSunColor.value.copy(pal.fogSun);
    u.uFogDensity.value = pal.fogDensity;
    u.uFogHeightFalloff.value = pal.fogFalloff;
    u.uFogBaseY.value = 0;
    u.uNight.value = this.night;
    u.uRimStrength.value = pal.rim;

    // --- Lights -----------------------------------------------------------------------------
    this.sun.color.copy(pal.key);
    this.sun.intensity = pal.keyI * KEY_SCALE;
    this.hemi.color.copy(pal.hemiSky);
    this.hemi.groundColor.copy(pal.hemiGround);
    this.hemi.intensity = pal.hemiI + flash * 0.9;
    this.followShadow(focus);
    const overcast = w ? w.overcast : 0;
    this.sun.shadow.intensity = shadowStrength(this.sunDirection, this.moonDirection) * (1 - 0.78 * overcast) * (1 - 0.3 * this.night);
    this.sun.shadow.radius = 2 + 3 * this.night + 3 * overcast;

    // --- Grade and bloom ----------------------------------------------------------------------
    const g = this.renderer.grade;
    g.uExposure.value = pal.exposure * (1 + flash * 0.12);
    g.uSaturation.value = pal.saturation;
    g.uContrast.value = pal.contrast;
    g.uLift.value.copy(pal.lift);
    g.uGain.value.copy(pal.gain);
    // Inside a cloud the world goes to the cloud's own lit color, never a glaring white at night.
    g.uCloudColor.value.copy(pal.cloudLit).lerp(pal.fog, 0.35).multiplyScalar(0.92);
    this.renderer.setBloom(pal.bloom, pal.bloomThreshold);

    // --- Clouds -------------------------------------------------------------------------------
    this.shared.uCloudLit.value.copy(pal.cloudLit);
    this.shared.uCloudShade.value.copy(pal.cloudShade);
    this.shared.uFlash.value = flash;
    // How much of the clear-sky key light the weather lets through: clouds lose their modelling
    // under an overcast lid.
    this.shared.uCloudDirect.value = clearKey > 1e-4 ? clamp01(pal.keyI / clearKey) : 1;
    if (w) this.shared.uFlashPos.value.copy(w.flashPosition);

    this.updateDome(dt, camera, pal);
    const drift = w ? w.drift : this.fallbackDrift;
    const cover = w ? w.cloudCover : 0.32;
    this.bankField.update(drift, this.time, cover, dt);
    this.banks?.update(camera);
    this.refreshShadowers(dt, camera);
    const seaShadows = smoothstep(0.04, 0.14, this.keyDirection.y) * (1 - 0.7 * overcast);
    this.sea.update(camera, drift, this.shadowerCount, seaShadows, this.renderer.gl.domElement.height);
  }

  // --- Internals ----------------------------------------------------------------------------

  /** Center the shadow camera on the focus, snapped to whole shadow-map texels (no shimmer). */
  private followShadow(focus: Vector3): void {
    const L = this.keyDirection;
    const texel = (2 * this.quality.shadowExtent) / this.quality.shadowMapSize;
    // The same basis three builds for the shadow camera with lookAt (eye = target + L·d).
    tmpRight.crossVectors(UP, L);
    if (tmpRight.lengthSq() < 1e-8) tmpRight.set(1, 0, 0);
    tmpRight.normalize();
    tmpUp.crossVectors(L, tmpRight);
    const fx = Math.round(focus.dot(tmpRight) / texel) * texel;
    const fy = Math.round(focus.dot(tmpUp) / texel) * texel;
    const fz = focus.dot(L);
    tmpV.copy(tmpRight).multiplyScalar(fx).addScaledVector(tmpUp, fy).addScaledVector(L, fz);
    this.sun.target.position.copy(tmpV);
    this.sun.position.copy(tmpV).addScaledVector(L, SHADOW_DISTANCE);
    this.sun.target.updateMatrixWorld();
  }

  private updateDome(dt: number, camera: PerspectiveCamera, pal: SkyPalette): void {
    const d = this.dome.uniforms;
    const w = this.weather;
    d.uHorizonSun.value.copy(pal.horizonSun);
    d.uSunDisk.value.copy(pal.sunDisk);
    d.uBeltColor.value.copy(pal.beltColor);
    d.uTrueSunDir.value.copy(this.sunDirection);
    d.uMoonDir.value.copy(this.moonDirection);
    d.uGlow.value = pal.glow;
    d.uBelt.value = pal.belt;
    d.uStars.value = pal.stars;
    d.uMoonLight.value = smoothstep(-0.04, 0.08, this.moonDirection.y) * (0.2 + 0.8 * this.night) * (1 - 0.6 * (w ? w.overcast : 0));
    const cover = w ? w.cloudCover : 0.32;
    d.uCirrus.value = smoothstep(0.2, 1.0, cover);
    d.uDeck.value = clamp01((w ? w.overcast : 0) * 1.05 + (w ? w.mist : 0) * 0.15);
    const speed = w ? Math.hypot(w.wind.x, w.wind.z) : 3;
    this.cirrusOffset = (this.cirrusOffset + (speed * dt) / 700) % 1000;
    d.uCloudOffset.value.set(this.cirrusOffset, 0);
    if (w && speed > 0.01) d.uWindDir.value.set(w.wind.x / speed, w.wind.z / speed);
    // The stars wheel once a day around the celestial pole.
    tmpM4.makeRotationAxis(POLE, -this.timeOfDay * Math.PI * 2);
    d.uStarRot.value.setFromMatrix4(tmpM4);
    if (w) {
      tmpV.copy(w.flashPosition).y += 450;
      d.uFlashDir.value.copy(tmpV.sub(camera.position).normalize());
    }
  }

  /** Pick the islands, spires and cloud banks whose shadows fall nearest the camera on the sea. */
  private refreshShadowers(dt: number, camera: PerspectiveCamera): void {
    this.shadowerTimer -= dt;
    if (this.shadowerTimer > 0) return;
    this.shadowerTimer = 0.2;
    const L = this.keyDirection;
    const occ = this.occluders;
    const score = this.occluderScore;
    let n = this.staticOccluders;
    // Append visible banks as soft shadows.
    const f = this.bankField;
    for (let b = 0; b < f.banks.length && n < score.length; b++) {
      const a = f.bankAlpha[b];
      if (a < 0.15) continue;
      const bank = f.banks[b];
      occ[n * 4] = f.bankPos[b * 3];
      occ[n * 4 + 1] = f.bankPos[b * 3 + 1] + bank.height * 0.4;
      occ[n * 4 + 2] = f.bankPos[b * 3 + 2];
      occ[n * 4 + 3] = -bank.width * 0.85 * a;
      n++;
    }
    const seaY = SEA_BASE + this.seaMean01 * SEA_RANGE;
    const ly = Math.max(L.y, 0.05);
    const cx = camera.position.x;
    const cz = camera.position.z;
    for (let i = 0; i < n; i++) {
      const k = (occ[i * 4 + 1] - seaY) / ly;
      const sx = occ[i * 4] - L.x * k;
      const sz = occ[i * 4 + 2] - L.z * k;
      score[i] = Math.hypot(sx - cx, sz - cz) - Math.abs(occ[i * 4 + 3]) * 3;
    }
    // Partial selection of the best MAX_SHADOWERS (small n, no allocation).
    const out = this.sea.shadowers;
    let count = 0;
    const taken = MAX_SHADOWERS;
    for (let s = 0; s < taken; s++) {
      let best = -1;
      let bestScore = 4500;
      for (let i = 0; i < n; i++) {
        if (score[i] < bestScore) {
          bestScore = score[i];
          best = i;
        }
      }
      if (best < 0) break;
      out[count++].set(occ[best * 4], occ[best * 4 + 1], occ[best * 4 + 2], occ[best * 4 + 3]);
      score[best] = Infinity;
    }
    this.shadowerCount = count;
  }
}
