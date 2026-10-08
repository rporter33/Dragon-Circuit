// Render-ready pose records for the wyvern and the rider. The player state machine fills these
// every frame (interpolated between physics steps); renderers, the camera, audio and fx read them.

import { Quaternion, Vector3 } from 'three';
import type { RiderPose, WyvernPose } from '../core/types';

export function createWyvernPose(): WyvernPose {
  return {
    position: new Vector3(),
    orientation: new Quaternion(),
    velocity: new Vector3(),
    airborne: true,
    airspeed: 0,
    angularVelocity: new Vector3(),
    wingSpread: 1,
    flapPhase: 0,
    flapStrength: 0,
    flare: 0,
    stall: 0,
    fatigue: 0,
    gait: 'idle',
    groundSpeed: 0,
    gaitTime: 0,
    lookTarget: new Vector3(),
    groundY: null,
  };
}

export function createRiderPose(): RiderPose {
  return {
    mounted: true,
    position: new Vector3(),
    yaw: 0,
    velocity: new Vector3(),
    action: 'mounted',
    actionTime: 0,
    lean: 0,
    crouch: 0,
    brace: 0,
    airflow: new Vector3(),
  };
}
