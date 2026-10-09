// The rider on the wyvern: where the saddle sits, how the legs straddle the barrel, and that no
// wing ever sweeps through the rider (every breed, the main saddles, the whole flight envelope).

import { describe, expect, it } from 'vitest';
import { Vector3, type Bone } from 'three';
import type { BreedId, RiderPose, WyvernPose } from '../core/types';
import { BREEDS, BREED_ORDER } from '../flight/breeds';
import { DEFAULT_RIDER, DEFAULT_WYVERN } from '../cosmetics/catalog';
import { createRiderPose, createWyvernPose } from '../player/poses';
import { Wyvern } from './wyvern/Wyvern';
import { Rider } from './rider/Rider';
import { B } from './rider/rig';
import { flankHalfWidth, type SaddleFlank } from './rider/animator';

/** Rider limbs as capsules: bone → bone, radius (m). */
const LIMBS: [keyof typeof B, keyof typeof B, number][] = [
  ['thighL', 'shinL', 0.09],
  ['shinL', 'footL', 0.065],
  ['footL', 'toeL', 0.05],
  ['thighR', 'shinR', 0.09],
  ['shinR', 'footR', 0.065],
  ['footR', 'toeR', 0.05],
  ['hips', 'chest', 0.15],
  ['chest', 'head', 0.13],
  ['upperArmL', 'foreArmL', 0.055],
  ['foreArmL', 'handL', 0.05],
  ['upperArmR', 'foreArmR', 0.055],
  ['foreArmR', 'handR', 0.05],
];

const _a = new Vector3();
const _b = new Vector3();
const _p = new Vector3();
const _ab = new Vector3();

function segDist(p: Vector3, a: Vector3, b: Vector3): number {
  _ab.subVectors(b, a);
  const t = Math.max(0, Math.min(1, _p.subVectors(p, a).dot(_ab) / Math.max(1e-9, _ab.lengthSq())));
  return p.distanceTo(_p.copy(a).addScaledVector(_ab, t));
}

function riderBones(r: Rider): Bone[] {
  return (r as unknown as { model: { rig: { bones: Bone[] } } }).model.rig.bones;
}

type Flight = 'stand' | 'glide' | 'flap' | 'tuck' | 'bank' | 'flare';

function wyvernPose(kind: Flight, breed: BreedId): WyvernPose {
  const p = createWyvernPose();
  if (kind === 'stand') {
    p.position.set(0, 10 + BREEDS[breed].standHeight, 0);
    p.airborne = false;
    p.wingSpread = 0.22;
    p.gait = 'idle';
    p.groundY = 10;
    p.lookTarget.set(0, 13, 40);
    return p;
  }
  p.position.set(0, 300, 0);
  p.velocity.set(0, 0, 24);
  p.airspeed = 24;
  p.airborne = true;
  p.wingSpread = kind === 'tuck' ? 0.1 : 1;
  p.flare = kind === 'flare' ? 1 : 0;
  if (kind === 'bank') {
    p.orientation.setFromAxisAngle(new Vector3(0, 0, 1), 0.7);
    p.angularVelocity.set(0, -0.6, 0.3);
  }
  p.lookTarget.set(0, 300, 40);
  return p;
}

/** Wing vertices (membranes plus the arm and finger tubes) of the wyvern's mesh. */
function wingVertices(w: Wyvern): number[] {
  const mesh = w.skinnedMesh!;
  const geo = mesh.geometry;
  const idx = geo.index!.array;
  const g1 = geo.groups[1];
  const out = new Set<number>();
  for (let i = g1.start; i < g1.start + g1.count; i++) out.add(idx[i]);
  const wingBones = new Set<number>();
  mesh.skeleton.bones.forEach((b, i) => {
    if (/humerus|forearm|hand|finger|claw/.test(b.name)) wingBones.add(i);
  });
  const si = geo.attributes.skinIndex;
  const sw = geo.attributes.skinWeight;
  for (let v = 0; v < si.count; v++) {
    let ww = 0;
    for (let k = 0; k < 4; k++) if (wingBones.has(si.getComponent(v, k))) ww += sw.getComponent(v, k);
    if (ww > 0.5) out.add(v);
  }
  return [...out];
}

