import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { EventBus } from '../core/events';
import type { BreedId, GameEvents, GroundHit, InputFrame, PlayerMode, TerrainQuery } from '../core/types';
import { mulberry32 } from '../core/rng';
import { emptyFrame } from '../input/Input';
import { DEFAULT_SETTINGS } from '../game/settings';
import { LAYOUT } from '../world/layout';
import { Terrain } from '../world/terrain';
import { BREED_ORDER, BREEDS } from '../flight/breeds';
import { Player } from './Player';
import { RiderFoot } from './foot';
import { computePrompt } from './prompts';
import { PLAYER_TUNING as P } from './tuning';

const terrain = new Terrain(LAYOUT);
const DT = 1 / 120;
const roost = terrain.islands.find((i) => i.def.landmark === 'roost')!;

interface Rig {
  player: Player;
  events: EventBus<GameEvents>;
  log: { type: keyof GameEvents; t: number; payload: unknown }[];
  t: number;
  run(seconds: number, input?: (inp: InputFrame, t: number) => void, cameraYaw?: number): void;
  modes(): PlayerMode[];
  count(type: keyof GameEvents): number;
}

function rig(breed: BreedId = 'harrier', opts: { holdToFlap?: boolean; wind?: Vector3 } = {}): Rig {
  const events = new EventBus<GameEvents>();
  const settings = { ...DEFAULT_SETTINGS, holdToFlap: opts.holdToFlap ?? true };
  const wind = opts.wind ?? new Vector3();
  const player = new Player({ terrain, env: { windAt: (_p, o) => o.copy(wind), terrain }, events, breed, settings: () => settings });
  const r: Rig = {
    player,
    events,
    log: [],
    t: 0,
    run(seconds, input, cameraYaw = 0) {
      const n = Math.round(seconds / DT);
      for (let i = 0; i < n; i++) {
        const inp = emptyFrame();
        input?.(inp, r.t);
        player.latchPresses(inp);
        player.fixedUpdate(DT, inp, cameraYaw);
        player.update(DT, 1);
        r.t += DT;
      }
    },
    modes: () => r.log.filter((e) => e.type === 'modeChange').map((e) => (e.payload as { to: PlayerMode }).to),
    count: (type) => r.log.filter((e) => e.type === type).length,
  };
  const types: (keyof GameEvents)[] = ['modeChange', 'touchdown', 'takeoff', 'mount', 'dismount', 'fellOff', 'caught', 'respawn', 'footstep', 'terrainHit', 'flap', 'flapRefused'];
  for (const type of types) events.on(type, (payload) => r.log.push({ type, t: r.t, payload }));
  return r;
}

/** Press a button on exactly one frame: the first one at or after time `at`. */
const pressAt = (at: number, key: 'interact' | 'jump') => {
  let done = false;
  return (inp: InputFrame, t: number) => {
    if (!done && t >= at - 1e-9) {
      inp.pressed[key] = true;
      done = true;
    }
  };
};

function groundAt(x: number, z: number): GroundHit {
  return terrain.groundAt(x, z, 1e6)!;
}

/** A point on the Roost's rim at angle theta, `inset` meters inside the cliff edge. */
function rimPoint(theta: number, inset: number): Vector3 {
  const R = roost.outlineRadius(theta) - inset;
  const x = roost.def.x + Math.cos(theta) * R;
  const z = roost.def.z + Math.sin(theta) * R;
  return new Vector3(x, groundAt(x, z).y, z);
}

