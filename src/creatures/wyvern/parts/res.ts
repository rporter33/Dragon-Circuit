// Geometric resolution profiles for the three levels of detail. Every part builder takes one, so
// the same rig and look build at any LOD on the same skeleton (identical bones and indices):
//   LOD0  close-ups (Stable, title, on foot, the player's chase camera): smooth silhouettes and
//         the small anatomy (teeth, lid rims, toe and finger joints, nostrils)
//   LOD1  mid distance and quality 'low' (also the fixed LOD of race ghosts): ~5k triangles
//   LOD2  far: ~1.5k triangles, the membranes as fans, no claws, teeth or tongue
// Detail that only reads up close is gated by the flags, not just thinned.

import type { BreedId } from '../../../core/types';

export type Lod = 0 | 1 | 2;

export interface Res {
  lod: Lod;
  /** Body tube vertices around (the scale rows need an even count, with one on the spine). */
  bodyAround: number;
  /** Multiplier on the body's station spacing along the tube. */
  stationStep: number;
  /** Ring sides of the hind legs and of the arm tube. */
  legAround: number;
  armAround: number;
  /** Extra rings along the humerus and thigh (0 = only the joints and the muscle keys). */
  limbRings: number;
  /** Skull: rings around and stations from the back of the skull to the snout. */
  headAround: number;
  headStations: number;
  /** Lower jaw: stations along and ring sides. */
  jawStations: number;
  jawAround: number;
  /** Eye ellipsoid (rings, sides). */
  eye: [number, number];
  /** Wing fingers: rings along and sides. */
  fingerRings: number;
  fingerSides: number;
  /** Membrane grid multiplier (1 = the 16×8 / 16×10 / 10×2 base grids); 0 = fans. */
  membrane: number;
  /** Generic small spikes (horns, spines, claws, toes): sides and path samples multiplier. */
  spikeSides: number;
  spikeSteps: number;
  /** Teeth per side (upper, lower); 0 = none. */
  teeth: [number, number];
  /** Tooth geometry: sides and segments. */
  toothSides: number;
  toothSegs: number;
  tongue: boolean;
  lids: boolean;
  /** Joint bulges on toes and fingers, knuckle bulges on the hand digits. */
  joints: boolean;
  /** Nostril bosses and slits (else a painted dot). */
  nostrils: boolean;
  claws: boolean;
  /** Saddle and plate detail: 2 full, 1 simplified, 0 a bare shell. */
  tack: 0 | 1 | 2;
}

export const RES: Record<Lod, Res> = {
  0: {
    lod: 0,
    bodyAround: 24,
    stationStep: 1,
    legAround: 14,
    armAround: 12,
    limbRings: 2,
    headAround: 22,
    headStations: 24,
    jawStations: 16,
    jawAround: 16,
    eye: [10, 16],
    fingerRings: 8,
    fingerSides: 7,
    membrane: 1.5,
    spikeSides: 1,
    spikeSteps: 1,
    teeth: [9, 8],
    toothSides: 4,
    toothSegs: 4,
    tongue: true,
    lids: true,
    joints: true,
    nostrils: true,
    claws: true,
    tack: 2,
  },
  1: {
    lod: 1,
    bodyAround: 14,
    stationStep: 1.7,
    legAround: 10,
    armAround: 8,
    limbRings: 0,
    headAround: 12,
    headStations: 12,
    jawStations: 7,
    jawAround: 8,
    eye: [5, 8],
    fingerRings: 4,
    fingerSides: 5,
    membrane: 0.625,
    spikeSides: 0.6,
    spikeSteps: 0.5,
    teeth: [5, 4],
    toothSides: 3,
    toothSegs: 1,
    tongue: false,
    lids: false,
    joints: false,
    nostrils: false,
    claws: true,
    tack: 1,
  },
  2: {
    lod: 2,
    bodyAround: 8,
    stationStep: 3.6,
    legAround: 6,
    armAround: 5,
    limbRings: 0,
    headAround: 8,
    headStations: 5,
    jawStations: 2,
    jawAround: 4,
    eye: [2, 4],
    fingerRings: 2,
    fingerSides: 3,
    membrane: 0,
    spikeSides: 0.4,
    spikeSteps: 0.25,
    teeth: [0, 0],
    toothSides: 3,
    toothSegs: 1,
    tongue: false,
    lids: false,
    joints: false,
    nostrils: false,
    claws: false,
    tack: 0,
  },
};

/** Sides for a spike designed with `n` sides at LOD0 (at least 3). */
export const sides = (res: Res, n: number) => Math.max(3, Math.round(n * res.spikeSides));
/** Path samples for a curve designed with `n` steps at LOD0 (at least 1). */
export const steps = (res: Res, n: number) => Math.max(1, Math.round(n * res.spikeSteps));
/** A count designed as `n` at LOD0 for tack and cosmetic panels (at least `min`). */
export const tackN = (res: Res, n: number, min = 1) => Math.max(min, Math.round(n * (res.tack === 2 ? 1 : res.tack === 1 ? 0.5 : 0.3)));

/**
 * Triangle budgets per breed and LOD (the dragon quality bar Q15): LOD0 at most 24k (the plated
 * ironback 30k), LOD1 6k, LOD2 1.5k.
 */
export const LOD_BUDGET: Record<BreedId, Record<Lod, number>> = {
  harrier: { 0: 24000, 1: 6000, 2: 1500 },
  skimmer: { 0: 24000, 1: 6000, 2: 1500 },
  galewing: { 0: 24000, 1: 6000, 2: 1500 },
  ironback: { 0: 30000, 1: 6000, 2: 1500 },
};
