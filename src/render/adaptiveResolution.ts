// Automatic resolution: headless tests can't measure a real GPU, and players run everything from
// integrated laptop chips to desktop cards. When frames run long for a couple of seconds the
// render resolution steps down; when there is headroom for a while it steps back up, but never
// straight back to a level that was just too slow.

export interface AdaptiveResolutionOptions {
  /** Lowest automatic scale. */
  min: number;
  /** Change per step. */
  step: number;
  /** Smoothed frame time (s) above which frames count as slow. */
  slow: number;
  /** Smoothed frame time (s) below which frames count as comfortable. */
  fast: number;
  /** Seconds of slow frames before stepping down. */
  slowHold: number;
  /** Seconds of comfortable frames before stepping up. */
  fastHold: number;
  /** Seconds after any change before the next one. */
  cooldown: number;
  /** Seconds a level that proved too slow stays off limits. */
  memory: number;
}

export const DEFAULT_ADAPTIVE: AdaptiveResolutionOptions = {
  min: 0.6,
  step: 0.1,
  slow: 1 / 45,
  fast: 1 / 55,
  slowHold: 2,
  fastHold: 6,
  cooldown: 3,
  memory: 30,
};

export class AdaptiveResolution {
  scale = 1;
  private o: AdaptiveResolutionOptions;
  private ema = 1 / 60;
  private slowFor = 0;
  private fastFor = 0;
  private cooldown = 0;
  private ceiling = Infinity;
  private ceilingTimer = 0;

  constructor(options: Partial<AdaptiveResolutionOptions> = {}) {
    this.o = { ...DEFAULT_ADAPTIVE, ...options };
  }

  /** Smoothed frame time (s). */
  get frameTime(): number {
    return this.ema;
  }

  /** Feed one rendered frame's duration. Returns the new scale when it changes, else null. */
  sample(dt: number): number | null {
    // Hitches (tab switches, shader compiles, GC) say nothing about steady-state cost.
    if (!(dt > 0) || dt > 0.25) return null;
    const o = this.o;
    this.ema += (dt - this.ema) * 0.08;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.ceilingTimer > 0) {
      this.ceilingTimer -= dt;
      if (this.ceilingTimer <= 0) this.ceiling = Infinity;
    }
    this.slowFor = this.ema > o.slow ? this.slowFor + dt : 0;
    this.fastFor = this.ema < o.fast ? this.fastFor + dt : 0;
    if (this.cooldown > 0) return null;

    if (this.slowFor >= o.slowHold && this.scale > o.min + 1e-6) {
      this.ceiling = this.scale;
      this.ceilingTimer = o.memory;
      return this.change(Math.max(o.min, this.scale - o.step));
    }
    if (this.fastFor >= o.fastHold && this.scale < 1 - 1e-6) {
      const next = Math.min(1, this.scale + o.step);
      if (next < this.ceiling - 1e-6) return this.change(next);
    }
    return null;
  }

  private change(next: number): number {
    this.scale = Math.round(next * 100) / 100;
    this.slowFor = 0;
    this.fastFor = 0;
    this.cooldown = this.o.cooldown;
    return this.scale;
  }
}
