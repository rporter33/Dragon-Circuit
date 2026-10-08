import type { Showcase } from '../showcase';
import { once, stageUi, type UiStage } from '../../ui/debug/stage';

/**
 * ?view=ui-menu&screen=... — menus on fake data (races, records, relics, discoveries).
 *   screen=title | titlemenu (no play=1)
 *   screen=pause | races | collection | settings | controls | credits | photo | results | quit (with play=1)
 *   tab=N      initial tab (settings, collection, controls)
 *   focus=N    focus the Nth item of the open screen
 *   device=gamepad|keyboard  pad=xbox|playstation
 */
let stage: UiStage | null = null;
let params = new URLSearchParams();

const showcase: Showcase = {
  name: 'ui-menu',
  description: 'Menus on fake data: screen=title|titlemenu|pause|races|collection|settings|controls|credits|photo|results|quit',
  setup(game, p) {
    params = p;
    stage = stageUi(game, p);
  },
  update(game, dt) {
    if (!stage) return;
    const s = stage;
    s.t += dt;
    const screen = params.get('screen') ?? 'pause';
    const ui = game.ui;
    const tab = Number(params.get('tab') ?? 0);
    const focus = params.get('focus');
    const sub: Record<string, Parameters<typeof ui.debugOpen>[0]> = {
      races: 'races', collection: 'collection', settings: 'settings', controls: 'controls', credits: 'credits', photo: 'photo',
    };

    if (screen === 'titlemenu') once(s, 'menu', s.t > 0.05, () => ui.debugOpen('titleMenu'));
    if (screen === 'results') {
      // A finished race: start, an unlock on the way, the finish line, then the card.
      once(s, 'start', s.t > 0.05, () => {
        s.races.activeId = 'roost-loop';
        s.races.state = 'running';
        game.events.emit('raceStart', { raceId: 'roost-loop' });
      });
      once(s, 'finish', s.t > 0.3, () => {
        game.events.emit('unlock', { cosmeticId: 'crown', name: 'Crown', slot: 'wyvernHorns' });
        game.events.emit('unlock', { cosmeticId: 'racer', name: 'Racing Suit', slot: 'riderOutfit' });
        s.races.state = 'finished';
        game.events.emit('raceFinish', { raceId: 'roost-loop', timeMs: 58420, medal: 'gold', newBest: true, previousBestMs: 59870 });
      });
      return;
    }
    if (screen === 'pause' || sub[screen] || screen === 'quit') {
      once(s, 'pause', s.t > 0.05, () => {
        // The quit dialog only asks when a race is running.
        if (screen === 'quit') {
          s.races.activeId = 'roost-loop';
          s.races.state = 'running';
        }
        game.pause();
      });
      once(s, 'sub', s.t > 0.15 && !!sub[screen], () => {
        ui.debugOpen(sub[screen], tab);
        if (tab && screen !== 'settings') for (let i = 0; i < tab; i++) ui.topPanel?.onTab(1);
      });
      once(s, 'quit', s.t > 0.15 && screen === 'quit', () => {
        const items = ui.topPanel?.scope.items ?? [];
        items[items.length - 1]?.activate?.();
      });
      once(s, 'focus', s.t > 0.25 && focus !== null, () => ui.topPanel?.scope.focus(Number(focus), { scroll: true }));
    }
  },
};

export default showcase;
