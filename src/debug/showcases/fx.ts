import { Color, DirectionalLight, HemisphereLight, Vector3 } from 'three';
import type { Showcase } from '../showcase';
import type { Game } from '../../game/Game';
import { globalUniforms } from '../../render/uniforms';
import { smoothstep } from '../../core/math';
import { islandByLandmark } from '../../world/layout';
import { launchDeckEnd } from '../../fx/Fx';

/**
 * ?view=fx&scene=<name> — stages the visual effects for review.
 *   dive      flying fast (pass steps input {"flight":{"tuck":1}}): speed lines, blur, trails
 *   turn      a hard banked pull (wingtip vortices from g)
 *   thermal   a thermal column seen from the side
 *   fireflies night on Gull's Rest
 *   ring      ring-pass bursts in front of a parked camera (one every &every= seconds)
 *   landing   a hard touchdown + takeoff wingbeats raising dust
 *   scrape    terrain hits against a cliff: dust, pebbles, sparks
 *   collect   feather and relic pickups
 *   leaves    the forest edge on Rootfall in a breeze
 *   gust      the launch-wind gust off the Roost's deck
 *   breath    on foot on cold Highmoor
 * The time of day defaults per scene (&tod= overrides). Event scenes re-emit on a timer so any
 * capture time shows the effect; &at0=1 emits once at setup instead.
 */

interface Stage {
  cam?: [number, number, number];
  look?: [number, number, number];
  tod: number;
  /** Re-emit this scene's events every `every` seconds (0 = never). */
  every: number;
  emit?: (game: Game, n: number) => void;
}

const _p = new Vector3();
const _n = new Vector3();

function ground(game: Game, x: number, z: number, above = 0): number {
  const g = game.world.terrain.groundAt(x, z, 1e6);
  return (g ? g.y : 0) + above;
}

function stage(game: Game, scene: string): Stage {
  const p = game.player;
  const park = () => p.teleport(new Vector3(0, 2600, 2700), 0, 'flying', 0);
  switch (scene) {
    case 'dive': {
      p.teleport(new Vector3(-150, 950, 120), (200 * Math.PI) / 180, 'flying', 72);
      return { tod: 0.38, every: 0 };
    }
    case 'turn': {
      p.teleport(new Vector3(-150, 700, 120), (160 * Math.PI) / 180, 'flying', 48);
      return { tod: 0.66, every: 0 };
    }
    case 'thermal': {
      park();
      const t = game.world.layout.thermals[1];
      const d = Number(new URLSearchParams(location.search).get('dist') ?? 420) / 420;
      return { cam: [t.x - 260 * d, 470, t.z - 330 * d], look: [t.x, 500, t.z], tod: 0.36, every: 0 };
    }
    case 'fireflies': {
      const g = islandByLandmark('gullrest')!;
      // Stand on the meadow so the swarm homes around the camera.
      p.teleport(new Vector3(g.x + 20, ground(game, g.x + 20, g.z + 30, 1), g.z + 30), Math.PI, 'onFoot');
      return { cam: [g.x - 18, ground(game, g.x - 18, g.z - 22, 2.2), g.z - 22], look: [g.x + 25, ground(game, g.x + 25, g.z + 18, 1.5), g.z + 18], tod: 0.95, every: 0 };
    }
    case 'ring': {
      park();
      const c: [number, number, number] = [0, 420, 380];
      return {
        cam: [c[0] + 14, c[1] + 3, c[2] - 34],
        look: [c[0], c[1], c[2]],
        tod: 0.42,
        every: 1.4,
        emit: (gm) => {
          // The burst plane faces the player's velocity; give it one through the ring.
          gm.player.flight.velocity.set(0, 0, 40);
          gm.events.emit('ringPassed', { raceId: 'fx', index: 3, total: 10, splitMs: 0, deltaMs: null, position: _p.set(c[0], c[1], c[2]).clone() });
        },
      };
    }
    case 'landing': {
      const x = -20;
      const z = 110;
      const y = ground(game, x, z);
      p.teleport(new Vector3(x, y + 3, z), Math.PI * 0.8, 'landed');
      return {
        cam: [x + 16, y + 4.5, z - 22],
        look: [x, y + 1.5, z],
        tod: 0.68,
        every: 2.2,
        emit: (gm, n) => {
          if (n % 2 === 0) {
            gm.events.emit('touchdown', { impact: 6, position: new Vector3(x, y, z), surface: 'grass' });
          } else {
            // Takeoff wingbeats close to the ground (dust rings).
            const pose = gm.player.wyvernPose;
            pose.groundY = y;
            gm.events.emit('flap', { strength: 1, position: new Vector3(x, y + 3, z) });
          }
        },
      };
    }
    case 'scrape': {
      park();
      const g = islandByLandmark('gullrest')!;
      const sh = game.world.terrain.islands.find((i) => i.def.id === g.id)!;
      const th = Math.PI * 1.1;
      const r = sh.outlineRadius(th);
      const px = g.x + Math.cos(th) * r;
      const pz = g.z + Math.sin(th) * r;
      const py = sh.topHeight(px - Math.cos(th) * 4, pz - Math.sin(th) * 4) - 6;
      return {
        cam: [px + Math.cos(th) * 30 + Math.sin(th) * 14, py + 6, pz + Math.sin(th) * 30 - Math.cos(th) * 14],
        look: [px, py, pz],
        tod: 0.55,
        every: 1.6,
        emit: (gm) => {
          gm.player.flight.velocity.set(-Math.sin(th) * 30, -4, Math.cos(th) * 30);
          gm.events.emit('terrainHit', { impulse: 13, point: new Vector3(px, py, pz), normal: _n.set(Math.cos(th), 0.2, Math.sin(th)).normalize().clone() });
        },
      };
    }
    case 'collect': {
      park();
      const c: [number, number, number] = [30, 300, 60];
      return {
        cam: [c[0] + 9, c[1] + 2, c[2] - 12],
        look: [c[0], c[1] + 1.2, c[2]],
        tod: 0.7,
        every: 1.6,
        emit: (gm, n) => {
          const relic = n % 2 === 1;
          gm.events.emit('collect', { id: 'fx', kind: relic ? 'relic' : 'feather', name: 'fx', position: new Vector3(relic ? c[0] - 2 : c[0] + 2, c[1], c[2]), total: 1, ofTotal: 10 });
        },
      };
    }
    case 'leaves': {
      const g = islandByLandmark('rootfall')!;
      const x = g.x - 120;
      const z = g.z - 60;
      p.teleport(new Vector3(x - 6, ground(game, x - 6, z - 8, 1), z - 8), 0, 'onFoot');
      return { cam: [x, ground(game, x, z, 2.4), z], look: [x + 18, ground(game, x + 18, z + 20, 3), z + 20], tod: 0.4, every: 0 };
    }
    case 'gust': {
      park();
      const d = launchDeckEnd(game.dressing.decks)!;
      const side = [d.dirZ, -d.dirX];
      return {
        cam: [d.x - d.dirX * 16 + side[0] * 14, d.y + 6, d.z - d.dirZ * 16 + side[1] * 14],
        look: [d.x + d.dirX * 10, d.y + 3, d.z + d.dirZ * 10],
        tod: 0.66,
        every: 0,
      };
    }
    case 'breath': {
      const g = islandByLandmark('highmoor')!;
      const x = g.x - 40;
      const z = g.z + 20;
      p.teleport(new Vector3(x, ground(game, x, z, 1), z), Math.PI / 2, 'onFoot');
      return { cam: [x + 2.5, ground(game, x + 2.5, z - 3, 1.9), z - 3], look: [x + 0.3, ground(game, x, z, 1.4), z], tod: 0.33, every: 0 };
    }
    default:
      return { tod: 0.4, every: 0 };
  }
}

