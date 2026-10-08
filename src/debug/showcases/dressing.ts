import { Color, DirectionalLight, HemisphereLight, Vector3 } from 'three';
import { globalUniforms } from '../../render/uniforms';
import { smoothstep } from '../../core/math';
import type { Showcase } from '../showcase';
import type { Game } from '../../game/Game';
import { islandByLandmark } from '../../world/layout';

/**
 * ?view=dressing&spot=<name> — fixed camera spots for reviewing world dressing.
 * Spots: roost, stable, deck, meadow, forest, cascade, cascadeBelow, rootfall, glowcap,
 * observatory, lantern, highmoor, overview. Add &tod= to override the spot's time of day.
 * The player is parked out of frame and the simulation frozen.
 */

interface Spot {
  cam: [number, number, number];
  look: [number, number, number];
  tod: number;
}

function ground(game: Game, x: number, z: number, above = 0): number {
  const g = game.world.terrain.groundAt(x, z, 1e6);
  return (g ? g.y : 0) + above;
}

function spots(game: Game): Record<string, () => Spot> {
  const L = (id: string) => islandByLandmark(id)!;
  return {
    roost: () => ({ cam: [26, ground(game, 26, 38, 1.7), 38], look: [-2, ground(game, 0, -30, 5), -30], tod: 0.4 }),
    stable: () => ({ cam: [-10, ground(game, -10, -2, 1.7), -2], look: [2, ground(game, 0, -30, 4), -30], tod: 0.4 }),
    deck: () => {
      const a = (37 * Math.PI) / 180;
      const b = a + 0.32;
      return { cam: [Math.cos(b) * 225, ground(game, 0, 0, 2), Math.sin(b) * 225], look: [Math.cos(a) * 170, ground(game, 0, 0, -6), Math.sin(a) * 170], tod: 0.42 };
    },
    meadow: () => {
      const g = L('gullrest');
      return { cam: [g.x - 30, ground(game, g.x - 30, g.z - 20, 1.6), g.z - 20], look: [g.x + 20, ground(game, g.x + 20, g.z + 15, 1), g.z + 15], tod: 0.71 };
    },
    forest: () => {
      const g = L('rootfall');
      return { cam: [g.x - 260, g.y + 70, g.z - 160], look: [g.x, g.y + 10, g.z], tod: 0.38 };
    },
    forestFloor: () => {
      const g = L('rootfall');
      return { cam: [g.x + 20, ground(game, g.x + 20, g.z - 40, 1.7), g.z - 40], look: [g.x + 40, ground(game, g.x + 40, g.z + 10, 6), g.z + 10], tod: 0.4 };
    },
    cascade: () => {
      const g = L('cascade');
      return { cam: [g.x - 300, g.y - 60, g.z + 420], look: [g.x, g.y - 120, g.z], tod: 0.36 };
    },
    cascadeBelow: () => {
      const g = L('cascade');
      return { cam: [g.x - 120, g.y - 380, g.z + 300], look: [g.x, g.y - 100, g.z], tod: 0.4 };
    },
    rootfall: () => {
      const g = L('rootfall');
      return { cam: [g.x - 120, g.y - 330, g.z - 260], look: [g.x, g.y - 220, g.z], tod: 0.4 };
    },
    glowcap: () => {
      const g = L('glowcap');
      return { cam: [g.x - 70, ground(game, g.x - 70, g.z + 40, 5), g.z + 40], look: [g.x, ground(game, g.x, g.z, 10), g.z], tod: 0.96 };
    },
    observatory: () => {
      const g = L('observatory');
      return { cam: [g.x + 45, ground(game, g.x, g.z, 14), g.z + 50], look: [g.x, ground(game, g.x, g.z, 8), g.z], tod: 0.66 };
    },
    lantern: () => {
      const s = game.world.layout.spires.find((sp) => sp.lantern)!;
      return { cam: [s.x + 700, s.topY - 60, s.z - 900], look: [s.x, s.topY, s.z], tod: 0.95 };
    },
    highmoor: () => {
      const g = L('highmoor');
      return { cam: [g.x - 60, ground(game, g.x - 60, g.z + 30, 2), g.z + 30], look: [g.x + 40, ground(game, g.x + 40, g.z - 10, 3), g.z - 10], tod: 0.68 };
    },
    overview: () => ({ cam: [-260, 420, 300], look: [0, 240, 0], tod: 0.42 }),
  };
}

