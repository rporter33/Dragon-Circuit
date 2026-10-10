import { describe, expect, it } from 'vitest';
import { Triangle, Vector3 } from 'three';
import type { RiderLook } from '../../core/types';
import { DEFAULT_RIDER, DEFAULT_WYVERN } from '../../cosmetics/catalog';
import { BREED_ORDER } from '../../flight/breeds';
import { createRiderPose, createWyvernPose } from '../../player/poses';
import { Wyvern } from '../wyvern/Wyvern';
import { Rider } from './Rider';
import type { RiderModel } from './model';
import { B } from './rig';
import { flankHalfWidth, type SaddleFlank } from './animator';

const builds: RiderLook['build'][] = ['slight', 'medium', 'broad'];
const poses = ['idle', 'kneel', 'glide', 'flapUp', 'flapDown', 'bankL', 'bankR', 'flare'] as const;

function model(r: Rider): RiderModel {
  return (r as unknown as { model: RiderModel }).model;
}

/** A point on the boot sole under the ball, expressed relative to its ankle bone. */
function sole(r: Rider, side: 'L' | 'R'): Vector3 {
  const { rig } = model(r);
  const z = rig.dims.footLen * 0.32;
  return rig.bones[B[`foot${side}`]].localToWorld(new Vector3(
    (side === 'L' ? -1 : 1) * 0.004 * z / 0.2, -rig.bindPos[B[`foot${side}`]].y, z,
  ));
}

/** Distance to actual deformed boot triangles, independent of the animator's target point. */
function bootDistance(r: Rider, side: 'L' | 'R', target: Vector3): number {
  const { mesh, geometry } = model(r);
  const idx = geometry.index!, si = geometry.attributes.skinIndex, sw = geometry.attributes.skinWeight;
  const valid = (v: number) => {
    let weight = 0;
    for (let k = 0; k < 4; k++) {
      if (si.getComponent(v, k) === B[`foot${side}`] || si.getComponent(v, k) === B[`toe${side}`]) weight += sw.getComponent(v, k);
    }
    return weight > 0.5;
  };
  const tri = new Triangle(), point = new Vector3();
  let min = Infinity;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    if (!valid(a) || !valid(b) || !valid(c)) continue;
    mesh.getVertexPosition(a, tri.a).applyMatrix4(mesh.matrixWorld);
    mesh.getVertexPosition(b, tri.b).applyMatrix4(mesh.matrixWorld);
    mesh.getVertexPosition(c, tri.c).applyMatrix4(mesh.matrixWorld);
    min = Math.min(min, tri.closestPointToPoint(target, point).distanceTo(target));
  }
  return min;
}

