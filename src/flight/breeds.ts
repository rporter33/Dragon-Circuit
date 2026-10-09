// The four breeds. Numbers are physical (kg, m², N) so differences in feel fall out of the
// flight model rather than per-breed fudge factors:
//   - wing loading (mass / area) sets cruise and stall speed,
//   - aspect ratio (span² / area) sets induced drag, so glide ratio,
//   - mass sets momentum: heavy breeds dive harder and carry speed through turns, but are slow
//     to change direction and need strong flaps to climb.
//
// Measured with src/flight/telemetry.ts (still air, 120 Hz) — FlightModel.test.ts and
// breeds.test.ts hold them. A held pull no longer breaks the stall (soft protection): stall is
// the 1 g stall speed. Climb is a held-flap climb; circling is the sink rate circling at 35° of
// bank at the race autopilot's thermalling speed (a thermal lifts the wyvern at its strength minus
// that); stamina is seconds of full flapping (×1.4 when Rested), and an empty meter still gives
// weak beats.
//
//              span    cruise  stall  best glide  tucked dive  roll rate  roll in/out  climb    circling  stamina  beat     down
//   harrier    15.5 m  23 m/s  13.9   10.3 : 1    86 m/s       1.76 r/s   0.36/0.19 s  6.3 m/s  2.35 m/s  16 s     1.15 Hz  0.57
//   skimmer    13      21.4    12.9   8.8         80           2.53       0.35/0.17    6.6      2.56      12       1.35     0.54
//   galewing   20.5    21.3    12.8   13.8        80           1.01       0.64/0.31    4.3      1.56      20       0.75     0.60
//   ironback   16      26      15.7   9.6         95           1.16       0.49/0.29    3.9      2.87      14.5     1.0      0.62
//
// The bigger wings (B8, the client: "the wingspan could be scaled to be larger, which may help with
// the ascending"). Span +16–19% (harrier 13 → 15.5 m, skimmer 11.2 → 13, galewing 17.5 → 20.5,
// ironback 13.5 → 16); the area follows half as fast (+8–9%: a slimmer chord, so a higher aspect
// ratio), so the wing loading and the stall and cruise speeds come down only 4%. The beat keeps its
// angle and its rate, so a longer wing's stroke sweeps a longer arc: peak stroke thrust and lift
// scale with the span (the ironback's by 8% only, so it stays the breed whose every climb is
// earned: its heavy body gains the most from the longer span's lower induced drag). Against the
// 13 m wings: a held-flap climb +18–26% (harrier 5.0 → 6.3 m/s), circling sink −16–19% (a 5 m/s
// thermal lifts the harrier at 2.65 m/s, was 2.1), best glide +12–15%, tucked dive −3%; roll rates
// unchanged, roll-in 2–6% slower (more wing to swing). The skimmer's beat slows from 1.6 to 1.35 Hz
// to stay within its size's scaling law (its new 13 m wing is the harrier's old one); still the
// quickest wings.
//
// Stamina (the client: "the stamina seems a bit low"): +19–21% per breed (harrier 13.5 → 16 s,
// skimmer 10 → 12, galewing 16.5 → 20, ironback 12 → 14.5), regen unchanged as a share of the
// meter per second, so a full refill takes as long as before. Measured endurance of full beats
// until the meter is empty: 14.5 → 17.3 / 10.7 → 12.8 / 17.4 → 21.2 / 12.3 → 15.5 s. With the
// bigger wings a full meter climbs about half again as high (harrier 73 → 109 m); landing is
// still the quick way back to full (and Rested). Every stat stays a plain number here: nothing
// elsewhere scales it, so a multiplier on it (the bond) has its full effect.
//
// Wingbeats are size-true (FANIM-04: Pennycuick's scaling for each breed's mass, span and area
// gives 0.5–0.8 Hz; the skimmer stays the quick-winged breed). `down` is the share of each beat
// spent on the power stroke (big flyers drive down for longer than they recover). The flight
// model advances the beat at flapRate, so thrust per SECOND is the peak × down/2 whatever the
// rate: a slower beat is a longer, bigger surge for the same work. flapThrust/flapLift are the
// stroke's peak (an even, down 0.5, stroke of the same mean would peak at × 2·down).
//
// The 0..1 display ratings below are read off that table: speed (dive + top flapping speed),
// agility (roll rate), glide (best glide ratio), power (sustained climb), stamina (seconds).

import type { BreedId, BreedStats } from '../core/types';
import { DEG } from '../core/math';

function inducedK(span: number, area: number, oswald = 0.8): number {
  const ar = (span * span) / area;
  return 1 / (Math.PI * oswald * ar);
}

/** Downstroke fraction of a beat for a breed that doesn't give its own (BreedStats.downFrac). */
export const DEFAULT_DOWN_FRAC = 0.5;

export const BREEDS: Record<BreedId, BreedStats> = {
  harrier: {
    id: 'harrier',
    name: 'Harrier',
    tagline: 'The all-rounder',
    description: 'Steady, forgiving and quick to answer the reins. Every rider in the Drift learned on one.',
    mass: 650,
    wingArea: 41.5,
    wingspan: 15.5,
    liftSlope: 4.6,
    clMax: 1.45,
    stallAngle: 17 * DEG,
    cd0: 0.0285,
    inducedK: inducedK(15.5, 41.5),
    flapThrust: 14950,
    flapLift: 6800,
    flapRate: 1.15,
    downFrac: 0.57,
    staminaSeconds: 16,
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
    description: 'Small, quick-winged and nervous. Turns on a coin and sprints on rapid wingbeats, but tires fast and bleeds speed in a glide.',
    mass: 470,
    wingArea: 32.3,
    wingspan: 13,
    liftSlope: 4.4,
    clMax: 1.57,
    stallAngle: 18 * DEG,
    cd0: 0.036,
    inducedK: inducedK(13, 32.3),
    flapThrust: 12900,
    flapLift: 5150,
    flapRate: 1.35,
    downFrac: 0.54,
    staminaSeconds: 12,
    staminaRegen: 0.16,
    rollAuthority: 8.5,
    pitchAuthority: 4.6,
    yawAuthority: 1.8,
    angularDamping: 4.2,
    maxRollRate: 2.6,
    groundSpeed: 11,
    standHeight: 2.1,
    ratings: { speed: 0.55, agility: 0.95, glide: 0.45, power: 0.9, stamina: 0.55 },
  },
  galewing: {
    id: 'galewing',
    name: 'Galewing',
    tagline: 'Rides the wind forever',
    description: 'Enormous, slender wings and a patient temperament. Glides farther than anything alive, but turns like a ship.',
    mass: 640,
    wingArea: 49.8,
    wingspan: 20.5,
    liftSlope: 5.0,
    clMax: 1.4,
    stallAngle: 15 * DEG,
    cd0: 0.024,
    inducedK: inducedK(20.5, 49.8, 0.85),
    flapThrust: 10050,
    flapLift: 6830,
    flapRate: 0.75,
    downFrac: 0.6,
    staminaSeconds: 20,
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
    wingArea: 45.7,
    wingspan: 16,
    liftSlope: 4.4,
    clMax: 1.46,
    stallAngle: 16 * DEG,
    cd0: 0.031,
    inducedK: inducedK(16, 45.7, 0.78),
    flapThrust: 13070,
    flapLift: 9150,
    flapRate: 1.0,
    downFrac: 0.62,
    staminaSeconds: 14.5,
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
