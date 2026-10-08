// The interface every system implements and the services Game hands them. Game.ts is the only
// place systems are constructed and wired; modules talk to each other through these interfaces
// and the event bus, never by importing each other's internals.

import type { Group, Object3D, PerspectiveCamera, Scene, Vector3 } from 'three';
import type { GameEventBus } from '../core/events';
import type {
  BreedId,
  BreedStats,
  CosmeticSlot,
  CylinderCollider,
  FlightEnvironment,
  FlightState,
  InputDevice,
  InputFrame,
  Medal,
  PlayerMode,
  RaceKind,
  RaceRecord,
  RiderLook,
  RiderPose,
  Settings,
  WeatherKind,
  WyvernLook,
  WyvernPose,
} from '../core/types';
import type { Renderer } from '../render/renderer';
import type { QualityProfile } from '../render/quality';
import type { Terrain } from '../world/terrain';
import type { WorldLayout } from '../world/layout';

// ---------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------

export interface InputSystem {
  /** Read devices once per rendered frame. Edge-triggered presses are true for this frame only. */
  poll(dt: number): InputFrame;
  readonly frame: InputFrame;
  readonly device: InputDevice;
  /** Gamepad vibration (no-op on keyboard or when rumble is off). 0..1 magnitudes. */
  rumble(strong: number, weak: number, durationMs: number): void;
  /** Request/release pointer lock for mouse-look (play mode only). */
  setPointerLock(on: boolean): void;
  /** Automation/debug: override the next frames' input. Pass null to return to devices. */
  setScripted(frame: Partial<InputFrame> | null): void;
  /** Gamepad display name, if any (for button glyph style: xbox / playstation / generic). */
  readonly padStyle: 'xbox' | 'playstation' | 'generic' | null;
}

// ---------------------------------------------------------------------------------------------
// Weather and sky
// ---------------------------------------------------------------------------------------------

export interface WeatherSystem extends Pick<FlightEnvironment, 'windAt'> {
  readonly kind: WeatherKind;
  /** Prevailing wind (m/s, world). */
  readonly wind: Vector3;
  /** 0..1 */
  readonly rain: number;
  readonly mist: number;
  readonly cloudCover: number;
  set(kind: WeatherKind, immediate?: boolean): void;
  update(dt: number, camera: PerspectiveCamera, focus: Vector3): void;
}

export interface SkySystem {
  /** 0..1, 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset. */
  timeOfDay: number;
  /** Direction toward the sun (normalized, may be below the horizon). */
  readonly sunDirection: Vector3;
  /** 0 day … 1 night. */
  readonly night: number;
  setTimeOfDay(t: number): void;
  /**
   * Advance the day, move lights (the shadow camera follows `focus`), update shared uniforms,
   * sky dome, clouds and cloud sea.
   */
  update(dt: number, camera: PerspectiveCamera, focus: Vector3, settings: Settings): void;
  setQuality(q: QualityProfile): void;
  /** 0..1 how deep the camera is inside a cloud puff (drives the grade's cloud veil). */
  cloudVeilAt(p: Vector3): number;
}

// ---------------------------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------------------------

export interface WorldSystem {
  readonly terrain: Terrain;
  readonly layout: WorldLayout;
  readonly group: Group;
  /** Vegetation LOD, grass streaming around `focus`, animated water. */
  update(dt: number, camera: PerspectiveCamera, focus: Vector3): void;
  setQuality(q: QualityProfile): void;
}

/**
 * Vegetation, water and structures on top of the islands (world/dressing). Visual, except for
 * the optional collision hints below.
 */
export interface DressingSystem {
  readonly group: Group;
  /** Solid cylinders (building walls, towers, big trunks) to keep walkers out of. */
  readonly colliders: readonly CylinderCollider[];
  /**
   * Walkable built surfaces that the terrain doesn't cover (the Roost's launch deck juts out over
   * the void): the deck top under (x, z) at or below fromY + 2, or null.
   */
  deckAt(x: number, z: number, fromY: number): { y: number; surface: 'wood' | 'stone' } | null;
  update(dt: number, camera: PerspectiveCamera, focus: Vector3): void;
  setQuality(q: QualityProfile): void;
}

// ---------------------------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------------------------

