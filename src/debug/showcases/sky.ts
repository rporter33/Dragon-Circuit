import { Vector3 } from 'three';
import type { Game } from '../../game/Game';
import type { Showcase } from '../showcase';

/**
 * ?view=sky&shot=<name> — fixed vantage points for judging the sky, light, clouds and weather.
 * Combine with &tod= and &weather=. Shots that aim at the sun follow it as the day turns.
 *
 *   horizon  toward the sun across the cloud sea          antisun  away from the sun
 *   down     looking down onto the cloud sea              zenith   straight up (stars, cirrus)
 *   islands  wide view over the Roost toward Cascade      bank     a cumulus bank up close
 *   inside   inside that bank (the veil)                  skim     low over the cloud tops
 *   moon     toward the moon at night
 */
type ShotFn = (game: Game, out: { cam: Vector3; look: Vector3 }) => void;

const tmp = new Vector3();

function towardSun(game: Game, out: { cam: Vector3; look: Vector3 }, sign: number, pitch: number, height: number) {
  const s = game.sky.sunDirection;
  const h = Math.hypot(s.x, s.z) || 1;
  out.cam.set(-260, height, 420);
  out.look.set(out.cam.x + (sign * s.x) / h * 1000, out.cam.y + pitch * 1000, out.cam.z + (sign * s.z) / h * 1000);
}

/** The cloud bank nearest the Roost that is actually showing. */
function bankPose(game: Game, inside: boolean, out: { cam: Vector3; look: Vector3 }) {
  const f = (game.sky as unknown as { bankField: import('../../sky/cloudBankField').CloudBankField }).bankField;
  let best = -1;
  let bestD = Infinity;
  for (let b = 0; b < f.banks.length; b++) {
    if (f.bankAlpha[b] < 0.8) continue;
    const d = Math.hypot(f.bankPos[b * 3], f.bankPos[b * 3 + 2] - 600);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  if (best < 0) {
    out.cam.set(0, 400, 600);
    out.look.set(0, 380, 0);
    return;
  }
  const bank = f.banks[best];
  const c = tmp.set(f.bankPos[best * 3], f.bankPos[best * 3 + 1] + bank.height * 0.45, f.bankPos[best * 3 + 2]);
  if (inside) {
    out.cam.copy(c);
    out.look.set(c.x + 100, c.y, c.z + 30);
  } else {
    const s = game.sky.sunDirection;
    const h = Math.hypot(s.x, s.z) || 1;
    // Stand off at 3.5 bank widths, a little to the side of the sun line so the bank is half lit.
    const ang = Math.atan2(s.z / h, s.x / h) + 2.2;
    out.cam.set(c.x + Math.cos(ang) * bank.width * 3.5, c.y + bank.height * 0.4, c.z + Math.sin(ang) * bank.width * 3.5);
    out.look.copy(c);
  }
}

const SHOTS: Record<string, ShotFn> = {
  horizon: (g, o) => towardSun(g, o, 1, -0.12, 430),
  antisun: (g, o) => towardSun(g, o, -1, -0.12, 430),
  down: (g, o) => {
    o.cam.set(-260, 330, 420);
    o.look.set(-260 + 500, 0, 420 - 300);
  },
  zenith: (g, o) => {
    o.cam.set(0, 500, 0);
    o.look.set(1, 1500, 0.5);
  },
  islands: (g, o) => {
    o.cam.set(-420, 620, 760);
    o.look.set(300, 300, -300);
  },
  skim: (g, o) => {
    const s = g.sky.sunDirection;
    const h = Math.hypot(s.x, s.z) || 1;
    o.cam.set(-200, 75, 300);
    o.look.set(-200 + (s.x / h) * 1000, 40, 300 + (s.z / h) * 1000);
  },
  moon: (g, o) => {
    const m = g.sky.moonDirection;
    o.cam.set(-260, 430, 420);
    o.look.set(o.cam.x + m.x * 1000, o.cam.y + Math.max(0.15, m.y - 0.15) * 1000, o.cam.z + m.z * 1000);
  },
  bank: (g, o) => bankPose(g, false, o),
  inside: (g, o) => bankPose(g, true, o),
};

let shot: ShotFn = SHOTS.islands;
const pose = { cam: new Vector3(), look: new Vector3() };

const sky: Showcase = {
  name: 'sky',
  description: 'Sky/light/cloud review shots (&shot=horizon|antisun|down|zenith|islands|skim|moon|bank|inside)',
  setup(game, params) {
    shot = SHOTS[params.get('shot') ?? 'islands'] ?? SHOTS.islands;
    game.debug.freeze = params.get('freeze') !== '0';
    // Park the player well out of frame.
    game.player.teleport(new Vector3(0, 2600, 2700), 0, 'flying', 0);
  },
  update(game) {
    shot(game, pose);
    game.cameraRig.setOverride({ position: pose.cam, target: pose.look });
  },
};

export default sky;
