// Presentation only. Deliberately separate from courseVia: those points steer test autopilots.
// No steering, timing, save data, rewards or breed tuning belongs here.
import type { ThermalDef } from '../world/layout';
import { THERMAL_EDGE } from '../sky/windField';

export const LANTERN_LIFT_ID = 4;
export const LANTERN_EXIT_HEIGHT = 730;

export interface LanternCoachFrame {
  x: number; y: number; z: number;
  /** Actual sampled rising air and wyvern climb rate are different measurements. */
  lift: number; vy: number; stall: number;
  missedFinish: boolean;
  finishX: number; finishY: number; finishZ: number;
}

export interface LanternAdvice {
  phase: 'seek' | 'climb' | 'exit' | 'approach' | 'recover' | 'stall' | 'finish';
  title: string;
  body: string;
  suggestLift: boolean;
}

export class LanternCoach {
  private inLift = false;
  private entryY = 0;
  private leftLift = false;
  private heightReady = false;
  private stalled = false;

  reset(): void { this.inLift = false; this.entryY = 0; this.leftLift = false; this.heightReady = false; this.stalled = false; }

  update(f: LanternCoachFrame, thermal: ThermalDef): LanternAdvice {
    const distance = Math.hypot(f.x - thermal.x, f.z - thermal.z);
    const inColumn = distance < thermal.radius * THERMAL_EDGE && f.y > thermal.baseY && f.y < thermal.topY;
    // Hysteresis follows the existing weather lift vocabulary, but requires the suggested
    // column too: unrelated ridge lift must never be called Lantern's thermal.
    const lifting = inColumn && f.lift > (this.inLift ? 1 : 2);
    if (lifting && !this.inLift) { this.entryY = f.y; this.leftLift = false; }
    if (!lifting && this.inLift) this.leftLift = true;
    this.inLift = lifting;
    // Ephemeral progress through climb -> glide. Descending from the suggested departure
    // height toward a lower finish is expected; the departure altitude is not a recovery floor.
    if (f.y >= LANTERN_EXIT_HEIGHT) this.heightReady = true;
    else if (f.y < f.finishY - 20) this.heightReady = false;

    // Avoid alternating recovery lines when the physical stall measure hovers at its edge.
    this.stalled = f.stall > (this.stalled ? 0.05 : 0.15);
    if (this.stalled) return { phase: 'stall', title: 'Recover airspeed', body: 'Ease the nose down; level the wings. Climb again once speed returns.', suggestLift: !lifting };
    if (f.missedFinish) return { phase: 'finish', title: 'Room for another approach', body: 'Make a wide turn in open sky; approach the gold ring from the Roost side.', suggestLift: f.y < f.finishY - 20 };
    if (lifting) {
      const gain = Math.round(f.y - this.entryY);
      const delta = `${gain >= 0 ? '+' : '−'}${Math.abs(gain)} m`;
      const rate = `${f.vy >= 0 ? '+' : '−'}${Math.abs(f.vy).toFixed(1)} m/s`;
      if (f.y >= LANTERN_EXIT_HEIGHT) return { phase: 'exit', title: `Climb ${delta} · height to spare`, body: 'Leave when ready. Glide around the spire’s east side; bank toward the gold ring.', suggestLift: false };
      return { phase: 'climb', title: `In rising air · climb ${delta} · ${rate}`, body: 'Circle gently inside the warm strokes. Release flap; aim for about 730 m before leaving.', suggestLift: false };
    }
    const finishDistance = Math.hypot(f.x - f.finishX, f.z - f.finishZ);
    if (finishDistance <= 350 && f.y >= f.finishY - 20) return { phase: 'approach', title: `Gold finish · ${Math.round(f.finishY)} m`, body: 'Line up at the ring’s height; keep speed and approach from the spire’s east side.', suggestLift: false };
    if (this.heightReady || f.y >= LANTERN_EXIT_HEIGHT - 15) return { phase: 'exit', title: 'Glide, then bank', body: 'Go around the spire’s east side toward the gold ring. More lift is always an option.', suggestLift: false };
    if (this.leftLift) return { phase: 'recover', title: 'Lift fell away · circle back', body: 'Keep speed; turn gently back into the warm column south of the spire.', suggestLift: true };
    return { phase: 'seek', title: 'Suggested lift · south of Lantern Spire', body: 'Find the warm rising strokes; enter below 730 m with speed, then circle gently.', suggestLift: true };
  }
}
