// Course validation against the real world: every ring clear of rock, Rootfall's roots and the
// waterfalls, and of every building, tree, deck and gate (all collider kinds); the flight line
// between rings clear; the Eye of the Gale threaded with room to
// spare; medals ordered; and every course actually flown with the autopilot and the real flight
// model to prove it can be finished inside the medal times.

import { describe, expect, it } from 'vitest';
import { Scene, Vector3 } from 'three';
import { LAYOUT } from '../world/layout';
import { Terrain } from '../world/terrain';
import { QUALITY } from '../render/quality';
import { Dressing } from '../world/dressing/Dressing';
import { BREEDS } from '../flight/breeds';
import type { BreedId } from '../core/types';
import { COSMETICS } from '../cosmetics/catalog';
import { COURSES, courseVia } from './courses';
import { ClearanceField } from './clearance';
import { coursePoints, gateRing, GATE_RADIUS, medalFor, polylineLength } from './courseMath';
import { ringGeom } from './ringMath';
import { gateColliders } from './gateMesh';
import { ColliderIndex, deckCollider } from '../world/colliders';
import { flyCourse, thermalAir, type FlyResult } from './flyCourse';

const SLOW = 240_000;
const terrain = new Terrain(LAYOUT);
const dressing = new Dressing({ scene: new Scene(), terrain, quality: QUALITY.low, asyncStreaming: false });
const field = new ClearanceField({ terrain, roots: dressing.rootPlan, falls: dressing.water.plansList });

const flights = new Map<string, FlyResult>();
function fly(id: string, breed: BreedId): FlyResult {
  const key = `${id}/${breed}`;
  let r = flights.get(key);
  if (!r) {
    const def = COURSES.find((c) => c.id === id)!;
    r = flyCourse(def, { breed: BREEDS[breed], env: thermalAir(LAYOUT.thermals, terrain), via: courseVia(id), maxSeconds: 420 });
    flights.set(key, r);
  }
  return r;
}