describe('new game', () => {
  it('starts on foot at the spawn with the wyvern standing on the Roost', () => {
    const { player } = rig();
    player.placeAtSpawn();
    expect(player.mode).toBe('onFoot');
    const sp = LAYOUT.spawn.position;
    expect(player.riderPosition.x).toBeCloseTo(sp[0], 3);
    expect(player.riderPosition.z).toBeCloseTo(sp[2], 3);
    expect(player.riderPosition.y).toBeCloseTo(groundAt(sp[0], sp[2]).y, 3);
    expect(player.riderPose.mounted).toBe(false);
    const ws = LAYOUT.wyvernSpawn.position;
    const w = player.wyvernPose;
    expect(w.position.x).toBeCloseTo(ws[0], 3);
    expect(w.position.z).toBeCloseTo(ws[2], 3);
    expect(w.position.y).toBeCloseTo(groundAt(ws[0], ws[2]).y + BREEDS.harrier.standHeight, 3);
    expect(w.airborne).toBe(false);
    expect(w.gait).toBe('idle');
    expect(w.groundY).toBeCloseTo(groundAt(ws[0], ws[2]).y, 3);
  });

  it('waits by the stable until called, then comes to the rider', () => {
    const r = rig();
    r.player.placeAtSpawn();
    const w0 = r.player.position.clone();
    const rider0 = r.player.riderPosition.clone();
    r.run(5);
    expect(r.player.mode).toBe('onFoot');
    expect(r.player.riderPosition.distanceTo(rider0)).toBeLessThan(0.01);
    expect(r.player.position.distanceTo(w0)).toBeLessThan(0.01);
    expect(r.player.wyvernPose.gait).toBe('idle');
    // Call it (interact away from the wyvern and the stable): the rider waves, it comes over.
    r.run(12, pressAt(r.t + 0.1, 'interact'));
    expect(r.player.wyvernDistance).toBeLessThan(P.followStop + 1);
    expect(r.count('footstep')).toBeGreaterThan(3);
  });
});

describe('takeoff and landing', () => {
  for (const id of BREED_ORDER) {
    it(`${id}: takes off from flat ground and climbs away while flapping`, () => {
      const r = rig(id);
      r.player.teleport(new Vector3(0, 250, -40), 0, 'landed');
      const g0 = groundAt(0, -40).y;
      r.run(7, (inp) => (inp.flight.flap = 1));
      expect(r.modes()).toEqual(['flying']);
      expect(r.count('takeoff')).toBe(1);
      expect(r.player.position.y - g0).toBeGreaterThan(10);
    });
  }

  it('crouches before the leap (committed takeoff)', () => {
    const r = rig();
    r.player.teleport(new Vector3(0, 250, -40), 0, 'landed');
    r.run(0.1, (inp) => (inp.flight.flap = 1));
    expect(r.player.mode).toBe('landed');
    expect(r.player.wyvernPose.gait).toBe('takeoff');
    r.run(0.3, (inp) => (inp.flight.flap = 1));
    expect(r.player.mode).toBe('flying');
  });

  it('lands softly when low and slow, and stands at standHeight', () => {
    const r = rig();
    const g = groundAt(0, -60);
    r.player.teleport(new Vector3(0, g.y + 7, -60), 0, 'flying', 17);
    r.run(6, (inp) => (inp.flight.flare = 1));
    expect(r.player.mode).toBe('landed');
    expect(r.count('touchdown')).toBe(1);
    const td = r.log.find((e) => e.type === 'touchdown')!.payload as GameEvents['touchdown'];
    expect(td.impact).toBeLessThan(P.landSink);
    expect(td.surface).toBeDefined();
    const gNow = groundAt(r.player.position.x, r.player.position.z);
    expect(r.player.position.y - gNow.y).toBeCloseTo(BREEDS.harrier.standHeight, 2);
    // Settles to a stop and stands.
    r.run(3);
    expect(r.player.wyvernPose.gait).toBe('idle');
    expect(r.player.wyvernPose.airborne).toBe(false);
  });

  it('skids and bounces when it comes in too fast, then stops', () => {
    const r = rig();
    const g = groundAt(0, -100);
    r.player.teleport(new Vector3(0, g.y + 3.5, -100), 0, 'flying', 21);
    r.run(0.4, (inp) => (inp.flight.flare = 0.4));
    // Touching the ground at > 18 m/s does not land straight away.
    expect(r.player.mode).toBe('flying');
    r.run(4, (inp) => (inp.flight.flare = 1));
    expect(r.player.mode).toBe('landed');
  });

  it('walking off a cliff while mounted becomes flight', () => {
    const r = rig();
    const theta = 0.3;
    const p = rimPoint(theta, 6);
    const yaw = Math.atan2(Math.cos(theta), Math.sin(theta)); // facing outward
    r.player.teleport(p, yaw, 'landed');
    expect(r.player.mode).toBe('landed');
    // Push the stick "forward" with the camera behind the wyvern.
    r.run(4, (inp) => (inp.foot.moveY = 1), yaw);
    expect(r.modes()).toContain('flying');
    expect(r.count('takeoff')).toBe(1);
    r.run(3);
    // Gliding, not falling like a stone: it has built flying speed.
    expect(r.player.mode).toBe('flying');
    expect(r.player.flight.airspeed).toBeGreaterThan(BREEDS.harrier.stallAngle > 0 ? 15 : 0);
  });

  it('turns and walks camera-relative on the ground', () => {
    const r = rig();
    r.player.teleport(new Vector3(0, 250, 0), 0, 'landed');
    const x0 = r.player.position.x;
    // Camera facing +X (yaw 90°): stick forward means east.
    r.run(3, (inp) => (inp.foot.moveY = 1), Math.PI / 2);
    expect(r.player.position.x - x0).toBeGreaterThan(8);
    expect(r.player.wyvernPose.gait).toBe('run');
    expect(r.count('footstep')).toBeGreaterThan(2);
  });
});