let current: Stage = { tod: 0.4, every: 0 };
let timer = 0;
let count = 0;
let lights: { sun: DirectionalLight | null; hemi: HemisphereLight | null } = { sun: null, hemi: null };
const base = { sun: 0, hemi: 0 };

/** Stand-in night for the baseline sky (which only moves the sun); a real sky overrides it. */
function standInNight(game: Game): void {
  if (game.sky.night > 0.01) return;
  const t = game.sky.timeOfDay;
  const sunY = Math.sin((t - 0.25) * Math.PI * 2);
  const n = smoothstep(0.08, -0.18, sunY);
  const dusk = smoothstep(0.45, 0.05, sunY) * (1 - n);
  const u = globalUniforms;
  u.uNight.value = n;
  if (lights.sun) lights.sun.intensity = base.sun * (1 - n * 0.85);
  if (lights.hemi) lights.hemi.intensity = base.hemi * (1 - n * 0.72);
  u.uSunColor.value.set('#fff0dd').lerp(new Color('#ffb070'), dusk * 0.8).lerp(new Color('#8fa4e8'), n).multiplyScalar(1 - 0.6 * n);
  u.uSkyZenith.value.set('#3d73c7').lerp(new Color('#3a5fa8'), dusk).lerp(new Color('#0b1430'), n);
  u.uSkyHorizon.value.set('#bfd6eb').lerp(new Color('#f2b27a'), dusk).lerp(new Color('#24345c'), n);
  u.uFogColor.value.set('#aec7e6').lerp(new Color('#c9a9a0'), dusk * 0.6).lerp(new Color('#1b2747'), n);
  u.uFogSunColor.value.set('#ffd9a6').lerp(new Color('#ff9a55'), dusk).lerp(new Color('#2a3a66'), n);
}

const fx: Showcase = {
  name: 'fx',
  description: 'Visual effects staging (scene=dive|turn|thermal|fireflies|ring|landing|scrape|collect|leaves|gust|breath)',
  setup(game, params) {
    const scene = params.get('scene') ?? 'dive';
    current = stage(game, scene);
    if (game.debug.tod === undefined) game.debug.tod = current.tod;
    if (current.cam && current.look) {
      game.cameraRig.setOverride({ position: new Vector3(...current.cam), target: new Vector3(...current.look) });
    } else {
      game.cameraRig.snap(game.player);
    }
    const every = Number(params.get('every'));
    if (Number.isFinite(every) && every > 0) current.every = every;
    timer = params.get('at0') === '1' ? 0 : current.every - 0.05;
    count = 0;
    if (params.get('at0') === '1' && current.emit) {
      current.emit(game, count++);
      current.every = 0;
    }
    lights = { sun: null, hemi: null };
    game.scene.traverse((o) => {
      if (o instanceof DirectionalLight && !lights.sun) lights.sun = o;
      if (o instanceof HemisphereLight && !lights.hemi) lights.hemi = o;
    });
    base.sun = lights.sun?.intensity ?? 0;
    base.hemi = lights.hemi?.intensity ?? 0;
  },
  update(game, dt) {
    standInNight(game);
    if (current.every > 0 && current.emit) {
      timer += dt;
      if (timer >= current.every) {
        timer -= current.every;
        current.emit(game, count++);
      }
    }
  },
};

export default fx;
