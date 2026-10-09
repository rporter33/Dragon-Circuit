// Regression tests for the camera fixes of the review pass: collision with structures and soft
// foliage (CAM-01), the companion filling the frame (CAM-04), the next ring hiding behind the
// wyvern (CAM-02), the catch hand-off passing through the wyvern (CAM-03), the Stable gliding
// across the plaza (PLAY-06), the title rider behind the menu (PLAY-22 / VIS-19), the wingbeat
// heave scaled by breed, and bad frame times (DT-01).

import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { GameEvents, InputFrame, PlayerMode, RiderPose, Settings, WyvernPose } from '../core/types';
import type { PlayerSystem } from '../game/contracts';
import { EventBus } from '../core/events';
import { BREEDS } from '../flight/breeds';
import { DEFAULT_SETTINGS } from '../game/settings';
import { emptyFrame } from '../input/Input';
import { LAYOUT } from '../world/layout';
import { Terrain } from '../world/terrain';
import { CameraRig, CUT_IN, CUT_OUT } from './CameraRig';
import { TITLE_SHOT } from './showRigs';
import { heaveFor } from './cameraMath';

const UP = new Vector3(0, 1, 0);
const DT = 1 / 60;
const idle: InputFrame = emptyFrame();

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

type FakePlayer = PlayerSystem & { mode: PlayerMode; breed: PlayerSystem['breed'] };

function fakePlayer(): FakePlayer {
  return {
    mode: 'flying' as PlayerMode,
    breed: BREEDS.harrier,
    flight: { gLoad: 1 } as PlayerSystem['flight'],
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
}

function fly(p: FakePlayer, pos: Vector3, yaw: number, pitch: number, speed: number): void {
  const w = p.wyvernPose;
  w.position.copy(pos);
  w.orientation.setFromAxisAngle(UP, yaw).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -pitch));
  w.velocity.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(speed);
  w.airspeed = speed;
  w.airborne = true;
  p.riderPose.mounted = true;
  p.riderPose.position.copy(pos);
  p.riderPosition.copy(pos);
}

function makeRig(terrain: Terrain, settings: Partial<Settings> = {}, events?: EventBus<GameEvents>) {
  const s: Settings = { ...DEFAULT_SETTINGS, ...settings };
  const camera = new PerspectiveCamera(s.fov, 16 / 9, 0.5, 7000);
  return { rig: new CameraRig(camera, terrain, () => s, events), camera, settings: s };
}

function ndc(camera: PerspectiveCamera, p: Vector3): Vector3 {
  camera.updateMatrixWorld();
  return p.clone().project(camera);
}

const terrain = new Terrain(LAYOUT);
const SKY = new Vector3(0, 1500, 0);

describe('CAM-01: structures and foliage', () => {
  it('pulls in at once for a wall, but only eases in front of leaves (never collapsing)', () => {
    for (const soft of [false, true]) {
      const t = new Terrain(LAYOUT);
      const { rig: r, camera } = makeRig(t);
      const p = fakePlayer();
      const pos = SKY.clone();
      fly(p, pos, 0, 0, 0.1);
      for (let i = 0; i < 60; i++) r.update(DT, idle, p);
      const free = camera.position.distanceTo(pos);
      expect(free).toBeGreaterThan(14);
      // A canopy (or a solid tower top) right on the boom, halfway to the camera.
      const mid = camera.position.clone().lerp(pos, 0.45);
      t.colliders.add({ kind: 'sphere', x: mid.x, y: mid.y, z: mid.z, radius: 3, soft });
      r.update(DT, idle, p);
      const first = camera.position.distanceTo(pos);
      let min = Infinity;
      for (let i = 0; i < 120; i++) {
        r.update(DT, idle, p);
        min = Math.min(min, camera.position.distanceTo(pos));
      }
      if (soft) {
        // No pop on the first frame; then it settles in front of the leaves, not on the wyvern.
        expect(free - first).toBeLessThan(1.5);
        expect(min).toBeGreaterThan(free * 0.4);
        expect(min).toBeLessThan(free * 0.75);
      } else {
        // Solid: the camera is never left inside it.
        expect(camera.position.distanceTo(mid)).toBeGreaterThan(3);
        expect(min).toBeLessThan(free * 0.6);
      }
    }
  });

  it('keeps the on-foot camera out of a building wall behind the rider', () => {
    const t = new Terrain(LAYOUT);
    const { rig: r, camera } = makeRig(t);
    const p = fakePlayer();
    p.mode = 'onFoot';
    const feet = t.standingPoint(40, 0, new Vector3());
    p.riderPose.mounted = false;
    p.riderPose.position.copy(feet);
    p.riderPose.yaw = 0; // facing +Z; the camera sits behind, toward -Z
    p.wyvernPose.position.set(400, feet.y + 2.6, 400);
    // A wall 2.5 m behind the rider.
    t.colliders.add({ kind: 'box', x: feet.x, y: feet.y + 4, z: feet.z - 3.5, hx: 8, hy: 4, hz: 1, yaw: 0 });
    for (let i = 0; i < 90; i++) {
      r.update(DT, idle, p);
      expect(camera.position.z).toBeGreaterThan(feet.z - 2.45);
    }
  });
});