/** Smallest gap (m) between the wings and the rider's limb capsules over the run. */
function wingClearance(breed: BreedId, saddle: string, kind: Flight, crouch = 0): number {
  const w = new Wyvern({ ...DEFAULT_WYVERN, breed, saddle });
  const r = new Rider(DEFAULT_RIDER, { saddle: w.saddle });
  const wp = wyvernPose(kind, breed);
  const rp: RiderPose = createRiderPose();
  rp.mounted = true;
  rp.action = 'mounted';
  rp.crouch = crouch;
  rp.brace = kind === 'flare' ? 1 : 0;
  const verts = wingVertices(w);
  const mesh = w.skinnedMesh!;
  const rate = BREEDS[breed].flapRate;
  const cycle = Math.round(60 / rate);
  const frames = 90 + (kind === 'flap' ? cycle : 0);
  let min = Infinity;
  for (let f = 0; f < frames; f++) {
    if (kind === 'flap') {
      wp.flapStrength = 1;
      wp.flapPhase = ((f / 60) * rate) % 1;
    }
    if (wp.airborne) {
      wp.position.z += 24 / 60;
      wp.lookTarget.z += 24 / 60;
    }
    w.update(1 / 60, wp);
    r.update(1 / 60, rp, w.saddle);
    // Static poses: the settled last frame; the flap: every other frame of the last full beat.
    const sample = kind === 'flap' ? f >= frames - cycle && f % 2 === 0 : f === frames - 1;
    if (!sample) continue;
    const bones = riderBones(r);
    const limbs = LIMBS.map(([a, b, rad]) => ({ a: bones[B[a]].getWorldPosition(new Vector3()), b: bones[B[b]].getWorldPosition(new Vector3()), rad }));
    for (const v of verts) {
      mesh.getVertexPosition(v, _a).applyMatrix4(mesh.matrixWorld);
      for (const l of limbs) min = Math.min(min, segDist(_a, l.a, l.b) - l.rad);
    }
  }
  w.dispose();
  r.dispose();
  return min;
}

describe('the rider on the wyvern', { timeout: 120000 }, () => {
  it('sits behind the shoulder girdle, over the ribcage near the center of mass (not on the wing roots)', () => {
    for (const breed of BREED_ORDER) {
      for (const saddle of ['rider', 'racing', 'royal', 'nomad']) {
        const w = new Wyvern({ ...DEFAULT_WYVERN, breed, saddle });
        const seat = w.seatOffset(new Vector3());
        const T = w.rigDef.props.shape.torsoLength;
        const shoulderZ = w.rigDef.props.shoulder[2];
        expect(seat.z).toBeGreaterThan(-0.02 * T);
        expect(seat.z).toBeLessThan(0.12 * T);
        // Well behind the shoulder joints, where the flight muscles heave with every beat.
        expect(shoulderZ - seat.z).toBeGreaterThan(0.18 * T);
        w.dispose();
      }
    }
  });

  it('wraps the legs around the barrel: knees in at the saddle, shins down the ribs, never inside the body', () => {
    for (const breed of BREED_ORDER) {
      const w = new Wyvern({ ...DEFAULT_WYVERN, breed });
      const r = new Rider(DEFAULT_RIDER, { saddle: w.saddle });
      const wp = wyvernPose('stand', breed);
      const rp = createRiderPose();
      rp.mounted = true;
      rp.action = 'mounted';
      for (let i = 0; i < 60; i++) {
        w.update(1 / 60, wp);
        r.update(1 / 60, rp, w.saddle);
      }
      const flank = w.saddle.userData.flank as SaddleFlank;
      const inv = w.saddle.matrixWorld.clone().invert();
      const bones = riderBones(r);
      for (const [knee, foot] of [
        ['shinL', 'footL'],
        ['shinR', 'footR'],
      ] as const) {
        const k = bones[B[knee]].getWorldPosition(new Vector3()).applyMatrix4(inv);
        const f = bones[B[foot]].getWorldPosition(new Vector3()).applyMatrix4(inv);
        // Ankle outside the ribs (saddle space; x is sideways).
        expect(Math.abs(f.x)).toBeGreaterThan(flankHalfWidth(flank, f.y));
        // Knees in: no splits — the knee stays well below the hips and close to the grip width.
        expect(k.y).toBeLessThan(-0.08);
        expect(Math.abs(k.x)).toBeLessThan(0.62);
      }
      w.dispose();
      r.dispose();
    }
  });

  for (const breed of BREED_ORDER) {
    it(`never sweeps a wing through the rider (${breed}: glide, full wingbeat, bank, flare, dive, standing)`, () => {
      for (const saddle of ['rider', 'racing', 'royal']) {
        for (const kind of ['stand', 'glide', 'flap', 'bank', 'flare', 'tuck'] as Flight[]) {
          const gap = wingClearance(breed, saddle, kind, kind === 'tuck' ? 1 : 0);
          expect(gap, `${breed} ${saddle} ${kind}`).toBeGreaterThan(0.02);
        }
      }
    });
  }
});