let current: Spot | null = null;
let lights: { sun: DirectionalLight | null; hemi: HemisphereLight | null } = { sun: null, hemi: null };
const base = { sun: 0, hemi: 0, sunColor: new Color(), hemiSky: new Color(), hemiGround: new Color() };

/**
 * Stand-in for the sky module's night: the baseline sky only moves the sun, so this showcase dims
 * the lights and sets uNight / sky / fog colors itself. A real sky overwrites these each frame.
 */
function applyNight(game: Game): void {
  const t = game.sky.timeOfDay;
  const sunY = Math.sin((t - 0.25) * Math.PI * 2);
  const n = smoothstep(0.08, -0.18, sunY);
  const dusk = smoothstep(0.45, 0.05, sunY) * (1 - n);
  const u = globalUniforms;
  u.uNight.value = n;
  if (lights.sun) {
    lights.sun.intensity = base.sun * (1 - n * 0.85);
    lights.sun.color.copy(base.sunColor).lerp(new Color('#ffb070'), dusk * 0.8).lerp(new Color('#9fb4ff'), n);
  }
  if (lights.hemi) {
    lights.hemi.intensity = base.hemi * (1 - n * 0.72);
    lights.hemi.color.copy(base.hemiSky).lerp(new Color('#2c3c6e'), n);
    lights.hemi.groundColor.copy(base.hemiGround).lerp(new Color('#1c1a24'), n);
  }
  u.uSunColor.value.set('#fff0dd').lerp(new Color('#ffb070'), dusk * 0.8).lerp(new Color('#8fa4e8'), n).multiplyScalar(1 - 0.6 * n);
  u.uSkyZenith.value.set('#3d73c7').lerp(new Color('#3a5fa8'), dusk).lerp(new Color('#0b1430'), n);
  u.uSkyHorizon.value.set('#bfd6eb').lerp(new Color('#f2b27a'), dusk).lerp(new Color('#24345c'), n);
  u.uFogColor.value.set('#aec7e6').lerp(new Color('#c9a9a0'), dusk * 0.6).lerp(new Color('#1b2747'), n);
  u.uFogSunColor.value.set('#ffd9a6').lerp(new Color('#ff9a55'), dusk).lerp(new Color('#2a3a66'), n);
}

const dressing: Showcase = {
  name: 'dressing',
  description: 'World dressing review spots (&spot=roost|stable|meadow|forest|cascade|cascadeBelow|rootfall|glowcap|observatory|lantern|highmoor)',
  setup(game, params) {
    const all = spots(game);
    const name = params.get('spot') ?? 'roost';
    const make = all[name] ?? all.roost;
    current = make();
    if (game.debug.tod === undefined) game.debug.tod = current.tod;
    game.debug.freeze = params.get('freeze') !== '0';
    // Park the player well out of frame.
    game.player.teleport(new Vector3(0, 2600, 2700), 0, 'flying', 0);
    // Explicit ?cam=&look= wins over the spot's camera.
    const cam = game.debug.cam ?? current.cam;
    const look = game.debug.cam && game.debug.look ? game.debug.look : current.look;
    game.cameraRig.setOverride({ position: new Vector3(...cam), target: new Vector3(...look) });
    lights = { sun: null, hemi: null };
    game.scene.traverse((o) => {
      if (o instanceof DirectionalLight && !lights.sun) lights.sun = o;
      if (o instanceof HemisphereLight && !lights.hemi) lights.hemi = o;
    });
    if (lights.sun) {
      base.sun = lights.sun.intensity;
      base.sunColor.copy(lights.sun.color);
    }
    if (lights.hemi) {
      base.hemi = lights.hemi.intensity;
      base.hemiSky.copy(lights.hemi.color);
      base.hemiGround.copy(lights.hemi.groundColor);
    }
  },
  update(game) {
    if (new URLSearchParams(location.search).get('sky') !== 'native') applyNight(game);
  },
};

export default dressing;