describe('CAM-04: the waiting wyvern beside the rider', () => {
  it('swings the idle on-foot camera off a wyvern that fills the frame', () => {
    const { rig: r, camera } = makeRig(terrain);
    const p = fakePlayer();
    p.mode = 'onFoot';
    const feet = terrain.standingPoint(40, 0, new Vector3());
    p.riderPose.mounted = false;
    p.riderPose.position.copy(feet);
    p.riderPose.yaw = 0;
    // The wyvern 4.5 m to the rider's right (−X), level with them.
    const wFeet = terrain.standingPoint(feet.x - 4.5, feet.z, new Vector3());
    p.wyvernPose.position.copy(wFeet).addScaledVector(UP, p.breed.standHeight);
    p.wyvernPose.groundY = wFeet.y;
    for (let i = 0; i < 20; i++) r.update(DT, idle, p);
    const near0 = camera.position.distanceTo(p.wyvernPose.position);
    for (let i = 0; i < 6 * 60; i++) r.update(DT, idle, p);
    const near1 = camera.position.distanceTo(p.wyvernPose.position);
    // It backs off the wyvern (toward standing it behind the rider, the furthest an orbit can).
    expect(near1).toBeGreaterThan(near0 + 1.8);
    // The rider stays framed.
    const s = ndc(camera, feet.clone().addScaledVector(UP, 1));
    expect(Math.abs(s.x)).toBeLessThan(0.35);
  });
});

describe('CAM-02: the next ring stays visible above the wyvern while racing', () => {
  it('rises over a ring that lies below the flight path', () => {
    for (const racing of [false, true]) {
      const { rig: r, camera } = makeRig(terrain);
      const p = fakePlayer();
      const pos = SKY.clone();
      const ring = new Vector3();
      if (racing) r.setWaypointSource((out) => out.copy(ring));
      let sep = 0;
      for (let i = 0; i < 150; i++) {
        pos.z += 30 * DT;
        fly(p, pos, 0, 0, 30);
        // A ring 90 m ahead and 16 m below (the course dives; the player hasn't yet).
        ring.set(pos.x, pos.y - 16, pos.z + 90);
        r.update(DT, idle, p);
        const head = ndc(camera, pos.clone().addScaledVector(UP, 2.2));
        sep = ndc(camera, ring).y - head.y;
      }
      if (racing) expect(sep).toBeGreaterThan(0.12);
      else expect(sep).toBeLessThan(0.08);
    }
  });
});

describe('CAM-03: the catch hands off by orbiting, not through the wyvern', () => {
  it('never closes in on the wyvern while swinging from the fall camera to the chase', () => {
    const { rig: r, camera } = makeRig(terrain);
    const p = fakePlayer();
    p.mode = 'falling';
    p.riderPose.mounted = false;
    const rider = SKY.clone();
    p.riderPose.velocity.set(0, -20, 4);
    for (let i = 0; i < 60; i++) {
      rider.y -= 20 * DT;
      p.riderPose.position.copy(rider);
      p.wyvernPose.position.copy(rider).add(new Vector3(30, -20, -30));
      r.update(DT, idle, p);
    }
    // Caught: now flying fast, away from where the fall camera looked.
    p.mode = 'flying';
    const pos = rider.clone();
    const dists: number[] = [];
    for (let i = 0; i < 150; i++) {
      pos.x += 38 * DT;
      pos.y += 2 * DT;
      fly(p, pos, Math.PI / 2, 0.05, 38);
      r.update(DT, idle, p);
      dists.push(camera.position.distanceTo(pos));
    }
    expect(r.rig).toBe('flight');
    // It only ever backs away: from the fall camera's distance out to the chase distance (the old
    // straight-line blend dipped to 7 m through the wyvern before swinging out).
    for (let i = 1; i < dists.length; i++) expect(dists[i]).toBeGreaterThan(dists[i - 1] - 0.05);
    expect(dists[30]).toBeGreaterThan(dists[0] + 5);
  });
});

