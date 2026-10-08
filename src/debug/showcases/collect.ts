import { Vector3 } from 'three';
import type { Showcase } from '../showcase';
import type { Game } from '../../game/Game';

/**
 * ?view=collect&item=<id>[&dist=m][&az=deg][&el=deg] — look at one feather or relic from a few
 * meters away (default: feather-01 on the launch deck). The player is parked out of frame.
 * &item=list logs every collectible with its position and access.
 */
const showcase: Showcase = {
  name: 'collect',
  description: 'Feathers and relics close up: &item=feather-01|relic-charts|…',
  setup(game: Game, params: URLSearchParams) {
    const items = game.collectibles.items;
    if (params.get('item') === 'list') {
      console.table(items.map((c) => ({ id: c.id, where: c.where, access: c.access, x: c.position.x.toFixed(0), y: c.position.y.toFixed(1), z: c.position.z.toFixed(0) })));
      return;
    }
    const item = items.find((c) => c.id === (params.get('item') ?? 'feather-01')) ?? items[0];
    const dist = Number(params.get('dist') ?? (item.kind === 'relic' ? 5 : 4));
    const az = (Number(params.get('az') ?? 35) * Math.PI) / 180;
    const el = (Number(params.get('el') ?? 12) * Math.PI) / 180;
    const target = item.position.clone();
    const cam = target.clone().add(new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist));
    if (!params.has('cam')) game.cameraRig.setOverride({ position: cam, target });
    // Park the player well away so it isn't picked up.
    game.player.teleport(target.clone().add(new Vector3(0, 400, 0)), 0, 'flying', 0);
  },
};

export default showcase;
