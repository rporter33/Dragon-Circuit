// Settings: Graphics, Camera, Gameplay, Audio, Accessibility. Every change applies live through
// actions.applySettings, so you see (and hear) it while the menu is open.

import type { Settings } from '../core/types';
import type { GameView } from '../game/contracts';
import { QUALITY } from '../render/quality';
import { div, h } from './dom';
import { Dialog } from './Dialog';
import { Panel, hintBar, sheet, type UiCtx } from './panel';
import {
  SETTINGS_TABS,
  cycleChoice,
  qualityFacts,
  sliderFraction,
  sliderValueAt,
  stepSlider,
  toggleValue,
  type ChoiceRow,
  type SettingRow,
  type SliderRow,
  type ToggleRow,
} from './settingsModel';

const CHEV_L = '<svg viewBox="0 0 12 12"><path d="M8 1.5 L3 6 L8 10.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEV_R = '<svg viewBox="0 0 12 12"><path d="M4 1.5 L9 6 L4 10.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Builds the tab strip used by sheets: [LB] Tab Tab Tab [RB]. */
export function tabStrip(labels: string[], onPick: (i: number) => void): { el: HTMLElement; tabs: HTMLElement[] } {
  const tabs = labels.map((l, i) => {
    const t = h('div', { class: 'dw-tab', text: l });
    t.addEventListener('click', () => onPick(i));
    return t;
  });
  const el = div(
    'dw-tabs',
    h('span', { class: 'dw-hint-g', attrs: { 'data-glyph': 'tabPrev' } }),
    ...tabs,
    h('span', { class: 'dw-hint-g', attrs: { 'data-glyph': 'tabNext' } }),
  );
  return { el, tabs };
}

export class SettingsMenu extends Panel {
  private tab = 0;
  private tabs: HTMLElement[];
  private body: HTMLElement;
  /** Re-render functions for the visible rows (after a change or an external settings event). */
  private refreshers: (() => void)[] = [];
  /** The Quality row, which says "Applying…" while a quality change links its shaders. */
  private qualityRow: HTMLElement | null = null;
  private applying = false;

  constructor(ctx: UiCtx, initialTab = 0) {
    super(ctx, 'dw-settings');
    const s = sheet('Settings', 'Options');
    const strip = tabStrip(
      SETTINGS_TABS.map((t) => t.label),
      (i) => this.setTab(i, true),
    );
    s.head.append(strip.el);
    this.tabs = strip.tabs;
    this.body = s.body;
    s.foot.append(
      h('span', { class: 'dw-foot-note', text: 'Changes apply immediately and are saved.' }),
      hintBar([
        ['adjust', 'Adjust'],
        ['confirm', 'Toggle'],
        ['back', 'Back'],
      ]),
    );
    s.root.classList.add('dw-enter');
    this.root.append(s.root);
    this.setTab(initialTab, false);
    ctx.fillGlyphs(this.root);
  }

  override onTab(dir: -1 | 1): boolean {
    this.setTab((this.tab + dir + SETTINGS_TABS.length) % SETTINGS_TABS.length, true);
    return true;
  }

  override onShow(): void {
    for (const r of this.refreshers) r();
  }

  override update(_dt: number, view: GameView): void {
    const busy = !!view.renderer?.recompilingQuality;
    if (busy === this.applying) return;
    this.applying = busy;
    this.qualityRow?.classList.toggle('is-applying', busy);
  }

  private setTab(i: number, sound: boolean): void {
    if (sound && i !== this.tab) this.ctx.sound('tab');
    this.tab = i;
    this.tabs.forEach((t, j) => t.classList.toggle('is-active', j === i));
    this.body.replaceChildren();
    this.scope.clear();
    this.refreshers = [];
    this.qualityRow = null;
    this.applying = false;
    const rows = div('dw-rows');
    for (const row of SETTINGS_TABS[i].rows) rows.append(this.buildRow(row));
    this.body.append(rows);
    if (SETTINGS_TABS[i].id === 'graphics') this.body.append(this.qualityCard());
    this.body.scrollTop = 0;
    this.scope.focus(0, { scroll: false });
  }

  /** What the chosen quality level draws, so the choice means something. */
  private qualityCard(): HTMLElement {
    const title = h('div', { class: 'dw-group-title' });
    const grid = div('dw-qfacts');
    const card = div('dw-qcard', title, grid);
    const refresh = () => {
      const level = this.ctx.settings().quality;
      title.textContent = `AT ${level.toUpperCase()} THE DRIFT DRAWS`;
      grid.replaceChildren(...qualityFacts(QUALITY[level]).map((f) => div('dw-qfact', h('span', { text: f.label }), h('b', { text: f.value }))));
    };
    this.refreshers.push(refresh);
    refresh();
    return card;
  }

  private apply(patch: Partial<Settings>): void {
    this.ctx.applySettings(patch);
    for (const r of this.refreshers) r();
  }

