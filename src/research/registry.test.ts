import { describe, expect, it } from 'vitest';
import { CODEX_STAGES, SPECIES, VENTARI_SITES } from './registry';
import { LAYOUT } from '../world/layout';

describe('research registry', () => {
  it('has unique ids', () => {
    const ids = [...SPECIES.map((s) => s.id), ...VENTARI_SITES.map((s) => s.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('places every Ventari site at a real landmark', () => {
    const landmarks = new Set(LAYOUT.landmarks.map((l) => l.id));
    for (const s of VENTARI_SITES) expect(landmarks.has(s.landmark), s.id).toBe(true);
  });

  it('orders the Codex stages by rising thresholds, starting at zero', () => {
    expect(CODEX_STAGES[0].threshold).toBe(0);
    for (let i = 1; i < CODEX_STAGES.length; i++) {
      expect(CODEX_STAGES[i].stage).toBe(i);
      expect(CODEX_STAGES[i].threshold).toBeGreaterThan(CODEX_STAGES[i - 1].threshold);
    }
  });
});