describe('on foot', () => {
  it('dismounts beside the wyvern and mounts again when close', () => {
    const r = rig();
    r.player.teleport(new Vector3(0, 250, 0), 0, 'landed');
    r.run(0.5, pressAt(0.1, 'interact'));
    expect(r.player.mode).toBe('dismounting');
    expect(r.player.controllable).toBe(false);
    r.run(1);
    expect(r.player.mode).toBe('onFoot');
    expect(r.count('dismount')).toBe(1);
    expect(r.player.wyvernDistance).toBeGreaterThan(2);
    expect(r.player.wyvernDistance).toBeLessThan(P.mountRange);
    expect(r.player.riderPose.mounted).toBe(false);
    const t0 = r.t;
    r.run(0.3, pressAt(t0 + 0.1, 'interact'));
    expect(r.player.mode).toBe('mounting');
    r.run(1);
    expect(r.player.mode).toBe('landed');
    expect(r.player.riderPose.mounted).toBe(true);
    expect(r.count('mount')).toBe(1);
  });

  it('walks and runs camera-relative, with footsteps', () => {
    const r = rig();
    r.player.teleport(new Vector3(0, 250, 30), 0, 'onFoot');
    const p0 = r.player.riderPosition.clone();
    // Camera facing -Z (yaw 180°): stick forward walks toward -Z.
    r.run(2, (inp) => (inp.foot.moveY = 1), Math.PI);
    const walked = p0.z - r.player.riderPosition.z;
    expect(walked).toBeGreaterThan(6);
    expect(walked).toBeLessThan(P.walkSpeed * 2 + 0.5);
    expect(r.player.riderPose.action).toBe('walk');
    const p1 = r.player.riderPosition.clone();
    r.run(2, (inp) => {
      inp.foot.moveY = 1;
      inp.foot.sprint = true;
    }, Math.PI);
    expect(p1.z - r.player.riderPosition.z).toBeGreaterThan(walked * 1.5);
    expect(r.player.riderPose.action).toBe('run');
    expect(r.count('footstep')).toBeGreaterThan(4);
  });

  it('jumps and lands again', () => {
    const r = rig();
    r.player.teleport(new Vector3(0, 250, 30), 0, 'onFoot');
    const y0 = r.player.riderPosition.y;
    let top = y0;
    const jump = pressAt(0.05, 'jump');
    r.run(1.2, (inp, t) => {
      jump(inp, t);
      top = Math.max(top, r.player.riderPosition.y);
    });
    expect(top - y0).toBeGreaterThan(0.6);
    expect(r.player.riderPosition.y).toBeCloseTo(y0, 1);
    expect(r.player.mode).toBe('onFoot');
  });

  it('the wyvern follows a rider who wanders more than 30 m away', () => {
    const r = rig();
    r.player.teleport(new Vector3(-40, 250, 0), Math.PI / 2, 'onFoot');
    // Walk east for 12 s (~50 m).
    r.run(12, (inp) => (inp.foot.moveY = 1), Math.PI / 2);
    r.run(8);
    expect(r.player.wyvernDistance).toBeLessThan(P.followDistance);
    expect(r.player.mode).toBe('onFoot');
  });

  it('a rider who walks off the edge falls, is caught by the wyvern, and flies on', () => {
    const r = rig();
    const theta = 2.2;
    const p = rimPoint(theta, 4);
    const yaw = Math.atan2(Math.cos(theta), Math.sin(theta));
    r.player.teleport(p, yaw, 'onFoot');
    r.run(5, (inp) => (inp.foot.moveY = 1), yaw);
    expect(r.modes()).toEqual(['falling', 'flying']);
    const fell = r.log.find((e) => e.type === 'fellOff')!;
    const caught = r.log.find((e) => e.type === 'caught')!;
    expect(caught.t - fell.t).toBeCloseTo(P.catchDelay, 1);
    expect(r.player.riderPose.mounted).toBe(true);
    // And then it flies away instead of dropping into the clouds.
    r.run(4);
    expect(r.player.mode).toBe('flying');
    expect(r.player.flight.airspeed).toBeGreaterThan(14);
  });
});

