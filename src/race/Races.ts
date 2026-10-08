// Races: ring courses and sprints, timing, medals and ghosts.
//
// Flow: flying toward a start gate arms its race (raceArmed; the HUD shows its name), crossing
// the gate starts the clock (raceStart), rings must be flown through in order (ringPassed with
// split and delta vs the best run, or ringMissed when one is passed by), and the last ring or
// a sprint's finish beacon ends it (raceFinish, a RaceRecord, unlocks). begin() from the menu
// puts the player on a rolling start ~140 m before the gate. Respawning, dismounting or
// wandering far off course aborts.
//
// Timing runs in fixedUpdate at the physics rate with sub-step precision (the swept test
// reports where in the step a plane was crossed). The best run's ghost flies alongside.

import { Vector3, type PerspectiveCamera, type Scene } from 'three';
import type { GameEventBus } from '../core/events';
import type { Settings } from '../core/types';
import type { CameraSystem, GhostRecording, PlayerSystem, RaceDef, RaceSystem, SaveData, SaveStore } from '../game/contracts';
import type { QualityProfile } from '../render/quality';
import { createWyvernPose } from '../player/poses';
import { Wyvern } from '../creatures/wyvern/Wyvern';
import { COURSES } from './courses';
import { GATE_HALF_HEIGHT, GATE_HALF_WIDTH, gateRing, medalFor, RACE_START } from './courseMath';
import { missRadiusFor, ringGeom, ringSide, sweepGate, sweepRing, type RingGeom } from './ringMath';
import { createGhostSample, ghostDuration, GHOST_RATE, GhostRecorder, sampleGhost } from './ghost';
import { raceStartPosition } from './flyCourse';
import { bestMedal, grantUnlocks } from '../progression/unlocks';
import { RaceVisuals } from './RaceVisuals';

/** Arming: within this distance of a gate, on its approach side, heading through it. */
const ARM_DISTANCE = 260;
const ARM_OFF_AXIS = 110;
const ARM_HEADING_DOT = 0.35;
/** An armed race lets go beyond this distance (or once you're past the gate's plane). */
const DISARM_DISTANCE = 340;
/** How long the result stays up before the race goes idle (s). */
const FINISHED_HOLD = 8;
/** Abort when this far from the next ring for this long. */
const LEFT_COURSE_DISTANCE = { rings: 1400, sprint: 3200 } as const;
const LEFT_COURSE_SECONDS = 4;

export interface RacesDeps {
  scene: Scene;
  events: GameEventBus;
  save: SaveStore & { data: SaveData };
  player: PlayerSystem;
  quality: QualityProfile;
  settings: () => Settings;
  /** Snapped after a teleport to the start (it also snaps on its own for big jumps). */
  camera?: CameraSystem;
  defs?: RaceDef[];
}

const _p = new Vector3();
const _v = new Vector3();

export class Races implements RaceSystem {
  readonly defs: RaceDef[];
  activeId: string | null = null;
  state: 'idle' | 'countdown' | 'running' | 'finished' = 'idle';
  elapsedMs = 0;
  nextRingIndex = 0;
  bestMs: number | null = null;
  lastDeltaMs: number | null = null;
  /** Race time at each ring of the current run (ms). */
  readonly splits: number[] = [];
  /** The last finish (for the results screen). */
  lastResult: { raceId: string; timeMs: number; medal: string; newBest: boolean } | null = null;

  private deps: RacesDeps;
  private gates: RingGeom[];
  private rings: RingGeom[][];
  private active: RaceDef | null = null;
  private visuals: RaceVisuals;
  private recorder = new GhostRecorder();
  private stepCount = 0;
  private bestGhost: GhostRecording | null = null;
  private ghostRequest = 0;
  private ghostWyvern: Wyvern | null = null;
  private ghostPose = createWyvernPose();
  private ghostSample = createGhostSample();
  private showGhost: boolean;
  private countdownShown = 4;
  private missedAt = -1;
  private offCourseTime = 0;
  private finishedTime = 0;
  private time = 0;
  private armCheck = 0;

  constructor(deps: RacesDeps) {
    this.deps = deps;
    this.defs = deps.defs ?? COURSES;
    this.gates = this.defs.map((d) => gateRing(d));
    this.rings = this.defs.map((d) => d.rings.map(ringGeom));
    this.showGhost = deps.settings().showGhost;
    this.visuals = new RaceVisuals(deps.scene, this.defs, deps.quality);
    deps.events.on('respawn', () => {
      if (this.activeId && (this.state === 'running' || this.state === 'countdown')) this.abort('respawn');
    });
  }

