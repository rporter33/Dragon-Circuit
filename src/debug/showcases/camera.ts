import type { Showcase } from '../showcase';
import type { PlayerMode } from '../../core/types';
import { applyStage, createStage, walkStage, type Stage } from '../../camera/debugStage';
import { STABLE_UI_FRACTION } from '../../camera/showRigs';

/**
 * ?view=cam&scene=foot|mounted|title|stable|fall|photo — stages the rider and wyvern at the Roost and lets
 * the camera rig frame them. Scripted foot input walks the rider (camera-relative), so the
 * on-foot auto-follow can be checked headless. scene=stable shades the left 40% where the
 * customization panel will sit (add focus=rider|wyvern|both to test setStableFocus).
 * Use ?play=1 for foot/mounted/stable, omit it for title.
 */
let stage: Stage | null = null;
let scene = 'foot';

const camera: Showcase = {
  name: 'cam',
  description: 'Camera rigs on staged poses: scene=foot|mounted|title|stable|fall|photo',
  setup(game, params) {
    scene = params.get('scene') ?? 'foot';
    const mode: PlayerMode = scene === 'mounted' ? 'landed' : 'onFoot';
    stage = createStage(game, mode);
    if (scene === 'fall') {
      // Walked off the Roost's southern rim, facing out: find where the ground ends.
      const t = game.world.terrain;
      let z = 100;
      let top = 250;
      for (; z < 400; z += 0.5) {
        const g = t.groundAt(0, z, 1e6);
        if (!g) break;
        top = g.y;
      }
      stage.rider.set(0, top, z - 5);
      stage.riderYaw = 0;
    }
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
    if (scene === 'foot' || scene === 'mounted' || scene === 'photo') walkStage(game, stage, dt);
    if (scene === 'photo') game.cameraRig.mode = 'photo';
    if (scene === 'fall') {
      // Run to the rim, then drop off it (no ground under the rider).
      const g = stage.mode === 'onFoot' ? game.world.terrain.groundAt(stage.rider.x, stage.rider.z, stage.rider.y + 1) : null;
      if (g && stage.rider.y - g.y < 0.5) {
        stage.riderVel.set(0, 0, 5);
        stage.rider.addScaledVector(stage.riderVel, dt);
        stage.rider.y = g.y;
      } else {
        stage.mode = 'falling';
        stage.riderVel.set(0, Math.max(-40, stage.riderVel.y - 9.81 * dt), 4);
        stage.rider.addScaledVector(stage.riderVel, dt);
      }
    }
    applyStage(game, stage);
  },
};

export default camera;
