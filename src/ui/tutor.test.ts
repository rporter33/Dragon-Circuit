import { describe, expect, it } from 'vitest';
import { TIP_GAP, TIPS, Tutor, tipActions, tipDef, tipText, type TutorFrame, type TutorSave } from './tutor';

function frame(over: Partial<TutorFrame> = {}): TutorFrame {
  return {
    dt: 0.1,
    enabled: true,
    mode: 'onFoot',
    flapping: false,
    pitch: 0,
    stamina: 1,
    winded: false,
    stall: 0,
    airspeed: 0,
    vy: 0,
    height: null,
    rested: 0,
    inThermal: false,
    racing: false,
    nearGate: false,
    prompt: null,
    ...over,
  };
}

/** Run `seconds` of identical frames. */
function run(t: Tutor, seconds: number, over: Partial<TutorFrame> = {}): void {
  for (let i = 0; i < Math.round(seconds / 0.1); i++) t.update(frame(over));
}

describe('Tutor', () => {
  it('starts with walking to the wyvern, after a quiet moment', () => {
    const save: TutorSave = { tutorialDone: false };
    const t = new Tutor(() => save);
    run(t, TIP_GAP - 0.5);
    expect(t.current).toBeNull();
    run(t, 1);
    expect(t.current?.id).toBe('walk');
  });

  it('ends a tip when its lesson is done, records it, and never shows it again', () => {
    const save: TutorSave = { tutorialDone: false };
    const t = new Tutor(() => save);
    run(t, 4);
    expect(t.current?.id).toBe('walk');
    run(t, 2, { mode: 'landed' }); // mounted: walk learned (check mark), then gone
    expect(save.tips).toContain('walk');
    run(t, 5, { mode: 'onFoot' });
    expect(t.current?.id).not.toBe('walk');
  });

  it('skips what the player already knows (flapped before the tip came up)', () => {
    const save: TutorSave = { tutorialDone: false, tips: ['walk', 'takeoff'] };
    const t = new Tutor(() => save);
    run(t, 0.5, { mode: 'flying', flapping: true });
    run(t, 1.5, { mode: 'flying', flapping: true });
    expect(save.tips).toContain('flap');
    expect(t.current?.id).not.toBe('flap');
  });

  it('teaches in order: no flare or race tips before the first wingbeats are learned', () => {
    const save: TutorSave = { tutorialDone: false, tips: ['walk', 'takeoff'] };
    const t = new Tutor(() => save);
    run(t, 4, { mode: 'flying', height: 20, vy: -3, airspeed: 20, nearGate: true });
    expect(t.current?.id).toBe('flap');
  });

  it('pauses (does not consume) a tip while menus are open, and drops an unread tip when a race starts', () => {
    const save: TutorSave = { tutorialDone: false };
    const t = new Tutor(() => save);
    run(t, 4);
    expect(t.current?.id).toBe('walk');
    run(t, 60, { enabled: false });
    expect(t.current?.id).toBe('walk');
    expect(save.tips ?? []).not.toContain('walk');
    run(t, 0.2, { racing: true });
    expect(t.current).toBeNull();
    expect(save.tips ?? []).not.toContain('walk');
  });

  it('lets the tired-wings tip cut in, and sets tutorialDone once every first-flight tip is done', () => {
    const save: TutorSave = { tutorialDone: false, tips: ['walk', 'takeoff', 'flap'] };
    const t = new Tutor(() => save);
    run(t, 8, { mode: 'flying' }); // pitch tip comes up 4 s after the flap lesson
    expect(t.current?.id).toBe('pitch');
    run(t, 5.5, { mode: 'flying', stamina: 0.3 }); // past its minimum: tired cuts in
    expect(t.current?.id).toBe('tired');
    expect(t.current?.anchor).toBe('gauge');
    run(t, 2, { mode: 'landed' });
    expect(save.tips).toContain('tired');
    // Land once more: the flare lesson counts as learned on touchdown.
    run(t, 0.1, { mode: 'flying' });
    run(t, 0.1, { mode: 'landed' });
    run(t, 20, { mode: 'flying', pitch: 0.5 });
    const core = TIPS.filter((x) => x.core).map((x) => x.id);
    expect(core.every((id) => save.tips!.includes(id))).toBe(true);
    expect(save.tutorialDone).toBe(true);
  });

  it('shows nothing once the tutorial is done, except context tips not yet seen', () => {
    const save: TutorSave = { tutorialDone: true, tips: ['tired'] };
    const t = new Tutor(() => save);
    run(t, 5, { mode: 'onFoot' });
    expect(t.current).toBeNull();
    run(t, 0.5, { mode: 'landed', rested: 0.9 });
    expect(t.current?.id).toBe('rested');
  });

  it('makes room for a prompt that asks for the same thing, once read for a moment', () => {
    const save: TutorSave = { tutorialDone: false, tips: ['walk'] };
    const t = new Tutor(() => save);
    run(t, 4, { mode: 'landed' });
    expect(t.current?.id).toBe('takeoff');
    const shown = t.shown;
    run(t, Math.max(0, 3 - shown) + 0.2, { mode: 'landed', prompt: 'flap' }); // "Take off"
    expect(t.current).toBeNull();
    expect(save.tips).toContain('takeoff');
  });

  it('the tired-wings tip yields to the low-stamina prompt', () => {
    const save: TutorSave = { tutorialDone: false, tips: ['walk', 'takeoff', 'flap'] };
    const t = new Tutor(() => save);
    run(t, 3, { mode: 'flying', stamina: 0.3 });
    expect(t.current?.id).toBe('tired');
    run(t, 0.2, { mode: 'flying', stamina: 0.15, prompt: 'rest' });
    expect(t.current).toBeNull();
  });

  it('reset() starts the lessons over', () => {
    const save: TutorSave = { tutorialDone: true, tips: ['walk'] };
    const t = new Tutor(() => save);
    t.reset();
    expect(save.tutorialDone).toBe(false);
    expect(save.tips).toEqual([]);
  });

  it('teaches rising air the first time the wyvern rides a thermal (once the wingbeat lesson is done)', () => {
    const save: TutorSave = { tutorialDone: false, tips: ['walk', 'takeoff', 'flap', 'pitch'] };
    const t = new Tutor(() => save);
    run(t, 6, { mode: 'flying' });
    expect(t.current).toBeNull();
    run(t, 3, { mode: 'flying', inThermal: true });
    expect(t.current?.id).toBe('thermal');
    expect(t.current?.title).toBe('Rising air — circle to climb');
    // Climbing in it for a couple of seconds is the lesson learned.
    run(t, 3, { mode: 'flying', inThermal: true, vy: 3 });
    run(t, 2, { mode: 'flying' });
    expect(save.tips).toContain('thermal');
  });

  it('calls the Rested bonus Sun-warmed by day (wyverns bask) and Rested at night', () => {
    const rested = tipDef('rested');
    expect(tipText(rested, 0).title).toBe('Sun-warmed');
    expect(tipText(rested, 0.9).title).toBe('Rested');
    expect(tipText(tipDef('flap'), 0.9).title).toBe(tipDef('flap').title);
  });

  it('lists the glyph actions a tip body names', () => {
    expect(tipActions('Walk with {move}, then climb on with {mount}.')).toEqual(['move', 'mount']);
  });
});
