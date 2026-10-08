// Persistence: one versioned JSON document in localStorage, ghosts in IndexedDB. (Baseline;
// the progression module owner adds migrations, ghost storage and unlock evaluation.)

import type { Medal } from '../core/types';
import type { GhostRecording, SaveData, SaveStore } from '../game/contracts';
import { DEFAULT_RIDER, DEFAULT_WYVERN, cosmeticById } from '../cosmetics/catalog';
import { DEFAULT_SETTINGS } from '../game/settings';

const KEY = 'driftwing.save.v1';

export function defaultSave(): SaveData {
  return {
    version: 1,
    wyvern: { ...DEFAULT_WYVERN },
    rider: { ...DEFAULT_RIDER },
    unlocked: [],
    collected: [],
    races: {},
    settings: { ...DEFAULT_SETTINGS },
    discovered: [],
    playTime: 0,
    tutorialDone: false,
  };
}

export class LocalSaveStore implements SaveStore {
  data: SaveData;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ghosts = new Map<string, GhostRecording>();

  constructor() {
    this.data = this.load();
  }

  private load(): SaveData {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultSave();
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      const base = defaultSave();
      return {
        ...base,
        ...parsed,
        wyvern: { ...base.wyvern, ...parsed.wyvern },
        rider: { ...base.rider, ...parsed.rider },
        settings: { ...base.settings, ...parsed.settings },
      };
    } catch {
      return defaultSave();
    }
  }

  save(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 500);
  }

  flush(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage full or blocked: play on without saving */
    }
  }

  reset(): void {
    const settings = this.data.settings;
    this.data = { ...defaultSave(), settings };
    this.flush();
  }

  async getGhost(raceId: string): Promise<GhostRecording | null> {
    return this.ghosts.get(raceId) ?? null;
  }

  async putGhost(ghost: GhostRecording): Promise<void> {
    this.ghosts.set(ghost.raceId, ghost);
  }

  isUnlocked(cosmeticId: string): boolean {
    const c = cosmeticById(cosmeticId);
    if (!c) return false;
    return c.unlock.type === 'default' || this.data.unlocked.includes(cosmeticId);
  }

  medalCount(medal: Exclude<Medal, 'none'>): number {
    const rank = { none: 0, bronze: 1, silver: 2, gold: 3 } as const;
    return Object.values(this.data.races).filter((r) => rank[r.medal] >= rank[medal]).length;
  }
}
