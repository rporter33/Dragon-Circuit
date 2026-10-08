import { Color, DirectionalLight, HemisphereLight, Vector3 } from 'three';
import { globalUniforms } from '../../render/uniforms';
import type { Showcase } from '../showcase';
import type { Game } from '../../game/Game';
import { ROOST_LAUNCH_ANGLE } from '../../world/islandShape';

/**
 * ?view=terrain&spot=<name> — framed views of the archipelago's rock for art direction:
 *   cliff     along the Roost's rim toward the launch point (try tod=0.7)
 *   rim       Gull's Rest from just off its edge
 *   under     looking up at the Roost's underside from below
 *   spire     the Lantern Spire          needles   threading the Needles
 *   eye       the Eye of the Gale        broken    the broken ring by the Observatory
 *   archway   the Archway Reach          ground    standing on the Roost's courtyard
 *   moor      Highmoor's heather         grove     Glowcap Grove
 *   islet     a small rocky islet up close
 * Add &actors=1 to keep the wyvern and rider in frame.
 * &light=golden|night roughly emulates that lighting on top of whatever sky is installed, once at
 * setup (a full sky module overrides it every frame). For night, pair it with a high tod so the
 * key light (the moon) comes from above.
 */
const spots: Record<string, (game: Game) => { cam: Vector3; look: Vector3 }> = {
  cliff(game) {
    const roost = game.world.terrain.islands[0];
    const d = roost.def;
    const th = ROOST_LAUNCH_ANGLE + 0.32;
    const R = roost.outlineRadius(th);
    const cam = new Vector3(d.x + Math.cos(th) * (R + 26), d.y + 4, d.z + Math.sin(th) * (R + 26));
    const th2 = ROOST_LAUNCH_ANGLE - 0.15;
    const R2 = roost.outlineRadius(th2);
    const look = new Vector3(d.x + Math.cos(th2) * R2, d.y - 8, d.z + Math.sin(th2) * R2);
    return { cam, look };
  },
  rim(game) {
    const isl = game.world.terrain.islands.find((s) => s.def.landmark === 'gullrest')!;
    const d = isl.def;
    return { cam: new Vector3(d.x - 140, d.y + 10, d.z - 70), look: new Vector3(d.x, d.y - 20, d.z) };
  },
  under(game) {
    const d = game.world.terrain.islands[0].def;
    return { cam: new Vector3(d.x + 230, d.y - 230, d.z + 160), look: new Vector3(d.x, d.y - 90, d.z) };
  },
  spire(game) {
    const s = game.world.terrain.spires[0].def;
    return { cam: new Vector3(s.x + 330, s.topY - 160, s.z + 260), look: new Vector3(s.x, s.topY - 230, s.z) };
  },
  spiretop(game) {
    const s = game.world.terrain.spires[0].def;
    return { cam: new Vector3(s.x + 40, s.topY + 22, s.z + 32), look: new Vector3(s.x, s.topY - 6, s.z) };
  },
  needles(game) {
    const s = game.world.terrain.spires[1].def;
    return { cam: new Vector3(s.x - 180, 470, s.z + 260), look: new Vector3(s.x + 90, 420, s.z - 300) };
  },
  needle(game) {
    const s = game.world.terrain.spires[2].def;
    return { cam: new Vector3(s.x + 70, s.topY - 60, s.z + 50), look: new Vector3(s.x, s.topY - 110, s.z) };
  },
  eye(game) {
    const eye = game.world.terrain.arches.find((a) => a.def.landmark === 'eye')!;
    const cam = eye.center.clone().addScaledVector(eye.normal, -260).add(new Vector3(60, 25, 0));
    return { cam, look: eye.center.clone() };
  },
  eyeclose(game) {
    const eye = game.world.terrain.arches.find((a) => a.def.landmark === 'eye')!;
    const p = new Vector3();
    eye.pointAt(Math.PI * 0.3, p);
    const cam = p.clone().addScaledVector(eye.normal, -55).add(new Vector3(0, 12, 0));
    const look = new Vector3();
    eye.pointAt(Math.PI * 0.55, look);
    return { cam, look };
  },
  archclose(game) {
    const a = game.world.terrain.arches[0];
    const p = new Vector3();
    a.pointAt(Math.PI * 0.75, p);
    const cam = p.clone().addScaledVector(a.normal, 45).add(new Vector3(0, 5, 0));
    const look = new Vector3();
    a.pointAt(Math.PI * 0.95, look);
    return { cam, look };
  },
  brokenclose(game) {
    const a = game.world.terrain.arches.find((x) => !x.full && x.def.arcEnd > Math.PI * 1.2)!;
    const p = new Vector3();
    a.pointAt(a.def.arcEnd, p);
    const cam = p.clone().addScaledVector(a.normal, -30).addScaledVector(a.right, 18).add(new Vector3(0, 8, 0));
    return { cam, look: p };
  },
  broken(game) {
    const a = game.world.terrain.arches.find((x) => !x.full && x.def.arcEnd > Math.PI * 1.2)!;
    const cam = a.center.clone().addScaledVector(a.normal, -120).addScaledVector(a.right, 40).add(new Vector3(0, 20, 0));
    return { cam, look: a.center.clone() };
  },
  archway(game) {
    const isl = game.world.terrain.islands.find((s) => s.def.landmark === 'archway')!;
    const d = isl.def;
    return { cam: new Vector3(d.x + 120, d.y + 45, d.z + 90), look: new Vector3(d.x - 400, d.y + 30, d.z - 230) };
  },
  roost(game) {
    const d = game.world.terrain.islands[0].def;
    return { cam: new Vector3(d.x + 170, d.y + 120, d.z + 210), look: new Vector3(d.x + 10, d.y - 10, d.z - 10) };
  },
  launch(game) {
    const roost = game.world.terrain.islands[0];
    const t = roost.track!;
    const end = t[t.length - 1];
    const mid = t[3];
    return { cam: new Vector3(mid[0] - 25, roost.def.y + 14, mid[1] - 30), look: new Vector3(end[0], roost.def.y - 4, end[1]) };
  },
  crumbs(game) {
    const isl = game.world.terrain.islands.find((s) => s.def.landmark === 'gullrest')!;
    const d = isl.def;
    return { cam: new Vector3(d.x + 95, d.y - 25, d.z + 60), look: new Vector3(d.x, d.y - 40, d.z) };
  },
  far(game) {
    const d = game.world.terrain.islands[0].def;
    return { cam: new Vector3(d.x + 900, d.y + 150, d.z + 700), look: new Vector3(d.x, d.y - 40, d.z) };
  },
  ground(game) {
    const d = game.world.terrain.islands[0].def;
    return { cam: new Vector3(d.x + 55, d.y + 9, d.z + 60), look: new Vector3(d.x - 20, d.y + 1, d.z - 30) };
  },
  moor(game) {
    const d = game.world.terrain.islands.find((s) => s.def.landmark === 'highmoor')!.def;
    return { cam: new Vector3(d.x + 150, d.y + 70, d.z + 200), look: new Vector3(d.x - 20, d.y, d.z) };
  },
  cascade(game) {
    const d = game.world.terrain.islands.find((s) => s.def.landmark === 'cascade')!.def;
    return { cam: new Vector3(d.x - 330, d.y + 90, d.z + 260), look: new Vector3(d.x, d.y - 30, d.z) };
  },
  grove(game) {
    const d = game.world.terrain.islands.find((s) => s.def.landmark === 'glowcap')!.def;
    return { cam: new Vector3(d.x + 200, d.y + 60, d.z + 160), look: new Vector3(d.x, d.y - 10, d.z) };
  },
  islet(game) {
    const isl = game.world.terrain.islands.find((s) => s.def.kind === 'rocky' && s.def.radius < 60)!;
    const d = isl.def;
    return { cam: new Vector3(d.x + 90, d.y + 25, d.z + 70), look: new Vector3(d.x, d.y - 20, d.z) };
  },
};