describe('PLAY-06: the Stable cuts through a fade instead of gliding across the plaza', () => {
  it('fades out, cuts, fades in when the wyvern waits far away', () => {
    const { rig: r, camera } = makeRig(terrain);
    const p = fakePlayer();
    p.mode = 'onFoot';
    const feet = terrain.standingPoint(0, -8, new Vector3());
    p.riderPose.mounted = false;
    p.riderPose.position.copy(feet);
    p.riderPose.yaw = Math.PI;
    const wFeet = terrain.standingPoint(-30, 44, new Vector3());
    p.wyvernPose.position.copy(wFeet).addScaledVector(UP, p.breed.standHeight);
    p.wyvernPose.groundY = wFeet.y;
    for (let i = 0; i < 60; i++) r.update(DT, idle, p);
    const before = camera.position.clone();
    r.mode = 'stable';
    r.setStableFocus('wyvern');
    let peak = 0;
    let glide = 0;
    let last = camera.position.clone();
    const frames = Math.ceil((CUT_OUT + CUT_IN + 0.3) / DT);
    for (let i = 0; i < frames; i++) {
      r.update(DT, idle, p);
      peak = Math.max(peak, r.fade);
      // Visible movement (while not black) must stay small: no long glide across the plaza.
      if (r.fade < 0.9) glide = Math.max(glide, camera.position.distanceTo(last));
      last = camera.position.clone();
    }
    expect(peak).toBeGreaterThan(0.99);
    expect(r.fade).toBe(0);
    expect(glide).toBeLessThan(1.5);
    expect(camera.position.distanceTo(before)).toBeGreaterThan(20);
    expect(camera.position.distanceTo(p.wyvernPose.position)).toBeLessThan(30);
  });
});

describe('PLAY-22 / VIS-19: the title two-shot holds from the first frame', () => {
  it('keeps the rider left and the wyvern right of the menu column throughout the intro', () => {
    const { rig: r, camera } = makeRig(terrain);
    const p = fakePlayer();
    p.mode = 'onFoot';
    const rider = terrain.standingPoint(LAYOUT.spawn.position[0], LAYOUT.spawn.position[2], new Vector3());
    const wy = terrain.standingPoint(LAYOUT.wyvernSpawn.position[0], LAYOUT.wyvernSpawn.position[2], new Vector3());
    p.riderPose.mounted = false;
    p.riderPose.position.copy(rider);
    p.riderPose.yaw = LAYOUT.spawn.yaw;
    p.wyvernPose.position.copy(wy).addScaledVector(UP, p.breed.standHeight);
    p.wyvernPose.orientation.setFromAxisAngle(UP, LAYOUT.wyvernSpawn.yaw);
    p.wyvernPose.groundY = wy.y;
    r.mode = 'title';
    for (let t = 0; t < 14; t += DT) {
      r.update(DT, idle, p);
      const sr = ndc(camera, rider.clone().addScaledVector(UP, 1));
      const sw = ndc(camera, wy.clone().addScaledVector(UP, p.breed.standHeight));
      expect(sr.x).toBeLessThan(-0.3);
      expect(sr.x).toBeGreaterThan(-0.8);
      expect(sw.x).toBeGreaterThan(0.3);
      expect(sw.x).toBeLessThan(0.85);
      // Below the logo, above the bottom edge.
      expect(sr.y).toBeLessThan(-0.2);
      expect(sr.y).toBeGreaterThan(-0.8);
      if (t > TITLE_SHOT.introTime) expect(sr.x).toBeCloseTo(TITLE_SHOT.riderX, 1);
    }
    // Low and heroic: the camera stands near the rider's eye line.
    expect(camera.position.y - rider.y).toBeLessThan(3);
  });
});

