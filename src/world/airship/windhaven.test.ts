import { describe, expect, it } from 'vitest';
import { InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
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
      const mesh = view.getObjectByName(`structure-${p.finish}`) as InstancedMesh;
      expect(mesh).toBeDefined();
      const index = (mesh.userData.partIds as string[]).indexOf(p.id);
      expect(index).toBeGreaterThanOrEqual(0);
      const matrix = new Matrix4(), position = new Vector3(), scale = new Vector3(), rotation = new Quaternion();
      mesh.getMatrixAt(index, matrix);
      matrix.decompose(position, rotation, scale);
      const b = colliders[i];
      position.add(view.position).toArray().forEach((v, axis) => expect(v).toBeCloseTo([b.x, b.y, b.z][axis], 4));
      scale.toArray().forEach((v, axis) => expect(v).toBeCloseTo([b.hx * 2, b.hy * 2, b.hz * 2][axis], 4));
      expect(rotation.y).toBeCloseTo(Math.sin(b.yaw / 2), 5);
    });
  });

  it('preserves the approved deck, shelter headroom and cabin doorway dimensions', () => {
    const parts = windhavenPlan();
    const deck = parts.filter(p => p.id.startsWith('deck-'));
    expect(deck).toHaveLength(36);
    deck.forEach(({ box: b }, i) => {
      const z = -35 + i * 2;
      expect(b).toEqual({ kind: 'box', x: 0, y: -0.4, z, hx: (z <= 15 ? 28 : Math.max(3, 28 - (z - 15) * 1.15)) / 2, hy: 0.4, hz: 1, yaw: 0, surface: 'wood' });
    });
    const roof = parts.find(p => p.id === 'shelter-roof')!.box;
    expect(roof.y - roof.hy).toBeCloseTo(9.6);
    const door = parts.filter(p => p.id.startsWith('cabin-door-'));
    door.forEach(p => expect(Math.abs(p.box.x) - p.box.hx).toBeCloseTo(1.6));
  });

  it('keeps decorative sails and fittings clear of the landing envelope with bounded geometry', () => {
    const view = buildWindhaven();
    let triangles = 0;
    let meshes = 0;
    view.traverse(object => {
      if (!(object instanceof Mesh)) return;
      meshes++;
      const positions = object.geometry.getAttribute('position');
      triangles += (object.geometry.index?.count ?? positions.count) / 3 * (object instanceof InstancedMesh ? object.count : 1);
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
        expect(Number.isFinite(x + y + z)).toBe(true);
        if (object.userData.visualOnly && Math.abs(x) < 10.25 && z < -11 && z > -34) expect(y).toBeLessThan(0.15);
      }
    });
    expect(meshes).toBeLessThanOrEqual(14);
    expect(triangles).toBeLessThan(80000);
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
