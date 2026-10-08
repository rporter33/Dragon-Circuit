// Controller haptics. Gameplay announces events; this module turns each into a short, distinct
// rumble pattern so you can feel the game without looking: a soft pulse per wingbeat, a
// rhythmic buzz while stalled, a hard jolt when you clip rock, a thud on touchdown, a crisp
// double tap through a ring.
//
// Three layers:
//   - pulseEnvelope / HapticMixer: pure envelope maths. Overlapping pulses mix by taking the
//     loudest value per motor, so a stall buzz under a wingbeat stays readable.
//   - PATTERNS: event → list of timed pulses (pure; the tests compare their signatures).
//   - Haptics: subscribes to the event bus and plays patterns into a RumbleSink (Input), which
//     owns the actual GamepadHapticActuator and respects device + settings.

import type { GameEventBus } from '../core/events';
import type { Medal, Settings } from '../core/types';
import { clamp01 } from '../core/math';

export type PulseShape = 'flat' | 'decay' | 'swell';

export interface RumblePulse {
  /** Low-frequency, heavy motor (0..1). */
  strong: number;
  /** High-frequency, buzzy motor (0..1). */
  weak: number;
  /** Impulse-trigger motors where the browser supports 'trigger-rumble' (Xbox), 0..1. */
  left?: number;
  right?: number;
  /** Total length in ms. */
  ms: number;
  /** Rise time in ms (default 6). 0 = instant hit. */
  attackMs?: number;
  /** flat: hold then cut. decay: hit then fade (quadratic). swell: rise and fall (sine). */
  shape?: PulseShape;
}

export interface RumbleLevels {
  strong: number;
  weak: number;
  left: number;
  right: number;
}

export interface PatternStep {
  /** Start offset in ms from when the pattern is played. */
  at: number;
  pulse: RumblePulse;
}

/** Where patterns are played. Input implements this. */
export interface RumbleSink {
  pulse(p: RumblePulse, delayMs?: number): void;
}

/** Envelope gain (0..1) of a pulse `t` ms after it started. */
export function pulseEnvelope(p: RumblePulse, t: number): number {
  if (t < 0 || t >= p.ms) return 0;
  const shape = p.shape ?? 'decay';
  if (shape === 'swell') return Math.sin((Math.PI * t) / p.ms);
  const a = Math.min(p.attackMs ?? 6, p.ms * 0.5);
  if (t < a) return t / a;
  if (shape === 'flat') return 1;
  const u = (t - a) / Math.max(1, p.ms - a);
  return (1 - u) * (1 - u);
}

interface ActivePulse {
  p: RumblePulse;
  /** ms since start; negative while still delayed. */
  t: number;
}

const MAX_ACTIVE = 24;

/** Mixes overlapping pulses into four motor levels. Pure: time only moves via advance(). */
export class HapticMixer {
  private active: ActivePulse[] = [];

  add(p: RumblePulse, delayMs = 0): void {
    if (this.active.length >= MAX_ACTIVE) this.active.shift();
    this.active.push({ p, t: -Math.max(0, delayMs) });
  }

  play(steps: PatternStep[]): void {
    for (const s of steps) this.add(s.pulse, s.at);
  }

  advance(dtMs: number): void {
    const list = this.active;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      a.t += dtMs;
      if (a.t < a.p.ms) list[w++] = a;
    }
    list.length = w;
  }

  sample(out: RumbleLevels): RumbleLevels {
    out.strong = out.weak = out.left = out.right = 0;
    for (const a of this.active) {
      const e = pulseEnvelope(a.p, a.t);
      if (e <= 0) continue;
      out.strong = Math.max(out.strong, clamp01(a.p.strong) * e);
      out.weak = Math.max(out.weak, clamp01(a.p.weak) * e);
      out.left = Math.max(out.left, clamp01(a.p.left ?? 0) * e);
      out.right = Math.max(out.right, clamp01(a.p.right ?? 0) * e);
    }
    return out;
  }

  clear(): void {
    this.active.length = 0;
  }

  get busy(): boolean {
    return this.active.length > 0;
  }
}

/** Seconds between buzzes while stalled. */
export const STALL_PERIOD = 0.26;

const MEDAL_WEIGHT: Record<Medal, number> = { none: 0, bronze: 0.1, silver: 0.2, gold: 0.35 };

