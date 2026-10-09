// The four breeds. Numbers are physical (kg, m², N) so differences in feel fall out of the
// flight model rather than per-breed fudge factors:
//   - wing loading (mass / area) sets cruise and stall speed,
//   - aspect ratio (span² / area) sets induced drag, so glide ratio,
//   - mass sets momentum: heavy breeds dive harder and carry speed through turns, but are slow
//     to change direction and need strong flaps to climb.
//
// Measured with src/flight/telemetry.ts (still air, 120 Hz) — FlightModel.test.ts and
// breeds.test.ts hold them. Stall = 1 g stall speed / where a slow hauled-back stall breaks.
//
//              cruise  stall      best glide  tucked dive  roll rate  roll in/out  climb    stamina
//   harrier    24 m/s  14.5/14.8  8.9 : 1     81 m/s       1.76 r/s   0.34/0.34 s  5.0 m/s  9 s
//   skimmer    23      13.6/13.9  7.3         74           2.53       0.33/0.33    4.2      6.5
//   galewing   22      13.3/13.1  12.3        75           1.01       0.62/0.57    3.3      11
//   ironback   27      16.4/16.6  8.0         89           1.16       0.48/0.48    3.2      8
//
// The 0..1 display ratings below are read off that table: speed (dive + top flapping speed),
// agility (roll rate), glide (best glide ratio), power (sustained climb), stamina (seconds).

import type { BreedId, BreedStats } from '../core/types';
import { DEG } from '../core/math';

function inducedK(span: number, area: number, oswald = 0.8): number {
  const ar = (span * span) / area;
  return 1 / (Math.PI * oswald * ar);
}

export const BREEDS: Record<BreedId, BreedStats> = {
  harrier: {
    id: 'harrier',
    name: 'Harrier',
    tagline: 'The all-rounder',
    description: 'Steady, forgiving and quick to answer the reins. Every rider in the Drift learned on one.',
    mass: 650,
    wingArea: 38,
    wingspan: 13,
    liftSlope: 4.6,
    clMax: 1.45,
    stallAngle: 17 * DEG,
    cd0: 0.0285,
    inducedK: inducedK(13, 38),
    flapThrust: 14300,
    flapLift: 6500,
    flapRate: 1.45,
    staminaSeconds: 13.5,
    staminaRegen: 0.12,
    rollAuthority: 5.6,
    pitchAuthority: 3.4,
    yawAuthority: 1.2,
    angularDamping: 3.2,
    maxRollRate: 1.8,
    groundSpeed: 9,
    standHeight: 2.6,
    ratings: { speed: 0.7, agility: 0.68, glide: 0.62, power: 0.85, stamina: 0.75 },
  },
  skimmer: {
    id: 'skimmer',
    name: 'Skimmer',
    tagline: 'Light and twitchy',
    description: 'Small, quick-winged and nervous. Turns on a coin, but tires fast and bleeds speed in a glide.',
    mass: 470,
    wingArea: 30,
    wingspan: 11.2,
    liftSlope: 4.4,
    clMax: 1.57,
    stallAngle: 18 * DEG,
    cd0: 0.036,
    inducedK: inducedK(11.2, 30),
    flapThrust: 12000,
    flapLift: 4800,
    flapRate: 2.1,
    staminaSeconds: 10,
    staminaRegen: 0.16,
    rollAuthority: 8.5,
    pitchAuthority: 4.6,
    yawAuthority: 1.8,
    angularDamping: 4.2,
    maxRollRate: 2.6,
    groundSpeed: 11,
    standHeight: 2.1,
    ratings: { speed: 0.45, agility: 0.95, glide: 0.45, power: 0.7, stamina: 0.55 },
  },
  galewing: {
    id: 'galewing',
    name: 'Galewing',
    tagline: 'Rides the wind forever',
    description: 'Enormous, slender wings and a patient temperament. Glides farther than anything alive, but turns like a ship.',
    mass: 640,
    wingArea: 46,
    wingspan: 17.5,
    liftSlope: 5.0,
    clMax: 1.4,
    stallAngle: 15 * DEG,
    cd0: 0.024,
    inducedK: inducedK(17.5, 46, 0.85),
    flapThrust: 10300,
    flapLift: 7000,
    flapRate: 0.95,
    staminaSeconds: 16.5,
    staminaRegen: 0.1,
    rollAuthority: 1.9,
    pitchAuthority: 2.6,
    yawAuthority: 0.9,
    angularDamping: 1.9,
    maxRollRate: 1.05,
    groundSpeed: 7.5,
    standHeight: 2.5,
    ratings: { speed: 0.45, agility: 0.35, glide: 1.0, power: 0.5, stamina: 1.0 },
  },
  ironback: {
    id: 'ironback',
    name: 'Ironback',
    tagline: 'A falling mountain',
    description: 'Thick-hided and heavy-boned. Dives like a stone and carries its speed through anything, but every climb is earned.',
    mass: 920,
    wingArea: 42,
    wingspan: 13.5,
    liftSlope: 4.4,
    clMax: 1.46,
    stallAngle: 16 * DEG,
    cd0: 0.031,
    inducedK: inducedK(13.5, 42, 0.78),
    flapThrust: 15000,
    flapLift: 10500,
    flapRate: 1.0,
    staminaSeconds: 12,
    staminaRegen: 0.14,
    rollAuthority: 2.3,
    pitchAuthority: 2.5,
    yawAuthority: 0.9,
    angularDamping: 2.0,
    maxRollRate: 1.2,
    groundSpeed: 8,
    standHeight: 2.9,
    ratings: { speed: 0.95, agility: 0.42, glide: 0.52, power: 0.48, stamina: 0.68 },
  },
};

export const BREED_ORDER: BreedId[] = ['harrier', 'skimmer', 'galewing', 'ironback'];
