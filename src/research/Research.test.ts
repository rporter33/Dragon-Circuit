import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { EventBus } from '../core/events';
import type { GameEvents } from '../core/types';
import { LocalSaveStore, MemoryGhostStore } from '../progression/save';
import { Research } from './Research';
import { shrineInteraction } from './firstLeadEncounter';
import { Interactables } from '../game/interactables';

describe('first shrine runtime', () => {
  it('registers in reach, shows the clue repeatedly, but rewards and raises ribs only once', () => {
    const bus = new EventBus<GameEvents>();
    const save = new LocalSaveStore({ storage: null, ghosts: new MemoryGhostStore(), debounceMs: 0 });
    new Research(save, bus);
    const rewards: number[] = [], stages: number[] = [];
    bus.on('researchEntry', (e) => rewards.push(e.points));
    bus.on('codexStage', (e) => stages.push(e.stage));
    let reads = 0;
    const entry = shrineInteraction({ id: 'gullrest-shrine', islandId: 1, x: 0, y: 0, z: 0, yaw: 0, radius: 7,
      inscription: { x: 0, y: 0, z: 4.5 } }, bus, () => reads++);
    const registry = new Interactables();
    registry.add(entry);
    expect(registry.nearest(new Vector3(0, 0, 6))).toBe(entry);
    expect(registry.nearest(new Vector3(0, 4, 6))).toBeNull();
    entry.onInteract();
    entry.onInteract();
    expect(reads).toBe(2);
    expect(rewards).toEqual([5, 10]);
    expect(stages).toEqual([1]);
    save.reset();
    entry.onInteract();
    expect(stages).toEqual([1, 1]);
    save.flush();
  });

  it('refreshes authoritative finds without emitting backfill rewards', () => {
    const bus = new EventBus<GameEvents>();
    const save = new LocalSaveStore({ storage: null, ghosts: new MemoryGhostStore() });
    const research = new Research(save, bus);
    save.data.collected.push('feather-01');
    research.refresh();
    expect(save.data.research?.points.nature).toBe(1);
    expect(save.data.research?.entries).toEqual([]);
  });
});
