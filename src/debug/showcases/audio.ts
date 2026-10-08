import type { Showcase } from '../showcase';
import { AUDIO_SCENES, renderScene, runAudioCheck } from '../../audio/offline';

/**
 * ?view=audio — exposes the offline audio check to automation:
 *   await window.__dwAudioCheck()            every scene → { ok, scenes: [{ name, rmsDb, peakDb, … }] }
 *   await window.__dwAudioScene('windDive')  one scene
 * Scenes render through the real mixer graph on an OfflineAudioContext, so this works headless
 * and without speakers. With a real browser, any click also unlocks live audio as usual.
 */
const audio: Showcase = {
  name: 'audio',
  description: 'Offline audio render check (window.__dwAudioCheck(), window.__dwAudioScene(name))',
  setup() {
    const w = window as unknown as Record<string, unknown>;
    w.__dwAudioCheck = (names?: string[]) => runAudioCheck(names);
    w.__dwAudioScene = (name: string) => renderScene(name);
    w.__dwAudioScenes = AUDIO_SCENES;
  },
};

export default audio;
