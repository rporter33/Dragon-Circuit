import { describe, expect, it } from 'vitest';
import { Quaternion, Scene, Vector3 } from 'three';
import { EventBus } from '../core/events';
import type { GameEvents, PlayerMode } from '../core/types';
import type { PlayerSystem } from '../game/contracts';
import { BREEDS } from '../flight/breeds';
import { createFlightState } from '../flight/FlightModel';
import { createRiderPose, createWyvernPose } from '../player/poses';
import { QUALITY } from '../render/quality';
import { DEFAULT_SETTINGS } from '../game/settings';
import { LocalSaveStore, MemoryGhostStore } from '../progression/save';
import { COURSES } from './courses';
import { gateRing, RACE_START } from './courseMath';
import { Races } from './Races';

const DT = 1 / 120;

/** Just enough of a player for the race system: a point that flies where it's told. */
class FakePlayer {
  mode: PlayerMode = 'flying';
  breed = BREEDS.harrier;
  flight = createFlightState();
  wyvernPose = createWyvernPose();
  riderPose = createRiderPose();
  riderPosition = new Vector3();
  prevPosition = new Vector3();
  position = new Vector3();
  controllable = true;
  fade = 0;
  teleports: { position: Vector3; yaw: number; speed?: number }[] = [];
  setBreed() {}
  fixedUpdate() {}
  update() {}
  teleport(position: Vector3, yaw: number, _mode: string, speed?: number): void {
    this.teleports.push({ position: position.clone(), yaw, speed });
    this.prevPosition.copy(position);
    this.position.copy(position);
    this.flight.position.copy(position);
    this.flight.velocity.set(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(speed ?? 25);
  }
}

function setup() {
  const events = new EventBus<GameEvents>();
  const log: { type: string; payload: any }[] = [];
  for (const type of ['raceArmed', 'raceCountdown', 'raceStart', 'ringPassed', 'ringMissed', 'raceFinish', 'raceAbort', 'unlock'] as const) {
    events.on(type, (payload) => log.push({ type, payload }));
  }
  const save = new LocalSaveStore({ storage: null, ghosts: new MemoryGhostStore() });
  const player = new FakePlayer();
  const races = new Races({
    scene: new Scene(),
    events,
    save,
    player: player as unknown as PlayerSystem,
    quality: QUALITY.low,
    settings: () => DEFAULT_SETTINGS,
  });
  /** Fly in a straight line to `to` at `speed`, stepping the race system at 120 Hz. */
  const flyTo = (to: Vector3, speed = 30) => {
    const from = player.position.clone();
    const dir = to.clone().sub(from);
    const dist = dir.length();
    dir.normalize();
    player.flight.velocity.copy(dir).multiplyScalar(speed);
    const steps = Math.max(1, Math.ceil(dist / (speed * DT)));
    for (let i = 1; i <= steps; i++) {
      player.prevPosition.copy(player.position);
      player.position.lerpVectors(from, to, i / steps);
      player.flight.position.copy(player.position);
      races.fixedUpdate(DT, player as unknown as PlayerSystem);
    }
  };
  return { events, log, save, player, races, flyTo };
}

const loop = COURSES.find((c) => c.id === 'roost-loop')!;
const ringPoint = (i: number, along: number, side = 0) => {
  const r = loop.rings[i];
  const n = new Vector3(...r.normal).normalize();
  const s = new Vector3(n.z, 0, -n.x).normalize();
  return new Vector3(...r.position).addScaledVector(n, along).addScaledVector(s, side);
};
const gatePoint = (along: number) => {
  const g = gateRing(loop);
  return new Vector3(g.cx, g.cy, g.cz).addScaledVector(new Vector3(g.nx, g.ny, g.nz), along);
};

describe('Races: a full run of the Roost Loop', () => {
  it('arms on approach, starts at the gate, counts rings in order and records the finish', async () => {
    const { log, save, player, races, flyTo } = setup();
    player.teleport(gatePoint(-200), 0, 'flying', 30);
    flyTo(gatePoint(-150));
    expect(races.state).toBe('countdown');
    expect(log.find((e) => e.type === 'raceArmed')?.payload.raceId).toBe('roost-loop');
    flyTo(gatePoint(-5));
    expect(log.filter((e) => e.type === 'raceCountdown').map((e) => e.payload.count)).toEqual([3, 2, 1]);
    flyTo(gatePoint(10));
    expect(races.state).toBe('running');
    expect(log.some((e) => e.type === 'raceStart')).toBe(true);

    // Ring 0 straight through; ring 1 passed by outside the hole first (a miss), then through.
    flyTo(ringPoint(0, -10));
    flyTo(ringPoint(0, 10));
    const first = log.find((e) => e.type === 'ringPassed')!.payload;
    expect(first.index).toBe(0);
    expect(first.total).toBe(loop.rings.length);
    expect(first.deltaMs).toBeNull();
    expect(Math.abs(first.splitMs - races.splits[0])).toBeLessThan(1e-6);
    flyTo(ringPoint(1, -10, 25));
    flyTo(ringPoint(1, 10, 25));
    expect(log.find((e) => e.type === 'ringMissed')?.payload.index).toBe(1);
    expect(races.nextRingIndex).toBe(1);
    flyTo(ringPoint(1, -20));
    flyTo(ringPoint(1, 10));
    expect(races.nextRingIndex).toBe(2);

    for (let i = 2; i < loop.rings.length; i++) {
      flyTo(ringPoint(i, -10), 40);
      flyTo(ringPoint(i, 10), 40);
    }
    expect(races.state).toBe('finished');
    const fin = log.find((e) => e.type === 'raceFinish')!.payload;
    expect(fin.newBest).toBe(true);
    expect(fin.previousBestMs).toBeNull();
    expect(fin.timeMs).toBeCloseTo(races.splits[races.splits.length - 1], 6);
    const rec = save.data.races['roost-loop'];
    expect(rec.runs).toBe(1);
    expect(rec.bestMs).toBeCloseTo(fin.timeMs, 6);
    expect(rec.breed).toBe('harrier');
    expect(rec.medal).toBe(fin.medal);
    // The run's ghost is stored with its splits.
    const ghost = await save.getGhost('roost-loop');
    expect(ghost?.splits?.length).toBe(loop.rings.length);
    expect(ghost!.samples.length).toBeGreaterThan(30 * 11);
  });

  it('a second, slower run is not a best but splits compare against the best', async () => {
    const { log, save, player, races, flyTo } = setup();
    const run = (speed: number) => {
      player.teleport(gatePoint(-200), 0, 'flying', speed);
      flyTo(gatePoint(-150), speed);
      flyTo(gatePoint(10), speed);
      for (let i = 0; i < loop.rings.length; i++) {
        flyTo(ringPoint(i, -10), speed);
        flyTo(ringPoint(i, 10), speed);
      }
    };
    run(60);
    await Promise.resolve();
    expect(races.state).toBe('finished');
    // Leave the finished state and go again, slower.
    for (let i = 0; i < 120 * 9; i++) races.fixedUpdate(DT, player as unknown as PlayerSystem);
    expect(races.state).toBe('idle');
    run(45);
    const finishes = log.filter((e) => e.type === 'raceFinish').map((e) => e.payload);
    expect(finishes[1].newBest).toBe(false);
    expect(finishes[1].previousBestMs).toBeCloseTo(finishes[0].timeMs, 6);
    expect(save.data.races['roost-loop'].runs).toBe(2);
    expect(save.data.races['roost-loop'].bestMs).toBeCloseTo(finishes[0].timeMs, 6);
    const passes = log.filter((e) => e.type === 'ringPassed').map((e) => e.payload);
    const second = passes.slice(loop.rings.length);
    expect(second[0].deltaMs).toBeGreaterThan(0); // behind the best
  });

  it('begin() puts the player on a rolling start before the gate, and respawn aborts', () => {
    const { log, player, races, events, flyTo } = setup();
    races.begin('lantern-dash');
    const def = COURSES.find((c) => c.id === 'lantern-dash')!;
    const t = player.teleports[0];
    const g = gateRing(def);
    expect(t.speed).toBe(RACE_START.speed);
    expect(t.position.distanceTo(new Vector3(g.cx, g.cy, g.cz))).toBeCloseTo(RACE_START.leadDistance, 3);
    expect(races.state).toBe('countdown');
    expect(races.activeId).toBe('lantern-dash');
    const target = new Vector3(g.cx, g.cy, g.cz).addScaledVector(new Vector3(g.nx, g.ny, g.nz), 10);
    flyTo(target, 28);
    expect(races.state).toBe('running');
    events.emit('respawn', { position: new Vector3() });
    expect(log.find((e) => e.type === 'raceAbort')?.payload.reason).toBe('respawn');
    expect(races.state).toBe('idle');
    expect(races.activeId).toBeNull();
  });

  it('restart and quit', () => {
    const { log, races } = setup();
    races.begin('roost-loop');
    races.restart();
    expect(log.filter((e) => e.type === 'raceAbort').map((e) => e.payload.reason)).toEqual(['restart']);
    expect(races.state).toBe('countdown');
    races.abort('quit');
    expect(log.filter((e) => e.type === 'raceAbort').map((e) => e.payload.reason)).toEqual(['restart', 'quit']);
    expect(races.activeId).toBeNull();
  });

  it('dismounting mid-race leaves the course; flying away from an armed gate disarms quietly', () => {
    const { log, player, races, flyTo } = setup();
    player.teleport(gatePoint(-200), 0, 'flying', 30);
    flyTo(gatePoint(-150));
    expect(races.state).toBe('countdown');
    // Turn away and leave.
    flyTo(gatePoint(-150).add(new Vector3(0, 0, 0)).addScaledVector(new Vector3(0, 1, 0), 400));
    expect(races.state).toBe('idle');
    expect(log.some((e) => e.type === 'raceAbort')).toBe(false);
    // Arm again, start, then step off on foot.
    player.teleport(gatePoint(-200), 0, 'flying', 30);
    flyTo(gatePoint(10));
    expect(races.state).toBe('running');
    player.mode = 'onFoot';
    races.fixedUpdate(DT, player as unknown as PlayerSystem);
    expect(log.find((e) => e.type === 'raceAbort')?.payload.reason).toBe('left-course');
  });

  it('points the HUD at the gate, then each ring, and knows which start is nearby', () => {
    const { player, races, flyTo } = setup();
    const out = new Vector3();
    player.teleport(gatePoint(-300), 0, 'flying', 30);
    expect(races.waypoint(out)?.toArray()).toEqual(loop.start.position);
    expect(races.nearbyStart(gatePoint(-100))?.id).toBe('roost-loop');
    expect(races.nearbyStart(new Vector3(0, 5000, 0))).toBeNull();
    flyTo(gatePoint(10));
    expect(races.waypoint(out)?.toArray()).toEqual(loop.rings[0].position);
  });

  it('awards unlocks a medal earns (gold on the Roost Loop unlocks the crown horns)', () => {
    const { log, player, races, flyTo } = setup();
    player.teleport(gatePoint(-200), 0, 'flying', 90);
    flyTo(gatePoint(10), 90);
    for (let i = 0; i < loop.rings.length; i++) {
      flyTo(ringPoint(i, -10), 90);
      flyTo(ringPoint(i, 10), 90);
    }
    const fin = log.find((e) => e.type === 'raceFinish')!.payload;
    expect(fin.medal).toBe('gold');
    expect(log.some((e) => e.type === 'unlock' && e.payload.cosmeticId === 'crown')).toBe(true);
    void Quaternion;
  });
});
