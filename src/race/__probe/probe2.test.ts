import { it } from 'vitest';
import { Scene, Vector3 } from 'three';
import { LAYOUT } from '../../world/layout';
import { Terrain } from '../../world/terrain';
import { QUALITY } from '../../render/quality';
import { Dressing } from '../../world/dressing/Dressing';
import { ClearanceField } from '../clearance';
import { COURSES } from '../courses';

it('probe', () => {
  const terrain = new Terrain(LAYOUT);
  const dressing = new Dressing({ scene: new Scene(), terrain, quality: QUALITY.low, asyncStreaming: false });
  terrain.colliders.addSource('s', () => dressing.colliders);
  terrain.colliders.addSource('f', () => dressing.forest.colliders);
  const field = new ClearanceField({ terrain, roots: dressing.rootPlan, falls: dressing.water.plansList });
  const loop = COURSES[0];
  const deckEnd = [154, 245, 97];
  const deckDir = [Math.sin(1.0102), Math.cos(1.0102)];
  const bearing = (a: number[], b: number[]) => (Math.atan2(b[0] - a[0], b[2] - a[2]) * 180) / Math.PI;
  const cands: { g: number[]; yaw: number; r0: number[] }[] = [];
  for (const [gx, gz] of [[270, 235], [260, 225], [280, 250], [250, 215]]) for (const gy of [228, 232]) for (const yaw of [22, 24, 26]) for (const r0 of [[390, 228, 320], [400, 228, 300], [380, 229, 330], [410, 227, 290]]) cands.push({ g: [gx, gy, gz], yaw, r0 });
  for (const c of cands) {
    const g = c.g;
    const gc = field.at(g[0], g[1], g[2]);
    const leg0 = field.along(g, c.r0, 3).min;
    const leg1 = field.along(c.r0, loop.rings[1].position, 3).min;
    const off = (g[0] - deckEnd[0]) * deckDir[1] - (g[2] - deckEnd[2]) * deckDir[0];
    const y = (c.yaw * Math.PI) / 180;
    const start = new Vector3(g[0] - Math.sin(y) * 140, g[1] + 15, g[2] - Math.cos(y) * 140);
    const sd = terrain.distance(start);
    const runup = field.along(start.toArray(), g, 4).min;
    const b0 = bearing(g, c.r0);
    const b1 = bearing(c.r0, loop.rings[1].position);
    const b2 = bearing(loop.rings[1].position, loop.rings[2].position);
    console.log(JSON.stringify(c), 'gateClr', gc.toFixed(0), 'leg0', leg0.toFixed(0), 'leg1', leg1.toFixed(0), 'deckOff', off.toFixed(0), 'startDist', sd.toFixed(0), 'runup', runup.toFixed(0), 'turns', (b0 - c.yaw).toFixed(0), (b1 - b0).toFixed(0), (b2 - b1).toFixed(0));
  }
  // The old line for reference.
  console.log('old ring1 bearing', bearing(loop.rings[0].position, loop.rings[1].position).toFixed(0), bearing(loop.start.position, loop.rings[0].position).toFixed(0));
  // Roost waterfall
  console.log(JSON.stringify(dressing.water.plansList.filter((w) => Math.hypot(w.lip.x, w.lip.z) < 400).map((w) => [w.lip.x, w.lip.y, w.lip.z].map(Math.round))));
}, 120000);
