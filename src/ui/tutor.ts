// Onboarding that teaches gently: a handful of tips, each shown once, when it is relevant and in a
// sensible order. Pure (unit-tested in tutor.test.ts); ui/Tips.ts draws the current tip.
//
//  - Context-triggered: a tip appears when the moment comes (on foot at the start, standing on the
//    deck mounted, a few seconds into the first flight, coming down over an island, the first time
//    the wings tire, the first time the wyvern is Rested, near rising air, near a race gate).
//  - Learn by doing: a tip ends as soon as you do what it teaches; if you already did it before
//    it came up, it never shows at all. Otherwise it steps aside after a while.
//  - Never repeat: every tip that showed (or was learned) is recorded in the save; once the
//    first-flight tips are all done, save.tutorialDone turns true.
//  - Never block play: one tip at a time, nothing during races, a pause between tips, and the
//    'Show tips' setting turns them off.

import type { PlayerMode } from '../core/types';
import type { PromptAction } from '../game/contracts';
import type { ControlAction } from '../input/scheme';

export type TipId = 'walk' | 'takeoff' | 'flap' | 'pitch' | 'flare' | 'tired' | 'rested' | 'thermal' | 'race';

export interface TipDef {
  id: TipId;
  title: string;
  /** Body text; {action} placeholders become button glyphs for the active device. */
  body: string;
  /** The left-hand tip card, or a callout beside the stamina emblem. */
  anchor: 'card' | 'gauge';
  /** Part of the first flight (all of these done → tutorialDone). */
  core: boolean;
  /** Tips that must be done first. */
  after: readonly TipId[];
  /** Shown at least this long unless learned sooner, at most this long (s). */
  minTime: number;
  maxTime: number;
  /** May cut in on a tip that has had its minimum time. */
  urgent?: boolean;
  /** After dark, if the words differ (the Rested bonus is basking in the sun by day). */
  night?: { title: string; body: string };
}

export const TIPS: readonly TipDef[] = [
  { id: 'walk', title: 'Your wyvern awaits', body: 'Walk with {move}, then climb on with {mount}.', anchor: 'card', core: true, after: [], minTime: 4, maxTime: 30 },
  { id: 'takeoff', title: 'Take to the sky', body: 'Run off the end of the launch deck, or press {flap} to leap into the air.', anchor: 'card', core: true, after: ['walk'], minTime: 4, maxTime: 30 },
  { id: 'flap', title: 'Beat your wings', body: 'Hold {flap} to climb. Every wingbeat costs stamina — glide to win it back.', anchor: 'card', core: true, after: ['takeoff'], minTime: 4, maxTime: 12 },
  {
    id: 'pitch',
    title: 'Climb and dive',
    body: 'Pull up gently with {pitch} to climb; push down to dive for speed. If you stall, beat your wings and let the nose fall.',
    anchor: 'card',
    core: true,
    after: ['flap'],
    minTime: 5,
    maxTime: 12,
  },
  {
    id: 'flare',
    title: 'Coming in to land',
    body: 'Come in low and slow, then hold {flare} just above the ground to settle. Any island is a place to rest: your wyvern flies stronger after.',
    anchor: 'card',
    core: true,
    after: ['flap'],
    minTime: 4,
    maxTime: 14,
  },
  { id: 'tired', title: 'Wings tiring', body: 'No hurry: glide to recover, or land on any island to rest.', anchor: 'gauge', core: false, after: ['flap'], minTime: 4, maxTime: 9, urgent: true },
  {
    // Wyverns are reptiles: by day a rest on an island means basking, wings spread to the sun.
    id: 'rested',
    title: 'Sun-warmed',
    body: 'Your wyvern basked in the sun, wings spread wide. While the warm ring glows, its stamina lasts longer and refills faster.',
    night: {
      title: 'Rested',
      body: 'A rest on the island refreshed your wyvern. While the warm ring glows, its stamina lasts longer and refills faster.',
    },
    anchor: 'gauge',
    core: false,
    after: ['flap'],
    minTime: 6,
    maxTime: 8,
  },
  {
    id: 'thermal',
    title: 'Rising air — circle to climb',
    body: 'Glowing motes mark a thermal. Bank gently and keep circling inside it to climb without a wingbeat.',
    anchor: 'card',
    core: false,
    after: ['flap'],
    minTime: 5,
    maxTime: 11,
  },
  { id: 'race', title: 'Races', body: 'Races start at the stone gates: fly through one, or pick a course from the pause menu {pause}.', anchor: 'card', core: false, after: ['pitch'], minTime: 6, maxTime: 9 },
];

const BY_ID = new Map(TIPS.map((t) => [t.id, t]));
/** Seconds a tip stays once the prompt starts asking for the same thing. */
const PROMPT_OVERLAP = 3;

export function tipDef(id: TipId): TipDef {
  return BY_ID.get(id)!;
}

