// Behavioural tests of the whole rig on a fake player and the real archipelago: the things a
// player would notice — the wyvern drifting out of frame, the camera inside rock, a jump cut.

import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { InputFrame, PlayerMode, RiderPose, Settings, WyvernPose } from '../core/types';
import type { PlayerSystem } from '../game/contracts';
import { EventBus } from '../core/events';
import type { GameEvents } from '../core/types';
import { BREEDS } from '../flight/breeds';
import { DEFAULT_SETTINGS } from '../game/settings';
import { emptyFrame } from '../input/Input';
import { LAYOUT } from '../world/layout';
import { Terrain } from '../world/terrain';
import { CameraRig } from './CameraRig';

const terrain = new Terrain(LAYOUT);
const UP = new Vector3(0, 1, 0);
const DT = 1 / 60;

function wyvernPose(): WyvernPose {
  return {
    position: new Vector3(), orientation: new Quaternion(), velocity: new Vector3(), airborne: true,
    airspeed: 0, angularVelocity: new Vector3(), wingSpread: 1, flapPhase: 0, flapStrength: 0, flare: 0,
    stall: 0, fatigue: 0, gait: 'idle', groundSpeed: 0, gaitTime: 0, lookTarget: new Vector3(), groundY: null,
  };
}

function riderPose(): RiderPose {
  return {
    mounted: true, position: new Vector3(), yaw: 0, velocity: new Vector3(), action: 'mounted', actionTime: 0,
    lean: 0, crouch: 0, brace: 0, airflow: new Vector3(),
  };
}

type FakePlayer = PlayerSystem & { mode: PlayerMode };

function fakePlayer(): FakePlayer {
  const p = {
    mode: 'flying' as PlayerMode,
    breed: BREEDS.harrier,
    flight: {} as PlayerSystem['flight'],
    wyvernPose: wyvernPose(),
    riderPose: riderPose(),
    riderPosition: new Vector3(),
    prevPosition: new Vector3(),
    position: new Vector3(),
    setBreed() {},
    fixedUpdate() {},
    update() {},
    teleport() {},
    controllable: true,
    fade: 0,
  };
  return p;
}

/** Fly the fake wyvern: heading `yaw`, climb angle `pitch`, bank, speed. */
function fly(p: FakePlayer, pos: Vector3, yaw: number, pitch: number, bank: number, speed: number): void {
  const w = p.wyvernPose;
  w.position.copy(pos);
  const q = new Quaternion().setFromAxisAngle(UP, yaw);
  q.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -pitch));
  q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), bank));
  w.orientation.copy(q);
  w.velocity.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(speed);
  w.airspeed = speed;
  p.riderPose.mounted = true;
  p.riderPose.position.copy(pos);
  p.riderPosition.copy(pos);
}

function rig(settings: Partial<Settings> = {}, events?: EventBus<GameEvents>) {
  const s: Settings = { ...DEFAULT_SETTINGS, ...settings };
  const camera = new PerspectiveCamera(s.fov, 16 / 9, 0.5, 7000);
  const r = new CameraRig(camera, terrain, () => s, events);
  return { rig: r, camera, settings: s };
}

/** Where a world point lands on screen (NDC, -1..1), or null if behind the camera. */
function ndc(camera: PerspectiveCamera, p: Vector3): Vector3 | null {
  camera.updateMatrixWorld();
  const v = p.clone().applyMatrix4(camera.matrixWorldInverse);
  if (v.z > 0) return null;
  return p.clone().project(camera);
}

const idle: InputFrame = emptyFrame();

