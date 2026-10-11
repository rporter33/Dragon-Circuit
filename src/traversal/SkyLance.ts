import { Vector3 } from 'three';
import type { SweepWorld } from './sweep';
import { LANCE as T } from './tuning';
import type { Tether } from './tether';
export type LanceState = 'ready' | 'projectile' | 'anchored' | 'spent';
/** Fixed-step equipment state; neither animation nor render geometry controls collision. */
export class SkyLance {
  state: LanceState = 'ready';
  readonly position = new Vector3();
  readonly previous = new Vector3();
  readonly velocity = new Vector3();
  readonly direction = new Vector3(0, 0, 1);
  rope: Tether | null = null;
  anchorId: string | null = null;
  age = 0;
  castAge = Infinity;
  reason = '';
  taut = false;
  pullTime = 0;
  pull(): void { if (this.rope && this.pullTime <= 0) this.pullTime = T.pullDuration; }
  charging = false;
  charge = 0;
  private range: number = T.maxLength;
  constructor(readonly world: SweepWorld) {}
  beginCharge(): void { if (this.state === 'ready') { this.charging = true; this.charge = 0; } }
  cancelCharge(): void { this.charging = false; this.charge = 0; }
  windup(dt: number): void { if (this.charging && dt > 0) this.charge = Math.min(1, this.charge + dt / T.chargeTime); }
  throw(origin: Vector3, aim: Vector3, inherited: Vector3, strength = 0): boolean {
    if (this.state !== 'ready') return false;
    if (aim.lengthSq() < 1e-8 || !aim.toArray().every(Number.isFinite)) { this.cancelCharge(); return false; }
    this.position.copy(origin); this.previous.copy(origin);
    this.direction.copy(aim).normalize();
    const power = Math.max(0, Math.min(1, strength));
    this.velocity.copy(this.direction).multiplyScalar(T.throwSpeed + (T.chargedSpeed - T.throwSpeed) * power).add(inherited);
    this.range = T.maxLength + (T.chargedLength - T.maxLength) * power;
    this.cancelCharge();
    this.state = 'projectile'; this.age = 0; this.castAge = 0; this.reason = ''; return true;
  }
  /** Player owns movement and checks the final collision-resolved line once per step.
   * Standalone equipment/prediction still validates its entire path here. New attachments
   * always validate immediately, before they can arbitrate rescue or movement. */
  step(dt: number, harness: Vector3, pathAfterMovement = false): boolean {
    if (!(dt > 0)) return false;
    this.castAge += dt;
    if (this.state === 'spent') {
      this.age += dt;
      if (this.age + 1e-12 >= T.recoveryTime) this.reset();
      return false;
    }
    if (this.rope) { this.validate(harness,!pathAfterMovement); return false; }
    if (this.state !== 'projectile') return false;
    this.age += dt; this.previous.copy(this.position);
    this.velocity.y -= T.projectileGravity * dt;
    this.position.addScaledVector(this.velocity, dt);
    this.direction.copy(this.velocity).normalize();
    const hit = this.world.sweep(this.previous, this.position, T.tipRadius);
    if (hit) {
      this.position.copy(hit.point);
      const length = this.position.distanceTo(harness);
      if (hit.anchorId && length >= T.minLength && length <= this.range) {
        this.anchorId = hit.anchorId;
        this.rope = { anchor: this.position.clone(), length };
        this.state = 'anchored'; return this.validate(harness);
      }
      this.detach(hit.anchorId ? 'Out of tether range' : 'Not an anchor');
    } else if (this.age >= T.maxFlight || this.position.distanceTo(harness) > this.range) this.detach('Missed');
    return false;
  }
  /** Static identity always validates before dispatch, even while slack. Player also checks
   * obstruction after its sole movement integration; standalone callers check both by default. */
  validate(harness: Vector3, checkPath = true, retainObstructed = false): boolean {
    if (!this.rope || !this.anchorId) return false;
    if (!this.world.anchorValid(this.anchorId)) { this.detach('Anchor invalidated'); return false; }
    if (!checkPath) return true;
    const hit = this.world.sweep(harness, this.rope.anchor, .02, this.anchorId);
    if (hit) { if (retainObstructed) this.reason = 'Line caught at edge'; else this.detach('Tether obstructed'); return false; }
    this.reason = ''; return true;
  }
  detach(reason = 'Released'): void {
    this.cancelCharge(); this.pullTime = 0; this.anchorId = null; this.age = 0;
    this.rope = null; this.taut = false; this.state = 'spent'; this.reason = reason;
  }
  recover(): boolean {
    if (this.state === 'ready' || this.state === 'anchored') return false;
    this.reset(); return true;
  }
  reset(): void { this.pullTime = 0; this.cancelCharge(); this.castAge = Infinity; this.range = T.maxLength; this.state = 'ready'; this.rope = null; this.anchorId = null; this.age = 0; this.reason = ''; this.taut = false; this.velocity.set(0, 0, 0); }
}