describe('the seven courses', () => {
  it('are exactly the ones the catalog and race list expect', () => {
    const spec: Record<string, [string, number]> = {
      'roost-loop': ['rings', 1],
      'cascade-run': ['rings', 2],
      'archway-thread': ['rings', 3],
      underspan: ['rings', 4],
      'needle-slalom': ['rings', 5],
      'lantern-dash': ['sprint', 2],
      'long-drift': ['sprint', 4],
    };
    expect(COURSES.map((c) => c.id).sort()).toEqual(Object.keys(spec).sort());
    for (const c of COURSES) {
      expect([c.kind, c.difficulty], c.id).toEqual(spec[c.id]);
      expect(LAYOUT.landmarks.some((l) => l.id === c.landmark), c.id).toBe(true);
      if (c.kind === 'sprint') expect(c.rings.length).toBe(1);
      else expect(c.rings.length).toBeGreaterThanOrEqual(6);
      for (const r of c.rings) {
        const want = c.difficulty >= 4 && c.kind === 'rings' ? [7, 7] : [8, 12];
        expect(r.radius, c.id).toBeGreaterThanOrEqual(want[0]);
        expect(r.radius, c.id).toBeLessThanOrEqual(want[1]);
      }
    }
    // Every race a cosmetic asks a medal on exists.
    for (const o of COSMETICS) if (o.unlock.type === 'medal') expect(COURSES.some((c) => c.id === (o.unlock as { raceId: string }).raceId)).toBe(true);
  });

  it('keeps every ring and gate clear of rock, roots and falling water by radius + 3 m', () => {
    for (const c of COURSES) {
      const g = gateRing(c);
      expect(field.at(g.cx, g.cy, g.cz), `${c.id} gate`).toBeGreaterThan(GATE_RADIUS + 3);
      c.rings.forEach((r, i) => {
        const clr = field.at(...r.position);
        expect(clr, `${c.id} ring ${i} at ${r.position}`).toBeGreaterThan(r.radius + 3);
      });
    }
  }, SLOW);

  it('leaves the flight line between consecutive rings clear', () => {
    for (const c of COURSES) {
      // Sprints: the suggested route through its thermals; ring courses: gate → each ring.
      const line = coursePoints(c, courseVia(c.id)).map((p) => ('p' in p ? p.p : p));
      for (let i = 1; i < line.length; i++) {
        const { min, at } = field.along(line[i - 1], line[i], 3);
        expect(min, `${c.id} leg ${i - 1}→${i} near ${at.map(Math.round)}`).toBeGreaterThan(c.kind === 'sprint' ? 10 : 6);
      }
    }
  }, SLOW);

  it('keeps ring openings and the flight line clear of buildings, trees, decks and the gates', () => {
    // Every collider kind the dressing makes (cylinders, spheres, boxes; foliage soft), measured
    // with the index's signed distance, plus every start gate's own solid parts.
    const hard = new ColliderIndex();
    const soft = new ColliderIndex();
    for (const c of [...dressing.colliders, ...dressing.forest.colliders, ...dressing.decks.map(deckCollider), ...COURSES.flatMap(gateColliders)]) (c.soft ? soft : hard).add(c);
    const p = new Vector3();
    for (const c of COURSES) {
      c.rings.forEach((r, i) => {
        const g = ringGeom(r);
        const n = new Vector3(g.nx, g.ny, g.nz);
        const a1 = new Vector3().crossVectors(n, Math.abs(n.y) < 0.95 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize();
        const a2 = new Vector3().crossVectors(n, a1);
        for (const k of [0, 0.5, 0.95]) {
          for (let j = 0; j < 16; j++) {
            const th = (j / 16) * Math.PI * 2;
            p.fromArray(r.position).addScaledVector(a1, Math.cos(th) * k * r.radius).addScaledVector(a2, Math.sin(th) * k * r.radius);
            expect(Math.min(hard.distance(p, 20), soft.distance(p, 20)), `${c.id} ring ${i}`).toBeGreaterThan(3);
          }
        }
      });
      const line = coursePoints(c, courseVia(c.id)).map((q) => ('p' in q ? q.p : q));
      for (let i = 1; i < line.length; i++) {
        const a = new Vector3(...line[i - 1]);
        const b = new Vector3(...line[i]);
        const L = a.distanceTo(b);
        for (let d = 0; d <= L; d += 3) {
          p.copy(a).lerp(b, d / L);
          const at = `${c.id} leg ${i - 1}→${i} at ${p.toArray().map(Math.round)}`;
          expect(hard.distance(p, 20), at).toBeGreaterThan(6);
          expect(soft.distance(p, 20), at).toBeGreaterThan(3);
        }
      }
    }
  }, SLOW);

  it('threads the Eye of the Gale with room to spare', () => {
    const eye = terrain.arches.find((a) => a.def.landmark === 'eye')!;
    const clear = eye.def.radius - eye.def.tube - 1;
    let threaded = 0;
    for (const c of COURSES) {
      for (const r of c.rings) {
        const g = ringGeom(r);
        const rel = new Vector3(g.cx, g.cy, g.cz).sub(eye.center);
        const along = rel.dot(eye.normal);
        if (Math.abs(along) > 40) continue;
        const offAxis = Math.sqrt(Math.max(0, rel.lengthSq() - along * along));
        if (offAxis > eye.def.radius) continue;
        threaded++;
        const tube = Math.max(0.9, r.radius * 0.09) * 1.3;
        expect(offAxis + r.radius + tube, c.id).toBeLessThanOrEqual(clear);
        // Faces through the Eye, not across it.
        expect(Math.abs(new Vector3(g.nx, g.ny, g.nz).dot(eye.normal))).toBeGreaterThan(0.95);
      }
    }
    expect(threaded).toBeGreaterThanOrEqual(1);
  });

  it('threads the Archway Reach arches and Rootfall’s roots', () => {
    const arch = COURSES.find((c) => c.id === 'archway-thread')!;
    const archesHit = new Set<number>();
    for (const r of arch.rings) {
      for (const a of terrain.arches) {
        if (a.def.landmark === 'eye' || a.full) continue;
        const rel = new Vector3(...r.position).sub(a.center);
        const inPlane = Math.hypot(rel.dot(a.right), rel.dot(a.up));
        if (Math.abs(rel.dot(a.normal)) < 5 && inPlane < a.def.radius - a.def.tube - r.radius && rel.dot(a.up) > 0) archesHit.add(a.def.id);
      }
    }
    expect(archesHit.size).toBe(3);
    // Underspan: several rings sit among the roots (a strand within 40 m) yet clear of them.
    const under = COURSES.find((c) => c.id === 'underspan')!;
    const amongRoots = under.rings.filter((r) => field.root(...r.position) < 40).length;
    expect(amongRoots).toBeGreaterThanOrEqual(4);
  });

  it('asks for no climb steeper than a wyvern can fly without a thermal', () => {
    for (const c of COURSES) {
      if (c.kind === 'sprint') continue;
      const pts = [c.start.position, ...c.rings.map((r) => r.position)];
      for (let i = 1; i < pts.length; i++) {
        const dy = pts[i][1] - pts[i - 1][1];
        const dxz = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
        expect(dy / dxz, `${c.id} leg ${i}`).toBeLessThan(0.2);
      }
    }
  });

  it('orders its medals and sets them from the speed model', () => {
    for (const c of COURSES) {
      const { gold, silver, bronze } = c.medals;
      expect(gold).toBeGreaterThan(10_000);
      expect(silver).toBeGreaterThan(gold);
      expect(bronze).toBeGreaterThan(silver);
      expect(medalFor(gold, c.medals)).toBe('gold');
      expect(medalFor(gold + 1, c.medals)).toBe('silver');
      expect(medalFor(bronze + 1, c.medals)).toBe('none');
      // Gold averages somewhere near the gold pace over the line (faster on a dive, slower on
      // a climb), never absurd.
      const L = polylineLength(coursePoints(c, courseVia(c.id)));
      const avg = L / (gold / 1000);
      expect(avg, c.id).toBeGreaterThan(20);
      expect(avg, c.id).toBeLessThan(45);
    }
  });
});

describe('flying the courses with the autopilot (real flight model, thermals, terrain)', () => {
  for (const c of COURSES) {
    it(`${c.id}: the harrier finishes cleanly inside the medal times`, () => {
      const r = fly(c.id, 'harrier');
      expect(r.finished, `stuck at ring ${r.stuckAt}`).toBe(true);
      expect(r.hits).toBe(0);
      expect(r.misses).toBe(0);
      // A decent pilot (not a perfect one) lands between gold and bronze: gold is a stretch,
      // never a gimme, and bronze is always in reach.
      expect(r.timeMs).toBeLessThanOrEqual(c.medals.bronze);
      expect(r.timeMs).toBeGreaterThanOrEqual(c.medals.gold * 0.95);
      // Splits are increasing and end at the finish time.
      for (let i = 1; i < r.splits.length; i++) expect(r.splits[i]).toBeGreaterThan(r.splits[i - 1]);
      expect(r.splits[r.splits.length - 1]).toBe(r.timeMs);
    }, SLOW);
  }

  it('every breed can finish every course, sprints included (the ironback climbs in thermals now)', () => {
    const breeds: BreedId[] = ['skimmer', 'galewing', 'ironback'];
    const missed: string[] = [];
    for (const c of COURSES) {
      for (const b of breeds) {
        const r = fly(c.id, b);
        if (!r.finished) missed.push(`${b} on ${c.id} (stuck at ring ${r.stuckAt})`);
      }
    }
    expect(missed).toEqual([]);
  }, SLOW * 3);
});