describe('respawn', () => {
  it('fades to white below the cloud floor and returns gliding above the last safe ground', () => {
    const r = rig();
    // Stand somewhere safe first so it's remembered.
    r.player.teleport(new Vector3(40, 250, 40), 0, 'landed');
    r.run(1);
    const safe = r.player.safeGround.clone();
    expect(Math.hypot(safe.x - 40, safe.z - 40)).toBeLessThan(1);
    r.player.teleport(new Vector3(2400, LAYOUT.cloudFloor + 5, 0), 0, 'flying', 20);
    let maxFade = 0;
    let respawnAt = -1;
    r.events.on('respawn', () => (respawnAt = r.t));
    r.run(3, () => {
      maxFade = Math.max(maxFade, r.player.fade);
    });
    expect(maxFade).toBeCloseTo(1, 2);
    expect(r.count('respawn')).toBe(1);
    expect(r.modes()).toEqual(['respawning', 'flying']);
    expect(r.player.fade).toBe(0);
    const rp = r.log.find((e) => e.type === 'respawn')!.payload as GameEvents['respawn'];
    expect(Math.hypot(rp.position.x - safe.x, rp.position.z - safe.z)).toBeLessThan(1);
    expect(rp.position.y - safe.y).toBeGreaterThan(P.respawnHeight);
    expect(rp.position.y - safe.y).toBeLessThan(P.respawnHeight + 5);
    expect(respawnAt).toBeGreaterThan(0.5);
    expect(r.player.controllable).toBe(true);
  });
});

describe('input handling', () => {
  it('tap-to-flap: one beat per press', () => {
    const r = rig('harrier', { holdToFlap: false });
    r.player.teleport(new Vector3(0, 900, 0), 0, 'flying', 24);
    const beats0 = r.player.model.beats;
    // Three short taps, a second apart, each held for 0.1 s.
    r.run(3, (inp, t) => (inp.flight.flap = t % 1 < 0.1 ? 1 : 0));
    expect(r.player.model.beats - beats0).toBe(3);
    // Holding the trigger in tap mode still gives just one beat.
    const b1 = r.player.model.beats;
    r.run(2, (inp) => (inp.flight.flap = 1));
    expect(r.player.model.beats - b1).toBe(1);
  });

  it('hold-to-flap: continuous beats while held', () => {
    const r = rig('harrier', { holdToFlap: true });
    r.player.teleport(new Vector3(0, 900, 0), 0, 'flying', 24);
    const beats0 = r.player.model.beats;
    r.run(2, (inp) => (inp.flight.flap = 1));
    expect(r.player.model.beats - beats0).toBeGreaterThanOrEqual(3);
  });

  it('a press is handled exactly once however many fixed steps a frame runs', () => {
    const r = rig();
    r.player.teleport(new Vector3(0, 250, 0), 0, 'landed');
    const inp = emptyFrame();
    inp.pressed.interact = true;
    // One rendered frame with three fixed steps.
    r.player.latchPresses(inp);
    for (let i = 0; i < 3; i++) r.player.fixedUpdate(DT, inp, 0);
    // A frame with no fixed step, then one with a step: the press is not lost.
    const r2 = rig();
    r2.player.teleport(new Vector3(0, 250, 0), 0, 'landed');
    r2.player.latchPresses(inp);
    r2.player.latchPresses(emptyFrame());
    r2.player.fixedUpdate(DT, emptyFrame(), 0);
    expect(r.player.mode).toBe('dismounting');
    expect(r2.player.mode).toBe('dismounting');
    expect(r.count('dismount')).toBe(1);
  });
});

