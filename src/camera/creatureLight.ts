// The creature light rig: a kick light and a directional rim that only the wyverns and the rider
// receive (render/uniforms.ts creatureUniforms; the world never compiles them), set per camera
// shot the way a film crew lights the hero apart from the set:
//
//   chase   (flight, mounted, on foot, falling, photo, showcases) a cool sky kick from above and
//           a little behind the camera that grazes the dorsal ridge, and a rim from the side
//           opposite the sun so the far flank separates from green islands;
//   stable  a soft fill from 35° camera-left and a warm rim from behind-right;
//   title   rim only, from the backlit side.
// At night the kick dims and the rim cools toward moonlight. Everything is added before the
// creature highlight shoulder (shading/light.ts), so none of it can bloom the hide.
//
// Directions are written in VIEW space (toward the light), so the shaders need no matrix work.

import { Color, Quaternion, Vector3, type PerspectiveCamera } from 'three';
import { creatureUniforms, globalUniforms } from '../render/uniforms';

export type CreatureLightPreset = 'chase' | 'stable' | 'title';

export interface LightRigState {
  kickDir: Vector3;
  kickColor: Color;
  kickI: number;
  rimDir: Vector3;
  rimColor: Color;
  rimI: number;
}

export function createLightRigState(): LightRigState {
  return { kickDir: new Vector3(0, 1, 0), kickColor: new Color(), kickI: 0, rimDir: new Vector3(0, 0, -1), rimColor: new Color(), rimI: 0 };
}

/** Which preset a camera rig shoots with. */
export function presetFor(rig: string | null): CreatureLightPreset {
  if (rig === 'stable') return 'stable';
  if (rig === 'title') return 'title';
  return 'chase';
}

const SKY_KICK = new Color(0.78, 0.86, 1.0);
const SKY_RIM = new Color(0.92, 0.94, 1.0);
const MOON_RIM = new Color(0.6, 0.7, 1.0);
const WARM_FILL = new Color(1.0, 0.95, 0.88);
const WARM_RIM = new Color(1.0, 0.82, 0.62);
const _c = new Color();

/**
 * The preset's lights for a sun direction in view space (toward the sun) and a night amount
 * (0 day … 1 night). `sunTint` is the key light's color (any intensity). Pure; writes `out`.
 */
export function lightRigTargets(preset: CreatureLightPreset, sunView: Vector3, night: number, sunTint: Color, out: LightRigState): LightRigState {
  const day = 1 - night;
  switch (preset) {
    case 'stable':
      out.kickDir.set(-Math.sin((35 * Math.PI) / 180), 0.35, Math.cos((35 * Math.PI) / 180)).normalize();
      out.kickColor.copy(WARM_FILL);
      out.kickI = 0.25 * (1 - 0.6 * night);
      out.rimDir.set(0.7, 0.35, -0.6).normalize();
      out.rimColor.copy(WARM_RIM).lerp(MOON_RIM, night);
      out.rimI = 0.9 * day + 0.4 * night;
      break;
    case 'title': {
      out.kickDir.set(0, 1, 0);
      out.kickColor.copy(SKY_KICK);
      out.kickI = 0;
      // From the side the sun backlights, always from behind the subject.
      out.rimDir.set(sunView.x, Math.max(0.15, sunView.y), -Math.max(0.4, Math.abs(sunView.z))).normalize();
      const m = Math.max(sunTint.r, sunTint.g, sunTint.b, 1e-4);
      out.rimColor.setRGB(sunTint.r / m, sunTint.g / m, sunTint.b / m).lerp(MOON_RIM, night);
      out.rimI = 0.6 * day + 0.4 * night;
      break;
    }
    default: {
      // A cool sky kick from camera-up and a little back: it grazes the back and the ridge.
      out.kickDir.set(0, 1, 0.35).normalize();
      out.kickColor.copy(SKY_KICK);
      out.kickI = 0.25 * (1 - 0.6 * night);
      // A rim from the side opposite the sun, from behind the subject.
      const rx = -Math.max(-1, Math.min(1, sunView.x * 2));
      out.rimDir.set(rx, 0.35, -0.7).normalize();
      out.rimColor.copy(SKY_RIM).lerp(MOON_RIM, night);
      out.rimI = 0.35 * day + 0.4 * night;
      break;
    }
  }
  return out;
}

const _q = new Quaternion();
const _sun = new Vector3();

/** Eases the shared creature light uniforms toward the active shot's preset. */
export class CreatureLightRig {
  private target = createLightRigState();
  private started = false;

  update(dt: number, rig: string | null, camera: PerspectiveCamera): void {
    const u = creatureUniforms;
    const g = globalUniforms;
    _q.copy(camera.quaternion).invert();
    _sun.copy(g.uSunDir.value).applyQuaternion(_q);
    _c.copy(g.uSunColor.value);
    lightRigTargets(presetFor(rig), _sun, g.uNight.value, _c, this.target);
    const k = this.started ? 1 - Math.exp(-4 * Math.max(0, dt)) : 1;
    this.started = true;
    const t = this.target;
    u.uKickDir.value.lerp(t.kickDir, k).normalize();
    u.uKickColor.value.lerp(t.kickColor, k);
    u.uKickI.value += (t.kickI - u.uKickI.value) * k;
    u.uRimDir.value.lerp(t.rimDir, k).normalize();
    u.uRimColor.value.lerp(t.rimColor, k);
    u.uRimI.value += (t.rimI - u.uRimI.value) * k;
  }
}