  // --- Queries ----------------------------------------------------------------------------------

  waypoint(out: Vector3): Vector3 | null {
    const d = this.active;
    if (d && this.state === 'countdown') return out.fromArray(d.start.position);
    if (d && this.state === 'running') return out.fromArray(d.rings[this.nextRingIndex].position);
    if (this.state === 'idle') {
      const near = this.nearestStart(this.deps.player.position, 900);
      return near ? out.fromArray(near.start.position) : null;
    }
    return null;
  }

  nearbyStart(p: Vector3): RaceDef | null {
    return this.nearestStart(p, 250);
  }

  private nearestStart(p: Vector3, range: number): RaceDef | null {
    let best: RaceDef | null = null;
    let bestD = range;
    for (const d of this.defs) {
      const dist = _p.fromArray(d.start.position).distanceTo(p);
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    return best;
  }

  /** Seconds the best ghost has been recorded for (0 without one). */
  get ghostSeconds(): number {
    return this.bestGhost ? ghostDuration(this.bestGhost) : 0;
  }

  // --- Commands ---------------------------------------------------------------------------------

  begin(raceId: string): void {
    const def = this.defs.find((d) => d.id === raceId);
    if (!def) return;
    if (this.activeId && (this.state === 'running' || this.state === 'countdown')) this.abort(this.activeId === raceId ? 'restart' : 'quit');
    const g = gateRing(def);
    const start = raceStartPosition(def, _p);
    this.deps.player.teleport(start, Math.atan2(g.nx, g.nz), 'flying', RACE_START.speed);
    this.deps.camera?.snap(this.deps.player);
    this.arm(def);
  }

  restart(): void {
    if (this.activeId) this.begin(this.activeId);
  }

  abort(reason: 'quit' | 'restart' | 'respawn' | 'left-course'): void {
    const id = this.activeId;
    if (!id) return;
    if (this.state === 'running' || this.state === 'countdown') this.deps.events.emit('raceAbort', { raceId: id, reason });
    this.reset();
  }

  setShowGhost(on: boolean): void {
    this.showGhost = on;
    if (!on && this.ghostWyvern) this.ghostWyvern.group.visible = false;
  }

  // --- Simulation -------------------------------------------------------------------------------

  fixedUpdate(dt: number, player: PlayerSystem): void {
    this.time += dt;
    const a = player.prevPosition;
    const b = player.position;
    const flying = player.mode === 'flying';

    if (this.state === 'idle') {
      // Arming is a cheap check; a few times a second is plenty.
      this.armCheck -= dt;
      if (flying && this.armCheck <= 0) {
        this.armCheck = 0.1;
        const def = this.armable(b, player.flight.velocity);
        if (def) this.arm(def);
      }
      return;
    }
    const def = this.active!;
    const idx = this.defs.indexOf(def);

    if (this.state === 'countdown') {
      const gate = this.gates[idx];
      const c = sweepGate(a.x, a.y, a.z, b.x, b.y, b.z, gate, GATE_HALF_WIDTH, GATE_HALF_HEIGHT);
      if (c !== null) {
        this.start((1 - c) * dt);
        return;
      }
      const dist = _p.set(gate.cx, gate.cy, gate.cz).distanceTo(b);
      const side = ringSide(b.x, b.y, b.z, gate);
      if (!flying || dist > DISARM_DISTANCE || side > 2) {
        this.reset();
        return;
      }
      // Three-two-one as the gate comes up (seconds to the gate at the current speed).
      const speed = Math.max(5, player.flight.velocity.dot(_v.set(gate.nx, gate.ny, gate.nz)));
      const eta = Math.ceil(-side / speed);
      if (eta >= 1 && eta <= 3 && eta < this.countdownShown) {
        this.countdownShown = eta;
        this.deps.events.emit('raceCountdown', { raceId: def.id, count: eta });
      }
      return;
    }

    if (this.state === 'finished') {
      this.finishedTime += dt;
      if (this.finishedTime > FINISHED_HOLD) this.reset();
      return;
    }

    // Running.
    const ring = this.rings[idx][this.nextRingIndex];
    const c = sweepRing(a.x, a.y, a.z, b.x, b.y, b.z, ring, missRadiusFor(ring.radius));
    if (c?.kind === 'pass') {
      this.passRing(this.elapsedMs + c.t * dt * 1000, b);
      if (this.state !== 'running') return;
    } else if (c?.kind === 'miss' && this.missedAt !== this.nextRingIndex) {
      this.missedAt = this.nextRingIndex;
      this.deps.events.emit('ringMissed', { raceId: def.id, index: this.nextRingIndex });
    }
    this.elapsedMs += dt * 1000;
    this.record(player);

    // Off course: dismounted, or far from the next ring for a while.
    if (player.mode === 'onFoot' || player.mode === 'dismounting') {
      this.abort('left-course');
      return;
    }
    const next = this.rings[idx][this.nextRingIndex];
    const far = _p.set(next.cx, next.cy, next.cz).distanceTo(b) > LEFT_COURSE_DISTANCE[def.kind];
    this.offCourseTime = far ? this.offCourseTime + dt : 0;
    if (this.offCourseTime > LEFT_COURSE_SECONDS) this.abort('left-course');
  }

  update(dt: number, camera: PerspectiveCamera, player: PlayerSystem): void {
    const idx = this.active ? this.defs.indexOf(this.active) : -1;
    this.visuals.update(dt, camera, {
      activeIndex: idx,
      state: this.state,
      nextRing: this.nextRingIndex,
    });
    this.updateGhost(dt);
    void player;
  }

  // --- Internals --------------------------------------------------------------------------------

  /** The race whose gate the player is flying toward, if any. */
  private armable(p: Vector3, vel: Vector3): RaceDef | null {
    const speed = vel.length();
    if (speed < 8) return null;
    for (let i = 0; i < this.defs.length; i++) {
      const g = this.gates[i];
      const dx = g.cx - p.x;
      const dy = g.cy - p.y;
      const dz = g.cz - p.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > ARM_DISTANCE) continue;
      const along = -(dx * g.nx + dy * g.ny + dz * g.nz); // signed side of the gate plane
      if (along > -5) continue; // not on the approach side
      const offAxis = Math.sqrt(Math.max(0, dist * dist - along * along));
      if (offAxis > ARM_OFF_AXIS) continue;
      if ((vel.x * g.nx + vel.y * g.ny + vel.z * g.nz) / speed < ARM_HEADING_DOT) continue;
      return this.defs[i];
    }
    return null;
  }

