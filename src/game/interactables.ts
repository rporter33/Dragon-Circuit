// Things the rider can walk up to and use on foot: read a Ventari inscription, talk to Quintus,
// inspect the Codex in the dock. Systems register them; Game shows the nearest one's prompt and
// calls it on interact. Mounting and the Stable keep their own prompts (see Game.updatePrompt).
//
// Per-frame cost is a scan over a handful of entries, with no allocation: positions are read
// through the entry, and each entry owns a constant prompt object.

import type { Vector3 } from 'three';
import type { Interactable, InteractableRegistry } from './contracts';

export class Interactables implements InteractableRegistry {
  private readonly items: Interactable[] = [];

  add(item: Interactable): void {
    this.remove(item.id);
    this.items.push(item);
  }

  remove(id: string): void {
    const i = this.items.findIndex((it) => it.id === id);
    if (i >= 0) this.items.splice(i, 1);
  }

  get size(): number {
    return this.items.length;
  }

  /** The closest enabled interactable whose reach contains `p` (horizontal distance, ±3 m in height), or null. */
  nearest(p: Vector3): Interactable | null {
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const it of this.items) {
      if (it.enabled && !it.enabled()) continue;
      const q = it.position;
      if (Math.abs(q.y - p.y) > 3) continue;
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > it.radius || d >= bestD) continue;
      best = it;
      bestD = d;
    }
    return best;
  }
}
