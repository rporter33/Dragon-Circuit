import { describe, expect, it } from 'vitest';
import { BUILD, buildLabel } from './build';

describe('build stamp', () => {
  it('formats the commit and build time in UTC', () => {
    expect(buildLabel({ sha: '1b815b7', time: '2026-10-09T01:41:05.123Z' })).toBe('Build 1b815b7 · 9 Oct 2026, 01:41 UTC');
  });

  it('falls back to the hash alone without a usable time', () => {
    expect(buildLabel({ sha: 'dev', time: '' })).toBe('Build dev');
    expect(buildLabel({ sha: 'abc1234', time: 'not a date' })).toBe('Build abc1234');
  });

  it('is baked in at build time (a short hash, or dev)', () => {
    expect(BUILD.sha).toMatch(/^([0-9a-f]{7,}|dev)$/);
  });
});
