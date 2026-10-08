// Player state machine: flying ↔ landed ↔ on foot, plus falls and respawns. (Baseline: flying
// and a simple landed state. The player module owner implements the full machine.)

import { Euler, Quaternion, Vector3 } from 'three';
import type { BreedId, BreedStats, FlightEnvironment, InputFrame, PlayerMode, RiderPose, WyvernPose } from '../core/types';
import type { GameEventBus } from '../core/events';
import type { PlayerSystem } from '../game/contracts';
import type { Terrain } from '../world/terrain';
import { BREEDS } from '../flight/breeds';
import { FlightModel, createFlightState } from '../flight/FlightModel';

export interface PlayerDeps {
  terrain: Terrain;
  env: FlightEnvironment;
  events: GameEventBus;
  breed: BreedId;
}

export function createWyvernPose(): WyvernPose {
  return {
    position: new Vector3(),
    orientation: new Quaternion(),
    velocity: new Vector3(),
    airborne: true,
    airspeed: 0,
    angularVelocity: new Vector3(),
    wingSpread: 1,
    flapPhase: 0,
    flapStrength: 0,
    flare: 0,
    stall: 0,
    fatigue: 0,
    gait: 'idle',
    groundSpeed: 0,
    gaitTime: 0,
    lookTarget: new Vector3(),
  };
}

export function createRiderPose(): RiderPose {
  return {
    mounted: true,
    position: new Vector3(),
    yaw: 0,
    velocity: new Vector3(),
    action: 'mounted',
    actionTime: 0,
    lean: 0,
    crouch: 0,
    brace: 0,
    airflow: new Vector3(),
  };
}

export class Player implements PlayerSystem {
  mode: PlayerMode = 'flying';
  breed: BreedStats;
  readonly model: FlightModel;
  wyvernPose = createWyvernPose();
  riderPose = createRiderPose();
  riderPosition = new Vector3();
  prevPosition = new Vector3();
  position = new Vector3();
  controllable = true;
  fade = 0;
  private deps: PlayerDeps;
  private prevQuat = new Quaternion();

  constructor(deps: PlayerDeps) {
    this.deps = deps;
    this.breed = BREEDS[deps.breed];
    this.model = new FlightModel(this.breed);
  }

  get flight() {
    return this.model.state;
  }

  setBreed(id: BreedId): void {
    this.breed = BREEDS[id];
    this.model.setBreed(this.breed);
  }

  teleport(position: Vector3, yaw: number, mode: 'flying' | 'landed' | 'onFoot', speed = 24): void {
    const q = new Quaternion().setFromEuler(new Euler(0, yaw, 0));
    this.model.reset(position, q, new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(mode === 'flying' ? speed : 0));
    this.prevPosition.copy(position);
    this.position.copy(position);
    this.prevQuat.copy(q);
    this.mode = mode === 'onFoot' ? 'landed' : mode;
  }

  fixedUpdate(dt: number, input: InputFrame, _cameraYaw: number): void {
    const s = this.model.state;
    this.prevPosition.copy(s.position);
    this.prevQuat.copy(s.orientation);
    if (this.mode === 'flying') {
      this.model.step(dt, input.flight, this.deps.env, this.deps.events);
      if (s.position.y < this.deps.terrain.layout.cloudFloor) {
        const p = new Vector3(0, 0, 0);
        this.deps.terrain.standingPoint(0, 60, p);
        p.y += 60;
        this.teleport(p, Math.PI, 'flying');
        this.deps.events.emit('respawn', { position: p });
      }
    }
    this.position.copy(s.position);
  }

  update(dt: number, alpha: number): void {
    const s = this.model.state;
    const w = this.wyvernPose;
    w.position.lerpVectors(this.prevPosition, s.position, alpha);
    w.orientation.slerpQuaternions(this.prevQuat, s.orientation, alpha);
    w.velocity.copy(s.velocity);
    w.airborne = this.mode === 'flying';
    w.airspeed = s.airspeed;
    w.angularVelocity.copy(s.angularVelocity);
    w.wingSpread = s.wingSpread;
    w.flapPhase = s.flapPhase;
    w.flapStrength = s.flapStrength;
    w.flare = s.flare;
    w.stall = s.stall;
    w.fatigue = 1 - s.stamina;
    w.gaitTime += dt;
    this.riderPosition.copy(w.position);
    this.riderPose.mounted = true;
    this.riderPose.airflow.copy(s.velocity).multiplyScalar(-1);
  }
}

export { createFlightState };