/** A tip's words for the hour (`night` 0 day … 1 night, as SkySystem.night). */
export function tipText(tip: TipDef, night: number): { title: string; body: string } {
  return night > 0.5 && tip.night ? tip.night : tip;
}

/** The glyph actions a tip body mentions, in order ("{flap}" → 'flap'). */
export function tipActions(body: string): ControlAction[] {
  return [...body.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as ControlAction);
}

/** What the tutor needs to know about this frame (built from the GameView by Tips). */
export interface TutorFrame {
  dt: number;
  /** Tips allowed at all (setting on, HUD showing, playing). */
  enabled: boolean;
  mode: PlayerMode;
  /** Wings beating (input held or a strong beat under way). */
  flapping: boolean;
  /** Pitch input −1..1. */
  pitch: number;
  stamina: number;
  winded: boolean;
  stall: number;
  airspeed: number;
  /** Vertical speed (m/s, + up). */
  vy: number;
  /** Height above the ground under the wyvern, or null over open air. */
  height: number | null;
  /** 0..1 Rested bonus remaining. */
  rested: number;
  /** Riding a thermal (the weather's thermalEnter until thermalExit). */
  inThermal: boolean;
  /** A race is armed or running. */
  racing: boolean;
  /** A race start gate is near and no race is on. */
  nearGate: boolean;
  /** The context prompt on screen, if any. */
  prompt: PromptAction | null;
}

/** The persisted part: which tips are done, plus the save's tutorialDone flag. */
export interface TutorSave {
  tips?: string[];
  tutorialDone: boolean;
}

/** Seconds of quiet between two tips. */
export const TIP_GAP = 2.5;
/** How long a learned tip lingers with its check mark. */
export const TIP_DONE_HOLD = 1.1;

export class Tutor {
  /** The tip on screen, or null. */
  current: TipDef | null = null;
  /** Seconds the current tip has shown. */
  shown = 0;
  /** Set while the current tip lingers after being learned (seconds left). */
  doneLeft = 0;
  /** Quiet before the first tip, so the opening moment (and its discovery card) breathes. */
  private gap = TIP_GAP;
  // Running knowledge about the player (this session).
  private flyingTime = 0;
  private flapTime = 0;
  private pitchTime = 0;
  private thermalClimb = 0;
  private sinceFlapTip = 0;
  private lastMode: PlayerMode | null = null;
  private landedTime = 0;
  private touchedDown = false;
  private raced = false;
  /** Set when save changes are made (Tips persists them). */
  dirty = false;

  constructor(private save: () => TutorSave) {}

  seen(id: TipId): boolean {
    const s = this.save();
    if (s.tutorialDone && tipDef(id).core) return true;
    return !!s.tips?.includes(id);
  }

  /** Record a tip as done (shown or learned). Sets tutorialDone when the first flight is complete. */
  markSeen(id: TipId): void {
    const s = this.save();
    if (s.tips?.includes(id)) return;
    s.tips = [...(s.tips ?? []), id];
    if (!s.tutorialDone && TIPS.every((t) => !t.core || s.tips!.includes(t.id))) s.tutorialDone = true;
    this.dirty = true;
  }

  /** Start the tips over (Settings → Replay tips, or a new game). */
  reset(): void {
    const s = this.save();
    s.tips = [];
    s.tutorialDone = false;
    this.current = null;
    this.shown = 0;
    this.doneLeft = 0;
    this.gap = 0;
    this.dirty = true;
  }

  /** Forget this session's observations (new game, or the tips were reset in Settings). */
  restartSession(): void {
    this.current = null;
    this.shown = 0;
    this.doneLeft = 0;
    this.gap = TIP_GAP;
    this.flyingTime = 0;
    this.flapTime = 0;
    this.pitchTime = 0;
    this.thermalClimb = 0;
    this.sinceFlapTip = 0;
    this.landedTime = 0;
    this.touchedDown = false;
    this.raced = false;
  }

