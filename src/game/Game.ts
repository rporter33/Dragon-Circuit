// Constructs every system, wires them together and runs the loop. Simulation runs at a fixed
// 120 Hz (flight physics, ring checks); everything visual runs once per rendered frame and
// interpolates between the last two physics steps.

import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { EventBus } from '../core/events';
import type { GameEvents, RiderLook, Settings, WyvernLook } from '../core/types';
import { Renderer } from '../render/renderer';
import { QUALITY } from '../render/quality';
import { globalUniforms } from '../render/uniforms';
import { Input, emptyFrame } from '../input/Input';
import { Haptics } from '../input/haptics';
import { World } from '../world/World';
import { Weather } from '../sky/Weather';
import { Sky } from '../sky/Sky';
import { Player } from '../player/Player';
import { CameraRig } from '../camera/CameraRig';
import { Wyvern } from '../creatures/wyvern/Wyvern';
import { Rider } from '../creatures/rider/Rider';
import { Races } from '../race/Races';
import { Collectibles } from '../progression/Collectibles';
import { LocalSaveStore } from '../progression/save';
import { Fx } from '../fx/Fx';
import { AudioSystem } from '../audio/Audio';
import { Ui } from '../ui/Ui';
import type { GameActions, GameScreen, GameView, PromptAction } from './contracts';
import { readDebugParams, type DebugParams } from '../debug/params';
import { findShowcase, type Showcase } from '../debug/showcase';

export const FIXED_DT = 1 / 120;
const MAX_STEPS = 12;
const TOD_PRESETS = { dawn: 0.27, day: 0.42, dusk: 0.72, night: 0.95 } as const;

export class Game implements GameActions {
  readonly events = new EventBus<GameEvents>();
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer: Renderer;
  readonly save = new LocalSaveStore();
  readonly input: Input;
  readonly haptics: Haptics;
  readonly world: World;
  readonly weather: Weather;
  readonly sky: Sky;
  readonly player: Player;
  readonly cameraRig: CameraRig;
  readonly wyvern: Wyvern;
  readonly rider: Rider;
  readonly races: Races;
  readonly collectibles: Collectibles;
  readonly fx: Fx;
  readonly audio: AudioSystem;
  readonly ui: Ui;
  readonly debug: DebugParams;

  screen: GameScreen = 'loading';
  /** Fade requested by screen transitions (0..1); combined with the player's own fade. */
  uiFade = 0;
  prompt: GameView['prompt'] = null;
  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private view: GameView;
  private showcase: Showcase | null = null;
  /** Neutral input fed to the simulation when the player has no control (title, menus). */
  private idleInput = emptyFrame();

  constructor(container: HTMLElement, uiRoot: HTMLElement) {
    this.debug = readDebugParams();
    const settings = this.settings;
    if (this.debug.quality) settings.quality = this.debug.quality;
    const quality = QUALITY[settings.quality];

    this.renderer = new Renderer(container, settings.quality);
    this.renderer.setQuality(settings.quality, settings.resolutionScale);
    this.camera = new PerspectiveCamera(settings.fov, this.renderer.aspect, 0.5, quality.drawDistance);
    this.renderer.onResize((w, h) => {
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
    });

    this.input = new Input(this.renderer.canvas, () => this.settings, this.events);
    this.haptics = new Haptics(this.events, this.input, () => this.settings);
    this.world = new World(this.scene, quality);
    this.weather = new Weather(this.scene, this.world.layout, this.events, quality);
    this.sky = new Sky(this.scene, this.renderer, quality);
    this.player = new Player({
      terrain: this.world.terrain,
      env: { windAt: (p, out) => this.weather.windAt(p, out), terrain: this.world.terrain },
      events: this.events,
      breed: this.save.data.wyvern.breed,
    });
    this.cameraRig = new CameraRig(this.camera, this.world.terrain, () => this.settings);
    this.wyvern = new Wyvern(this.save.data.wyvern);
    this.rider = new Rider(this.save.data.rider);
    this.scene.add(this.wyvern.group, this.rider.group);
    this.races = new Races();
    this.collectibles = new Collectibles();
    this.fx = new Fx({
      scene: this.scene,
      renderer: this.renderer,
      events: this.events,
      quality,
      settings: () => this.settings,
      layout: this.world.layout,
    });
    this.audio = new AudioSystem(this.events, () => this.settings);
    this.audio.applySettings(settings);
    this.ui = new Ui({ root: uiRoot, actions: this, events: this.events });

    this.view = {
      screen: this.screen,
      player: this.player,
      races: this.races,
      collectibles: this.collectibles,
      save: this.save,
      input: this.input,
      sky: this.sky,
      weather: this.weather,
      camera: this.cameraRig,
      prompt: null,
    };

    this.placeAtSpawn();
    this.applyDebug();
    this.wireEvents();
    this.showcase = findShowcase(this.debug.view);
    this.showcase?.setup(this, new URLSearchParams(typeof location !== 'undefined' ? location.search : ''));
  }

