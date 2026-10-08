import { Vector3 } from 'three';
import type { Showcase } from '../showcase';
import type { PromptAction } from '../../game/contracts';
import { headingFromYaw } from '../../ui/compass';
import { once, stageUi, type UiStage } from '../../ui/debug/stage';

/**
 * ?view=ui-hud — the flight HUD on fake data. Combine with ?play=1&at=x,y,z&yaw=&mode=flying.
 *   device=gamepad|keyboard  pad=xbox|playstation   which glyphs prompts use
 *   prompt=flare|mount|stable|dismount|flap|tuck|interact   force a context prompt
 *   stamina=0.4  winded=1  stall=0.8                 force the flight state the HUD reads
 *   toast=1  discover=<landmarkId>  pointer=1        notifications, banner, "click to look around"
 *   race=armed|countdown|running|behind|missed|finish   race HUD phases (finish → results card)
 */
const PROMPTS: Record<string, string> = {
  flare: 'Flare to land',
  mount: 'Mount',
  stable: 'Open the Stable',
  dismount: 'Dismount',
  flap: 'Take off',
  tuck: 'Stalling — lower the nose to recover',
  interact: 'Call your wyvern',
};

let stage: UiStage | null = null;
let params = new URLSearchParams();
const tmp = new Vector3();

/** A point `dist` m away at `deg` degrees right of where the camera faces, `up` m higher. */
function aroundCamera(game: Parameters<NonNullable<Showcase['update']>>[0], deg: number, dist: number, up: number): Vector3 {
  const h = headingFromYaw(game.cameraRig.yaw) + (deg * Math.PI) / 180;
  return tmp.set(Math.sin(h) * dist, up, -Math.cos(h) * dist).add(game.player.position);
}

const showcase: Showcase = {
  name: 'ui-hud',
  description: 'HUD staging: device, prompt, stamina/winded/stall, toast, discover, pointer, race=armed|countdown|running|behind|missed|finish',
  setup(game, p) {
    params = p;
    stage = stageUi(game, p);
    const prompt = p.get('prompt') as PromptAction | null;
    if (prompt) {
      stage.patch.prompt = { action: prompt, text: PROMPTS[prompt] ?? prompt };
      game.ui.setDebugView(stage.patch);
    }
  },
  update(game, dt) {
    if (!stage) return;
    const s = stage;
    s.t += dt;
    const f = game.player.flight;
    if (params.has('stamina')) f.stamina = Number(params.get('stamina'));
    if (params.get('winded') === '1') {
      f.winded = true;
      f.stamina = Math.min(f.stamina, 0.18);
    }
    if (params.has('stall')) f.stall = Number(params.get('stall'));
    const ev = game.events;

    once(s, 'toast', params.get('toast') === '1' && s.t > 0.2, () => {
      ev.emit('collect', { id: 'feather-13', kind: 'feather', name: 'Under the eastern falls', position: new Vector3(), total: 13, ofTotal: 48 });
      ev.emit('unlock', { cosmeticId: 'dapple', name: 'Dapple', slot: 'wyvernPattern' });
      ev.emit('toast', { text: 'Controller connected', sub: 'Xbox Wireless Controller', icon: 'info' });
    });
    const disc = params.get('discover');
    once(s, 'discover', !!disc && s.t > 0.2, () => ev.emit('discover', { landmarkId: disc!, name: game.world.layout.landmarks.find((l) => l.id === disc)?.name ?? disc! }));

    const race = params.get('race');
    if (!race) return;
    const r = s.races;
    const id = 'cascade-run';
    once(s, 'race-setup', true, () => {
      if (race === 'armed') {
        ev.emit('raceArmed', { raceId: id });
        return;
      }
      r.activeId = id;
      r.bestMs = 101230;
      if (race === 'countdown') {
        r.state = 'countdown';
        ev.emit('raceArmed', { raceId: id });
        ev.emit('raceCountdown', { raceId: id, count: 3 });
        return;
      }
      r.state = 'running';
      r.elapsedMs = 47230;
      r.nextRingIndex = 6;
      ev.emit('raceStart', { raceId: id });
    });
    if (race === 'armed') r.target = aroundCamera(game, 8, 160, 10).clone();
    if (race === 'countdown') {
      once(s, 'count2', s.t > 1, () => ev.emit('raceCountdown', { raceId: id, count: 2 }));
    }
    if (race === 'running' || race === 'behind' || race === 'missed') {
      r.target = aroundCamera(game, race === 'missed' ? 150 : 62, 240, 15).clone();
      once(s, 'ring', s.t > 1.2, () => {
        ev.emit('ringPassed', { raceId: id, index: 5, total: 14, splitMs: 47000, deltaMs: race === 'behind' ? 1310 : -420, position: new Vector3() });
        if (race === 'missed') ev.emit('ringMissed', { raceId: id, index: 6 });
      });
    }
    if (race === 'finish') {
      r.state = 'running';
      r.elapsedMs = 98410;
      once(s, 'finish', s.t > 0.5, () => {
        ev.emit('unlock', { cosmeticId: 'fan', name: 'Cheek Fans', slot: 'wyvernFrill' });
        r.state = 'finished';
        ev.emit('raceFinish', { raceId: id, timeMs: 98410, medal: 'silver', newBest: true, previousBestMs: 101230 });
      });
    }
  },
};

export default showcase;
