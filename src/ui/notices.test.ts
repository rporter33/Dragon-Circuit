import { describe, expect, it } from 'vitest';
import { BANNER_FADE, BANNER_LIFE, BannerQueue, NoticeQueue, isRestedToast } from './notices';

describe('NoticeQueue', () => {
  it('merges the plain toast an emitter also sends into the typed notice (one notice per pickup)', () => {
    const q = new NoticeQueue();
    // Hud's 'collect' handler, then the emitter's generic 'toast' in the same frame.
    expect(q.push({ key: 'collect:feather-02', aliases: ['Feather 1 of 48'], text: 'Feather 1 of 48', sub: 'The Roost’s western rim', group: 'feather' })).toBe('shown');
    expect(q.push({ key: 'toast:Feather 1 of 48', aliases: ['Feather 1 of 48'], text: 'Feather 1 of 48', sub: 'Found at the Roost’s western rim' })).toBe('merged');
    expect(q.visible).toHaveLength(1);
    expect(q.visible[0].sub).toBe('The Roost’s western rim');
  });

  it('matches aliases case- and space-insensitively (unlock and relic toasts)', () => {
    const q = new NoticeQueue();
    q.push({ key: 'unlock:crown', aliases: ['Unlocked: Crown'], text: 'Unlocked: Crown', sub: 'Wyvern horns' });
    expect(q.push({ key: 'toast:x', aliases: ['  unlocked:   crown '], text: 'Unlocked: Crown' })).toBe('merged');
    q.push({ key: 'relic:charts', aliases: ['Wind Charts', 'Relic found: Wind Charts'], text: 'Relic found: Wind Charts' });
    expect(q.push({ key: 'toast:wind charts', aliases: ['Wind Charts'], text: 'Wind Charts', sub: 'lore' })).toBe('merged');
    expect(q.visible).toHaveLength(2);
  });

  it('swallows a late duplicate for a while after the notice left, then allows it again', () => {
    const q = new NoticeQueue();
    q.push({ key: 'a', text: 'A', life: 1 });
    q.update(1.1);
    expect(q.visible).toHaveLength(0);
    expect(q.retired).toHaveLength(1);
    expect(q.push({ key: 'a', text: 'A' })).toBe('dropped');
    q.update(q.memory + 0.1);
    expect(q.push({ key: 'a', text: 'A' })).toBe('shown');
  });

  it('remember() lets a banner claim a name so the emitter toast does not repeat it', () => {
    const q = new NoticeQueue();
    q.remember(['Windward Roost'], 5);
    expect(q.push({ key: 'toast:windward roost', aliases: ['Windward Roost'], text: 'Windward Roost' })).toBe('dropped');
    expect(q.visible).toHaveLength(0);
  });

  it('updates a streak in place instead of stacking (feathers picked up in a row)', () => {
    const q = new NoticeQueue();
    q.push({ key: 'collect:f1', text: 'Feather 1 of 48', group: 'feather' });
    q.update(2);
    expect(q.push({ key: 'collect:f2', text: 'Feather 2 of 48', group: 'feather' })).toBe('merged');
    expect(q.visible).toHaveLength(1);
    expect(q.visible[0].text).toBe('Feather 2 of 48');
    expect(q.visible[0].age).toBeLessThan(1);
    expect(q.visible[0].rev).toBe(1);
  });

  it('caps the stack and lets higher priority through first', () => {
    const q = new NoticeQueue();
    q.maxVisible = 2;
    q.push({ key: 'a', text: 'a' });
    q.push({ key: 'b', text: 'b' });
    expect(q.push({ key: 'low', text: 'low', priority: 0 })).toBe('queued');
    expect(q.push({ key: 'high', text: 'high', priority: 3 })).toBe('queued');
    expect(q.waiting.map((n) => n.text)).toEqual(['high', 'low']);
    // With others waiting, visible notices give way early.
    q.update(3);
    expect(q.visible.map((n) => n.text)).toEqual(['high', 'low']);
  });

  it('holds notices (title screen) except system ones, and releases them later', () => {
    const q = new NoticeQueue();
    q.held = true;
    expect(q.push({ key: 'disc', text: 'Windward Roost' })).toBe('queued');
    expect(q.push({ key: 'pad', text: 'Controller connected', always: true })).toBe('shown');
    q.update(10);
    expect(q.visible).toHaveLength(0);
    expect(q.waiting).toHaveLength(1);
    q.held = false;
    q.update(0.01);
    expect(q.visible.map((n) => n.text)).toEqual(['Windward Roost']);
  });
});

describe('BannerQueue', () => {
  it('shows one banner at a time and never the same key twice', () => {
    const b = new BannerQueue();
    expect(b.push({ key: 'roost', kicker: 'DISCOVERED', name: 'Windward Roost' })).toBe(true);
    expect(b.push({ key: 'roost', kicker: 'DISCOVERED', name: 'Windward Roost' })).toBe(false);
    b.push({ key: 'cascade', kicker: 'DISCOVERED', name: 'Cascade Isle' });
    expect(b.update(0.01, false)).toBe('show');
    expect(b.current?.key).toBe('roost');
    expect(b.update(BANNER_LIFE - BANNER_FADE + 0.01, false)).toBe('hide');
    expect(b.update(BANNER_FADE, false)).toBe('show');
    expect(b.current?.key).toBe('cascade');
  });

  it('holds while blocked (racing) and fades a showing banner at once', () => {
    const b = new BannerQueue();
    b.push({ key: 'a', kicker: 'K', name: 'A' });
    b.update(0.1, false);
    b.push({ key: 'b', kicker: 'K', name: 'B' });
    expect(b.update(0.01, true)).toBe('hide');
    for (let i = 0; i < 100; i++) expect(b.update(0.1, true)).not.toBe('show');
    expect(b.current).toBeNull();
    expect(b.update(0.1, false)).toBe('show');
    expect(b.current?.key).toBe('b');
  });

  it('reset() lets places be discovered again after a new game', () => {
    const b = new BannerQueue();
    b.push({ key: 'roost', kicker: 'K', name: 'Roost' });
    b.reset();
    expect(b.push({ key: 'roost', kicker: 'K', name: 'Roost' })).toBe(true);
  });
});

describe('Rested announcements', () => {
  it('recognises the plain toast for the Rested bonus (the HUD shows it beside the emblem instead)', () => {
    expect(isRestedToast('Sun-warmed — your wyvern spreads its wings to the sun')).toBe(true);
    expect(isRestedToast('Rested — your wyvern shakes out its wings')).toBe(true);
    expect(isRestedToast('Relic found: Ember Scale')).toBe(false);
    expect(isRestedToast('Restart the race')).toBe(false);
  });
});