/** Event → pulses. Each is tuned to be recognisable with eyes closed. */
export const PATTERNS = {
  /** A soft push on each downstroke, scaled by how hard the trigger is pulled. */
  flap(strength: number): PatternStep[] {
    const s = clamp01(strength);
    return [{ at: 0, pulse: { strong: 0.1 + 0.22 * s, weak: 0.14 + 0.16 * s, right: 0.35 * s, ms: 90 + 60 * s, attackMs: 14, shape: 'decay' } }];
  },
  /** Too winded to beat: two faint ticks, like a stutter. */
  flapRefused(): PatternStep[] {
    const tick: RumblePulse = { strong: 0, weak: 0.22, ms: 35, shape: 'flat' };
    return [{ at: 0, pulse: tick }, { at: 80, pulse: tick }];
  },
  /** One beat of the stall buzz (played every STALL_PERIOD while stalled). */
  stallBeat(): PatternStep[] {
    return [{ at: 0, pulse: { strong: 0.08, weak: 0.4, left: 0.25, ms: 75, attackMs: 4, shape: 'flat' } }];
  },
  /** Clipping rock: an instant hard jolt with a rumbling tail. */
  terrainHit(impulse: number): PatternStep[] {
    const k = clamp01(impulse / 18);
    return [
      { at: 0, pulse: { strong: 0.5 + 0.5 * k, weak: 0.55 + 0.35 * k, left: 0.6 * k, right: 0.6 * k, ms: 140 + 160 * k, attackMs: 0, shape: 'decay' } },
      { at: 0, pulse: { strong: 0.2 + 0.25 * k, weak: 0.12, ms: 420 + 200 * k, attackMs: 0, shape: 'decay' } },
    ];
  },
  /** Feet meet ground: a low thud, heavier for harder landings, almost no buzz. */
  touchdown(impact: number): PatternStep[] {
    const k = clamp01(impact / 12);
    return [{ at: 0, pulse: { strong: 0.3 + 0.55 * k, weak: 0.06 + 0.18 * k, ms: 150 + 110 * k, attackMs: 0, shape: 'decay' } }];
  },
  takeoff(): PatternStep[] {
    return [{ at: 0, pulse: { strong: 0.4, weak: 0.12, ms: 230, attackMs: 40, shape: 'decay' } }];
  },
  /** Through a ring: crisp double tap on the light motor. */
  ringPassed(): PatternStep[] {
    const tap: RumblePulse = { strong: 0.04, weak: 0.62, ms: 45, attackMs: 0, shape: 'flat' };
    return [{ at: 0, pulse: tap }, { at: 85, pulse: tap }];
  },
  /** Missed a ring: one dull, flat buzz. */
  ringMissed(): PatternStep[] {
    return [{ at: 0, pulse: { strong: 0.3, weak: 0.04, ms: 190, shape: 'flat' } }];
  },
  collect(): PatternStep[] {
    return [{ at: 0, pulse: { strong: 0, weak: 0.22, ms: 50, attackMs: 0, shape: 'decay' } }];
  },
  unlock(): PatternStep[] {
    return [
      { at: 0, pulse: { strong: 0, weak: 0.3, ms: 55, shape: 'flat' } },
      { at: 110, pulse: { strong: 0.05, weak: 0.45, ms: 80, shape: 'decay' } },
    ];
  },
  countdown(count: number): PatternStep[] {
    return count > 0 ? [{ at: 0, pulse: { strong: 0.04, weak: 0.3, ms: 60, shape: 'flat' } }] : [];
  },
  raceStart(): PatternStep[] {
    return [{ at: 0, pulse: { strong: 0.55, weak: 0.5, right: 0.4, left: 0.4, ms: 280, attackMs: 0, shape: 'decay' } }];
  },
  /** Finish: four rising taps, then a swell that is fuller for better medals; sparkle on a record. */
  raceFinish(medal: Medal, newBest: boolean): PatternStep[] {
    const steps: PatternStep[] = [];
    for (let i = 0; i < 4; i++) {
      steps.push({ at: i * 110, pulse: { strong: 0.03, weak: 0.25 + 0.1 * i, ms: 45, shape: 'flat' } });
    }
    const m = MEDAL_WEIGHT[medal];
    steps.push({ at: 450, pulse: { strong: 0.25 + m, weak: 0.4 + m * 0.5, ms: 650, shape: 'swell' } });
    if (newBest) {
      steps.push({ at: 1150, pulse: { strong: 0, weak: 0.5, ms: 40, shape: 'flat' } });
      steps.push({ at: 1230, pulse: { strong: 0, weak: 0.55, ms: 40, shape: 'flat' } });
    }
    return steps;
  },
  /** Walked off an edge: a sick, slow lurch. */
  fellOff(): PatternStep[] {
    return [{ at: 0, pulse: { strong: 0.32, weak: 0.08, ms: 800, shape: 'swell' } }];
  },
  /** Caught by the wyvern: a firm thump. */
  caught(): PatternStep[] {
    return [{ at: 0, pulse: { strong: 0.75, weak: 0.4, ms: 230, attackMs: 0, shape: 'decay' } }];
  },
  respawn(): PatternStep[] {
    return [{ at: 0, pulse: { strong: 0.12, weak: 0.18, ms: 300, shape: 'swell' } }];
  },
  mount(): PatternStep[] {
    return [{ at: 0, pulse: { strong: 0.22, weak: 0.08, ms: 110, attackMs: 0, shape: 'decay' } }];
  },
  /** The wyvern's footfalls while you ride it on the ground. */
  heavyStep(): PatternStep[] {
    return [{ at: 0, pulse: { strong: 0.14, weak: 0, ms: 70, attackMs: 0, shape: 'decay' } }];
  },
};

