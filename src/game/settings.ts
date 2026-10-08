import type { Settings } from '../core/types';

export const DEFAULT_SETTINGS: Settings = {
  quality: 'high',
  resolutionScale: 1,
  invertPitch: false,
  lookSensitivity: 1,
  fov: 62,
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.9,
  reducedMotion: false,
  rumble: true,
  showControlHints: true,
  timeOfDay: 'cycle',
  dayLengthMinutes: 24,
  holdToFlap: true,
  showGhost: true,
};

/** Pick a starting quality from what the GPU says about itself. */
export function guessQuality(): Settings['quality'] {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return 'low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).toLowerCase() : '';
    if (/swiftshader|llvmpipe|software/.test(name)) return 'low';
    if (/intel|uhd|iris|mali|adreno|powervr|apple m1\b/.test(name)) return 'medium';
    return 'high';
  } catch {
    return 'medium';
  }
}
