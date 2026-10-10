import { Vector3 } from 'three';
import type { BreedId } from '../../core/types';
import { BREEDS, BREED_ORDER } from '../../flight/breeds';
import { BREED_DEFAULT_COLORS } from '../../cosmetics/catalog';
import { buildWindhaven, type WindhavenView } from '../../world/airship/Windhaven';
import type { Game } from '../../game/Game';
import { WINDHAVEN_ORIGIN as O, windhavenColliders, windhavenPlan } from '../../world/airship/windhavenPlan';
import type { Showcase } from '../showcase';

const ships = new WeakMap<Game, WindhavenView>();
const windhaven: Showcase = {
  name: 'windhaven',
  description: 'Stationary Windhaven blockout: &shipcam=overview|top|side|play &breed=galewing',
  setup(game, params) {
    const parts = windhavenPlan();
    const colliders = windhavenColliders(parts);
    game.world.terrain.colliders.addSource('windhaven', () => colliders);
    const ship = buildWindhaven(parts);
    ships.set(game, ship);
    game.scene.add(ship);
    game.debug.play = true;
    game.debug.tod ??= 0.42;
    game.debug.weather ??= 'clear';
    const requested = params.get('breed') as BreedId;
    let breed = BREED_ORDER.includes(requested) ? requested : 'galewing';
    const place = (mode: 'landed' | 'onFoot' = 'onFoot') => {
      game.previewWyvernLook({ ...game.save.data.wyvern, breed, ...BREED_DEFAULT_COLORS[breed] });
      game.player.teleport(new Vector3(O.x - (mode === 'onFoot' ? 4.5 : 0), O.y + 0.2, O.z - 23), mode === 'onFoot' ? 0 : Math.PI, mode);
    };
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.style.cssText = 'margin:8px 0;color:#c8e3eb';
    const cameras = {
      overview: [[52, 32, -58], [0, 5, 0]],
      top: [[0, 112, -0.1], [0, 0, 0]],
      side: [[88, 13, 0], [0, 5, 0]],
      cabin: [[16, 9, 11], [0, 3, 21]],
      windows: [[9, 2.4, 21.4], [0, 2.4, 21.4]],
      hitches: [[23, 5, -8], [13.35, 1, 3]],
    } as const;
    const camera = (name: string) => {
      const pose = cameras[name as keyof typeof cameras];
      game.debug.freeze = !!pose;
      status.textContent = pose ? 'Inspection paused — choose Walk deck to play.' : 'Live controls — WASD move, F mount/dismount, Space jump or launch.';
      game.cameraRig.setOverride(pose ? {
        position: new Vector3(...pose[0]).add(new Vector3(O.x, O.y, O.z)),
        target: new Vector3(...pose[1]).add(new Vector3(O.x, O.y, O.z)),
      } : null);
    };
    place();
    camera(params.get('shipcam') ?? 'overview');
    const panel = document.createElement('section');
    panel.setAttribute('aria-label', 'Windhaven review');
    panel.style.cssText = 'position:fixed;top:14px;left:14px;z-index:30;max-width:360px;padding:14px 16px;background:#142c3aeb;color:#f2e7cd;border:1px solid #bba074;border-radius:8px;font:14px/1.5 system-ui;pointer-events:auto';
    const title = document.createElement('strong');
    title.textContent = 'WINDHAVEN / traveling home — art study';
    const note = document.createElement('p');
    note.style.margin = '5px 0 10px';
    note.textContent = '72 m hull · 28 m working deck. A home for journeys between regions. Art preview: destination travel, crafting and stable services are still to come.';
    panel.append(title, note);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    const button = (label: string, action: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'border:1px solid #91a9b3;border-radius:4px;background:#244858;color:#fff3d8;padding:5px 8px;cursor:pointer';
      b.onclick = () => { action(); b.blur(); };
      row.append(b);
    };
    button('Overview', () => camera('overview'));
    button('Top', () => camera('top'));
    button('Side', () => camera('side'));
    button('Cabin', () => camera('cabin'));
    button('Windows', () => camera('windows'));
    button('Hitches', () => camera('hitches'));
    button('Clear wind', () => { game.debug.weather = 'clear'; game.weather.set('clear', true); });
    button('Breezy wind', () => { game.debug.weather = 'breezy'; game.weather.set('breezy', true); });
    const play = (mode: 'landed' | 'onFoot') => {
      place(mode);
      camera('play');
      if (game.screen === 'pause') game.resume();
    };
    button('Walk deck', () => play('onFoot'));
    button('Ride / take off', () => play('landed'));
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Review wyvern breed');
    select.style.cssText = 'margin-top:10px;background:#244858;color:#fff3d8;padding:5px;border-radius:4px';
    for (const id of BREED_ORDER) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = `${BREEDS[id].name} — ${BREEDS[id].wingspan} m wingspan`;
      option.selected = id === breed;
      select.append(option);
    }
    select.onchange = () => { breed = select.value as BreedId; place(); select.blur(); };
    const help = document.createElement('p');
    help.style.margin = '8px 0 0';
    help.textContent = 'Sails respond to live world wind, including in inspection views. Four hitch mounts reserve future attachment points. Drag to look around; Walk deck returns you to the terrace.';
    panel.append(row, status, select, help);
    document.body.append(panel);
  },
  update(game, dt) {
    // Keep review buttons reachable; the existing uncaptured drag camera still works.
    if (game.input.pointerLockWanted) game.input.setPointerLock(false);
    ships.get(game)?.updateCloth(game.screen === 'pause' ? 0 : dt, (p, out) => game.weather.windAt(p, out));
  },
};
export default windhaven;