describe('flight chase camera', () => {
  it('sits behind and above, with the wyvern in the lower-middle of the frame', () => {
    const { rig: r, camera } = rig();
    const p = fakePlayer();
    const pos = new Vector3(0, 1500, 0);
    for (let i = 0; i < 120; i++) {
      pos.z += 30 * DT;
      fly(p, pos, 0, 0, 0, 30);
      r.update(DT, idle, p);
    }
    const rel = camera.position.clone().sub(pos);
    expect(rel.z).toBeLessThan(-12); // behind (wyvern flies +Z)
    expect(rel.y).toBeGreaterThan(2); // above
    expect(rel.length()).toBeLessThan(35);
    const s = ndc(camera, pos)!;
    expect(Math.abs(s.x)).toBeLessThan(0.05);
    expect(s.y).toBeLessThan(0);
    expect(s.y).toBeGreaterThan(-0.6);
    expect(r.yaw).toBeCloseTo(0, 1);
  });

  it('keeps the wyvern framed through a hard sustained turn (no drift)', () => {
    const { rig: r, camera } = rig();
    const p = fakePlayer();
    const pos = new Vector3(0, 1500, 0);
    let yaw = 0;
    const turnRate = 0.9; // rad/s — a very hard turn
    let worstX = 0;
    let worstD = 0;
    for (let i = 0; i < 300; i++) {
      if (i > 60) yaw += turnRate * DT;
      pos.x += Math.sin(yaw) * 35 * DT;
      pos.z += Math.cos(yaw) * 35 * DT;
      fly(p, pos, yaw, 0, i > 60 ? -1.1 : 0, 35);
      r.update(DT, idle, p);
      const s = ndc(camera, pos)!;
      worstX = Math.max(worstX, Math.abs(s.x));
      worstD = Math.max(worstD, camera.position.distanceTo(pos));
    }
    expect(worstX).toBeLessThan(0.35);
    expect(worstD).toBeLessThan(35);
  });

  it('widens the lens with speed and when tucked, and not at all with reduced motion', () => {
    for (const reduced of [false, true]) {
      const { rig: r, camera, settings } = rig({ reducedMotion: reduced });
      const p = fakePlayer();
      const pos = new Vector3(0, 1600, 0);
      p.wyvernPose.wingSpread = 0.28; // tucked
      for (let i = 0; i < 300; i++) {
        pos.z += 80 * DT;
        fly(p, pos, 0, 0, 0, 80);
        r.update(DT, idle, p);
      }
      if (reduced) expect(camera.fov).toBeCloseTo(settings.fov, 3);
      else expect(camera.fov).toBeGreaterThan(settings.fov + 16);
    }
  });

  it('rolls with ~30% of the bank, but not with reduced motion', () => {
    for (const reduced of [false, true]) {
      const { rig: r, camera } = rig({ reducedMotion: reduced });
      const p = fakePlayer();
      const pos = new Vector3(0, 1500, 0);
      for (let i = 0; i < 240; i++) {
        pos.z += 30 * DT;
        fly(p, pos, 0, 0, 0.8, 30); // banked right (+Z roll = right wing down), flying straight
        r.update(DT, idle, p);
      }
      // Camera "right" vector tilting down = rolled right.
      const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const roll = Math.asin(-right.y);
      if (reduced) expect(Math.abs(roll)).toBeLessThan(0.02);
      else {
        expect(roll).toBeGreaterThan(0.8 * 0.3 * 0.7);
        expect(roll).toBeLessThan(0.8 * 0.3 * 1.3);
      }
    }
  });

  it('never ends up inside rock when skimming the ground and climbing past cliffs', () => {
    const { rig: r, camera } = rig();
    const p = fakePlayer();
    const roost = LAYOUT.islands.find((i) => i.landmark === 'roost')!;
    let worst = Infinity;
    // Many short flights low over the Roost, nose high (the camera wants to sit below the path).
    for (let k = 0; k < 12; k++) {
      const yaw = (k / 12) * Math.PI * 2;
      const start = new Vector3(roost.x + Math.cos(yaw) * 120, 0, roost.z + Math.sin(yaw) * 120);
      start.y = terrain.groundAt(start.x, start.z, 1e6)!.y + 3;
      const pos = start.clone();
      r.snap(p);
      for (let i = 0; i < 90; i++) {
        pos.x += Math.sin(yaw) * 25 * DT;
        pos.z += Math.cos(yaw) * 25 * DT;
        pos.y += 6 * DT;
        fly(p, pos, yaw, 0.5, 0, 25);
        r.update(DT, idle, p);
        worst = Math.min(worst, terrain.distance(camera.position));
      }
    }
    expect(worst).toBeGreaterThan(0.3);
  });

  it('look-around springs back after the stick is released', () => {
    const { rig: r } = rig();
    const p = fakePlayer();
    const pos = new Vector3(0, 1500, 0);
    const look = { ...emptyFrame(), lookX: 1, lookIsRate: true, lookActive: true };
    for (let i = 0; i < 60; i++) {
      pos.z += 30 * DT;
      fly(p, pos, 0, 0, 0, 30);
      r.update(DT, i < 40 ? look : idle, p);
    }
    expect(Math.abs(r.yaw)).toBeGreaterThan(0.8);
    for (let i = 0; i < 240; i++) {
      pos.z += 30 * DT;
      fly(p, pos, 0, 0, 0, 30);
      r.update(DT, idle, p);
    }
    expect(Math.abs(r.yaw)).toBeLessThan(0.05);
  });

  it('snaps after a teleport instead of gliding across the map', () => {
    const { rig: r, camera } = rig();
    const p = fakePlayer();
    const pos = new Vector3(0, 1500, 0);
    for (let i = 0; i < 30; i++) {
      pos.z += 30 * DT;
      fly(p, pos, 0, 0, 0, 30);
      r.update(DT, idle, p);
    }
    pos.set(2000, 1500, 0);
    fly(p, pos, 0, 0, 0, 30);
    r.update(DT, idle, p);
    expect(camera.position.distanceTo(pos)).toBeLessThan(35);
  });
});

