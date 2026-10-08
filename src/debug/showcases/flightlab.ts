import { Vector3 } from 'three';
import type { Showcase } from '../showcase';
import type { Game } from '../../game/Game';

/**
 * ?view=flightlab&scene=takeoff|dive|turn|landing|walkoff|fall|spawn&cam=side|chase|front|high
 *   [&breed=harrier|skimmer|galewing|ironback]
 *
 * Stages a flight/player scenario and tracks the wyvern with a fixed-offset camera, so screenshot
 * sequences (scripts/shot.mjs --steps) can show takeoffs, dives, turns and landings from a useful
 * angle. Input comes from the steps file (window.__dw.advance(seconds, input)).
 */

const _fwd = new Vector3();
const _right = new Vector3();
const _pos = new Vector3();
const _target = new Vector3();

let camMode = 'side';
let followRider = false;

function stage(game: Game, scene: string): void {
  const p = game.player;
  const t = game.world.terrain;
  const roost = t.islands.find((i) => i.def.landmark === 'roost')!;
  switch (scene) {
    case 'takeoff':
      p.teleport(new Vector3(0, 260, -60), 0, 'landed');
      break;
    case 'landing': {
      const g = t.groundAt(0, -90, 1e6)!;
      p.teleport(new Vector3(0, g.y + 14, -90), 0, 'flying', 21);
      break;
    }
    case 'dive':
      p.teleport(new Vector3(0, 620, -300), Math.PI, 'flying', 26);
      break;
    case 'turn':
      p.teleport(new Vector3(-200, 420, 200), Math.PI / 2, 'flying', 30);
      break;
    case 'walkoff': {
      // Mounted, a few meters from the Roost's south-east rim, facing out.
      const th = 0.6;
      const R = roost.outlineRadius(th) - 12;
      const x = Math.cos(th) * R;
      const z = Math.sin(th) * R;
      p.teleport(new Vector3(x, 300, z), Math.atan2(Math.cos(th), Math.sin(th)), 'landed');
      break;
    }
    case 'fall': {
      const th = 2.2;
      const R = roost.outlineRadius(th) - 5;
      const x = Math.cos(th) * R;
      const z = Math.sin(th) * R;
      p.teleport(new Vector3(x, 300, z), Math.atan2(Math.cos(th), Math.sin(th)), 'onFoot');
      followRider = true;
      break;
    }
    case 'spawn':
    default:
      followRider = true;
      break;
  }
}

const flightlab: Showcase = {
  name: 'flightlab',
  description: 'Flight/player scenarios with a tracking camera (scene=takeoff|dive|turn|landing|walkoff|fall|spawn)',
  setup(game, params) {
    const breed = params.get('breed');
    if (breed === 'harrier' || breed === 'skimmer' || breed === 'galewing' || breed === 'ironback') {
      game.setWyvernLook({ ...game.save.data.wyvern, breed });
    }
    camMode = params.get('cam') ?? 'side';
    followRider = false;
    stage(game, params.get('scene') ?? 'takeoff');
    game.cameraRig.snap(game.player);
  },
  update(game) {
    const w = game.player.wyvernPose;
    const focus = followRider && !game.player.riderPose.mounted ? game.player.riderPose.position : w.position;
    // Track heading (not roll/pitch) so the horizon stays readable.
    _fwd.set(0, 0, 1).applyQuaternion(w.orientation);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, 1);
    _fwd.normalize();
    _right.set(-_fwd.z, 0, _fwd.x);
    const span = game.player.breed.wingspan;
    switch (camMode) {
      case 'chase':
        _pos.copy(focus).addScaledVector(_fwd, -2.2 * span).add(new Vector3(0, 0.45 * span, 0));
        _target.copy(focus).addScaledVector(_fwd, span);
        break;
      case 'front':
        _pos.copy(focus).addScaledVector(_fwd, 1.8 * span).addScaledVector(_right, 0.6 * span).add(new Vector3(0, 0.25 * span, 0));
        _target.copy(focus);
        break;
      case 'high':
        _pos.copy(focus).addScaledVector(_right, 1.2 * span).addScaledVector(_fwd, -1.2 * span).add(new Vector3(0, 2.2 * span, 0));
        _target.copy(focus);
        break;
      case 'side':
      default:
        _pos.copy(focus).addScaledVector(_right, 2.2 * span).addScaledVector(_fwd, -0.4 * span).add(new Vector3(0, 0.3 * span, 0));
        _target.copy(focus).addScaledVector(_fwd, 0.3 * span);
        break;
    }
    game.cameraRig.setOverride({ position: _pos, target: _target });
  },
};

export default flightlab;
