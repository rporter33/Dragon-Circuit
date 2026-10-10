import type { GameEventBus } from '../core/events';
import type { SaveStore } from '../game/contracts';
import { CODEX_STAGES } from './registry';
import { airshipStage, recordResearch, researchState } from './state';

/** M1 runtime: only approved survey entries; existing finds are derived without duplicate rewards. */
export class Research {
  constructor(private save: SaveStore, private events: GameEventBus) {
    events.on('survey', (e) => {
      // WP2 exposes only the first site. The state model also supports the later second site.
      if (e.siteId !== 'gullrest-shrine') return;
      this.record(`survey:${e.siteId}:${e.part}`);
    });
    events.on('collect', () => this.refresh());
    events.on('discover', () => this.refresh());
    this.refresh();
  }

  refresh(): void {
    this.save.data.research = researchState(this.save.data.research, this.save.data);
  }

  private record(id: string): void {
    const before = airshipStage(this.save.data.research);
    const result = recordResearch(this.save.data.research, this.save.data, id);
    this.save.data.research = result.state;
    if (!result.event) return;
    this.save.save();
    this.events.emit('researchEntry', result.event);
    const stage = airshipStage(result.state);
    if (stage !== before) this.events.emit('codexStage', CODEX_STAGES[stage]);
  }
}
