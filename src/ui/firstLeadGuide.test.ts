import { describe, expect, it } from 'vitest';
import { defaultSave, migrateSave } from '../progression/save';
import { guidingToShrine, readyForShrine, shrineInstruction } from './firstLeadGuide';

describe('first discovery guidance', () => {
  it('offers a destination after flight basics, without waiting for a landing', () => {
    const save = defaultSave();
    expect(readyForShrine(save)).toBe(false);
    save.tips = ['walk', 'takeoff', 'flap'];
    expect(readyForShrine(save)).toBe(false);
    save.tips.push('pitch');
    expect(readyForShrine(save)).toBe(true);
  });
  it('resumes active guidance and preserves skipping after reload', () => {
    for (const status of ['active', 'skipped'] as const) {
      const save = defaultSave();
      save.firstLeadGuide = status;
      save.tips = ['walk', 'pitch'];
      const loaded = migrateSave(JSON.parse(JSON.stringify(save)));
      expect(loaded.tips).toEqual(save.tips);
      expect(loaded.firstLeadGuide).toBe(status);
      expect(readyForShrine(loaded)).toBe(false);
      expect(guidingToShrine(loaded)).toBe(status === 'active');
    }
  });
  it('uses inscription completion rather than landing or survey to finish', () => {
    const save = defaultSave();
    save.firstLeadGuide = 'active';
    save.research!.entries = ['survey:gullrest-shrine:site'];
    expect(guidingToShrine(save)).toBe(true);
    save.research!.entries.push('survey:gullrest-shrine:inscription');
    expect(guidingToShrine(save)).toBe(false);
    delete save.firstLeadGuide;
    save.tutorialDone = true;
    expect(readyForShrine(save)).toBe(false);
  });
  it('adapts instructions to travel, landing, dismounting, and reading', () => {
    expect(shrineInstruction('flying', 300)).toContain('Pause');
    expect(shrineInstruction('flying', 50)).toContain('{flare}');
    expect(shrineInstruction('landed', 50)).toContain('{dismount}');
    expect(shrineInstruction('onFoot', 50)).toContain('{interact}');
  });
  it('sanitizes malformed progress without disturbing older saves', () => {
    expect(migrateSave({ ...defaultSave(), tips: ['walk', 'walk', 9, 'unknown'], firstLeadGuide: 'bad' }).tips).toEqual(['walk']);
    expect(migrateSave({ ...defaultSave(), firstLeadGuide: 'bad' }).firstLeadGuide).toBeUndefined();
    expect(migrateSave(defaultSave())).toEqual(defaultSave());
  });
});
