// The player against the real Roost: its buildings, towers and trees (the dressing's colliders)
// and the launch deck, registered on the terrain's collider index exactly as Game does.

import { describe, expect, it } from 'vitest';
import { Scene, Vector3 } from 'three';
import { EventBus } from '../core/events';
import type { CylinderCollider, GameEvents, InputFrame, PlayerMode } from '../core/types';
import { emptyFrame } from '../input/Input';
import { DEFAULT_SETTINGS } from '../game/settings';
import { LAYOUT } from '../world/layout';
import { Terrain } from '../world/terrain';
import { deckCollider } from '../world/colliders';
import { QUALITY } from '../render/quality';
import { Dressing } from '../world/dressing/Dressing';
import { BREEDS } from '../flight/breeds';
import type { BreedId } from '../core/types';
import { Player } from './Player';
import { PLAYER_TUNING as P } from './tuning';

const SLOW = 120_000;
const DT = 1 / 120;

let world: { terrain: Terrain; dressing: Dressing } | null = null;
function roost() {
  if (world) return world;
  const terrain = new Terrain(LAYOUT);
  const dressing = new Dressing({ scene: new Scene(), terrain, quality: QUALITY.low, asyncStreaming: false });
  terrain.colliders.addSource('structures', () => dressing.colliders);
  terrain.colliders.addSource('forest', () => dressing.forest.colliders);
  const decks = dressing.decks.map(deckCollider);
  terrain.colliders.addSource('decks', () => decks);
  world = { terrain, dressing };
  return world;
}

function rig(breed: BreedId = 'harrier') {
  const { terrain } = roost();
  const events = new EventBus<GameEvents>();
  const player = new Player({ terrain, env: { windAt: (_p, o) => o.set(0, 0, 0), terrain }, events, breed, settings: () => DEFAULT_SETTINGS });
  const log: { type: keyof GameEvents; payload: unknown }[] = [];
  for (const type of ['modeChange', 'takeoff', 'fellOff', 'footstep', 'terrainHit'] as const) events.on(type, (payload) => log.push({ type, payload }));
  return {
    player,
    log,
    run(seconds: number, input?: (inp: InputFrame) => void, cameraYaw = 0, each?: () => void) {
      for (let i = 0; i < Math.round(seconds / DT); i++) {
        const inp = emptyFrame();
        input?.(inp);
        player.latchPresses(inp);
        player.fixedUpdate(DT, inp, cameraYaw);
        player.update(DT, 1);
        each?.();
      }
    },
    modes: () => log.filter((e) => e.type === 'modeChange').map((e) => (e.payload as { to: PlayerMode }).to),
  };
}

/** The tallest tower on the Roost: a solid cylinder from the dressing, standing on the ground. */
function tower(): CylinderCollider {
  const { dressing } = roost();
  const st = LAYOUT.stable;
  const towers = dressing.colliders.filter(
    (c): c is CylinderCollider => (c.kind === undefined || c.kind === 'cylinder') && !c.soft && Math.hypot(c.x - st.x, c.z - st.z) < 150 && c.y1 - c.y0 > 10,
  );
  return towers.sort((a, b) => b.y1 - b.y0 - (a.y1 - a.y0))[0];
}

describe('walls: buildings, towers and trunks', () => {
  it('the rider on foot cannot walk into a tower, and slides around it', () => {
    const tw = tower();
    const r = rig();
    // Start 14 m west of the tower, a little off its axis, walking due east (camera yaw +90°).
    // (Its east side has a crate against the plinth: a corner a rider rightly stops in.)
    r.player.teleport(new Vector3(tw.x - 14, tw.y0 + 20, tw.z + 1.5), Math.PI / 2, 'onFoot');
    expect(r.player.mode).toBe('onFoot');
    let closest = Infinity;
    r.run(9, (inp) => (inp.foot.moveY = 1), Math.PI / 2, () => {
      const p = r.player.riderPosition;
      closest = Math.min(closest, Math.hypot(p.x - tw.x, p.z - tw.z));
    });
    expect(closest).toBeGreaterThan(tw.radius + P.riderRadius - 0.05);
    // It went round: now east of the tower's center, not stuck on its face.
    expect(r.player.riderPosition.x).toBeGreaterThan(tw.x + 2);
  }, SLOW);

  it('the mounted wyvern cannot walk into a tower either', () => {
    const tw = tower();
    for (const breed of ['harrier', 'ironback'] as const) {
      const r = rig(breed);
      r.player.teleport(new Vector3(tw.x + 16, tw.y0 + 20, tw.z + 1), -Math.PI / 2, 'landed');
      expect(r.player.mode).toBe('landed');
      let closest = Infinity;
      r.run(8, (inp) => {
        inp.device = 'gamepad';
        inp.foot.moveY = 0.6;
      }, -Math.PI / 2, () => {
        const p = r.player.position;
        closest = Math.min(closest, Math.hypot(p.x - tw.x, p.z - tw.z));
      });
      expect(closest, breed).toBeGreaterThan(tw.radius + 0.3 * BREEDS[breed].standHeight);
    }
  }, SLOW);
});

