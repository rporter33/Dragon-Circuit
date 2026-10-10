import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { EventBus } from '../../core/events';
import type { BreedId, GameEvents, InputFrame } from '../../core/types';
import { BREEDS, BREED_ORDER } from '../../flight/breeds';
import { DEFAULT_SETTINGS } from '../../game/settings';
import { emptyFrame } from '../../input/Input';
import { Player } from '../../player/Player';
import { Terrain } from '../terrain';
import { LAYOUT } from '../layout';
import { WINDHAVEN_ORIGIN as O, windhavenColliders, windhavenPlan } from './windhavenPlan';
import { buildWindhaven } from './Windhaven';

function rig(breed: BreedId) {
  const terrain = new Terrain(LAYOUT);
  const colliders = windhavenColliders();
  terrain.colliders.addSource('windhaven', () => colliders);
  const events = new EventBus<GameEvents>();
  const player = new Player({ terrain, env: { terrain, windAt: (_p, out) => out.set(0, 0, 0) }, events, breed, settings: () => DEFAULT_SETTINGS });
  const run = (seconds: number, input?: (frame: InputFrame, step: number) => void, yaw = 0) => {
    for (let i = 0; i < Math.round(seconds * 120); i++) {
      const frame = emptyFrame();
      input?.(frame, i);
      player.latchPresses(frame);
      player.fixedUpdate(1 / 120, frame, yaw);
      player.update(1 / 120, 1);
    }
  };
  return { terrain, player, run, events };
}

describe('Windhaven stationary blockout', () => {
  it('renders each solid at exactly its collision position and size', () => {
    const parts = windhavenPlan();
    const view = buildWindhaven(parts);
    const colliders = windhavenColliders(parts);
    parts.forEach((p, i) => {
      const mesh = view.getObjectByName(p.id)!;
      expect(mesh).toBeDefined();
      const b = colliders[i];
      expect(mesh.position.clone().add(view.position).toArray()).toEqual([b.x, b.y, b.z]);
      expect(mesh.scale.toArray()).toEqual([b.hx * 2, b.hy * 2, b.hz * 2]);
    });
  });

  it('has continuous landing ground and unobstructed airspace for the largest wingspan', () => {
    const { terrain } = rig('galewing');
    const halfSpan = BREEDS.galewing.wingspan / 2;
    for (let x = -halfSpan; x <= halfSpan; x += 1) {
      for (let z = -34; z <= -12; z += 2) {
        expect(terrain.groundAt(O.x + x, O.z + z, O.y + 0.1)?.y).toBeCloseTo(O.y);
        // The flare envelope above the deck stays clear of rigid structures.
        expect(terrain.colliders.distance(new Vector3(O.x + x, O.y + 5, O.z + z), 2)).toBeGreaterThan(1);
      }
    }
    expect(terrain.groundAt(O.x + 15, O.z - 23, O.y + 0.1)?.y ?? -Infinity).toBeLessThan(O.y - 20);
  });

  for (const breed of BREED_ORDER) {
    for (const side of [-1, 1]) {
      it(`${breed}: lands from the ${side < 0 ? 'starboard' : 'port'} side and stops on deck`, () => {
        const { player, run, events } = rig(breed);
        let touchdowns = 0;
        events.on('touchdown', () => { touchdowns++; });
        player.teleport(new Vector3(O.x + side * 13, O.y + BREEDS[breed].standHeight + 0.6, O.z - 23), -side * Math.PI / 2, 'flying', 14);
        run(3, f => { f.flight.flare = 1; });
        expect(touchdowns).toBe(1);
        expect(player.mode).toBe('landed');
        expect(Math.abs(player.position.x - O.x)).toBeLessThan(13);
        expect(player.position.y).toBeCloseTo(O.y + BREEDS[breed].standHeight, 2);
      });
    }

    it(`${breed}: flares onto the terrace from flight and stops before the shelter`, () => {
      const { player, run, events } = rig(breed);
      let touchdowns = 0;
      events.on('touchdown', () => { touchdowns++; });
      player.teleport(new Vector3(O.x, O.y + BREEDS[breed].standHeight + 0.6, O.z - 34), 0, 'flying', 14);
      run(3, f => { f.flight.flare = 1; });
      expect(touchdowns).toBe(1);
      expect(player.mode).toBe('landed');
      expect(player.position.z).toBeGreaterThan(O.z - 36);
      expect(player.position.z).toBeLessThan(O.z - 10);
      expect(player.position.y).toBeCloseTo(O.y + BREEDS[breed].standHeight, 2);
    });

    it(`${breed}: stands, dismounts, remounts and launches off the stern`, () => {
      const { player, run } = rig(breed);
      player.teleport(new Vector3(O.x, O.y + 0.2, O.z - 23), Math.PI, 'landed');
      run(1);
      expect(player.mode).toBe('landed');
      expect(player.position.y).toBeCloseTo(O.y + BREEDS[breed].standHeight, 2);
      run(1.5, (f, i) => { f.pressed.interact = i === 0; });
      expect(player.mode).toBe('onFoot');
      expect(player.riderPosition.y).toBeCloseTo(O.y, 2);
      run(1.5, (f, i) => { f.pressed.interact = i === 0; });
      expect(player.mode).toBe('landed');
      run(5, (f, i) => { f.flight.flap = i < 12 ? 1 : 0; });
      expect(player.mode).toBe('flying');
      expect(player.position.z).toBeLessThan(O.z - 36);
      expect(player.position.y).toBeGreaterThan(O.y + BREEDS[breed].standHeight + 4);
    });

    it(`${breed}: can walk into the shelter from the terrace`, () => {
      const { player, run } = rig(breed);
      player.teleport(new Vector3(O.x, O.y + 0.2, O.z - 17), 0, 'landed');
      run(4, f => { f.foot.moveY = 1; });
      expect(player.mode).toBe('landed');
      expect(player.position.z).toBeGreaterThan(O.z - 10);
      expect(player.position.y).toBeCloseTo(O.y + BREEDS[breed].standHeight, 2);
    });
  }

  it('the rider can follow a side walkway past the shelter toward the workshops', () => {
    const { player, run } = rig('galewing');
    player.teleport(new Vector3(O.x + 9, O.y + 0.2, O.z - 15), 0, 'onFoot');
    run(4, f => { f.foot.moveY = 1; });
    expect(player.mode).toBe('onFoot');
    expect(player.riderPosition.z).toBeGreaterThan(O.z);
    expect(player.riderPosition.y).toBeCloseTo(O.y, 2);
  });
});
