// Runs one frame and contains whatever it throws, so a bug in one system costs a frame rather
// than the whole game. Errors are logged once per distinct message (not 60 times a second); if
// frames keep failing, onFatal fires once so the page can say so instead of freezing silently.

export class FrameGuard {
  /** Consecutive failed frames before onFatal fires. */
  fatalAfter = 30;
  /** Called once when frames keep failing (main.ts shows a "please reload" overlay). */
  onFatal: ((error: unknown) => void) | null = null;
  /** Total frames that threw since boot. */
  failures = 0;
  private streak = 0;
  private fatal = false;
  private logged = new Set<string>();

  run(frame: () => void): boolean {
    try {
      frame();
      this.streak = 0;
      return true;
    } catch (err) {
      this.failures++;
      this.streak++;
      const key = String((err as Error)?.stack ?? err).slice(0, 400);
      if (!this.logged.has(key) && this.logged.size < 20) {
        this.logged.add(key);
        console.error('Driftwing: a frame failed', err);
      }
      if (this.streak >= this.fatalAfter && !this.fatal) {
        this.fatal = true;
        this.onFatal?.(err);
      }
      return false;
    }
  }

  /** True once frames have failed fatalAfter times in a row. */
  get failed(): boolean {
    return this.fatal;
  }
}

/**
 * Turns rAF timestamps into frame times. The first callback's timestamp can predate the code
 * that started the loop (frames queued while the constructor blocked the thread), and
 * timestamps can step backwards across tab switches; neither may produce a negative step.
 */
export class FrameClock {
  private last = -1;

  /** Seconds since the previous tick (0 on the first, never negative). */
  tick(now: number): number {
    const raw = this.last < 0 || !Number.isFinite(now) ? 0 : Math.max(0, (now - this.last) / 1000);
    if (Number.isFinite(now)) this.last = now;
    return raw;
  }

  reset(): void {
    this.last = -1;
  }
}
