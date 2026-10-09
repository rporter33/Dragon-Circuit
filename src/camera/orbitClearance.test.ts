// Regression (flight stream report): walking the Roost launch deck on foot along its rail, under
// the gate, the on-foot camera collapsed onto the rider's head and looked straight up, and stayed
// that way for the rest of the deck.

import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { PlayerSystem } from '../game/contracts';
import { BREEDS } from '../flight/breeds';
import { DEFAULT_SETTINGS } from '../game/settings';
import { emptyFrame } from '../input/Input';
import { OrbitRig } from './followRigs';
import { createShot, type RigContext } from './rigTypes';
import type { CameraTerrain } from './collision';

/** Signed distance to an axis-aligned box (center c, half-size h). */
function boxDistance(p: Vector3, c: Vector3, h: Vector3): number {
  const qx = Math.abs(p.x - c.x) - h.x;
  const qy = Math.abs(p.y - c.y) - h.y;
  const qz = Math.abs(p.z - c.z) - h.z;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0);
}

/**
 * A deck with a rail along the walk (to the camera's right shoulder, its top a little below the
 * orbit pivot, as on the Roost's launch deck) and a gate lintel overhead.
 */
function deckWorld(railGap: number, railTop: number): CameraTerrain {
  const rail = { c: new Vector3(-railGap, railTop / 2, 0), h: new Vector3(0.13, railTop / 2, 40) };
  const lintel = { c: new Vector3(0, 7.9, 6), h: new Vector3(4, 0.3, 0.4) };
  const floor = { c: new Vector3(0, -0.25, 0), h: new Vector3(4, 0.25, 40) };
  return {
    distance: (p) => Math.min(boxDistance(p, rail.c, rail.h), boxDistance(p, lintel.c, lintel.h), boxDistance(p, floor.c, floor.h)),
  };
}

function walker(z: number): PlayerSystem {
  const pos = new Vector3(0, 0, z);
  return {
    mode: 'onFoot',
    breed: BREEDS.harrier,
    flight: {} as PlayerSystem['flight'],
    wyvernPose: {
      position: new Vector3(30, 0, -30), orientation: new Quaternion(), velocity: new Vector3(), airborne: false, airspeed: 0,
      angularVelocity: new Vector3(), wingSpread: 1, flapPhase: 0, flapStrength: 0, flare: 0, stall: 0, fatigue: 0, gait: 'idle',
      groundSpeed: 0, gaitTime: 0, lookTarget: new Vector3(), groundY: 0,
    },
    riderPose: {
      mounted: false, position: pos, yaw: 0, velocity: new Vector3(0, 0, 1.6), action: 'walk', actionTime: 0, lean: 0, crouch: 0,
      brace: 0, airflow: new Vector3(),
    },
    riderPosition: pos,
    prevPosition: pos.clone(),
    position: pos,
    setBreed() {},
    fixedUpdate() {},
    update() {},
    teleport() {},
    controllable: true,
    fade: 0,
  } as unknown as PlayerSystem;
}

describe('on-foot orbit beside a rail and under a lintel', () => {
  // The logged case: the rail's top 0.25 m under the pivot, 0.66 m to the side, the view yawed
  // ~10 degrees toward it.
  const cases: [number, number, number][] = [];
  for (const gap of [0.62, 0.66, 0.8]) for (const top of [1.2, 1.45]) for (const yaw of [0, 0.18]) cases.push([gap, top, yaw]);
  for (const [gap, top, yaw] of cases) {
    it(`keeps its boom and looks ahead (rail ${gap} m aside, top ${top} m, view yaw ${yaw})`, () => {
      const terrain = deckWorld(gap, top);
      const ctx: RigContext = {
        terrain, settings: { ...DEFAULT_SETTINGS }, camera: new PerspectiveCamera(), time: 0, zoom: 1, waypoint: null,
      };
      const rig = new OrbitRig('foot');
      const shot = createShot();
      const dir = new Vector3();
      let player = walker(-20);
      rig.enter(player, { position: new Vector3(0, 2, -25), target: new Vector3(0, 1.5, -20), yaw, pitch: 0.14 }, ctx);
      // Walk 30 m along the rail, under the lintel at z = 6.
      for (let i = 0; i <= 1100; i++) {
        player = walker(-20 + i * (1.6 / 60) * 0.7);
        rig.update(1 / 60, emptyFrame(), player, ctx, shot);
        if (i < 60) continue; // settle
        dir.subVectors(shot.target, shot.position).normalize();
        const boom = shot.position.distanceTo(player.riderPose.position);
        // A rail across the boom may pull it in (that is collision), but never onto the head...
        expect(boom).toBeGreaterThan(1.2);
        // ...and never looking up at the sky.
        expect(dir.y).toBeLessThan(0.5);
        // Clear of the lintel (the last few metres, with the view settled behind the walk): the
        // full boom is back.
        if (i > 1000) expect(boom).toBeGreaterThan(4);
        // Never inside the rail or the lintel.
        expect(terrain.distance(shot.position)).toBeGreaterThan(0.2);
      }
    });
  }
});