export interface PlayerSystem {
  readonly mode: PlayerMode;
  readonly breed: BreedStats;
  /** Physics state of the wyvern while flying (also valid, if stale, on the ground). */
  readonly flight: FlightState;
  /** Interpolated, render-ready poses. Updated in update(). */
  readonly wyvernPose: WyvernPose;
  readonly riderPose: RiderPose;
  /** Where the rider is standing / sitting (world), for prompts and pickups. */
  readonly riderPosition: Vector3;
  /** Physics position at the end of the previous fixed step (for swept checks like rings). */
  readonly prevPosition: Vector3;
  /** Current physics position (the thing that flies through rings). */
  readonly position: Vector3;
  setBreed(id: BreedId): void;
  /**
   * Fixed-rate simulation. `cameraYaw` (radians, facing = (sin, 0, cos)) makes on-foot movement
   * camera-relative.
   */
  fixedUpdate(dt: number, input: InputFrame, cameraYaw: number): void;
  /** Per-frame: interpolate poses with alpha (0..1 between the last two fixed steps). */
  update(dt: number, alpha: number): void;
  /** Teleport, e.g. to a race start. */
  teleport(position: Vector3, yaw: number, mode: 'flying' | 'landed' | 'onFoot', speed?: number): void;
  /** True while gameplay input is accepted (not during transitions/fades). */
  readonly controllable: boolean;
  /** 0..1 full-screen fade the player state wants (respawn, catch-on-fall). */
  readonly fade: number;
}

// ---------------------------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------------------------

export type CameraMode = 'follow' | 'title' | 'stable' | 'photo';

export interface CameraSystem {
  readonly camera: PerspectiveCamera;
  /** Horizontal facing of the camera (radians, facing = (sin, 0, cos)). */
  readonly yaw: number;
  mode: CameraMode;
  update(dt: number, input: InputFrame, player: PlayerSystem): void;
  /** Trauma-style shake, 0..1 added (decays). Ignored with reduced motion. */
  shake(amount: number): void;
  /** Snap behind the player without smoothing (after teleports). */
  snap(player: PlayerSystem): void;
  /** Debug: hold the camera at a fixed pose (null releases). */
  setOverride(pose: { position: Vector3; target: Vector3 } | null): void;
  /**
   * Stable screen: frame the wyvern, the rider, or both (default). The UI calls this as the
   * player moves between wyvern and rider customization; the camera glides to the new subject.
   */
  setStableFocus?(subject: 'wyvern' | 'rider' | 'both'): void;
}

// ---------------------------------------------------------------------------------------------
// Creatures
// ---------------------------------------------------------------------------------------------

export interface WyvernRenderable {
  readonly group: Group;
  /**
   * Rider attaches here; +Z forward, +Y up, origin on the saddle seat (where the rider's hips
   * rest). `saddle.userData.halfWidth` holds the body's half-width at the seat (m) so the rider
   * can straddle it; `saddle.userData.gripOffset` (Vector3, saddle space) is where the hands hold.
   */
  readonly saddle: Object3D;
  setLook(look: WyvernLook): void;
  update(dt: number, pose: WyvernPose): void;
  /** World-space wingtip positions (for vortex trails). */
  getWingtips(outLeft: Vector3, outRight: Vector3): void;
  /** World-space head/mouth position (for breath puffs, look-at). */
  getHead(out: Vector3): Vector3;
  dispose(): void;
}