  update(f: TutorFrame): void {
    this.observe(f);
    // Learned things never need teaching: mark them done silently, or end the tip on screen.
    for (const t of TIPS) {
      if (this.seen(t.id) || !this.learned(t.id, f)) continue;
      if (this.current?.id === t.id) {
        if (this.doneLeft <= 0) this.doneLeft = TIP_DONE_HOLD;
      } else this.markSeen(t.id);
    }

    const cur = this.current;
    if (cur) {
      // Menus, a hidden HUD or tips turned off: the tip waits where it is.
      if (!f.enabled) return;
      // A race starting needs the player's attention: read enough → seen, else it comes back later.
      if (f.racing) {
        if (this.shown >= cur.minTime) this.finish();
        else this.drop();
        return;
      }
      this.shown += f.dt;
      if (this.doneLeft > 0) {
        this.doneLeft -= f.dt;
        if (this.doneLeft <= 0) this.finish();
        return;
      }
      // Superseded: the prompt now says the same thing ("Low on stamina — glide or land to
      // rest", "Take off", "Flare now"): the tip makes room once it has been read a moment.
      if (cur.id === 'tired' && (f.winded || f.prompt === 'rest')) {
        this.finish();
        return;
      }
      if (f.prompt && this.shown >= PROMPT_OVERLAP && tipActions(cur.body).includes(f.prompt as ControlAction)) {
        this.finish();
        return;
      }
      if (this.shown >= cur.maxTime || (this.shown >= cur.minTime && !this.stillRelevant(cur.id, f))) {
        this.finish();
        return;
      }
      // An urgent tip may cut in once this one has had its minimum time; this one comes back later.
      if (this.shown >= cur.minTime) {
        const urgent = TIPS.find((t) => t.urgent && t.id !== cur.id && this.eligible(t, f));
        if (urgent) {
          this.current = urgent;
          this.shown = 0;
        }
      }
      return;
    }
    if (!f.enabled || f.racing) return;
    if (this.gap > 0) {
      this.gap -= f.dt;
      return;
    }
    const next = TIPS.find((t) => this.eligible(t, f));
    if (next) {
      this.current = next;
      this.shown = 0;
      this.doneLeft = 0;
    }
  }

  private drop(): void {
    this.current = null;
    this.shown = 0;
    this.doneLeft = 0;
    this.gap = TIP_GAP;
  }

  private finish(): void {
    if (this.current) this.markSeen(this.current.id);
    this.current = null;
    this.shown = 0;
    this.doneLeft = 0;
    this.gap = TIP_GAP;
  }

  private observe(f: TutorFrame): void {
    const flying = f.mode === 'flying';
    if (flying) this.flyingTime += f.dt;
    else this.flyingTime = 0;
    if (flying && f.flapping) this.flapTime += f.dt;
    if (flying && Math.abs(f.pitch) > 0.25) this.pitchTime += f.dt;
    if (flying && f.inThermal && f.vy > 1) this.thermalClimb += f.dt;
    if (this.seen('flap') && flying) this.sinceFlapTip += f.dt;
    this.landedTime = f.mode === 'landed' ? this.landedTime + f.dt : 0;
    this.touchedDown = this.lastMode === 'flying' && f.mode === 'landed';
    if (f.racing) this.raced = true;
    this.lastMode = f.mode;
  }

  /** The player already did what this tip teaches. */
  private learned(id: TipId, f: TutorFrame): boolean {
    switch (id) {
      case 'walk':
        return f.mode === 'mounting' || f.mode === 'landed' || f.mode === 'flying';
      case 'takeoff':
        return f.mode === 'flying';
      case 'flap':
        return this.flapTime >= 1.5;
      case 'pitch':
        // Shown long enough to read the stall advice, and the stick has been used.
        return this.current?.id === 'pitch' && this.shown >= 4 && this.pitchTime >= 1.5;
      case 'flare':
        return this.touchedDown;
      case 'tired':
        return this.current?.id === 'tired' && (f.mode === 'landed' || f.stamina > 0.7);
      case 'thermal':
        return this.thermalClimb >= 2;
      case 'race':
        return this.raced;
      default:
        return false;
    }
  }

  /** Whether a tip's moment is still on (a tip that no longer fits steps aside after minTime). */
  private stillRelevant(id: TipId, f: TutorFrame): boolean {
    switch (id) {
      case 'walk':
        return f.mode === 'onFoot';
      case 'takeoff':
        return f.mode === 'landed';
      case 'flap':
      case 'pitch':
      case 'flare':
        return f.mode === 'flying';
      case 'tired':
        return f.mode === 'flying' && !f.winded;
      default:
        return true;
    }
  }

  private eligible(t: TipDef, f: TutorFrame): boolean {
    if (this.seen(t.id)) return false;
    for (const a of t.after) if (!this.seen(a)) return false;
    const flying = f.mode === 'flying';
    switch (t.id) {
      case 'walk':
        return f.mode === 'onFoot';
      case 'takeoff':
        return this.landedTime > 0.8;
      case 'flap':
        // Already beating the wings? Then it's being learned; only teach a glider.
        return flying && this.flyingTime > 2 && this.flapTime < 0.5;
      case 'pitch':
        return flying && this.sinceFlapTip > 4 && f.stall < 0.2;
      case 'flare':
        // Coming down over an island, slow enough to land (or the game already says "flare").
        return (flying && this.flyingTime > 6 && f.height !== null && f.height < 60 && f.vy < -0.5 && f.airspeed < 40) || f.prompt === 'flare';
      case 'tired':
        return flying && f.stamina < 0.4 && !f.winded && f.prompt !== 'rest';
      case 'rested':
        return f.rested > 0 && f.mode !== 'flying';
      case 'thermal':
        return flying && f.inThermal && this.flyingTime > 4;
      case 'race':
        return f.nearGate && ((flying && this.flyingTime > 8) || f.mode === 'landed');
    }
  }
}