  get settings(): Settings {
    return this.save.data.settings;
  }

  // --- Lifecycle --------------------------------------------------------------------------------

  start(): void {
    this.setScreen(this.debug.play ? 'play' : 'title');
    if (this.debug.manual) return;
    this.running = true;
    this.lastTime = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this.frame(dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** Advance the game by dt seconds (sim + presentation) and, unless told not to, render. */
  frame(dt: number, render = true): void {
    const input = this.input.poll(dt);
    this.haptics.update(dt);
    const simulate = (this.screen === 'play' || this.screen === 'title') && !this.debug.freeze;

    if (simulate) {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < MAX_STEPS) {
        const gameplayInput = this.screen === 'play' && this.player.controllable && !this.ui.capturesInput ? input : this.idleInput;
        this.player.fixedUpdate(FIXED_DT, gameplayInput, this.cameraRig.yaw);
        this.races.fixedUpdate(FIXED_DT, this.player);
        this.accumulator -= FIXED_DT;
        steps++;
      }
      if (steps === MAX_STEPS) this.accumulator = 0;
    }
    const alpha = this.accumulator / FIXED_DT;
    this.player.update(dt, alpha);
    this.showcase?.update?.(this, dt);

    if (this.screen === 'play' && !this.ui.capturesInput) this.handlePlayInput();

    const focus = this.player.wyvernPose.position;
    globalUniforms.uPlayerPos.value.copy(this.player.riderPosition);
    this.weather.update(dt, this.camera, focus);
    this.updateTimeOfDay(dt);
    this.sky.update(dt, this.camera, focus, this.settings);
    this.world.update(dt, this.camera, focus);
    this.wyvern.update(dt, this.player.wyvernPose);
    this.rider.update(dt, this.player.riderPose, this.player.riderPose.mounted ? this.wyvern.saddle : null);
    this.cameraRig.update(dt, this.screen === 'play' ? input : this.idleInput, this.player);
    this.races.update(dt, this.camera, this.player);
    this.collectibles.update(dt, this.camera, this.player);
    this.fx.update(dt, this.camera, this.player, this.wyvern);
    this.audio.update(dt, this.camera, this.player, this.weather, this.sky);
    this.renderer.grade.uCloudVeil.value = this.sky.cloudVeilAt(this.camera.position);
    this.renderer.grade.uFade.value = Math.max(this.player.fade, this.uiFade);

    this.prompt = this.computePrompt();
    this.view.screen = this.screen;
    this.view.prompt = this.prompt;
    this.ui.update(dt, this.view);

    if (this.screen === 'play') this.save.data.playTime += dt;
    if (render) this.renderer.render(this.scene, this.camera, dt);
  }

  // --- Actions (called by the UI) -------------------------------------------------------------

  startGame(): void {
    this.audio.unlock();
    this.setScreen('play');
  }

  pause(): void {
    if (this.screen === 'play') this.setScreen('pause');
  }

  resume(): void {
    this.setScreen('play');
  }

  openStable(): void {
    this.setScreen('stable');
  }

  closeStable(): void {
    this.setScreen('play');
  }

  beginRace(raceId: string): void {
    this.setScreen('play');
    this.races.begin(raceId);
  }

  restartRace(): void {
    this.races.restart();
  }

  quitRace(): void {
    this.races.abort('quit');
  }

  setWyvernLook(look: WyvernLook): void {
    const breedChanged = look.breed !== this.save.data.wyvern.breed;
    this.save.data.wyvern = { ...look };
    if (breedChanged) this.player.setBreed(look.breed);
    this.wyvern.setLook(look);
    this.save.save();
    this.events.emit('lookChanged', {});
  }

  setRiderLook(look: RiderLook): void {
    this.save.data.rider = { ...look };
    this.rider.setLook(look);
    this.save.save();
    this.events.emit('lookChanged', {});
  }

  applySettings(s: Settings): void {
    const prev = this.settings;
    this.save.data.settings = { ...s };
    if (s.quality !== prev.quality || s.resolutionScale !== prev.resolutionScale) {
      this.renderer.setQuality(s.quality, s.resolutionScale);
      const q = QUALITY[s.quality];
      this.camera.far = q.drawDistance;
      this.camera.updateProjectionMatrix();
      this.world.setQuality(q);
      this.sky.setQuality(q);
      this.fx.setQuality(q);
    }
    this.audio.applySettings(s);
    this.races.setShowGhost(s.showGhost);
    this.save.save();
    this.events.emit('settingsChanged', { settings: s });
  }

  resetProgress(): void {
    this.save.reset();
    this.setWyvernLook(this.save.data.wyvern);
    this.setRiderLook(this.save.data.rider);
    this.placeAtSpawn();
  }

  // --- Internals ------------------------------------------------------------------------------

  private setScreen(screen: GameScreen): void {
    this.screen = screen;
    this.ui.setScreen(screen);
    this.cameraRig.mode = screen === 'title' ? 'title' : screen === 'stable' ? 'stable' : 'follow';
    this.input.setPointerLock(screen === 'play');
  }

  private handlePlayInput(): void {
    const p = this.input.frame.pressed;
    if (p.pause) this.pause();
    if (p.restart && this.races.activeId) this.restartRace();
    if (p.interact && this.player.mode === 'onFoot' && this.nearStable()) this.openStable();
  }

  private nearStable(): boolean {
    const st = this.world.layout.stable;
    const r = this.player.riderPosition;
    return Math.hypot(r.x - st.x, r.z - st.z) < st.interactRadius;
  }

  private computePrompt(): GameView['prompt'] {
    if (this.screen !== 'play') return null;
    const mk = (action: PromptAction, text: string) => ({ action, text });
    const mode = this.player.mode;
    if (mode === 'onFoot' && this.nearStable()) return mk('stable', 'Open the Stable');
    if (mode === 'flying') {
      const f = this.player.flight;
      const g = this.world.terrain.groundAt(f.position.x, f.position.z, f.position.y);
      if (g && f.position.y - g.y < 25 && f.airspeed < 30) return mk('flare', 'Flare to land');
      if (f.stall > 0.5) return mk('tuck', 'Stalling — dive to recover');
    }
    return null;
  }

  private updateTimeOfDay(dt: number): void {
    const s = this.settings;
    if (this.debug.tod !== undefined) {
      this.sky.setTimeOfDay(this.debug.tod);
      return;
    }
    if (s.timeOfDay === 'cycle') {
      this.sky.setTimeOfDay(this.sky.timeOfDay + dt / (s.dayLengthMinutes * 60));
    } else {
      this.sky.setTimeOfDay(TOD_PRESETS[s.timeOfDay]);
    }
  }

  private placeAtSpawn(): void {
    const sp = this.world.layout.spawn;
    const p = this.world.terrain.standingPoint(sp.position[0], sp.position[2], new Vector3());
    p.y += 40;
    this.player.teleport(p, sp.yaw, 'flying', 26);
    this.cameraRig.snap(this.player);
  }

  private applyDebug(): void {
    const d = this.debug;
    if (d.weather) this.weather.set(d.weather, true);
    if (d.at) {
      this.player.teleport(new Vector3(...d.at), d.yaw ?? 0, d.mode ?? 'flying', d.speed ?? 26);
      this.cameraRig.snap(this.player);
    }
    if (d.cam && d.look) this.cameraRig.setOverride({ position: new Vector3(...d.cam), target: new Vector3(...d.look) });
  }

  private wireEvents(): void {
    this.events.on('terrainHit', ({ impulse }) => {
      this.cameraRig.shake(Math.min(1, impulse / 25));
    });
  }
}