describe('the launch deck (PLAY-01)', () => {
  /** A point on the deck's centerline `along` meters out from its root, at deck height. */
  function onDeck(along: number): { p: Vector3; yaw: number; deckY: number } {
    const d = roost().dressing.decks[0];
    return { p: new Vector3(d.x + Math.sin(d.yaw) * along, d.y + 1, d.z + Math.cos(d.yaw) * along), yaw: d.yaw, deckY: d.y };
  }

  it('the rider walks the whole deck on its planks, then off the end into a fall and a catch', () => {
    const d = roost().dressing.decks[0];
    const start = onDeck(1);
    const r = rig();
    r.player.teleport(start.p, start.yaw, 'onFoot');
    expect(r.player.riderPosition.y).toBeCloseTo(start.deckY, 2);
    let maxAlongOnDeck = 0;
    let worstGap = 0;
    r.run(9, (inp) => (inp.foot.moveY = 1), start.yaw, () => {
      if (r.player.mode !== 'onFoot' || !r.player.foot.grounded) return;
      const p = r.player.riderPosition;
      const along = (p.x - d.x) * Math.sin(d.yaw) + (p.z - d.z) * Math.cos(d.yaw);
      if (along < d.length - 0.5) {
        worstGap = Math.max(worstGap, Math.abs(p.y - d.y));
        maxAlongOnDeck = Math.max(maxAlongOnDeck, along);
      }
    });
    // On the planks the whole way (not sinking to the rock below), right to the end.
    expect(worstGap).toBeLessThan(0.05);
    expect(maxAlongOnDeck).toBeGreaterThan(d.length - 2);
    // Off the end: a fall, and the wyvern catches the rider.
    const fell = r.log.find((e) => e.type === 'fellOff');
    expect(fell).toBeDefined();
    const fp = (fell!.payload as GameEvents['fellOff']).position;
    const alongFell = (fp.x - d.x) * Math.sin(d.yaw) + (fp.z - d.z) * Math.cos(d.yaw);
    expect(alongFell).toBeGreaterThan(d.length - 1);
    expect(r.modes()).toContain('falling');
    r.run(2);
    expect(r.player.mode).toBe('flying');
  }, SLOW);

  it('the mounted wyvern runs the deck and launches off its end', () => {
    const d = roost().dressing.decks[0];
    const start = onDeck(0);
    const r = rig();
    r.player.teleport(start.p, start.yaw, 'landed');
    expect(r.player.mode).toBe('landed');
    expect(r.player.position.y - BREEDS.harrier.standHeight).toBeCloseTo(start.deckY, 2);
    r.run(8, (inp) => {
      inp.foot.moveY = 1;
      inp.foot.sprint = true;
    }, start.yaw);
    const to = r.log.find((e) => e.type === 'takeoff');
    expect(to).toBeDefined();
    const tp = (to!.payload as GameEvents['takeoff']).position;
    const along = (tp.x - d.x) * Math.sin(d.yaw) + (tp.z - d.z) * Math.cos(d.yaw);
    expect(along).toBeGreaterThan(d.length - 2);
    expect(r.player.mode).toBe('flying');
  }, SLOW);
});

describe('the Stable (PLAY-06)', () => {
  it('opening it brings a far-off wyvern to a clear stall beside the stable', () => {
    for (const breed of ['harrier', 'ironback'] as const) {
      const r = rig(breed);
      r.player.placeAtSpawn();
      const st = LAYOUT.stable;
      // The rider walks to the door; the wyvern still waits across the plaza.
      r.player.foot.place(new Vector3(st.x, 300, st.z + 4), 0, roost().terrain);
      r.run(1 / 120);
      expect(r.player.wyvernDistance).toBeGreaterThan(P.stableSettleRange);
      expect(r.player.settleAtStable(), breed).toBe(true);
      expect(r.player.wyvernDistance, breed).toBeLessThan(P.stableSettleRange + 2);
      // Standing on the plaza (not on a roof, not in a wall) and staying put.
      const p = r.player.position.clone();
      const g = roost().terrain.groundAt(p.x, p.z, p.y);
      expect(p.y - g!.y, breed).toBeCloseTo(BREEDS[breed].standHeight, 1);
      r.run(2);
      expect(r.player.position.distanceTo(p), breed).toBeLessThan(0.3);
      // Already close: nothing moves.
      expect(r.player.settleAtStable()).toBe(false);
    }
  }, SLOW);
});