  private arm(def: RaceDef): void {
    this.reset();
    this.active = def;
    this.activeId = def.id;
    this.state = 'countdown';
    this.countdownShown = 4;
    this.bestMs = this.deps.save.data.races[def.id]?.bestMs ?? null;
    this.loadGhost(def.id);
    this.deps.events.emit('raceArmed', { raceId: def.id });
  }

  private start(sinceCrossing: number): void {
    const def = this.active!;
    this.state = 'running';
    this.elapsedMs = sinceCrossing * 1000;
    this.nextRingIndex = 0;
    this.splits.length = 0;
    this.lastDeltaMs = null;
    this.missedAt = -1;
    this.offCourseTime = 0;
    this.recorder.reset();
    this.stepCount = 0;
    this.record(this.deps.player);
    this.visuals.gatePassed(this.defs.indexOf(def));
    this.deps.events.emit('raceStart', { raceId: def.id });
  }

  private passRing(atMs: number, at: Vector3): void {
    const def = this.active!;
    const index = this.nextRingIndex;
    this.splits.push(atMs);
    const best = this.bestGhost?.splits?.[index];
    this.lastDeltaMs = best !== undefined ? atMs - best : null;
    this.visuals.ringPassed(this.defs.indexOf(def), index);
    this.deps.events.emit('ringPassed', {
      raceId: def.id,
      index,
      total: def.rings.length,
      splitMs: atMs,
      deltaMs: this.lastDeltaMs,
      position: at.clone(),
    });
    this.nextRingIndex++;
    this.missedAt = -1;
    if (this.nextRingIndex >= def.rings.length) this.finish(atMs);
  }

  private finish(timeMs: number): void {
    const def = this.active!;
    const save = this.deps.save;
    const player = this.deps.player;
    const prev = save.data.races[def.id];
    const previousBestMs = prev?.bestMs ?? null;
    const medal = medalFor(timeMs, def.medals);
    const newBest = previousBestMs === null || timeMs < previousBestMs;
    save.data.races[def.id] = {
      bestMs: newBest ? timeMs : previousBestMs!,
      medal: bestMedal(prev?.medal ?? 'none', medal),
      breed: newBest ? player.breed.id : prev!.breed,
      runs: (prev?.runs ?? 0) + 1,
    };
    this.elapsedMs = timeMs;
    this.state = 'finished';
    this.finishedTime = 0;
    this.lastResult = { raceId: def.id, timeMs, medal, newBest };
    if (newBest) {
      this.bestMs = timeMs;
      const ghost = this.recorder.finish({
        raceId: def.id,
        breed: player.breed.id,
        look: save.data.wyvern,
        rider: save.data.rider,
        timeMs,
        splits: this.splits,
      });
      this.bestGhost = ghost;
      void save.putGhost(ghost);
    }
    save.save();
    this.deps.events.emit('raceFinish', { raceId: def.id, timeMs, medal, newBest, previousBestMs });
    grantUnlocks(save.data, this.deps.events);
    if (this.ghostWyvern) this.ghostWyvern.group.visible = false;
  }