export interface RiderRenderable {
  readonly group: Group;
  setLook(look: RiderLook): void;
  /** When pose.mounted, sit on `saddle` (its world matrix); otherwise stand at pose.position. */
  update(dt: number, pose: RiderPose, saddle: Object3D | null): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------------------------
// Races and progression
// ---------------------------------------------------------------------------------------------

export interface RingDef {
  position: [number, number, number];
  /** Direction you fly through it (normalized when used). */
  normal: [number, number, number];
  /** Inner radius you must pass within (m). */
  radius: number;
}

export interface RaceDef {
  id: string;
  name: string;
  kind: RaceKind;
  description: string;
  /** Difficulty 1..5 for the race list. */
  difficulty: number;
  /** Where the start gate hangs and the direction it faces. Flying through it arms the race. */
  start: { position: [number, number, number]; yaw: number };
  /** Ring courses: the rings in order. Sprints: one ring, the finish beacon. */
  rings: RingDef[];
  /** Medal times in ms. */
  medals: { gold: number; silver: number; bronze: number };
  /** Landmark near the start, for the race list. */
  landmark: string;
}

export interface RaceSystem {
  readonly defs: RaceDef[];
  /** Null when no race is running. */
  readonly activeId: string | null;
  readonly state: 'idle' | 'countdown' | 'running' | 'finished';
  /** Elapsed race time (ms) while running. */
  readonly elapsedMs: number;
  readonly nextRingIndex: number;
  /** Best time for the active race, if any. */
  readonly bestMs: number | null;
  /** Split delta vs best at the last ring (ms, negative = ahead), or null. */
  readonly lastDeltaMs: number | null;
  /** World position the HUD compass should point at: next ring, finish, or nearest start. */
  waypoint(out: Vector3): Vector3 | null;
  /** The race whose start gate is near this point (for a prompt), if any. */
  nearbyStart(p: Vector3): RaceDef | null;
  /** Place the player at the start and begin the countdown. */
  begin(raceId: string): void;
  restart(): void;
  abort(reason: 'quit' | 'restart' | 'respawn' | 'left-course'): void;
  fixedUpdate(dt: number, player: PlayerSystem): void;
  update(dt: number, camera: PerspectiveCamera, player: PlayerSystem): void;
  setShowGhost(on: boolean): void;
}

export interface SaveData {
  version: 1;
  wyvern: WyvernLook;
  rider: RiderLook;
  /** Cosmetic ids unlocked beyond the defaults. */
  unlocked: string[];
  /** Collected collectible ids. */
  collected: string[];
  races: Record<string, RaceRecord>;
  settings: Settings;
  /** Landmarks visited (for the collection screen and race list). */
  discovered: string[];
  /** Seconds played. */
  playTime: number;
  /** Whether the first-flight tutorial prompts have been dismissed. */
  tutorialDone: boolean;
}

export interface GhostRecording {
  raceId: string;
  breed: BreedId;
  look: WyvernLook;
  rider: RiderLook;
  timeMs: number;
  /** Sample rate in Hz. */
  rate: number;
  /** Packed samples: [x, y, z, qx, qy, qz, qw, flapPhase, flapStrength, wingSpread, flare] × n. */
  samples: Float32Array;
  /** Optional: race time (ms) at each ring of this run, for live split deltas against it. */
  splits?: number[];
}

export interface SaveStore {
  readonly data: SaveData;
  /** Persist soon (debounced). */
  save(): void;
  /** Persist now. */
  flush(): void;
  reset(): void;
  getGhost(raceId: string): Promise<GhostRecording | null>;
  putGhost(ghost: GhostRecording): Promise<void>;
  /**
   * Whether a cosmetic can be worn. `slot` disambiguates ids that several slots share ('long' is
   * a hair style and a scarf); without it the first catalog match is used.
   */
  isUnlocked(cosmeticId: string, slot?: CosmeticSlot): boolean;
  medalCount(medal: Exclude<Medal, 'none'>): number;
}

export interface CollectibleSystem {
  readonly total: { feathers: number; relics: number };
  readonly found: { feathers: number; relics: number };
  update(dt: number, camera: PerspectiveCamera, player: PlayerSystem): void;
  /** Nearest uncollected collectible within range, for a subtle HUD shimmer hint. */
  nearestHint(p: Vector3, range: number): Vector3 | null;
}

// ---------------------------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------------------------

export interface FxSystem {
  update(dt: number, camera: PerspectiveCamera, player: PlayerSystem, wyvern: WyvernRenderable): void;
  setQuality(q: QualityProfile): void;
}

export interface AudioSystemApi {
  /** Must be called from a user gesture before audio can play. */
  unlock(): void;
  update(dt: number, camera: PerspectiveCamera, player: PlayerSystem, weather: WeatherSystem, sky: SkySystem): void;
  applySettings(s: Settings): void;
  /** Music layer intensity 0..1 (races raise it). */
  setIntensity(v: number): void;
}

export type GameScreen = 'title' | 'play' | 'pause' | 'stable' | 'results' | 'loading';

/** What the UI can ask the game to do. */
export interface GameActions {
  startGame(): void;
  pause(): void;
  resume(): void;
  openStable(): void;
  closeStable(): void;
  beginRace(raceId: string): void;
  restartRace(): void;
  quitRace(): void;
  setWyvernLook(look: WyvernLook): void;
  setRiderLook(look: RiderLook): void;
  applySettings(s: Settings): void;
  resetProgress(): void;
}

/** Read-only view of the game the UI renders from each frame. */
export interface GameView {
  screen: GameScreen;
  player: PlayerSystem;
  races: RaceSystem;
  collectibles: CollectibleSystem;
  save: SaveStore;
  input: InputSystem;
  sky: SkySystem;
  weather: WeatherSystem;
  camera: CameraSystem;
  /** Context prompt the HUD should show (e.g. "Hold LT to flare"), or null. */
  prompt: { action: PromptAction; text: string } | null;
}

export type PromptAction = 'flap' | 'flare' | 'tuck' | 'interact' | 'mount' | 'dismount' | 'jump' | 'restart' | 'stable';

export interface UiSystem {
  readonly screen: GameScreen;
  setScreen(screen: GameScreen): void;
  /** Per-frame: menus consume input when open; HUD reads the view. */
  update(dt: number, view: GameView): void;
  /** True if the UI consumed this frame's input (menus open). */
  readonly capturesInput: boolean;
}

/** Shared services handed to systems at construction. */
export interface Services {
  scene: Scene;
  renderer: Renderer;
  events: GameEventBus;
  quality: QualityProfile;
  settings: () => Settings;
}