describe('mounted boot contact', { timeout: 120000 }, () => {
  for (const breed of BREED_ORDER) for (const saddle of ['rider', 'racing', 'royal', 'nomad']) {
    it(`${breed}/${saddle}: keeps every build on the tread throughout the pose matrix`, () => {
      const w = new Wyvern({ ...DEFAULT_WYVERN, breed, saddle });
      try {
        for (const build of builds) {
          const r = new Rider({ ...DEFAULT_RIDER, build }, { saddle: w.saddle, socket: (name, out) => w.socket(name, out) });
          try {
            const wp = createWyvernPose(), rp = createRiderPose();
            for (const pose of poses) {
              wp.position.set(11, 300, -19);
              wp.airborne = pose !== 'idle' && pose !== 'kneel';
              wp.groundY = wp.airborne ? null : 300;
              wp.kneel = pose === 'kneel' ? 1 : 0;
              wp.wingSpread = wp.airborne ? 1 : 0.22;
              wp.flapStrength = pose.startsWith('flap') ? 1 : 0;
              wp.flapPhase = pose === 'flapUp' ? 0.75 : 0.25;
              wp.flare = pose === 'flare' ? 1 : 0;
              wp.orientation.setFromAxisAngle(new Vector3(0, 0, 1), pose === 'bankL' ? 0.7 : pose === 'bankR' ? -0.7 : 0);
              rp.crouch = pose.startsWith('flap') ? 0.35 : pose.startsWith('bank') ? 0.25 : 0;
              rp.lean = pose === 'bankL' ? 0.8 : pose === 'bankR' ? -0.8 : 0;
              rp.brace = pose === 'flare' ? 1 : 0;
              for (let f = 0; f < 90; f++) {
                w.update(1 / 60, wp);
                r.update(1 / 60, rp, w.saddle);
              }
              for (const side of ['L', 'R'] as const) {
                const target = w.socket(`stirrup${side}`, new Vector3())!;
                expect(sole(r, side).distanceTo(target), `${build}/${pose}/${side}`).toBeLessThanOrEqual(0.02);
                const surfaceDistance = bootDistance(r, side, target);
                expect(surfaceDistance, `${build}/${pose}/${side} surface`).toBeLessThanOrEqual(0.02);
                // Stay outside the 18 mm metal rod at the tread centre, rather than embedding
                // the sole to obtain a deceptively smaller socket distance.
                expect(surfaceDistance, `${build}/${pose}/${side} metal clearance`).toBeGreaterThanOrEqual(0.018);
                const treadTop = new Vector3(0, 1, 0).transformDirection(w.saddle.matrixWorld).multiplyScalar(0.018).add(target);
                expect(bootDistance(r, side, treadTop), `${build}/${pose}/${side} tread top`).toBeLessThan(0.003);
                const { rig } = model(r);
                const hip = rig.bones[B[`thigh${side}`]].getWorldPosition(new Vector3());
                const ankle = rig.bones[B[`foot${side}`]].getWorldPosition(new Vector3());
                expect(hip.distanceTo(ankle) / (rig.dims.thigh + rig.dims.shin), `${build}/${pose}/${side} reach`).toBeLessThan(0.99);
                const inv = w.saddle.matrixWorld.clone().invert();
                const knee = rig.bones[B[`shin${side}`]].getWorldPosition(new Vector3()).applyMatrix4(inv);
                const foot = ankle.clone().applyMatrix4(inv);
                const localHip = hip.clone().applyMatrix4(inv);
                // Forward knees with the shin folded back, rather than a sideways split.
                expect(knee.z - localHip.z, `${build}/${pose}/${side} knee leads hip`).toBeGreaterThan(0);
                // The neutral seat has a clear forward knee. Flare deliberately shifts the
                // hips forward to brace; requiring the same travel there would change that
                // existing torso choreography rather than test the supported posture.
                if (pose === 'idle') expect(knee.z - localHip.z, `${build}/${side} neutral knee`).toBeGreaterThan(0.08);
                expect(knee.z - foot.z, `${build}/${pose}/${side} shin folds back`).toBeGreaterThan(0.15);
                const flank = w.saddle.userData.flank as SaddleFlank;
                // The ankle and lower shin remain outside the shared barrel profile.
                for (const mix of [0.5, 0.75, 1]) {
                  const shin = knee.clone().lerp(foot, mix);
                  expect(Math.abs(shin.x) - flankHalfWidth(flank, shin.y), `${build}/${pose}/${side} flank/${mix}`).toBeGreaterThan(0.03);
                }
              }
            }
          } finally { r.dispose(); }
        }
      } finally { w.dispose(); }
    });
  }

  it('retains the original fallback when a provider or an individual hold is missing, without stale contacts', () => {
    const w = new Wyvern(DEFAULT_WYVERN);
    let available: 'none' | 'both' | 'left' = 'none';
    const r = new Rider(DEFAULT_RIDER, { saddle: w.saddle, socket: (name, out) => available === 'both' || (available === 'left' && name === 'stirrupL') ? w.socket(name, out) : null });
    const fallback = new Rider(DEFAULT_RIDER, { saddle: w.saddle });
    const wp = createWyvernPose(), rp = createRiderPose();
    wp.position.set(0, 300, 0);
    try {
      for (let f = 0; f < 90; f++) { w.update(1 / 60, wp); r.update(1 / 60, rp, w.saddle); fallback.update(1 / 60, rp, w.saddle); }
      for (const side of ['L', 'R'] as const) expect(sole(r, side).distanceTo(sole(fallback, side))).toBeLessThan(1e-9);
      available = 'both';
      r.update(0, rp, w.saddle);
      expect(sole(r, 'L').distanceTo(w.socket('stirrupL', new Vector3())!)).toBeLessThan(0.02);
      // A foot-only attachment must not change the existing hand pose.
      fallback.update(0, rp, w.saddle);
      for (const side of ['L', 'R'] as const) {
        const a = model(r).rig.bones[B[`hand${side}`]].getWorldPosition(new Vector3());
        const b = model(fallback).rig.bones[B[`hand${side}`]].getWorldPosition(new Vector3());
        expect(a.distanceTo(b)).toBeLessThan(1e-9);
      }
      available = 'left';
      r.update(0, rp, w.saddle);
      fallback.update(0, rp, w.saddle);
      expect(sole(r, 'L').distanceTo(w.socket('stirrupL', new Vector3())!)).toBeLessThan(0.02);
      expect(sole(r, 'R').distanceTo(sole(fallback, 'R'))).toBeLessThan(1e-9);
      available = 'none';
      r.update(0, rp, w.saddle);
      fallback.update(0, rp, w.saddle);
      for (const side of ['L', 'R'] as const) expect(sole(r, side).distanceTo(sole(fallback, side))).toBeLessThan(1e-9);
    } finally { r.dispose(); fallback.dispose(); w.dispose(); }
  });

  for (const breed of BREED_ORDER) it(`${breed}: follows rebuilt looks and moving/banking tack at every approved render timing`, () => {
    const w = new Wyvern({ ...DEFAULT_WYVERN, breed });
    const r = new Rider(DEFAULT_RIDER, { saddle: w.saddle, socket: (name, out) => w.socket(name, out) });
    try {
      for (const build of builds) {
        r.setLook({ ...DEFAULT_RIDER, build });
        w.setLook({ ...DEFAULT_WYVERN, breed, saddle: build === 'broad' ? 'nomad' : 'racing' });
        for (const schedule of [[1 / 30], [1 / 60], [1 / 120], [1 / 144], [1 / 30, 1 / 144, 1 / 60, 1 / 90]]) {
          const wp = createWyvernPose(), rp = createRiderPose();
          let t = 0;
          for (let f = 0; t < 3; f++) {
            const dt = schedule[f % schedule.length];
            t += dt;
            wp.position.set(12 + t * 20, 300 + Math.sin(t), -19);
            wp.orientation.setFromAxisAngle(new Vector3(0, 0, 1), Math.sin(t * 2) * 0.7);
            wp.flapPhase = t % 1;
            wp.flapStrength = 1;
            rp.crouch = 0.35;
            rp.lean = Math.sin(t * 2) * 0.8;
            w.update(dt, wp);
            r.update(dt, rp, w.saddle);
            if (t > 1) for (const side of ['L', 'R'] as const) {
              expect(sole(r, side).distanceTo(w.socket(`stirrup${side}`, new Vector3())!), `${build}/${schedule}/${t}/${side}`).toBeLessThanOrEqual(0.02);
            }
          }
          // Paused/zero-duration presentation must keep current contacts finite and supported.
          r.update(0, rp, w.saddle);
          expect(sole(r, 'R').distanceTo(w.socket('stirrupR', new Vector3())!)).toBeLessThanOrEqual(0.02);
          wp.position.add(new Vector3(100, 50, -100));
          w.update(1 / 60, wp);
          r.update(1 / 60, rp, w.saddle);
          expect(sole(r, 'L').distanceTo(w.socket('stirrupL', new Vector3())!)).toBeLessThanOrEqual(0.02);
        }
      }
    } finally { r.dispose(); w.dispose(); }
  });

  it('leaves on-foot standing, walking, running and turning identical with a socket provider', () => {
    const w = new Wyvern(DEFAULT_WYVERN);
    try {
      for (const build of builds) {
        const look = { ...DEFAULT_RIDER, build };
        const r = new Rider(look, { saddle: w.saddle, socket: (name, out) => w.socket(name, out) });
        const fallback = new Rider(look, { saddle: w.saddle });
        try {
          const rp = createRiderPose();
          rp.mounted = false;
          for (const action of ['idle', 'walk', 'run'] as const) {
            rp.action = action;
            for (let f = 0; f < 120; f++) {
              rp.yaw += 0.005;
              const speed = action === 'idle' ? 0 : action === 'walk' ? 2 : 6;
              rp.velocity.set(Math.sin(rp.yaw) * speed, 0, Math.cos(rp.yaw) * speed);
              rp.position.addScaledVector(rp.velocity, 1 / 60);
              r.update(1 / 60, rp, null);
              fallback.update(1 / 60, rp, null);
              for (const bone of [B.footL, B.footR, B.handL, B.handR]) {
                const a = model(r).rig.bones[bone].getWorldPosition(new Vector3());
                const b = model(fallback).rig.bones[bone].getWorldPosition(new Vector3());
                expect(a.distanceTo(b), `${build}/${action}/${f}/${bone}`).toBeLessThan(1e-9);
              }
            }
          }
        } finally { r.dispose(); fallback.dispose(); }
      }
    } finally { w.dispose(); }
  });
});