describe('poses', () => {
  it('fills the wyvern and rider poses completely', () => {
    const r = rig();
    r.player.teleport(new Vector3(0, 400, 0), 0, 'flying', 24);
    r.run(1.5, (inp) => {
      inp.flight.flap = 1;
      inp.flight.roll = 0.6;
    });
    const w = r.player.wyvernPose;
    expect(w.airborne).toBe(true);
    expect(w.airspeed).toBeGreaterThan(10);
    expect(w.flapStrength).toBeGreaterThan(0.3);
    expect(w.lookTarget.distanceTo(w.position)).toBeGreaterThan(10);
    expect(w.angularVelocity.lengthSq()).toBeGreaterThan(0);
    const rp = r.player.riderPose;
    expect(rp.mounted).toBe(true);
    expect(rp.action).toBe('mounted');
    expect(rp.lean).toBeGreaterThan(0.1);
    expect(rp.airflow.length()).toBeGreaterThan(10);
    // Mid-frame interpolation lies between the last two physics positions.
    r.player.update(0, 0.5);
    const mid = r.player.wyvernPose.position.clone();
    expect(mid.distanceTo(r.player.prevPosition) + mid.distanceTo(r.player.position)).toBeCloseTo(r.player.prevPosition.distanceTo(r.player.position), 4);
  });

  it('the head leads into turns and watches the rider on foot', () => {
    const r = rig();
    r.player.teleport(new Vector3(0, 900, 0), 0, 'flying', 24);
    r.run(1, (inp) => (inp.flight.roll = 1));
    const w = r.player.wyvernPose;
    const toLook = w.lookTarget.clone().sub(w.position);
    const right = new Vector3(-1, 0, 0).applyQuaternion(w.orientation);
    expect(toLook.dot(right)).toBeGreaterThan(0);
    const r2 = rig();
    r2.player.teleport(new Vector3(0, 250, 30), 0, 'onFoot');
    r2.run(2);
    const head = r2.player.riderPosition.clone().add(new Vector3(0, 1.6, 0));
    expect(r2.player.wyvernPose.lookTarget.distanceTo(head)).toBeLessThan(1);
  });
});

describe('prompts', () => {
  it('suggests the right thing in each state', () => {
    const r = rig();
    r.player.placeAtSpawn();
    // The wyvern waits by the stable, 46 m away: a hint that you can call it.
    expect(computePrompt(r.player, LAYOUT)?.action).toBe('interact');
    r.player.teleport(new Vector3(LAYOUT.stable.x, 250, LAYOUT.stable.z + 5), 0, 'onFoot');
    // The wyvern stands 4.5 m away, so mounting wins over the stable door.
    expect(computePrompt(r.player, LAYOUT)?.action).toBe('mount');
    r.player.teleport(new Vector3(0, 250, 60), 0, 'landed');
    expect(computePrompt(r.player, LAYOUT)?.action).toBe('flap');
    r.run(2);
    expect(computePrompt(r.player, LAYOUT)?.action).toBe('dismount');
    const g = groundAt(0, -60);
    r.player.teleport(new Vector3(0, g.y + 12, -60), 0, 'flying', 20);
    r.run(2);
    expect(computePrompt(r.player, LAYOUT)?.action).toBe('flare');
    r.player.teleport(new Vector3(0, 900, 0), 0, 'flying', 13);
    // Hauled back below stall speed: the stall breaks about a second in.
    r.run(1.3, (inp) => (inp.flight.pitch = 1));
    expect(computePrompt(r.player, LAYOUT)?.text).toMatch(/Stalling/);
  });

  it('offers the stable door on foot away from the wyvern', () => {
    const r = rig();
    r.player.placeAtSpawn();
    // Walk the rider (not the wyvern) to the door.
    const st = LAYOUT.stable;
    r.player.foot.place(new Vector3(st.x, 260, st.z + 3), 0, terrain);
    r.run(DT);
    expect(r.player.wyvernDistance).toBeGreaterThan(P.mountRange);
    expect(computePrompt(r.player, LAYOUT)?.action).toBe('stable');
  });
});

