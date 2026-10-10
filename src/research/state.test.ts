import { describe, expect, it } from 'vitest';
import { airshipStage, recordResearch, researchState, RIDGE_OBSERVATION } from './state';

const finds = { collected: ['feather-01', 'feather-01', 'relic-ember', 'bogus'], discovered: ['roost', 'roost', 'bogus'] };

describe('M1 research state', () => {
  it('derives existing finds once without copying them into entries', () => {
    const state = researchState(undefined, finds);
    expect(state).toEqual({ entries: [], points: { nature: 1, antiquity: 10, winds: 3 } });
    expect(finds.collected).toHaveLength(4);
  });

  it('awards each survey part once with an event payload based on derived totals', () => {
    const site = recordResearch(undefined, finds, 'survey:gullrest-shrine:site');
    expect(site.event).toMatchObject({ points: 5, branch: 'antiquity', branchTotal: 15, total: 19 });
    const read = recordResearch(site.state, finds, 'survey:gullrest-shrine:inscription');
    expect(read.event).toMatchObject({ points: 10, branchTotal: 25, total: 29 });
    const repeat = recordResearch(read.state, finds, 'survey:gullrest-shrine:inscription');
    expect(repeat.event).toBeNull();
    expect(repeat.state).toEqual(read.state);
    expect(site.state.entries).toEqual(['survey:gullrest-shrine:site']);
  });

  it('sanitizes malformed state and rejects unimplemented or duplicate rewards', () => {
    for (const raw of [null, 12, [], { entries: 'x' }]) expect(researchState(raw, finds).entries).toEqual([]);
    const state = researchState({ entries: [null, 'survey:observatory:site', 'survey:wind-counters:site', 'survey:wind-counters:site'], points: { antiquity: Infinity } }, finds);
    expect(state.entries).toEqual(['survey:wind-counters:site']);
    expect(state.points.antiquity).toBe(15);
    expect(recordResearch(state, finds, 'thermal:3').event).toBeNull();
  });

  it('records a stable ridge observation once without inventing a point reward', () => {
    const first = recordResearch(undefined, finds, RIDGE_OBSERVATION);
    expect(first.event).toMatchObject({ branch: 'winds', points: 0 });
    expect(recordResearch(first.state, finds, RIDGE_OBSERVATION).event).toBeNull();
  });

  it('caps the airship at one and requires the first inscription even with many points', () => {
    expect(airshipStage(undefined)).toBe(0);
    expect(airshipStage(researchState(undefined, finds))).toBe(0);
    expect(airshipStage({ entries: ['survey:wind-counters:inscription'] })).toBe(0);
    expect(airshipStage({ entries: ['survey:gullrest-shrine:inscription', 'survey:wind-counters:inscription'] })).toBe(1);
  });
});