  private buildRow(row: SettingRow): HTMLElement {
    const label = div('', h('div', { class: 'dw-row-label', text: row.label }), h('div', { class: 'dw-row-help', text: row.help }));
    const el = div('dw-row', label);
    if (row.kind === 'choice' && row.key === 'quality') {
      // New shaders take a moment to link; the view holds its last frame meanwhile.
      label.append(h('div', { class: 'dw-row-applying', text: 'Applying… the view catches up in a moment' }));
      this.qualityRow = el;
    }
    switch (row.kind) {
      case 'choice':
        this.choice(el, row);
        break;
      case 'slider':
        this.slider(el, row);
        break;
      case 'toggle':
        this.toggle(el, row);
        break;
      case 'action':
        if (row.id === 'replayTips') {
          el.append(div('dw-choice', h('span', { class: 'dw-choice-v', text: 'Replay' })));
          this.scope.add({
            el,
            activate: () => {
              const save = this.ctx.view.save;
              if (!save.data.tutorialDone && !(save.data.tips?.length ?? 0)) {
                this.ctx.sound('locked');
                return;
              }
              this.ctx.sound('select');
              save.data.tips = [];
              save.data.tutorialDone = false;
              save.save();
              if (!this.ctx.settings().showControlHints) this.apply({ showControlHints: true });
              this.ctx.events.emit('toast', { text: 'Tips will show again', sub: 'From your next steps in the Drift', icon: 'info' });
            },
          });
          break;
        }
        el.classList.add('dw-row--danger');
        el.append(div('dw-choice', h('span', { class: 'dw-choice-v', text: 'Erase…' })));
        this.scope.add({
          el,
          activate: () => {
            this.ctx.sound('select');
            this.ctx.push(
              new Dialog(this.ctx, 'Erase all progress?', 'Feathers, relics, medals, best times and unlocks will be forgotten. Your settings stay.', [
                { label: 'Keep progress', run: () => {}, cancel: true, primary: true },
                { label: 'Erase', run: () => this.ctx.actions.resetProgress() },
              ]),
            );
          },
        });
        break;
    }
    return el;
  }

  private choice(el: HTMLElement, row: ChoiceRow): void {
    const val = h('span', { class: 'dw-choice-v' });
    const l = h('span', { class: 'dw-chev', html: CHEV_L });
    const r = h('span', { class: 'dw-chev', html: CHEV_R });
    el.append(div('dw-choice', l, val, r));
    const key = row.key;
    const get = () => this.ctx.settings()[key];
    const set = (v: Settings[typeof key]) => this.apply({ [key]: v } as Partial<Settings>);
    const refresh = () => {
      const v = get();
      const i = row.options.findIndex((o) => o.value === v);
      val.textContent = row.options[i]?.label ?? String(v);
      l.classList.toggle('is-end', i <= 0);
      r.classList.toggle('is-end', i >= row.options.length - 1);
    };
    const step = (dir: -1 | 1, wrap: boolean) => {
      const next = cycleChoice(get(), row.options, dir, wrap);
      if (next === get()) {
        this.ctx.sound('locked');
        return;
      }
      this.ctx.sound('move');
      set(next);
    };
    l.addEventListener('click', (e) => {
      e.stopPropagation();
      step(-1, false);
    });
    r.addEventListener('click', (e) => {
      e.stopPropagation();
      step(1, false);
    });
    this.refreshers.push(refresh);
    refresh();
    this.scope.add({
      el,
      adjust: (dir) => {
        step(dir, false);
        return true;
      },
      activate: () => step(1, true),
    });
  }

  private slider(el: HTMLElement, row: SliderRow): void {
    const fill = div('dw-track-fill');
    const knob = div('dw-track-knob');
    const track = div('dw-track', fill, knob);
    const val = h('span', { class: 'dw-slider-v' });
    el.append(div('dw-slider', track, val));
    const get = () => this.ctx.settings()[row.key] as number;
    const set = (v: number) => {
      if (v === get()) return;
      this.apply({ [row.key]: v } as Partial<Settings>);
    };
    const refresh = () => {
      const v = get();
      const f = sliderFraction(v, row) * 100;
      fill.style.width = `${f}%`;
      knob.style.left = `${f}%`;
      val.textContent = row.format(v);
    };
    // Mouse: click or drag along the track.
    const fromPointer = (e: PointerEvent) => {
      const r = track.getBoundingClientRect();
      set(sliderValueAt((e.clientX - r.left) / Math.max(1, r.width), row));
    };
    track.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      track.setPointerCapture(e.pointerId);
      fromPointer(e);
      this.scope.focusEl(el, { scroll: false });
    });
    track.addEventListener('pointermove', (e) => {
      if (track.hasPointerCapture(e.pointerId)) fromPointer(e);
    });
    track.addEventListener('click', (e) => e.stopPropagation());
    this.refreshers.push(refresh);
    refresh();
    this.scope.add({
      el,
      adjust: (dir) => {
        const next = stepSlider(get(), row, dir);
        if (next === get()) this.ctx.sound('locked');
        else {
          this.ctx.sound('move');
          set(next);
        }
        return true;
      },
    });
  }

  private toggle(el: HTMLElement, row: ToggleRow): void {
    const sw = div('dw-switch');
    const val = h('span', { class: 'dw-toggle-v' });
    el.append(div('dw-toggle', val, sw));
    const get = () => toggleValue(this.ctx.settings(), row);
    const refresh = () => {
      const on = get();
      sw.classList.toggle('is-on', on);
      val.textContent = on ? 'On' : 'Off';
    };
    const flip = (to?: boolean) => {
      const next = to ?? !get();
      if (next === get()) return false;
      this.ctx.sound('select');
      this.apply({ [row.key]: next } as Partial<Settings>);
      return true;
    };
    this.refreshers.push(refresh);
    refresh();
    this.scope.add({
      el,
      activate: () => flip(),
      adjust: (dir) => {
        if (!flip(dir > 0)) this.ctx.sound('locked');
        return true;
      },
    });
  }
}
