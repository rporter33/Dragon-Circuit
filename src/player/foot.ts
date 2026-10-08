// The rider on foot: camera-relative walking and running, jumping, steps up and down, slopes
// too steep to climb, and walking off an edge. Kinematic (no rigid body): the analytic terrain
// is sampled directly, so what you see is what you stand on.

import { Vector3 } from 'three';
import type { SurfaceKind, TerrainQuery } from '../core/types';
import { angleDelta, clamp } from '../core/math';
import { PLAYER_TUNING as P } from './tuning';

export interface FootControls {
  /** Camera-relative stick: x right, y forward. */
  moveX: number;
  moveY: number;
  sprint: boolean;
  jump: boolean;
}

export interface FootStepResult {
  /** Landed this step after being airborne; impact = downward speed (m/s). */
  landed: boolean;
  impact: number;
  /** Left the ground this step (walked off a ledge or jumped). */
  leftGround: boolean;
  jumped: boolean;
  footstep: boolean;
}

const _dir = new Vector3();
const _push = new Vector3();
const _n = new Vector3();
const _hip = new Vector3();

export class RiderFoot {
  /** Between the feet, on the ground when grounded. */
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  yaw = 0;
  grounded = true;
  airTime = 0;
  groundY = 0;
  readonly normal = new Vector3(0, 1, 0);
  surface: SurfaceKind = 'grass';
  /** Horizontal speed (m/s). */
  speed = 0;
  private stride = 0;
  private result: FootStepResult = { landed: false, impact: 0, leftGround: false, jumped: false, footstep: false };

  /** Stand at (x, z) on the ground found near y. False over open air. */
  place(p: Vector3, yaw: number, terrain: TerrainQuery): boolean {
    this.position.copy(p);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.speed = 0;
    this.airTime = 0;
    const g = terrain.groundAt(p.x, p.z, p.y + 2);
    if (!g) {
      this.grounded = false;
      return false;
    }
    this.position.y = g.y;
    this.groundY = g.y;
    this.normal.copy(g.normal);
    this.surface = g.surface;
    this.grounded = true;
    return true;
  }

  /** Free fall with no control (after falling off an island). */
  fall(dt: number): void {
    this.velocity.y -= P.footGravity * dt;
    this.velocity.x *= Math.exp(-0.3 * dt);
    this.velocity.z *= Math.exp(-0.3 * dt);
    this.position.addScaledVector(this.velocity, dt);
    this.grounded = false;
    this.airTime += dt;
  }

  step(dt: number, c: FootControls, cameraYaw: number, terrain: TerrainQuery): FootStepResult {
    const r = this.result;
    r.landed = false;
    r.impact = 0;
    r.leftGround = false;
    r.jumped = false;
    r.footstep = false;

    // Camera-relative wish direction: forward = (sin, 0, cos), right = (-cos, 0, sin).
    const sx = Math.sin(cameraYaw);
    const cx = Math.cos(cameraYaw);
    _dir.set(-cx * c.moveX + sx * c.moveY, 0, sx * c.moveX + cx * c.moveY);
    const mag = Math.min(1, _dir.length());
    if (mag > 1e-3) _dir.multiplyScalar(1 / _dir.length());
    const wish = mag * (c.sprint ? P.runSpeed : P.walkSpeed);

    // Accelerate the horizontal velocity toward the wish velocity.
    const accel = this.grounded ? P.footAccel : P.airAccel;
    const tx = _dir.x * wish - this.velocity.x;
    const tz = _dir.z * wish - this.velocity.z;
    const tl = Math.hypot(tx, tz);
    const dv = Math.min(tl, accel * dt);
    if (tl > 1e-6) {
      this.velocity.x += (tx / tl) * dv;
      this.velocity.z += (tz / tl) * dv;
    }
    if (mag > 0.1) this.yaw += clamp(angleDelta(this.yaw, Math.atan2(_dir.x, _dir.z)), -12 * dt, 12 * dt);

    // Steep ground under the feet: slide down it.
    if (this.grounded && this.normal.y < P.maxSlopeY) {
      this.velocity.x += this.normal.x * 9 * dt;
      this.velocity.z += this.normal.z * 9 * dt;
    }

    if (c.jump && this.grounded) {
      this.velocity.y = P.jumpSpeed;
      this.grounded = false;
      r.jumped = true;
      r.leftGround = true;
    }

    // Horizontal move, refusing to climb slopes steeper than ~40°.
    const nx = this.position.x + this.velocity.x * dt;
    const nz = this.position.z + this.velocity.z * dt;
    let g = terrain.groundAt(nx, nz, this.position.y + P.stepUp);
    // Uphill means moving against the slope's downhill (horizontal normal) direction.
    const uphill = g ? this.velocity.x * g.normal.x + this.velocity.z * g.normal.z < 0 : false;
    if (g && g.normal.y < P.maxSlopeY && uphill && this.grounded) {
      // Blocked: cancel the uphill part of the velocity (the slope's horizontal normal points downhill).
      const hx = g.normal.x;
      const hz = g.normal.z;
      const hl = Math.hypot(hx, hz) || 1;
      const into = (this.velocity.x * hx + this.velocity.z * hz) / hl;
      if (into < 0) {
        this.velocity.x -= (into * hx) / hl;
        this.velocity.z -= (into * hz) / hl;
      }
      g = terrain.groundAt(this.position.x, this.position.z, this.position.y + P.stepUp);
    } else {
      this.position.x = nx;
      this.position.z = nz;
    }

    // Walls (arch legs, spires, cliff rims from below): push out at hip height, horizontally.
    _hip.set(this.position.x, this.position.y + P.riderHip, this.position.z);
    if (terrain.collideSphere(_hip, P.riderRadius, _push, _n)) {
      this.position.x += _push.x;
      this.position.z += _push.z;
      const vn = this.velocity.x * _n.x + this.velocity.z * _n.z;
      if (vn < 0) {
        this.velocity.x -= vn * _n.x;
        this.velocity.z -= vn * _n.z;
      }
    }

    // Vertical.
    if (this.grounded) {
      if (g && this.position.y - g.y <= P.stepDown) {
        this.position.y = g.y;
        this.velocity.y = 0;
      } else {
        this.grounded = false;
        r.leftGround = true;
        this.velocity.y = Math.min(this.velocity.y, 0);
      }
    }
    if (!this.grounded) {
      this.airTime += dt;
      this.velocity.y -= P.footGravity * dt;
      this.position.y += this.velocity.y * dt;
      const land = terrain.groundAt(this.position.x, this.position.z, this.position.y + P.stepUp);
      if (land && this.position.y <= land.y && this.velocity.y <= 0) {
        r.landed = true;
        r.impact = -this.velocity.y;
        this.position.y = land.y;
        this.velocity.y = 0;
        this.grounded = true;
        this.airTime = 0;
        g = land;
      }
    } else {
      this.airTime = 0;
    }
    if (g && this.grounded) {
      this.groundY = g.y;
      this.normal.copy(g.normal);
      this.surface = g.surface;
    }

    this.speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded && this.speed > 0.3) {
      this.stride += this.speed * dt;
      // Longer strides at speed: ~0.9 m strolling, ~1.5 m jogging, ~2.3 m sprinting.
      const strideLength = 0.55 + 0.23 * this.speed;
      if (this.stride >= strideLength) {
        this.stride -= strideLength;
        r.footstep = true;
      }
    }
    return r;
  }
}