let pose: { cam: Vector3; look: Vector3 } | null = null;

function emulateLight(game: Game, kind: string): void {
  const u = globalUniforms;
  const set = (key: Color, keyI: number, sky: string, ground: string, hemiI: number, fog: string, fogSun: string, zenith: string, horizon: string, night: number) => {
    game.scene.traverse((o) => {
      if (o instanceof DirectionalLight) {
        o.color.copy(key);
        o.intensity = keyI;
      } else if (o instanceof HemisphereLight) {
        o.color.set(sky);
        o.groundColor.set(ground);
        o.intensity = hemiI;
      }
    });
    u.uSunColor.value.copy(key).multiplyScalar(keyI / 2.6);
    u.uFogColor.value.set(fog);
    u.uFogSunColor.value.set(fogSun);
    u.uSkyZenith.value.set(zenith);
    u.uSkyHorizon.value.set(horizon);
    u.uNight.value = night;
  };
  if (kind === 'golden') set(new Color('#ffb070'), 2.4, '#9aa6cc', '#6a4a3a', 0.9, '#c9b8b8', '#ffb46a', '#5a78b0', '#f2c79a', 0);
  if (kind === 'night') set(new Color('#9fb4e8'), 0.7, '#34406a', '#1c1a26', 0.55, '#1d2740', '#2a3656', '#070b1c', '#1a2440', 1);
}

const terrain: Showcase = {
  name: 'terrain',
  description: 'Island, spire and arch views: &spot=cliff|rim|under|spire|spiretop|needles|needle|eye|eyeclose|broken|brokenclose|archway|archclose|roost|launch|crumbs|far|ground|moor|cascade|grove|islet',
  setup(game, params) {
    const spot = params.get('spot') ?? 'cliff';
    const fn = spots[spot] ?? spots.cliff;
    pose = fn(game);
    game.cameraRig.setOverride({ position: pose.cam, target: pose.look });
    const light = params.get('light');
    if (light) emulateLight(game, light);
    if (params.get('actors') !== '1') {
      game.wyvern.group.visible = false;
      game.rider.group.visible = false;
    }
  },
};

export default terrain;
