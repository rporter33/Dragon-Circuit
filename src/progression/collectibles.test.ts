// Every collectible is somewhere a player can actually get to: not inside rock, a building, a
// tree trunk or a stream; ground ones on walkable ground; air ones with room for a wyvern to
// fly within pickup range. Checked against the real terrain and dressing at high quality (the
// most trees).

import { describe, expect, it } from 'vitest';
import { Scene, Vector3 } from 'three';
import { LAYOUT } from '../world/layout';
import { Terrain } from '../world/terrain';
import { QUALITY } from '../render/quality';
import { Dressing } from '../world/dressing/Dressing';
import { COSMETICS } from '../cosmetics/catalog';
import { ClearanceField } from '../race/clearance';
import { COLLECTIBLE_SPECS, placeCollectibles } from './collectibleDefs';
import { FEATHER_COUNT, RELICS, isCollectibleId } from './relics';
import { PICKUP_RADIUS } from './Collectibles';

const terrain = new Terrain(LAYOUT);
const dressing = new Dressing({ scene: new Scene(), terrain, quality: QUALITY.high, asyncStreaming: false });
const field = new ClearanceField({ terrain, roots: dressing.rootPlan, falls: dressing.water.plansList });
const items = placeCollectibles({ terrain, deckAt: (x, z, y) => dressing.deckAt(x, z, y) });

function streamDistance(x: number, z: number): number {
  let best = Infinity;
  for (const w of dressing.water.plansList) for (const q of w.stream) best = Math.min(best, Math.hypot(q.x - x, q.z - z) - q.w);
  return best;
}

function colliderDistance(p: Vector3): number {
  let best = Infinity;
  for (const c of dressing.colliders) {
    if (p.y < c.y0 - 1 || p.y > c.y1 + 2) continue;
    best = Math.min(best, Math.hypot(c.x - p.x, c.z - p.z) - c.radius);
  }
  return best;
}

describe('collectibles', () => {
  it('48 feathers and the seven relics the catalog asks for, with unique ids', () => {
    expect(items.filter((c) => c.kind === 'feather').length).toBe(FEATHER_COUNT);
    expect(items.filter((c) => c.kind === 'relic').map((c) => c.id).sort()).toEqual(RELICS.map((r) => r.id).sort());
    expect(new Set(items.map((c) => c.id)).size).toBe(items.length);
    for (const c of items) expect(isCollectibleId(c.id)).toBe(true);
    for (const o of COSMETICS) if (o.unlock.type === 'relic') expect(items.some((c) => c.id === (o.unlock as { relicId: string }).relicId)).toBe(true);
    // A healthy mix of on-foot and flying finds.
    const foot = items.filter((c) => c.access === 'foot').length;
    expect(foot).toBeGreaterThan(15);
    expect(items.length - foot).toBeGreaterThan(15);
  });

  it('ground finds stand on walkable ground, clear of buildings, trunks and water', () => {
    const problems: string[] = [];
    const check = (ok: boolean, what: string) => ok || problems.push(what);
    for (const c of items) {
      if (c.access !== 'foot') continue;
      const spec = COLLECTIBLE_SPECS.find((s) => s.id === c.id)!;
      const label = `${c.id} (${c.where})`;
      const hit = terrain.groundAt(c.position.x, c.position.z, 1e5);
      const deck = dressing.deckAt(c.position.x, c.position.z, 1e5);
      check(!!(hit || deck), `${label}: no ground`);
      if (hit && (!deck || hit.y >= deck.y)) check(hit.normal.y > 0.75, `${label}: too steep (${hit.normal.y.toFixed(2)})`);
      if (spec.spot.on === 'ground') check(Math.abs(c.groundY! - Math.max(hit?.y ?? -1e9, deck?.y ?? -1e9)) < 1e-6, `${label}: not on the ground`);
      check(field.rock(c.position.x, c.position.y, c.position.z) > 0.6, `${label}: in rock`);
      check(colliderDistance(c.position) > 0.8, `${label}: in a structure (${colliderDistance(c.position).toFixed(1)})`);
      check(dressing.forest.clearance(c.position.x, c.position.z) > 1.5, `${label}: in a tree`);
      check(streamDistance(c.position.x, c.position.z) > 1.5, `${label}: in a stream`);
    }
    expect(problems).toEqual([]);
  }, 120_000);

  it('air finds are clear of rock, roots and water, with room to fly within pickup range', () => {
    const dirs: Vector3[] = [];
    for (let i = 0; i < 26; i++) {
      const y = 1 - (2 * (i + 0.5)) / 26;
      const r = Math.sqrt(1 - y * y);
      const a = i * 2.39996;
      dirs.push(new Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    const problems: string[] = [];
    const check = (ok: boolean, what: string) => ok || problems.push(what);
    for (const c of items) {
      if (c.access !== 'air') continue;
      const label = `${c.id} (${c.where})`;
      const p = c.position;
      check(field.rock(p.x, p.y, p.z) > 4, `${label}: rock ${field.rock(p.x, p.y, p.z).toFixed(1)}`);
      check(field.root(p.x, p.y, p.z) > 2.5, `${label}: root ${field.root(p.x, p.y, p.z).toFixed(1)}`);
      check(field.fall(p.x, p.y, p.z) > 2.5, `${label}: water ${field.fall(p.x, p.y, p.z).toFixed(1)}`);
      check(p.y > LAYOUT.cloudFloor + 10, `${label}: in the clouds`);
      // Somewhere within reach a wyvern (half-span ~6.5 m) fits.
      let roomy = 0;
      for (const d of dirs) {
        const q = p.clone().addScaledVector(d, PICKUP_RADIUS.air - 1);
        if (field.at(q.x, q.y, q.z) > 8) roomy++;
      }
      check(roomy > 0, `${label}: no room to fly within reach`);
    }
    expect(problems).toEqual([]);
  }, 120_000);

  it('places are deterministic', () => {
    const again = placeCollectibles({ terrain, deckAt: (x, z, y) => dressing.deckAt(x, z, y) });
    expect(again.map((c) => c.position.toArray())).toEqual(items.map((c) => c.position.toArray()));
  });
});