describe('rig transitions and shake', () => {
  it('glides from flight to the ground orbit without a jump cut', () => {
    const { rig: r, camera } = rig();
    const p = fakePlayer();
    const roost = LAYOUT.islands.find((i) => i.landmark === 'roost')!;
    const g = terrain.groundAt(roost.x + 40, roost.z, 1e6)!.y;
    const pos = new Vector3(roost.x + 40, g + 2.6, roost.z);
    for (let i = 0; i < 60; i++) {
      fly(p, pos, 0, 0, 0, 5);
      r.update(DT, idle, p);
    }
    p.mode = 'landed';
    p.wyvernPose.velocity.set(0, 0, 0);
    let last = camera.position.clone();
    let worstJump = 0;
    for (let i = 0; i < 120; i++) {
      r.update(DT, idle, p);
      worstJump = Math.max(worstJump, camera.position.distanceTo(last));
      last = camera.position.clone();
    }
    expect(r.rig).toBe('mounted');
    expect(worstJump).toBeLessThan(0.6);
  });

  it('shakes on a terrain hit and settles; reduced motion ignores it', () => {
    for (const reduced of [false, true]) {
      const events = new EventBus<GameEvents>();
      const { rig: r, camera } = rig({ reducedMotion: reduced }, events);
      const p = fakePlayer();
      const pos = new Vector3(0, 1500, 0);
      fly(p, pos, 0, 0, 0, 0.1);
      for (let i = 0; i < 60; i++) r.update(DT, idle, p);
      const calm = camera.quaternion.clone();
      events.emit('terrainHit', { impulse: 30, point: pos, normal: UP });
      let maxAngle = 0;
      for (let i = 0; i < 12; i++) {
        r.update(DT, idle, p);
        maxAngle = Math.max(maxAngle, camera.quaternion.angleTo(calm));
      }
      if (reduced) expect(maxAngle).toBeLessThan(1e-6);
      else expect(maxAngle).toBeGreaterThan(0.005);
      for (let i = 0; i < 90; i++) r.update(DT, idle, p);
      expect(camera.quaternion.angleTo(calm)).toBeLessThan(1e-3);
    }
  });
});

