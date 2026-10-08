// Showcases: URL-selected setups for looking at one thing in isolation (?view=<name>).
// Any module can add one by dropping a file in src/debug/showcases/ that default-exports a
// Showcase — no shared file needs editing. Game calls setup() once and update() every frame
// after the player has posed (so a showcase may override poses, camera, time of day).

import type { Game } from '../game/Game';

export interface Showcase {
  name: string;
  /** One-line description listed by ?view=list in the console. */
  description: string;
  setup(game: Game, params: URLSearchParams): void;
  update?(game: Game, dt: number): void;
}

const modules = import.meta.glob<{ default: Showcase }>('./showcases/*.ts', { eager: true });

export const SHOWCASES: Showcase[] = Object.values(modules)
  .map((m) => m.default)
  .filter(Boolean);

export function findShowcase(name: string | undefined): Showcase | null {
  if (!name) return null;
  if (name === 'list') {
    console.table(SHOWCASES.map((s) => ({ name: s.name, description: s.description })));
    return null;
  }
  return SHOWCASES.find((s) => s.name === name) ?? null;
}
