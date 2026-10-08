import type { Showcase } from '../showcase';
import type { PlayerMode } from '../../core/types';
import { applyStage, createStage, walkStage, type Stage } from '../../camera/debugStage';
import { STABLE_UI_FRACTION } from '../../camera/showRigs';

/**
 * ?view=cam&scene=foot|mounted|title|stable — stages the rider and wyvern at the Roost and lets
 * the camera rig frame them. Scripted foot input walks the rider (camera-relative), so the
 * on-foot auto-follow can be checked headless. scene=stable shades the left 40% where the
 * customization panel will sit (add focus=rider|wyvern|both to test setStableFocus).
 * Use ?play=1 for foot/mounted/stable, omit it for title.
 */
let stage: Stage | null = null;
let scene = 'foot';

const camera: Showcase = {
  name: 'cam',
  description: 'Camera rigs on staged poses: scene=foot|mounted|title|stable',
  setup(game, params) {
    scene = params.get('scene') ?? 'foot';
    const mode: PlayerMode = scene === 'mounted' ? 'landed' : 'onFoot';
    stage = createStage(game, mode);
    if (scene === 'mounted') stage.wyvernYaw = Math.PI * 0.75;
    if (scene === 'stable' && typeof document !== 'undefined') {
      const panel = document.createElement('div');
      panel.style.cssText =
        `position:fixed;left:0;top:0;bottom:0;width:${STABLE_UI_FRACTION * 100}%;pointer-events:none;z-index:5;` +
        'background:linear-gradient(90deg,rgba(18,22,36,.82),rgba(18,22,36,.7) 92%,rgba(18,22,36,0));' +
        'color:#e8dcc0;font:600 22px Georgia,serif;padding:48px 40px;box-sizing:border-box;letter-spacing:.06em';
      panel.textContent = 'THE STABLE (UI panel area)';
      document.body.appendChild(panel);
    }
  },
  update(game, dt) {
    if (!stage) return;
    if (scene === 'stable' && game.screen !== 'stable') {
      game.openStable();
      const focus = new URLSearchParams(location.search).get('focus');
      if (focus === 'rider' || focus === 'wyvern' || focus === 'both') game.cameraRig.setStableFocus(focus);
    }
    if (scene === 'foot' || scene === 'mounted') walkStage(game, stage, dt);
    applyStage(game, stage);
  },
};

export default camera;