describe('ground, title and stable framing', () => {
  function onFoot(p: FakePlayer) {
    p.mode = 'onFoot';
    const L = LAYOUT;
    const rider = terrain.standingPoint(L.spawn.position[0], L.spawn.position[2], new Vector3());
    const wy = terrain.standingPoint(L.wyvernSpawn.position[0], L.wyvernSpawn.position[2], new Vector3());
    p.riderPose.mounted = false;
    p.riderPose.position.copy(rider);
    p.riderPose.yaw = L.spawn.yaw;
    p.riderPosition.copy(rider);
    p.wyvernPose.position.copy(wy).addScaledVector(UP, p.breed.standHeight);
    p.wyvernPose.orientation.setFromAxisAngle(UP, L.wyvernSpawn.yaw);
    p.wyvernPose.velocity.set(0, 0, 0);
    p.wyvernPose.groundY = wy.y;
    return { rider, wy };
  }

  it('on foot: starts behind the rider and exposes a camera-relative yaw', () => {
    const { rig: r, camera } = rig();
    const p = fakePlayer();
    const { rider } = onFoot(p);
    for (let i = 0; i < 30; i++) r.update(DT, idle, p);
    expect(r.rig).toBe('foot');
    expect(Math.cos(r.yaw - p.riderPose.yaw)).toBeGreaterThan(0.95);
    const d = camera.position.distanceTo(rider);
    expect(d).toBeGreaterThan(3);
    expect(d).toBeLessThan(8);
    const s = ndc(camera, rider.clone().addScaledVector(UP, 1))!;
    expect(Math.abs(s.x)).toBeLessThan(0.3);
  });

  it('title: frames both the rider and the wyvern', () => {
    const { rig: r, camera } = rig();
    const p = fakePlayer();
    const { rider, wy } = onFoot(p);
    r.mode = 'title';
    for (let t = 0; t < 20; t += DT) {
      r.update(DT, idle, p);
      if (t > 10) {
        for (const pt of [rider.clone().addScaledVector(UP, 1), wy.clone().addScaledVector(UP, 2.5)]) {
          const s = ndc(camera, pt)!;
          expect(s).not.toBeNull();
          expect(Math.abs(s.x)).toBeLessThan(0.95);
          expect(Math.abs(s.y)).toBeLessThan(0.95);
        }
      }
    }
  });

  it('stable: the subject sits in the right 60% of the screen, clear of the UI panel', () => {
    const { rig: r, camera } = rig();
    const p = fakePlayer();
    onFoot(p);
    r.mode = 'stable';
    for (let i = 0; i < 120; i++) r.update(DT, idle, p);
    const c = p.wyvernPose.position.clone().addScaledVector(UP, 0.6);
    const s = ndc(camera, c)!;
    expect((s.x + 1) / 2).toBeCloseTo(0.7, 1);
    // Sample the wyvern's bounding sphere: nothing should fall under the left 40%.
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const edge = ndc(camera, c.clone().addScaledVector(right, -p.breed.wingspan * 0.42))!;
    expect((edge.x + 1) / 2).toBeGreaterThan(0.4);
    // Leaving the stable glides the lens shift back to centre.
    r.mode = 'follow';
    p.mode = 'onFoot';
    for (let i = 0; i < 240; i++) r.update(DT, idle, p);
    expect(Math.abs(camera.filmOffset)).toBeLessThan(0.05);
  });

  it('stable focus can switch to the rider', () => {
    const { rig: r, camera } = rig();
    const p = fakePlayer();
    const { rider } = onFoot(p);
    r.mode = 'stable';
    r.setStableFocus('rider');
    for (let i = 0; i < 180; i++) r.update(DT, idle, p);
    const s = ndc(camera, rider.clone().addScaledVector(UP, 0.95))!;
    expect((s.x + 1) / 2).toBeCloseTo(0.7, 1);
    expect(camera.position.distanceTo(rider)).toBeLessThan(8);
  });
});
