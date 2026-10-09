import { it } from 'vitest';
import { Scene, Vector3 } from 'three';
import { LAYOUT } from '../../world/layout';
import { Terrain } from '../../world/terrain';
import { QUALITY } from '../../render/quality';
import { Dressing } from '../../world/dressing/Dressing';
import { BREEDS } from '../../flight/breeds';
import { FlightModel } from '../../flight/FlightModel';
import { OPEN_SKY, stillAir, yawQuat, neutralInput } from '../../flight/telemetry';
import { COURSES } from '../courses';
import { gateRing, RACE_START } from '../courseMath';
import { raceStartPosition } from '../flyCourse';

it('probe', () => {
  const terrain = new Terrain(LAYOUT);
  const dressing = new Dressing({ scene: new Scene(), terrain, quality: QUALITY.low, asyncStreaming: false });
  terrain.colliders.addSource('s', () => dressing.colliders);
  terrain.colliders.addSource('f', () => dressing.forest.colliders);
  console.log('decks', JSON.stringify(dressing.decks));
  const env = stillAir(OPEN_SKY);
  for (const id of Object.keys(BREEDS) as (keyof typeof BREEDS)[]) {
    const b = BREEDS[id];
    const m = new FlightModel(b);
    m.reset(new Vector3(0, 3000, 0), yawQuat(0), new Vector3(0, 0, RACE_START.speed));
    m.setGrace(1);
    const inp = neutralInput();
    let t = 0;
    const out: string[] = [];
    while (m.state.position.z < 200) {
      m.step(1 / 120, inp, env);
      t += 1 / 120;
      const z = m.state.position.z;
      for (const L of [80, 100, 120, 140, 160]) if (Math.abs(z - L) < 0.2 && !out.some((s) => s.startsWith(L + ':'))) out.push(`${L}:${(3000 - m.state.position.y).toFixed(1)}m@${t.toFixed(1)}s v${m.state.airspeed.toFixed(1)}`);
    }
    console.log(id, 'vCruise', m.derived.vCruise.toFixed(1), out.join(' | '));
  }
  for (const c of COURSES) {
    const g = gateRing(c);
    const s = raceStartPosition(c, new Vector3());
    const gnd = terrain.groundAt(s.x, s.z, s.y);
    console.log(c.id, 'gate', [g.cx, g.cy, g.cz].map(Math.round), 'yaw', (c.start.yaw * 180 / Math.PI).toFixed(1), 'start', s.toArray().map(Math.round), 'dist', terrain.distance(s).toFixed(1), 'aboveGround', gnd ? (s.y - gnd.y).toFixed(1) : null);
  }
});