describe('the weight of a big wyvern', () => {
  function heaveOf(mass: number, reduced = false) {
    const events = new EventBus<GameEvents>();
    const { rig: r, camera } = makeRig(terrain, { reducedMotion: reduced }, events);
    const p = fakePlayer();
    p.breed = { ...BREEDS.harrier, mass };
    const pos = SKY.clone();
    fly(p, pos, 0, 0, 0.1);
    for (let i = 0; i < 90; i++) r.update(DT, idle, p);
    const rest = camera.position.y;
    events.emit('flap', { strength: 1, position: pos });
    let dip = 0;
    let dipAt = 0;
    let lift = 0;
    for (let i = 1; i < 120; i++) {
      r.update(DT, idle, p);
      const dy = camera.position.y - rest;
      if (-dy > dip) {
        dip = -dy;
        dipAt = i * DT;
      }
      if (i * DT > dipAt + 0.05) lift = Math.max(lift, dy);
    }
    return { dip, dipAt, lift, settled: Math.abs(camera.position.y - rest) };
  }

  it('dips under each downstroke and rises a touch past rest; heavier breeds heave further and slower', () => {
    const light = heaveOf(BREEDS.skimmer.mass);
    const heavy = heaveOf(BREEDS.ironback.mass);
    expect(light.dip).toBeGreaterThan(0.2);
    expect(light.lift).toBeGreaterThan(0.03);
    expect(heavy.dip).toBeGreaterThan(light.dip * 1.15);
    expect(heavy.dipAt).toBeGreaterThan(light.dipAt);
    expect(heavy.settled).toBeLessThan(0.02);
    // A felt heave, not a lurch: well under a metre at a ~20 m boom.
    expect(heavy.dip).toBeLessThan(0.8);
    expect(heaveFor(BREEDS.ironback.mass).omega).toBeLessThan(heaveFor(BREEDS.skimmer.mass).omega);
  });

  it('reduced motion: no heave', () => {
    expect(heaveOf(BREEDS.ironback.mass, true).dip).toBeLessThan(1e-6);
  });

  it('presses down and tightens the lens under a hard pull-out', () => {
    const { rig: r, camera, settings } = makeRig(terrain);
    const p = fakePlayer();
    const pos = SKY.clone();
    for (let i = 0; i < 120; i++) {
      pos.z += 30 * DT;
      fly(p, pos, 0, 0, 30);
      r.update(DT, idle, p);
    }
    const calm = camera.fov;
    (p.flight as { gLoad: number }).gLoad = 3.5;
    for (let i = 0; i < 60; i++) {
      pos.z += 30 * DT;
      fly(p, pos, 0, 0, 30);
      r.update(DT, idle, p);
    }
    expect(camera.fov).toBeLessThan(calm - 2.5);
    expect(settings.fov).toBe(DEFAULT_SETTINGS.fov);
  });

  it('shoots bigger breeds from further back on a longer lens', () => {
    const at = (breed: keyof typeof BREEDS) => {
      const { rig: r, camera } = makeRig(terrain);
      const p = fakePlayer();
      p.breed = BREEDS[breed];
      const pos = SKY.clone();
      for (let i = 0; i < 120; i++) {
        pos.z += 30 * DT;
        fly(p, pos, 0, 0, 30);
        r.update(DT, idle, p);
      }
      return { dist: camera.position.distanceTo(pos), fov: camera.fov };
    };
    const skimmer = at('skimmer');
    const galewing = at('galewing');
    const ironback = at('ironback');
    const harrier = at('harrier');
    expect(galewing.dist).toBeGreaterThan(harrier.dist);
    expect(ironback.dist).toBeGreaterThan(harrier.dist);
    expect(skimmer.dist).toBeLessThan(harrier.dist);
    expect(galewing.fov).toBeLessThan(skimmer.fov);
  });
});

describe('DT-01: bad frame times', () => {
  it('a negative or NaN dt never grows the shake or breaks the camera', () => {
    const events = new EventBus<GameEvents>();
    const { rig: r, camera } = makeRig(terrain, {}, events);
    const p = fakePlayer();
    fly(p, SKY.clone(), 0, 0, 20);
    r.update(DT, idle, p);
    events.emit('terrainHit', { impulse: 10, point: SKY.clone(), normal: UP });
    const t0 = r.trauma;
    r.update(-5, idle, p);
    r.update(NaN, idle, p);
    expect(r.trauma).toBeLessThanOrEqual(t0);
    expect(r.trauma).toBeLessThanOrEqual(1);
    expect(Number.isFinite(camera.position.x + camera.position.y + camera.position.z)).toBe(true);
  });
});