describe('the rider on slopes', () => {
  // A synthetic ramp: flat for z < 0, then 50° up.
  const ramp: TerrainQuery = {
    groundAt: (_x, z) => {
      const steep = z > 0;
      const y = steep ? Math.tan((50 * Math.PI) / 180) * z : 0;
      const n = steep ? new Vector3(0, Math.cos((50 * Math.PI) / 180), -Math.sin((50 * Math.PI) / 180)) : new Vector3(0, 1, 0);
      return { y, normal: n, islandId: 0, surface: 'rock' };
    },
    collideSphere: () => false,
    distance: () => 100,
    raycast: () => null,
  };

  it('cannot walk up slopes steeper than ~40°', () => {
    const f = new RiderFoot();
    f.place(new Vector3(0, 0, -3), 0, ramp);
    for (let i = 0; i < 4 / DT; i++) f.step(DT, { moveX: 0, moveY: 1, sprint: true, jump: false }, 0, ramp);
    expect(f.position.y).toBeLessThan(0.6);
    expect(f.position.z).toBeLessThan(0.6);
  });
});

describe('robustness', () => {
  it('fuzz: random play never produces NaN or loses the player', () => {
    const rnd = mulberry32(99);
    for (const id of BREED_ORDER) {
      const r = rig(id, { wind: new Vector3(3, 0, 1) });
      r.player.placeAtSpawn();
      let cam = 0;
      r.run(40, (inp) => {
        if (rnd() < 0.02) cam = rnd() * Math.PI * 2;
        const f = inp.flight;
        f.pitch = rnd() * 2 - 1;
        f.roll = rnd() * 2 - 1;
        f.flap = rnd() < 0.3 ? 1 : 0;
        f.tuck = rnd() < 0.05 ? 1 : 0;
        f.flare = rnd() < 0.1 ? 1 : 0;
        inp.foot.moveX = rnd() * 2 - 1;
        inp.foot.moveY = rnd() * 0.5 + 0.5;
        inp.foot.sprint = rnd() < 0.5;
        inp.pressed.interact = rnd() < 0.01;
        inp.pressed.jump = rnd() < 0.02;
      }, cam);
      const all = [
        ...r.player.wyvernPose.position.toArray(),
        ...r.player.wyvernPose.orientation.toArray(),
        ...r.player.riderPose.position.toArray(),
        r.player.fade,
        r.player.flight.stamina,
      ];
      for (const v of all) expect(Number.isFinite(v), id).toBe(true);
      expect(r.player.wyvernPose.position.y, id).toBeGreaterThan(-200);
    }
  }, 30000);

  it('is deterministic for the same inputs', () => {
    const play = () => {
      const r = rig('skimmer');
      r.player.placeAtSpawn();
      const rnd = mulberry32(5);
      r.run(20, (inp) => {
        inp.flight.flap = rnd() < 0.5 ? 1 : 0;
        inp.flight.pitch = rnd() - 0.4;
        inp.foot.moveY = 1;
        inp.pressed.interact = rnd() < 0.01;
      }, 1);
      return [...r.player.position.toArray(), ...r.player.riderPosition.toArray(), r.player.mode];
    };
    expect(play()).toEqual(play());
  });
});
