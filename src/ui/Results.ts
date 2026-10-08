// The results card after a race: the medal, your time, how it compares with your best, the
// medal targets, anything the run unlocked, and Retry / Continue.

import type { InputPresses, Medal } from '../core/types';
import type { RaceDef } from '../game/contracts';
import { div, fromHtml, h } from './dom';
import { formatDelta, formatTime, medalName, titleCase } from './format';
import { ICONS, RULE, medalIcon } from './icons';
import { Panel, hintBar, type UiCtx } from './panel';

export interface RaceResult {
  raceId: string;
  def: RaceDef | undefined;
  timeMs: number;
  medal: Medal;
  newBest: boolean;
  previousBestMs: number | null;
  /** Cosmetic names unlocked during this run. */
  unlocked: string[];
}

export class Results extends Panel {
  override hidesHud = true;

  constructor(
    ctx: UiCtx,
    readonly result: RaceResult,
    private onRetry: () => void,
    private onContinue: () => void,
  ) {
    super(ctx, 'dw-results-layer');
    const r = result;
    const name = r.def?.name ?? titleCase(r.raceId);
    const medalWrap = div(`dw-results-medal${r.medal === 'none' ? ' is-none' : ''}`, fromHtml(medalIcon(r.medal)));

    const facts = div('dw-results-facts');
    const best = r.newBest || r.previousBestMs === null ? r.timeMs : Math.min(r.timeMs, r.previousBestMs);
    facts.append(div('', h('b', { text: formatTime(best) }), h('span', { text: 'Best' })));
    if (r.previousBestMs !== null) {
      const d = r.timeMs - r.previousBestMs;
      facts.append(div('', h('b', { class: d <= 0 ? 'is-good' : 'is-bad', text: formatDelta(d) }), h('span', { text: r.newBest ? 'vs. old best' : 'vs. best' })));
    }

    const targets = div('dw-results-targets');
    if (r.def) {
      for (const m of ['gold', 'silver', 'bronze'] as const) {
        targets.append(h('span', {}, fromHtml(medalIcon(m)), formatTime(r.def.medals[m])));
      }
    }

    const card = div(
      'dw-panel dw-results dw-enter',
      h('div', { class: 'dw-kicker', text: r.def?.kind === 'sprint' ? 'SPRINT COMPLETE' : 'COURSE COMPLETE' }),
      h('div', { class: 'dw-results-name', text: name }),
      fromHtml(RULE),
      medalWrap,
      h('div', { class: 'dw-results-medalname', text: r.medal === 'none' ? 'NO MEDAL — KEEP AT IT' : `${medalName(r.medal).toUpperCase()} MEDAL` }),
      h('div', { class: 'dw-results-time', text: formatTime(r.timeMs) }),
      r.newBest && r.previousBestMs !== null ? h('div', { class: 'dw-newbest', text: 'NEW BEST' }) : r.previousBestMs === null ? h('div', { class: 'dw-newbest', text: 'FIRST RUN' }) : null,
      facts,
      targets,
    );
    if (r.unlocked.length > 0) {
      const ul = h('ul');
      for (const u of r.unlocked) ul.append(h('li', {}, fromHtml(ICONS.unlock), u));
      card.append(div('dw-results-unlocks', h('div', { class: 'dw-kicker', text: 'NEW IN THE STABLE' }), ul));
    }
    const retry = h('div', { class: 'dw-btn', html: '<span>Retry</span>' });
    const cont = h('div', { class: 'dw-btn', html: '<span>Continue</span>' });
    this.scope.add({ el: retry, activate: () => this.retry() });
    this.scope.add({ el: cont, activate: () => this.cont() });
    card.append(
      div('dw-results-btns', retry, cont),
      hintBar([
        ['confirm', 'Select'],
        ['restart', 'Retry'],
        ['back', 'Continue'],
      ]),
    );
    this.root.append(card);
    ctx.fillGlyphs(this.root);
    this.scope.focus(1, { scroll: false });
  }

  private retry(): void {
    this.ctx.sound('select');
    this.ctx.pop(this);
    this.onRetry();
  }

  private cont(): void {
    this.ctx.sound('select');
    this.ctx.pop(this);
    this.onContinue();
  }

  override input(p: InputPresses): void {
    if (p.restart) {
      this.retry();
      return;
    }
    super.input(p);
  }

  override onBack(): void {
    this.cont();
  }
}
