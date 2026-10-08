// THREE.LOD measures distance to the object's origin, which is wrong for a 460 m wide island or a
// 700 m tall spire: standing on the rim you are "far" from the center. BoundsLOD measures the
// distance from the camera to the object's bounds (a vertical cylinder or a sphere) instead, so
// level distances mean "how far is the nearest rock".

import { LOD, Vector3, type Camera, type Object3D } from 'three';

export type Bounds =
  | { kind: 'cylinder'; x: number; z: number; radius: number; minY: number; maxY: number }
  | { kind: 'sphere'; x: number; y: number; z: number; radius: number };

/** Distance (m) from a point to bounds; 0 inside. */
export function boundsDistance(b: Bounds, px: number, py: number, pz: number): number {
  if (b.kind === 'sphere') return Math.max(0, Math.hypot(px - b.x, py - b.y, pz - b.z) - b.radius);
  const out = Math.max(0, Math.hypot(px - b.x, pz - b.z) - b.radius);
  const vy = py > b.maxY ? py - b.maxY : py < b.minY ? b.minY - py : 0;
  return Math.hypot(out, vy);
}

const camPos = new Vector3();

export class BoundsLOD extends LOD {
  readonly bounds: Bounds;
  /** Distance used at the last update (for the build scheduler and debugging). */
  lastDistance = Infinity;

  constructor(bounds: Bounds) {
    super();
    this.bounds = bounds;
  }

  /** Adds or replaces the level at `distance`, keeping levels sorted. */
  setLevel(object: Object3D, distance: number, hysteresis = 0.08): void {
    this.removeLevel(distance);
    this.addLevel(object, distance, hysteresis);
    // A freshly added level must not flash in before the next update picks the right one.
    object.visible = false;
    this.selectLevel();
  }

  /** Re-picks the visible level (after levels change). */
  refresh(): void {
    this.selectLevel();
  }

  update(camera: Camera): void {
    camPos.setFromMatrixPosition(camera.matrixWorld);
    this.lastDistance = boundsDistance(this.bounds, camPos.x, camPos.y, camPos.z);
    this.selectLevel();
  }

  /** Same selection rule as THREE.LOD, on the bounds distance. */
  private selectLevel(): void {
    const levels = this.levels;
    if (levels.length === 0) return;
    const distance = this.lastDistance;
    levels[0].object.visible = true;
    let i = 1;
    for (; i < levels.length; i++) {
      let levelDistance = levels[i].distance;
      if (levels[i].object.visible) levelDistance -= levelDistance * levels[i].hysteresis;
      if (distance >= levelDistance) {
        levels[i - 1].object.visible = false;
        levels[i].object.visible = true;
      } else break;
    }
    (this as unknown as { _currentLevel: number })._currentLevel = i - 1;
    for (; i < levels.length; i++) levels[i].object.visible = false;
  }
}
