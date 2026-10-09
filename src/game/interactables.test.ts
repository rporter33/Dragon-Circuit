import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Interactables } from './interactables';
import type { Interactable } from './contracts';

const item = (id: string, x: number, z: number, radius = 3, extra: Partial<Interactable> = {}): Interactable => ({
  id,
  position: new Vector3(x, 100, z),
  radius,
  prompt: { action: 'interact', text: id },
  onInteract: () => {},
  ...extra,
});

describe('Interactables', () => {
  it('finds the nearest entry in reach, by horizontal distance', () => {
    const r = new Interactables();
    r.add(item('a', 0, 0));
    r.add(item('b', 2, 0));
    expect(r.nearest(new Vector3(1.6, 100, 0))?.id).toBe('b');
    expect(r.nearest(new Vector3(-1, 101, 0))?.id).toBe('a');
    expect(r.nearest(new Vector3(10, 100, 0))).toBeNull();
  });

  it('ignores entries far above or below, and disabled ones', () => {
    const r = new Interactables();
    let on = false;
    r.add(item('a', 0, 0, 3, { enabled: () => on }));
    expect(r.nearest(new Vector3(0, 100, 0))).toBeNull();
    on = true;
    expect(r.nearest(new Vector3(0, 100, 0))?.id).toBe('a');
    expect(r.nearest(new Vector3(0, 104, 0))).toBeNull();
  });

  it('re-adding an id replaces it; remove forgets it', () => {
    const r = new Interactables();
    r.add(item('a', 0, 0));
    r.add(item('a', 50, 0));
    expect(r.size).toBe(1);
    expect(r.nearest(new Vector3(0, 100, 0))).toBeNull();
    expect(r.nearest(new Vector3(50, 100, 0))?.id).toBe('a');
    r.remove('a');
    expect(r.size).toBe(0);
  });

  it('keeps each prompt object constant (the HUD reads it every frame)', () => {
    const r = new Interactables();
    const it = item('a', 0, 0);
    r.add(it);
    expect(r.nearest(new Vector3(0, 100, 0))?.prompt).toBe(it.prompt);
    expect(r.nearest(new Vector3(0.5, 100, 0))?.prompt).toBe(it.prompt);
  });
});
