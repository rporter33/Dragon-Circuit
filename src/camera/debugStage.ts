// Debug staging for camera showcases: poses the rider and wyvern on the ground (on foot,
// mounted, or side by side for the title / stable) regardless of what the Player system is
// doing, so each camera rig can be judged in isolation. Not used by the game itself.

import { Vector3 } from 'three';
import type { PlayerMode } from '../core/types';
import type { Game } from '../game/Game';

const UP = new Vector3(0, 1, 0);

export interface Stage {
  mode: PlayerMode;
  /** Rider feet (on the ground). */
  rider: Vector3;
  riderYaw: number;
  riderVel: Vector3;
  /** Wyvern feet (on the ground); the pose centre sits standHeight above. */
  wyvern: Vector3;
  wyvernYaw: number;
}

/** Rider at the spawn point and the wyvern at its waiting spot, as on the title screen. */
export function createStage(game: Game, mode: PlayerMode): Stage {
  const L = game.world.layout;
  const t = game.world.terrain;
  return {
    mode,
    rider: t.standingPoint(L.spawn.position[0], L.spawn.position[2], new Vector3()),
    riderYaw: L.spawn.yaw,
    riderVel: new Vector3(),
    wyvern: t.standingPoint(L.wyvernSpawn.position[0], L.wyvernSpawn.position[2], new Vector3()),
    wyvernYaw: L.wyvernSpawn.yaw,
  };
}

/** Walk the staged rider (or the mounted wyvern) with the frame's foot input, camera-relative. */
export function walkStage(game: Game, st: Stage, dt: number): void {
  const f = game.input.frame.foot;
  const yaw = game.cameraRig.yaw;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const dx = -fz * f.moveX + fx * f.moveY;
  const dz = fx * f.moveX + fz * f.moveY;
  const mag = Math.min(1, Math.hypot(dx, dz));
  const mounted = st.mode !== 'onFoot';
  const speed = mag * (f.sprint ? (mounted ? 14 : 7) : mounted ? 6 : 3.5);
  const len = Math.hypot(dx, dz) || 1;
  st.riderVel.set((dx / len) * speed, 0, (dz / len) * speed);
  const body = mounted ? st.wyvern : st.rider;
  body.addScaledVector(st.riderVel, dt);
  game.world.terrain.standingPoint(body.x, body.z, body);
  if (speed > 0.2) {
    const yawNow = Math.atan2(dx, dz);
    if (mounted) st.wyvernYaw = yawNow;
    else st.riderYaw = yawNow;
  }
}

/** Overwrite the player's poses with the stage (call every frame from a showcase update). */
export function applyStage(game: Game, st: Stage): void {
  (game.player as unknown as { mode: PlayerMode }).mode = st.mode;
  const w = game.player.wyvernPose;
  const r = game.player.riderPose;
  const mounted = st.mode !== 'onFoot';
  w.position.copy(st.wyvern).addScaledVector(UP, game.player.breed.standHeight);
  w.orientation.setFromAxisAngle(UP, st.wyvernYaw);
  w.velocity.copy(mounted ? st.riderVel : new Vector3());
  w.angularVelocity.set(0, 0, 0);
  w.airborne = false;
  w.airspeed = 0;
  w.wingSpread = 0.25;
  w.flapStrength = 0;
  w.flare = 0;
  w.stall = 0;
  w.gait = mounted && st.riderVel.lengthSq() > 0.1 ? 'walk' : 'idle';
  w.groundSpeed = mounted ? st.riderVel.length() : 0;
  w.groundY = st.wyvern.y;
  r.mounted = mounted;
  r.position.copy(mounted ? w.position : st.rider);
  r.yaw = mounted ? st.wyvernYaw : st.riderYaw;
  r.velocity.copy(mounted ? new Vector3() : st.riderVel);
  r.action = mounted ? 'mounted' : st.riderVel.lengthSq() > 0.1 ? 'walk' : 'idle';
  (game.player.riderPosition as Vector3).copy(r.position);
}
