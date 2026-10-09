// Breed balance in races (RACE-01): the autopilot flies every course with every breed, through
// the real flight model, thermals and terrain. Every breed must be able to finish every course
// cleanly and earn a medal: a breed choice changes how a race feels, never whether it can be won.

import { describe, expect, it } from 'vitest';
import { LAYOUT } from '../world/layout';
import { Terrain } from '../world/terrain';
import { BREEDS, BREED_ORDER } from '../flight/breeds';
import { COURSES, courseVia } from './courses';
import { flyCourse, thermalAir } from './flyCourse';
import { medalFor } from './courseMath';

const terrain = new Terrain(LAYOUT);

describe('every breed on every course', () => {
  for (const c of COURSES) {
    it(`${c.id}: all four breeds finish without a miss or a hit, each with a medal`, () => {
      for (const id of BREED_ORDER) {
        const r = flyCourse(c, { breed: BREEDS[id], env: thermalAir(LAYOUT.thermals, terrain), via: courseVia(c.id), maxSeconds: 420 });
        expect(r.finished, `${id} stuck at ring ${r.stuckAt}`).toBe(true);
        expect(r.misses, id).toBe(0);
        expect(r.hits, id).toBe(0);
        expect(medalFor(r.timeMs, c.medals), `${id} ${(r.timeMs / 1000).toFixed(1)} s`).not.toBe('none');
      }
    }, 240_000);
  }
});