/** Subscribes to gameplay events and plays haptic patterns. Call update(dt) once per frame. */
export class Haptics {
  private stalled = false;
  private stallTimer = 0;
  private unsubscribe: (() => void)[] = [];

  constructor(
    events: GameEventBus,
    private sink: RumbleSink,
    private settings: () => Settings,
  ) {
    const u = this.unsubscribe;
    u.push(events.on('flap', ({ strength }) => this.play(PATTERNS.flap(strength))));
    u.push(events.on('flapRefused', () => this.play(PATTERNS.flapRefused())));
    u.push(events.on('stallStart', () => {
      this.stalled = true;
      this.stallTimer = 0;
    }));
    u.push(events.on('stallEnd', () => (this.stalled = false)));
    u.push(events.on('terrainHit', ({ impulse }) => this.play(PATTERNS.terrainHit(impulse))));
    u.push(events.on('touchdown', ({ impact }) => {
      this.stalled = false;
      this.play(PATTERNS.touchdown(impact));
    }));
    u.push(events.on('takeoff', () => this.play(PATTERNS.takeoff())));
    u.push(events.on('footstep', ({ heavy }) => heavy && this.play(PATTERNS.heavyStep())));
    u.push(events.on('mount', () => this.play(PATTERNS.mount())));
    u.push(events.on('dismount', () => this.play(PATTERNS.mount())));
    u.push(events.on('fellOff', () => this.play(PATTERNS.fellOff())));
    u.push(events.on('caught', () => this.play(PATTERNS.caught())));
    u.push(events.on('respawn', () => {
      this.stalled = false;
      this.play(PATTERNS.respawn());
    }));
    u.push(events.on('modeChange', ({ to }) => {
      if (to !== 'flying') this.stalled = false;
    }));
    u.push(events.on('raceCountdown', ({ count }) => this.play(PATTERNS.countdown(count))));
    u.push(events.on('raceStart', () => this.play(PATTERNS.raceStart())));
    u.push(events.on('ringPassed', () => this.play(PATTERNS.ringPassed())));
    u.push(events.on('ringMissed', () => this.play(PATTERNS.ringMissed())));
    u.push(events.on('raceFinish', ({ medal, newBest }) => this.play(PATTERNS.raceFinish(medal, newBest))));
    u.push(events.on('collect', () => this.play(PATTERNS.collect())));
    u.push(events.on('unlock', () => this.play(PATTERNS.unlock())));
  }

  /** Drives the rhythmic stall buzz. */
  update(dt: number): void {
    if (!this.stalled) return;
    this.stallTimer -= dt;
    if (this.stallTimer <= 0) {
      this.play(PATTERNS.stallBeat());
      // Keep the rhythm steady, but don't build a backlog after a long frame.
      this.stallTimer = Math.max(this.stallTimer + STALL_PERIOD, STALL_PERIOD * 0.5);
    }
  }

  get isStalled(): boolean {
    return this.stalled;
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
  }

  private play(steps: PatternStep[]): void {
    if (!this.settings().rumble) return;
    for (const s of steps) this.sink.pulse(s.pulse, s.at);
  }
}
