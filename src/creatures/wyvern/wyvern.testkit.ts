// Shared poses and helpers for the wyvern test files (wyvern.*.test.ts).

import { Vector3 } from 'three';
import type { BreedId, WyvernLook, WyvernPose } from '../../core/types';
import { BREEDS } from '../../flight/breeds';
import { DEFAULT_WYVERN } from '../../cosmetics/catalog';
import { createWyvernPose } from '../../player/poses';
import { Wyvern } from './Wyvern';

const _p = new Vector3();
const _q = new Vector3();

export const look = (breed: BreedId, extra: Partial<WyvernLook> = {}): WyvernLook => ({ ...DEFAULT_WYVERN, breed, ...extra });

/** A standing pose with the body center at standHeight above a flat ground at y = 10. */
export function standing(breed: BreedId): WyvernPose {
  const p = createWyvernPose();
  p.position.set(0, 10 + BREEDS[breed].standHeight, 0);
  p.airborne = false;
  p.wingSpread = 0.22;
  p.gait = 'idle';
  p.groundY = 10;
  p.lookTarget.set(0, 13, 40);
  return p;
}

export function gliding(): WyvernPose {
  const p = createWyvernPose();
  p.position.set(0, 300, 0);
  p.velocity.set(0, 0, 24);
  p.airspeed = 24;
  p.airborne = true;
  p.wingSpread = 1;
  p.lookTarget.set(0, 300, 40);
  return p;
}

export function boneWorld(w: Wyvern, name: string): Vector3 {
  const mesh = w.skinnedMesh!;
  const bone = mesh.skeleton.bones.find((b) => b.name === name)!;
  return bone.getWorldPosition(new Vector3());
}

/**
 * Saddle, shoulder (neck base) and head heights (relative to the body center) over the last
 * wingbeat of a flight (gliding at 24 m/s, flapStrength 1, the breed's own beat rate).
 */
export function beat(breed: BreedId) {
  const w = new Wyvern(look(breed));
  const pose = gliding();
  pose.flapStrength = 1;
  const rate = BREEDS[breed].flapRate;
  const neck0 = w.skinnedMesh!.skeleton.bones.find((b) => b.name === 'neck0')!;
  const samples: { phase: number; saddle: number; shoulders: number; head: number }[] = [];
  const n = Math.round(60 / rate);
  for (let i = 0; i < 600; i++) {
    pose.flapPhase = ((i / 60) * rate) % 1;
    pose.position.z += 24 / 60;
    pose.lookTarget.z += 24 / 60;
    w.update(1 / 60, pose);
    if (i >= 600 - n) {
      samples.push({
        phase: pose.flapPhase,
        saddle: w.saddle.getWorldPosition(_p).y - pose.position.y,
        shoulders: neck0.getWorldPosition(_p).y - pose.position.y,
        head: w.getHead(_q).y - pose.position.y,
      });
    }
  }
  w.dispose();
  type K = 'saddle' | 'shoulders' | 'head';
  const range = (k: K) => Math.max(...samples.map((s) => s[k])) - Math.min(...samples.map((s) => s[k]));
  const peak = (k: K) => samples.reduce((a, b) => (b[k] > a[k] ? b : a)).phase;
  return {
    saddleRange: range('saddle'),
    shoulderRange: range('shoulders'),
    headRange: range('head'),
    saddlePeak: peak('saddle'),
    shoulderPeak: peak('shoulders'),
    headPeak: peak('head'),
  };
}

