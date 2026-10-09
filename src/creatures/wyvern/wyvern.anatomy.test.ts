// Wyvern anatomy: proportions, budgets and cosmetics, rebuilds, the seat (stream A).
// Shared poses and helpers: wyvern.testkit.ts.

import { describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import type { BreedId } from '../../core/types';
import { BREEDS, BREED_ORDER } from '../../flight/breeds';
import { COSMETICS, cosmeticsFor } from '../../cosmetics/catalog';
import { Wyvern } from './Wyvern';
import { buildRig } from './rig';
import { PATTERN_IDS } from './materials';
import { STAND_ROOT_PITCH } from './animator';
import { boneWorld, look, standing } from './wyvern.testkit';

describe('proportions', { timeout: 30000 }, () => {
  it('honors the true wingspan (bind pose, tip to tip)', () => {
    for (const breed of BREED_ORDER) {
      const rig = buildRig(breed);
      expect(rig.fingerTips[0].x * 2).toBeCloseTo(BREEDS[breed].wingspan, 3);
    }
  });

  it('is about 14 m nose to tail for the harrier, smaller for the skimmer', () => {
    const len = (b: BreedId) => {
      const r = buildRig(b);
      return r.mouth.z - r.tailTip.z;
    };
    expect(len('harrier')).toBeGreaterThan(12.5);
    expect(len('harrier')).toBeLessThan(15.5);
    expect(len('skimmer')).toBeLessThan(len('harrier'));
    expect(len('galewing')).toBeGreaterThan(len('skimmer'));
  });

  it('gives each breed its build: ironback stockiest, galewing slimmest for its span', () => {
    const girth = (b: BreedId) => buildRig(b).props.shape.torsoHalfWidth;
    expect(girth('ironback')).toBeGreaterThan(girth('harrier'));
    expect(girth('harrier')).toBeGreaterThan(girth('skimmer'));
    const slim = (b: BreedId) => girth(b) / BREEDS[b].wingspan;
    for (const b of ['harrier', 'skimmer', 'ironback'] as const) expect(slim('galewing')).toBeLessThan(slim(b));
  });

  it('plants the feet on the ground when standing at standHeight', () => {
    for (const breed of BREED_ORDER) {
      const w = new Wyvern(look(breed));
      const pose = standing(breed);
      for (let i = 0; i < 90; i++) w.update(1 / 60, pose);
      const sole = w.rigDef.props.leg.sole;
      for (const n of ['toesL', 'toesR']) {
        const ball = boneWorld(w, n);
        // The ball of the foot sits one sole thickness above the ground.
        expect(ball.y - 10).toBeGreaterThan(sole - 0.03);
        expect(ball.y - 10).toBeLessThan(sole + 0.03);
      }
      // Wing claws rest on the ground too (quadrupedal stance).
      for (const n of ['clawL', 'clawR']) {
        const wrist = boneWorld(w, n);
        expect(wrist.y - 10).toBeLessThan(0.3 * BREEDS[breed].standHeight);
        expect(wrist.y - 10).toBeGreaterThan(0);
      }
      w.dispose();
    }
  });
});


// Building ~150 meshes is quick (a few seconds) but give a loaded shared machine headroom.
describe('model budget and cosmetics', { timeout: 60000 }, () => {
  const slots = { wyvernPattern: 'pattern', wyvernHorns: 'horns', wyvernFrill: 'frill', wyvernTail: 'tail', saddle: 'saddle' } as const;

  it('builds every catalog id for every breed within budget', () => {
    for (const breed of BREED_ORDER) {
      for (const c of COSMETICS) {
        const key = slots[c.slot as keyof typeof slots];
        if (!key) continue;
        const w = new Wyvern(look(breed, { [key]: c.id }));
        const s = w.stats;
        expect(s.bones).toBeLessThanOrEqual(80);
        expect(s.triangles).toBeGreaterThan(9000);
        expect(s.triangles).toBeLessThan(25000);
        const g = w.skinnedMesh!.geometry;
        const pos = g.getAttribute('position').array;
        let finite = true;
        for (let i = 0; i < pos.length; i++) finite &&= Number.isFinite(pos[i]);
        expect(finite).toBe(true);
        const si = g.getAttribute('skinIndex').array;
        const sw = g.getAttribute('skinWeight').array;
        let worstSum = 0;
        let maxIndex = 0;
        for (let v = 0; v < sw.length; v += 4) {
          worstSum = Math.max(worstSum, Math.abs(sw[v] + sw[v + 1] + sw[v + 2] + sw[v + 3] - 1));
          for (let k = 0; k < 4; k++) maxIndex = Math.max(maxIndex, si[v + k]);
        }
        expect(worstSum).toBeLessThan(1e-4);
        expect(maxIndex).toBeLessThan(s.bones);
        expect(g.groups.length).toBe(2);
        w.dispose();
      }
    }
  });

  it('gives every shape cosmetic its own geometry', () => {
    for (const [slot, key] of [
      ['wyvernHorns', 'horns'],
      ['wyvernFrill', 'frill'],
      ['wyvernTail', 'tail'],
      ['saddle', 'saddle'],
    ] as const) {
      const counts = new Set<number>();
      const ids = cosmeticsFor(slot);
      for (const c of ids) {
        const w = new Wyvern(look('harrier', { [key]: c.id }));
        counts.add(w.stats.vertices);
        w.dispose();
      }
      expect(counts.size).toBe(ids.length);
    }
  });

  it('builds a membrane area in proportion to the breed', () => {
    const area = (b: BreedId) => {
      const w = new Wyvern(look(b));
      const a = w.stats.membraneArea * 2;
      w.dispose();
      return a;
    };
    for (const b of BREED_ORDER) {
      const a = area(b);
      // Visual membranes cover most of the physical wing area (the rest is body and arm).
      expect(a / BREEDS[b].wingArea).toBeGreaterThan(0.35);
      expect(a / BREEDS[b].wingArea).toBeLessThan(1.1);
    }
  });
});

describe('setLook', () => {
  it('only touches uniforms for colors and patterns', () => {
    const w = new Wyvern(look('harrier'));
    const g = w.skinnedMesh!.geometry;
    w.setLook(look('harrier', { primary: '#ff0000', pattern: 'stripes', membrane: '#00ff00' }));
    expect(w.skinnedMesh!.geometry).toBe(g);
    expect(w.uniforms.uPrimary.value.r).toBeCloseTo(1, 3);
    expect(w.uniforms.uPattern.value).toBe(PATTERN_IDS.stripes);
    w.dispose();
  });

  it('rebuilds and disposes the old resources on a shape or breed change', () => {
    const w = new Wyvern(look('harrier'));
    const g = w.skinnedMesh!.geometry;
    const sk = w.skinnedMesh!.skeleton;
    const gd = vi.spyOn(g, 'dispose');
    const sd = vi.spyOn(sk, 'dispose');
    w.setLook(look('harrier', { horns: 'ram' }));
    expect(gd).toHaveBeenCalled();
    expect(sd).toHaveBeenCalled();
    expect(w.skinnedMesh!.geometry).not.toBe(g);
    // Exactly one mesh and one bone root under the group.
    expect(w.group.children.filter((c) => (c as { isSkinnedMesh?: boolean }).isSkinnedMesh).length).toBe(1);
    expect(w.group.children.filter((c) => (c as { isBone?: boolean }).isBone).length).toBe(1);
    const before = w.rigDef;
    w.setLook(look('ironback'));
    expect(w.rigDef).not.toBe(before);
    expect(w.rigDef.props.breed).toBe('ironback');
    // The saddle anchor survives rebuilds (the rider holds a reference to it).
    expect(w.saddle.parent).not.toBeNull();
    w.dispose();
  });
});

describe('accessors', () => {
  it('puts the head in front of the body and the saddle on top of it', () => {
    const w = new Wyvern(look('harrier'));
    const pose = standing('harrier');
    for (let i = 0; i < 30; i++) w.update(1 / 60, pose);
    const head = w.getHead(new Vector3());
    expect(head.z - pose.position.z).toBeGreaterThan(2);
    expect(head.y).toBeGreaterThan(pose.position.y);
    const seat = w.saddle.getWorldPosition(new Vector3());
    expect(seat.y - pose.position.y).toBeGreaterThan(0.6);
    expect(seat.y - pose.position.y).toBeLessThan(1.6);
    expect(Math.abs(seat.x - pose.position.x)).toBeLessThan(0.05);
    expect(w.saddle.userData.halfWidth).toBeGreaterThan(0.2);
    expect(w.saddle.userData.halfWidth).toBeLessThan(0.9);
    expect(w.saddle.userData.gripOffset).toBeInstanceOf(Vector3);
    w.dispose();
  });
});

describe('seat', () => {
  it('reports the standing seat in the body frame, matching the saddle anchor (mount/dismount line-up)', () => {
    for (const breed of BREED_ORDER) {
      for (const saddle of ['rider', 'racing', 'royal', 'nomad']) {
        const w = new Wyvern(look(breed, { saddle }));
        const pose = standing(breed);
        for (let i = 0; i < 90; i++) w.update(1 / 60, pose);
        const seat = w.seatOffset(new Vector3());
        const anchor = w.saddle.getWorldPosition(new Vector3()).sub(pose.position);
        // Within a couple of cm (breathing moves the body a hair).
        expect(seat.distanceTo(anchor)).toBeLessThan(0.025);
        expect(seat.y).toBeGreaterThan(0.5);
        expect(seat.z).toBeGreaterThan(0);
        w.dispose();
      }
    }
    expect(STAND_ROOT_PITCH).toBeLessThan(0);
  });

  it('straddles a horse-like width at the seat and holds the grip up and forward', () => {
    for (const breed of BREED_ORDER) {
      const w = new Wyvern(look(breed));
      expect(w.saddle.userData.halfWidth).toBeGreaterThan(0.4);
      expect(w.saddle.userData.halfWidth).toBeLessThanOrEqual(0.5);
      const g = w.saddle.userData.gripOffset as Vector3;
      expect(g.y).toBeGreaterThan(0.32);
      expect(g.z).toBeGreaterThan(0.45);
      w.dispose();
    }
  });
});
