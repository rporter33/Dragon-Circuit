// Showcases: URL-selected setups for looking at one thing in isolation (?view=<name>).
// Any module can add one by dropping a file in src/debug/showcases/ that default-exports a
// Showcase — no shared file needs editing. Game calls setup() once and update() every frame
// after the player has posed (so a showcase may override poses, camera, time of day).
//
// The modules load lazily: main.ts calls loadShowcases() only when ?view= is present, so the
// production bundle's entry chunk carries none of them.

import type { Game } from '../game/Game';

export interface Showcase {
  name: string;
  /** One-line description listed by ?view=list in the console. */
  description: string;
  setup(game: Game, params: URLSearchParams): void;
  update?(game: Game, dt: number): void;
  /** Release only resources owned by this optional scene. */
  dispose?(game: Game): void;
}

const loaders = import.meta.glob<{ default: Showcase }>('./showcases/*.ts');

/** Showcases loaded so far (empty until loadShowcases() resolves). */
export const SHOWCASES: Showcase[] = [];

/** Load every showcase module (each is its own chunk). */
export async function loadShowcases(): Promise<Showcase[]> {
  const mods = await Promise.all(Object.values(loaders).map((load) => load()));
  SHOWCASES.length = 0;
  for (const m of mods) if (m.default) SHOWCASES.push(m.default);
  return SHOWCASES;
}

export function findShowcase(name: string | undefined): Showcase | null {
  if (!name) return null;
  if (name === 'list') {
    console.table(SHOWCASES.map((s) => ({ name: s.name, description: s.description })));
    return null;
  }
  const found = SHOWCASES.find((s) => s.name === name) ?? null;
  if (!found && !SHOWCASES.length) console.warn(`?view=${name}: showcases are not loaded (call loadShowcases() first)`);
  return found;
}
