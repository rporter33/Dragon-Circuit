import type { Showcase } from '../showcase';
import { Stable } from '../../ui/Stable';
import { once, stageUi, type UiStage } from '../../ui/debug/stage';

/**
 * ?view=ui-stable&play=1&tab=N&focus=M — the Stable on a mid-game save (some looks unlocked,
 * some still locked with their requirements). tab: 0 Breed, 1 Colors, 2 Markings, 3 Horns &
 * Tail, 4 Saddle, 5 Rider, 6 Outfit, 7 Headgear, 8 Scarf & Cape. focus = item index in the tab.
 */
let stage: UiStage | null = null;
let params = new URLSearchParams();

const showcase: Showcase = {
  name: 'ui-stable',
  description: 'The Stable on a mid-game save: tab=0..8 focus=N device=gamepad|keyboard',
  setup(game, p) {
    params = p;
    stage = stageUi(game, p);
  },
  update(game, dt) {
    if (!stage) return;
    const s = stage;
    s.t += dt;
    once(s, 'open', s.t > 0.05, () => game.openStable());
    once(s, 'tab', s.t > 0.15, () => {
      const top = game.ui.topPanel;
      if (top instanceof Stable) top.selectTab(Number(params.get('tab') ?? 0));
    });
    const focus = params.get('focus');
    once(s, 'focus', s.t > 0.25 && focus !== null, () => game.ui.topPanel?.scope.focus(Number(focus), { scroll: true }));
  },
};

export default showcase;
