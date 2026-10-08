// Races: every course with its difficulty, your medal and best time; the focused one's
// description, medal targets and a "Fly to start" that takes you to its gate.

import type { GameView, RaceDef } from '../game/contracts';
import { LAYOUT } from '../world/layout';
import { div, fromHtml, h } from './dom';
import { formatTime, medalName } from './format';
import { ICONS, medalIcon } from './icons';
import { Panel, hintBar, sheet, type UiCtx } from './panel';
import { MEDAL_RANK } from './format';

function difficulty(n: number): HTMLElement {
  const el = h('span', { class: 'dw-difficulty', attrs: { title: `Difficulty ${n} of 5` } });
  for (let i = 1; i <= 5; i++) el.append(h('i', { class: i <= n ? 'is-on' : '' }));
  return el;
}

function kindLabel(def: RaceDef): string {
  return def.kind === 'rings' ? `Ring course · ${def.rings.length} rings` : 'Sprint · point to point';
}

export class RacesMenu extends Panel {
  private detail: HTMLElement;
  private defs: RaceDef[];

  constructor(ctx: UiCtx) {
    super(ctx, 'dw-races-menu');
    const view = ctx.view;
    this.defs = view.races.defs;
    const s = sheet('Races', 'Courses of the Drift');
    s.body.classList.add('dw-has-split');
    const list = div('dw-list');
    this.detail = div('dw-detail');
    if (this.defs.length === 0) {
      s.body.append(div('dw-empty', fromHtml(ICONS.race), h('div', { text: 'No courses are charted yet. The race wardens are still hanging the rings.' })));
    } else {
      for (const def of this.defs) {
        const rec = view.save.data.races[def.id];
        const medal = rec?.medal ?? 'none';
        const card = div(
          'dw-card',
          div('dw-kind', fromHtml(def.kind === 'rings' ? ICONS.race : ICONS.arrow)),
          div('', h('div', { class: 'dw-card-name', text: def.name }), div('dw-card-sub', difficulty(def.difficulty), h('span', { text: def.kind === 'rings' ? `${def.rings.length} rings` : 'Sprint' }))),
          div('dw-card-right', h('span', { text: rec ? formatTime(rec.bestMs) : '—' }), fromHtml(medalIcon(medal))),
        );
        this.scope.add({
          el: card,
          onFocus: () => this.showDetail(def, view),
          activate: () => this.fly(def),
        });
        list.append(card);
      }
      s.body.append(div('dw-split', list, this.detail));
    }
    s.foot.append(
      h('span', { class: 'dw-foot-note', text: this.defs.length ? 'Fly through a course’s start gate to race it at any time.' : '' }),
      hintBar([
        ['confirm', 'Fly to start'],
        ['back', 'Back'],
      ]),
    );
    s.root.classList.add('dw-enter');
    this.root.append(s.root);
    ctx.fillGlyphs(this.root);
    if (this.defs.length) this.scope.focus(0, { scroll: false });
  }

  private fly(def: RaceDef): void {
    this.ctx.sound('select');
    this.ctx.actions.beginRace(def.id);
  }

  private showDetail(def: RaceDef, view: GameView): void {
    const rec = view.save.data.races[def.id];
    const best = rec?.medal ?? 'none';
    const landmark = LAYOUT.landmarks.find((l) => l.id === def.landmark);
    const table = div('dw-medal-table');
    for (const m of ['gold', 'silver', 'bronze'] as const) {
      const row = div(
        `dw-medal-row${MEDAL_RANK[best] >= MEDAL_RANK[m] ? ' is-earned' : ''}`,
        fromHtml(medalIcon(m)),
        h('span', { text: medalName(m) }),
        h('b', { text: formatTime(def.medals[m]) }),
      );
      table.append(row);
    }
    const facts = div(
      'dw-facts',
      h('span', { text: 'Best time' }),
      h('b', { text: rec ? formatTime(rec.bestMs) : 'Not yet flown' }),
      h('span', { text: 'Medal' }),
      h('b', { text: medalName(best) }),
      h('span', { text: 'Runs' }),
      h('b', { text: String(rec?.runs ?? 0) }),
    );
    if (rec) facts.append(h('span', { text: 'Ghost breed' }), h('b', { text: rec.breed[0].toUpperCase() + rec.breed.slice(1) }));
    const btn = h('div', { class: 'dw-btn', html: '<span class="dw-hint-g" data-glyph="confirm"></span><span>Fly to start</span>' });
    btn.addEventListener('click', () => this.fly(def));
    this.detail.replaceChildren(
      div('dw-kicker', h('span', { text: kindLabel(def).toUpperCase() })),
      h('div', { class: 'dw-detail-title', text: def.name }),
      div('dw-card-sub', difficulty(def.difficulty), h('span', { text: landmark ? `Starts near ${landmark.name}` : '' })),
      h('p', { text: def.description }),
      table,
      facts,
      btn,
    );
    this.ctx.fillGlyphs(this.detail);
  }
}
