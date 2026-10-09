// The HUD's announcement policy, as pure data structures (unit-tested in notices.test.ts).
//
// Every corner notice (pickups, unlocks, race notes, system messages) goes through one
// NoticeQueue, so the screen never shows two notices about the same thing, never stacks more than
// a few, and lets the important ones through first:
//  - Identity: a notice carries tags (its key plus aliases, e.g. the plain toast text an emitter
//    also sends). A second notice sharing a tag merges into the first instead of showing again,
//    and tags are remembered for a few seconds after a notice leaves, so a late duplicate is
//    swallowed too.
//  - Groups: rapid notices of one kind (feathers picked up in a row) update the notice already
//    showing ("Feather 4 of 48") rather than queueing one each.
//  - Capacity: at most `maxVisible` show; the rest wait, highest priority first. While some wait,
//    visible notices give way sooner.
//  - Hold: on the title screen nothing new shows (except `always` notices such as a controller
//    connecting); held notices appear once play starts.
//
// BannerQueue is the same idea for the big centred title card ("DISCOVERED — Cascade Isle"): one
// at a time, held while a race needs the middle of the screen.

export type NoticeIcon = 'feather' | 'relic' | 'unlock' | 'race' | 'info' | 'landmark' | 'wing';

export interface NoticeSpec {
  /** Identity. A notice whose key or aliases share a tag with a live one merges into it. */
  key: string;
  /** Other strings that mean the same news (compared case-insensitively). */
  aliases?: readonly string[];
  text: string;
  sub?: string;
  icon?: NoticeIcon;
  /** Visual variant (CSS modifier): 'unlock', 'relic', 'warn'. */
  variant?: string;
  /** Higher shows first when several wait. Default 1. */
  priority?: number;
  /** Seconds on screen. Default 4.2. */
  life?: number;
  /** Notices of one group update each other in place (a pickup streak). */
  group?: string;
  /** Show even while the queue is held (system messages). */
  always?: boolean;
}

export interface Notice {
  readonly id: number;
  text: string;
  sub: string;
  icon: NoticeIcon;
  variant: string;
  priority: number;
  life: number;
  group: string;
  always: boolean;
  tags: Set<string>;
  /** Seconds since it became visible. */
  age: number;
  /** Bumped whenever text or sub changes (the renderer rewrites the element). */
  rev: number;
}

export type PushResult = 'shown' | 'queued' | 'merged' | 'dropped';

const DEFAULT_LIFE = 4.2;
/** While others wait, a visible notice gives way after this long. */
const YIELD_AFTER = 2.6;

/**
 * A plain toast announcing the Rested bonus ("Sun-warmed — …", "Rested — …"). The HUD names the
 * bonus beside the stamina emblem it belongs to (a caption, and the first-time tip), so a corner
 * toast for the same moment would say it twice.
 */
export function isRestedToast(text: string): boolean {
  return /^(sun-warmed|rested)\b/i.test(text.trim());
}