  /** Back to idle: no race, nothing shown. */
  private reset(): void {
    if (this.active) this.visuals.clear(this.defs.indexOf(this.active));
    this.active = null;
    this.activeId = null;
    this.state = 'idle';
    this.elapsedMs = 0;
    this.nextRingIndex = 0;
    this.lastDeltaMs = null;
    this.splits.length = 0;
    this.armCheck = 0.5; // don't instantly re-arm the gate we just left
    if (this.ghostWyvern) this.ghostWyvern.group.visible = false;
  }

  /** 30 Hz samples of the physics state (the fixed step is 120 Hz). */
  private record(player: PlayerSystem): void {
    const every = Math.max(1, Math.round(120 / GHOST_RATE));
    if (this.stepCount++ % every !== 0) return;
    const f = player.flight;
    const w = player.wyvernPose;
    if (player.mode === 'flying') this.recorder.push(f.position, f.orientation, f.flapPhase, f.flapStrength, f.wingSpread, f.flare);
    else this.recorder.push(w.position, w.orientation, w.flapPhase, w.flapStrength, w.wingSpread, w.flare);
  }

  private loadGhost(raceId: string): void {
    const req = ++this.ghostRequest;
    // Keep the ghost already in hand for this race (a run just finished) while storage answers.
    if (this.bestGhost?.raceId !== raceId) this.bestGhost = null;
    void this.deps.save.getGhost(raceId).then((g) => {
      // (Keep one handed in meanwhile, e.g. a just-finished run or a showcase's.)
      if (req === this.ghostRequest && this.activeId === raceId) this.bestGhost = g ?? this.bestGhost;
    });
  }

  private updateGhost(dt: number): void {
    const g = this.bestGhost;
    const show = this.showGhost && g !== null && this.state === 'running' && this.elapsedMs / 1000 <= ghostDuration(g!) + 0.5;
    if (!show) {
      if (this.ghostWyvern) this.ghostWyvern.group.visible = false;
      return;
    }
    if (!this.ghostWyvern) {
      this.ghostWyvern = new Wyvern(g!.look, { ghost: true });
      this.deps.scene.add(this.ghostWyvern.group);
    }
    const s = sampleGhost(g!, this.elapsedMs / 1000, this.ghostSample);
    const pose = this.ghostPose;
    pose.position.copy(s.position);
    pose.orientation.copy(s.orientation);
    pose.velocity.copy(s.velocity);
    pose.airborne = true;
    pose.airspeed = s.velocity.length();
    pose.wingSpread = s.wingSpread;
    pose.flapPhase = s.flapPhase;
    pose.flapStrength = s.flapStrength;
    pose.flare = s.flare;
    pose.gait = 'idle';
    pose.groundY = null;
    pose.lookTarget.copy(s.position).addScaledVector(s.velocity, 1.5);
    this.ghostWyvern.group.visible = true;
    this.ghostWyvern.update(dt, pose);
  }

  /** The ghost recording currently flown against (for showcases). */
  get currentGhost(): GhostRecording | null {
    return this.bestGhost;
  }

  /** Showcases/tests: fly against this ghost. */
  setGhost(g: GhostRecording | null): void {
    this.bestGhost = g;
  }

  /**
   * Showcases: present race `id` as if it were running with `next` the next ring and the clock
   * at `elapsedMs` (rings before `next` already gone). Pair with ?freeze=1 for a still frame.
   */
  debugStage(id: string, next: number, elapsedMs: number, state: 'countdown' | 'running' | 'finished' = 'running'): void {
    const def = this.defs.find((d) => d.id === id);
    if (!def) return;
    const ghost = this.bestGhost;
    this.arm(def);
    if (ghost?.raceId === id) this.bestGhost = ghost;
    this.state = state;
    this.nextRingIndex = Math.min(next, def.rings.length - 1);
    this.elapsedMs = elapsedMs;
  }
}
