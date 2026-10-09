// Wyvern anatomy: proportions, budgets and cosmetics, rebuilds, the seat (stream A). The body
// plan of a flier, reptile proportions, the breeds' silhouettes and the geometry budgets of every
// LOD (see the dragon quality bar Q2-Q5, Q15). Shared poses and helpers: wyvern.testkit.ts.

import { describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import type { BreedId } from '../../core/types';
import { BREEDS, BREED_ORDER } from '../../flight/breeds';
import { COSMETICS, cosmeticsFor } from '../../cosmetics/catalog';
import { Wyvern } from './Wyvern';
import { buildRig, rigFor } from './rig';
import { buildWyvernGeometry } from './geometry';
import { humerusRootRadius } from './parts/wings';
import type { Lod } from './parts/res';
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

  it('is about 11 m nose to tail for the harrier (a flier: the wings outspan the body), smaller for the skimmer', () => {
    const len = (b: BreedId) => {
      const r = buildRig(b);
      return r.mouth.z - r.tailTip.z;
    };
    expect(len('harrier')).toBeGreaterThan(10.5);
    expect(len('harrier')).toBeLessThan(12.5);
    for (const b of BREED_ORDER) expect(len(b)).toBeLessThan(BREEDS[b].wingspan);
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
        // The bone texture stays 16x16; LOD0 within its budget (Q15).
        expect(s.bones).toBeLessThanOrEqual(64);
        expect(s.triangles).toBeGreaterThan(9000);
        expect(s.triangles).toBeLessThanOrEqual(breed === 'ironback' ? 30000 : 24000);
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

/** Body plan cross-section at a named key. */
function keyProfile(breed: BreedId, mark: 'neckBase' | 'shoulder' | 'chest' | 'mid' | 'rear' | 'tailBase') {
  const rig = rigFor(breed);
  const s = rig.plan.keyS[rig.plan.marks[mark]];
  return { s, ...rig.plan.profile(s), center: rig.plan.point(s, new Vector3()) };
}

describe('a flier\'s body plan (Q2)', () => {
  it('is broadest at the shoulder girdle, not the belly, with the keel deepest under the shoulders', () => {
    for (const breed of BREED_ORDER) {
      const sh = keyProfile(breed, 'shoulder');
      const mid = keyProfile(breed, 'mid');
      expect(sh.hw / mid.hw, breed).toBeGreaterThanOrEqual(1.1);
      // No pot belly: the belly line rises from the sternum back to the hips.
      const rig = rigFor(breed);
      const k = rig.plan.keyS;
      const m = rig.plan.marks;
      let prev = -Infinity;
      let lowest = Infinity;
      let lowestZ = 0;
      for (let s = k[m.neckBase]; s <= k[m.rear]; s += 0.05) {
        const st = rig.plan.station(s);
        const belly = st.center.y - st.lower;
        if (belly < lowest) {
          lowest = belly;
          lowestZ = st.center.z;
        }
        if (s >= k[m.chest]) {
          expect(belly, `${breed} belly at s=${s.toFixed(2)}`).toBeGreaterThan(prev - 0.002);
          prev = belly;
        }
      }
      // The deepest point is the sternum, between the shoulders and the chest.
      expect(lowestZ / rig.props.shape.torsoLength, breed).toBeGreaterThan(0.1);
    }
  });

  it('carries a massive arm: the humerus root at least 0.85x the thigh', () => {
    for (const breed of BREED_ORDER) {
      const rig = rigFor(breed);
      expect(humerusRootRadius(rig) / rig.props.shape.thighRadius, breed).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('never folds the body tube over itself (cross-sections advance along the centreline)', () => {
    for (const breed of BREED_ORDER) {
      const { plan } = rigFor(breed);
      const a = new Vector3();
      const b = new Vector3();
      for (let s = 0.1; s < plan.length - 0.2; s += 0.05) {
        const t = plan.station(s).tangent;
        for (const th of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          plan.surface(s, th, a);
          plan.surface(s + 0.05, th, b);
          expect(b.sub(a).dot(t), `${breed} s=${s.toFixed(2)} θ=${th.toFixed(2)}`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('predator proportions (Q4)', () => {
  it('keeps the tail at most 40% of nose-to-tip (ironback 37%), and the wings outspan the body', () => {
    for (const breed of BREED_ORDER) {
      const rig = buildRig(breed);
      const len = rig.mouth.z - rig.tailTip.z;
      const tail = rig.bones[rig.idx.tail[0]].pos.z - rig.tailTip.z;
      expect(tail / len, breed).toBeLessThanOrEqual(breed === 'ironback' ? 0.37 : 0.4);
      expect(BREEDS[breed].wingspan, breed).toBeGreaterThan(len);
    }
  });

  it('flattens the tail side to side like a crocodile\'s rudder beyond 30% of its length', () => {
    for (const breed of BREED_ORDER) {
      const { plan } = rigFor(breed);
      const s0 = plan.keyS[plan.marks.tailBase];
      const L = plan.length - s0;
      for (let t = 0.3; t <= 0.9; t += 0.05) {
        const p = plan.profile(s0 + t * L);
        expect(p.hu + p.hl, `${breed} t=${t.toFixed(2)}`).toBeGreaterThan(2 * p.hw);
      }
      // Thick through the first quarter: the tail root anchors the thighs.
      const root = plan.profile(s0 + 0.2 * L);
      expect(root.hw / plan.profile(s0).hw, breed).toBeGreaterThan(0.7);
    }
  });

  it('flows the neck base into the shoulders', () => {
    for (const breed of BREED_ORDER) {
      const base = keyProfile(breed, 'neckBase');
      expect(base.hw / rigFor(breed).props.shape.torsoHalfWidth, breed).toBeGreaterThanOrEqual(0.85);
    }
  });
});

// Builds every breed x catalog id x LOD (~300 meshes): give a loaded shared machine headroom.
describe('levels of detail (Q15)', { timeout: 120000 }, () => {
  const slots = { wyvernHorns: 'horns', wyvernFrill: 'frill', wyvernTail: 'tail', saddle: 'saddle', wyvernPattern: 'pattern' } as const;
  const budget = (breed: BreedId, lod: Lod) => (lod === 0 ? (breed === 'ironback' ? 30000 : 24000) : lod === 1 ? 6000 : 1500);

  it('builds all three LODs of every breed and catalog id within budget, on the same skeleton', () => {
    for (const breed of BREED_ORDER) {
      const rig = rigFor(breed);
      const bones = rig.bones.length;
      for (const c of COSMETICS) {
        const key = slots[c.slot as keyof typeof slots];
        if (!key) continue;
        const tris: number[] = [];
        for (const lod of [0, 1, 2] as Lod[]) {
          const info = buildWyvernGeometry(rig, look(breed, { [key]: c.id }), lod);
          const g = info.geometry;
          tris.push(info.triangles);
          expect(info.triangles, `${breed} ${c.id} LOD${lod}`).toBeLessThanOrEqual(budget(breed, lod));
          // Uint16 indices: well under 65,535 vertices.
          expect(info.vertices).toBeLessThan(60000);
          expect(g.index!.array).toBeInstanceOf(Uint16Array);
          const si = g.getAttribute('skinIndex').array;
          let maxIndex = 0;
          for (let i = 0; i < si.length; i++) maxIndex = Math.max(maxIndex, si[i]);
          expect(maxIndex).toBeLessThan(bones);
          expect(g.groups.length).toBe(2);
          g.dispose();
        }
        // Each level is a real step down.
        expect(tris[1]).toBeLessThan(tris[0] * 0.45);
        expect(tris[2]).toBeLessThan(tris[1] * 0.4);
      }
    }
  });

  it('keeps the bone texture at 16x16 (at most 64 bones)', () => {
    for (const breed of BREED_ORDER) expect(rigFor(breed).bones.length).toBeLessThanOrEqual(64);
  });
});

describe('the folded wing contracts (Q3, A2 rig side)', () => {
  it('has fold helpers on the chest at the inner panel, skinning its interior and pleat valleys', () => {
    for (const breed of BREED_ORDER) {
      const rig = rigFor(breed);
      const [fl, fr] = rig.idx.fold;
      expect(rig.bones[fl].name).toBe('foldL');
      expect(rig.bones[fr].name).toBe('foldR');
      expect(rig.bones[fl].parent).toBe(rig.idx.chest);
      // Between the shoulder and the flank root, out from the body, mirrored.
      const p = rig.bones[fl].pos;
      expect(p.x).toBeGreaterThan(rig.props.shoulder[0]);
      expect(p.x).toBeLessThan(rig.fingerTips[2].x);
      expect(rig.bones[fr].pos.x).toBeCloseTo(-p.x, 6);
      const g = buildWyvernGeometry(rig, look(breed), 0).geometry;
      const si = g.getAttribute('skinIndex');
      const sw = g.getAttribute('skinWeight');
      const ex = g.getAttribute('aExtra');
      const idx = g.index!.array;
      const g1 = g.groups[1];
      const membrane = new Set<number>();
      for (let i = g1.start; i < g1.start + g1.count; i++) membrane.add(idx[i]);
      let maxW = 0;
      let pleated = 0;
      for (let v = 0; v < si.count; v++) {
        let w = 0;
        for (let k = 0; k < 4; k++) if (si.getComponent(v, k) === fl || si.getComponent(v, k) === fr) w += sw.getComponent(v, k);
        if (w > 0) expect(membrane.has(v)).toBe(true);
        maxW = Math.max(maxW, w);
        const y = ex.getY(v);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(1);
        if (y > 0.5) {
          expect(membrane.has(v)).toBe(true);
          pleated++;
        }
      }
      expect(maxW).toBeGreaterThan(0.45);
      expect(maxW).toBeLessThan(0.6);
      expect(pleated).toBeGreaterThan(20);
      g.dispose();
    }
  });
});

describe('reptile head (A6)', () => {
  it('keeps the expert-approved horn placement: swept horn roots within 1 mm of before', () => {
    // Base-ring centres of the default swept horns before the anatomy pass (head space, m),
    // harrier (its head dimensions are unchanged): left big horn, left lower horn.
    const before = [
      [0.132, 0.3198, 0.264],
      [0.308, 0.189, 0.132],
    ];
    const rig = rigFor('harrier');
    const H = rig.bones[rig.idx.head].pos;
    const L = rig.props.shape.headLength;
    const Wd = rig.props.shape.headHalfWidth;
    const Hh = rig.props.shape.headHalfHeight;
    // The same construction as cosmetics.buildHorns 'swept' (the roots are the first path points).
    const at = (x: number, y: number, z: number) => new Vector3(x * Wd, y * Hh, z * L);
    const big = at(0.6, 0.95, 0.14).add(new Vector3(-0.1 * L, -0.06 * L, 0.06 * L));
    const low = at(0.88, 0.45, 0.06).add(new Vector3(-0.06 * L, 0, 0.04 * L));
    for (const [p, ref] of [
      [big, before[0]],
      [low, before[1]],
    ] as const) {
      expect(Math.hypot(p.x - ref[0], p.y - ref[1], p.z - ref[2])).toBeLessThan(0.001);
    }
    // And the mesh really roots its horns there: horn vertices ring each root.
    const g = buildWyvernGeometry(rig, look('harrier'), 0).geometry;
    const pos = g.getAttribute('position');
    const mat = g.getAttribute('aMat');
    for (const p of [big, low]) {
      let near = 0;
      for (let i = 0; i < pos.count; i++) {
        if (Math.round(mat.getX(i)) !== 1) continue;
        const d = Math.hypot(pos.getX(i) - H.x - p.x, pos.getY(i) - H.y - p.y, pos.getZ(i) - H.z - p.z);
        if (d < 0.12 * L * 1.05) near++;
      }
      expect(near).toBeGreaterThan(8);
    }
    g.dispose();
  });

  it('has 58 bones with the gular bone under the jaw, the throat floor skinned to it', () => {
    for (const breed of BREED_ORDER) {
      const rig = rigFor(breed);
      expect(rig.bones.length).toBe(58);
      expect(rig.bones[rig.idx.gular].name).toBe('gular');
      expect(rig.bones[rig.idx.gular].parent).toBe(rig.idx.jaw);
      expect(rig.bones[rig.idx.gular].pos.y).toBeLessThan(rig.bones[rig.idx.jaw].pos.y);
      const g = buildWyvernGeometry(rig, look(breed), 0).geometry;
      const si = g.getAttribute('skinIndex');
      let n = 0;
      for (let v = 0; v < si.count; v++) for (let k = 0; k < 4; k++) if (si.getComponent(v, k) === rig.idx.gular) n++;
      expect(n).toBeGreaterThan(20);
      g.dispose();
    }
  });

  it('sets the eye in a socket under a brow ledge, with lid rims, nostrils, teeth and zones', () => {
    for (const breed of BREED_ORDER) {
      const rig = rigFor(breed);
      const info = buildWyvernGeometry(rig, look(breed), 0);
      const g = info.geometry;
      const pos = g.getAttribute('position');
      const mat = g.getAttribute('aMat');
      const ex = g.getAttribute('aExtra');
      const H = rig.bones[rig.idx.head].pos;
      // The brow juts out past the eyeball (left side, near the eye's station).
      const eyeOuter = info.eyeCenter.x + info.eyeAxis.x * info.eyeRadius;
      let browX = 0;
      let teeth = 0;
      const zones = new Set<number>();
      for (let i = 0; i < pos.count; i++) {
        const r = Math.round(mat.getX(i));
        if (r === 13) teeth++;
        zones.add(Math.round(ex.getZ(i)));
        if (r !== 0) continue;
        const y = pos.getY(i);
        const z = pos.getZ(i);
        if (Math.abs(z - info.eyeCenter.z) < 0.5 * info.eyeRadius && y > info.eyeCenter.y + 0.6 * info.eyeRadius && y < H.y + rig.props.shape.headHalfHeight * 2)
          browX = Math.max(browX, pos.getX(i));
      }
      expect(browX, breed).toBeGreaterThan(eyeOuter);
      // 9 + 8 teeth a side at LOD0 (each several vertices).
      expect(teeth).toBeGreaterThan(34 * 10);
      for (const z of [1, 2, 3, 4, 5]) expect(zones.has(z), `${breed} zone ${z}`).toBe(true);
      g.dispose();
    }
  });
});

describe('wing-walker hand and reptile foot (A5, A7)', () => {
  it('walks on a stout wrist with a sole pad and three clawed digits', () => {
    for (const breed of BREED_ORDER) {
      const rig = rigFor(breed);
      const g = buildWyvernGeometry(rig, look(breed), 0).geometry;
      const si = g.getAttribute('skinIndex');
      const sw = g.getAttribute('skinWeight');
      const mat = g.getAttribute('aMat');
      const pos = g.getAttribute('position');
      const claw = rig.idx.wings[0].claw;
      // Digit claws: claw-region vertices on the claw bone, clustered into three tips ahead of
      // the wrist.
      const tips: number[] = [];
      let pale = 0;
      for (let v = 0; v < si.count; v++) {
        if (si.getComponent(v, 0) !== claw || sw.getComponent(v, 0) < 0.99) continue;
        if (Math.round(mat.getX(v)) === 9) tips.push(pos.getX(v));
        else if (mat.getY(v) > 0.55) pale++;
      }
      expect(pale, `${breed} pad`).toBeGreaterThan(10);
      const xs = [...new Set(tips.map((x) => Math.round(x * 20)))];
      expect(xs.length, breed).toBeGreaterThanOrEqual(3);
      g.dispose();
    }
  });

  it('plants a lizard\'s foot: four toes forward, a short fifth outside, none behind; a wider stance', () => {
    for (const breed of BREED_ORDER) {
      const rig = rigFor(breed);
      const g = buildWyvernGeometry(rig, look(breed), 0).geometry;
      const si = g.getAttribute('skinIndex');
      const mat = g.getAttribute('aMat');
      const pos = g.getAttribute('position');
      const toes = rig.idx.legs[0].toes;
      const ball = rig.ball;
      let behind = 0;
      let scutate = 0;
      for (let v = 0; v < si.count; v++) {
        if (si.getComponent(v, 0) !== toes) continue;
        if (Math.round(mat.getX(v)) === 9 && pos.getZ(v) < ball.z - 0.15) behind++;
        if (Math.round(g.getAttribute('aExtra').getZ(v)) === 5) scutate++;
      }
      // No backward hallux: no toe claw behind the ball of the foot.
      expect(behind, breed).toBe(0);
      expect(scutate).toBeGreaterThan(10);
      // Hips (and so the hind feet) at least 1.2x the old 0.6 torso half-widths apart.
      expect(rig.props.hip[0] / (0.6 * rig.props.shape.torsoHalfWidth), breed).toBeGreaterThanOrEqual(1.2);
      g.dispose();
    }
  });
});