export function noticeTag(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export class NoticeQueue {
  readonly visible: Notice[] = [];
  readonly waiting: Notice[] = [];
  /** Notices that left the screen this update (the renderer fades them out). */
  readonly retired: Notice[] = [];
  maxVisible = 3;
  /** Seconds a notice's tags are remembered after it leaves. */
  memory = 2.5;
  held = false;
  private remembered: { tags: Set<string>; left: number }[] = [];
  private nextId = 1;

  /** Announce something. Duplicates merge, streaks update in place, overflow waits. */
  push(spec: NoticeSpec): PushResult {
    const tags = new Set<string>([noticeTag(spec.key), ...(spec.aliases ?? []).map(noticeTag)]);
    const same = this.find((n) => intersects(n.tags, tags));
    if (same) {
      for (const t of tags) same.tags.add(t);
      if (!same.sub && spec.sub) {
        same.sub = spec.sub;
        same.rev++;
      }
      return 'merged';
    }
    if (this.remembered.some((r) => intersects(r.tags, tags))) return 'dropped';
    const group = spec.group ?? '';
    if (group) {
      const g = this.find((n) => n.group === group);
      if (g) {
        g.text = spec.text;
        g.sub = spec.sub ?? '';
        for (const t of tags) g.tags.add(t);
        g.rev++;
        // Keep it on screen a little longer for the streak, without restarting its entrance.
        g.age = Math.min(g.age, 0.6);
        return 'merged';
      }
    }
    const n: Notice = {
      id: this.nextId++,
      text: spec.text,
      sub: spec.sub ?? '',
      icon: spec.icon ?? 'info',
      variant: spec.variant ?? '',
      priority: spec.priority ?? 1,
      life: spec.life ?? DEFAULT_LIFE,
      group,
      always: !!spec.always,
      tags,
      age: 0,
      rev: 0,
    };
    if (this.canShow(n)) {
      this.visible.push(n);
      return 'shown';
    }
    // Waiting: by priority, then arrival.
    let i = this.waiting.length;
    while (i > 0 && this.waiting[i - 1].priority < n.priority) i--;
    this.waiting.splice(i, 0, n);
    return 'queued';
  }

  /** Remember tags without showing anything (e.g. a banner already announced this name). */
  remember(tags: readonly string[], seconds: number): void {
    this.remembered.push({ tags: new Set(tags.map(noticeTag)), left: seconds });
  }

  /** Advance time. Fills `retired` with what left the screen this step. */
  update(dt: number): void {
    this.retired.length = 0;
    for (let i = this.remembered.length - 1; i >= 0; i--) {
      const r = this.remembered[i];
      r.left -= dt;
      if (r.left <= 0) this.remembered.splice(i, 1);
    }
    const pressure = this.waiting.some((w) => !this.held || w.always);
    for (let i = this.visible.length - 1; i >= 0; i--) {
      const n = this.visible[i];
      n.age += dt;
      const life = pressure ? Math.min(n.life, YIELD_AFTER) : n.life;
      if (n.age >= life) {
        this.visible.splice(i, 1);
        this.retired.push(n);
        this.remembered.push({ tags: n.tags, left: this.memory });
      }
    }
    for (let i = 0; i < this.waiting.length && this.visible.length < this.maxVisible; ) {
      const n = this.waiting[i];
      if (this.held && !n.always) {
        i++;
        continue;
      }
      this.waiting.splice(i, 1);
      n.age = 0;
      this.visible.push(n);
    }
  }

  /** Drop everything (new game). */
  clear(): void {
    this.retired.length = 0;
    this.retired.push(...this.visible);
    this.visible.length = 0;
    this.waiting.length = 0;
    this.remembered.length = 0;
  }

  private canShow(n: Notice): boolean {
    if (this.held && !n.always) return false;
    // Don't jump ahead of notices that could show now (held ones can't, so they don't block).
    const eligibleWaiting = this.waiting.some((w) => !this.held || w.always);
    return this.visible.length < this.maxVisible && !eligibleWaiting;
  }

  private find(pred: (n: Notice) => boolean): Notice | undefined {
    return this.visible.find(pred) ?? this.waiting.find(pred);
  }
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const t of b) if (a.has(t)) return true;
  return false;
}

// -------------------------------------------------------------------------------------------------

export interface BannerSpec {
  key: string;
  kicker: string;
  name: string;
  sub?: string;
}

export interface Banner extends BannerSpec {
  /** Seconds left on screen. */
  left: number;
}

/** Seconds a banner holds the centre of the screen. */
export const BANNER_LIFE = 5;
/** The last part of a banner's life is its fade-out. */
export const BANNER_FADE = 0.9;

/** The centred title card: one at a time, never twice for the same key, held while blocked. */
export class BannerQueue {
  current: Banner | null = null;
  readonly waiting: BannerSpec[] = [];
  private seen = new Set<string>();

  push(spec: BannerSpec): boolean {
    if (this.seen.has(spec.key)) return false;
    this.seen.add(spec.key);
    this.waiting.push(spec);
    return true;
  }

  /**
   * Advance. While `blocked` (a race owns the middle of the screen, or no HUD) nothing new shows,
   * and a banner already showing fades out at once.
   * Returns 'show' when a new banner just started, 'hide' when the current one began fading.
   */
  update(dt: number, blocked: boolean): 'show' | 'hide' | null {
    let hid = false;
    const c = this.current;
    if (c) {
      const before = c.left;
      c.left = (blocked ? Math.min(c.left, BANNER_FADE) : c.left) - dt;
      hid = before > BANNER_FADE && c.left <= BANNER_FADE;
      if (c.left > 0) return hid ? 'hide' : null;
      this.current = null;
    }
    if (!blocked) {
      const next = this.waiting.shift();
      if (next) {
        this.current = { ...next, left: BANNER_LIFE };
        return 'show';
      }
    }
    return hid ? 'hide' : null;
  }

  /** Forget what was shown (new game): the same places can be discovered again. */
  reset(): void {
    this.current = null;
    this.waiting.length = 0;
    this.seen.clear();
  }
}
