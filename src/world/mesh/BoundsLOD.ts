// THREE.LOD measures distance to the object's origin, which is wrong for a 460 m wide island or a
// 700 m tall spire: standing on the rim you are "far" from the center. BoundsLOD measures the
// distance from the camera to the object's bounds (a vertical cylinder or a sphere) instead, so
// level distances mean "how far is the nearest rock".

import { LOD, Vector3, type Camera, type Object3D } from 'three';

export type Bounds =
  | { kind: 'cylinder'; x: number; z: number; radius: number; minY: number; maxY: number }
  | { kind: 'sphere'; x: number; y: number; z: number; radius: number };

/**
 * Distance (m) from a point to bounds; 0 inside. Runs for every feature every frame: plain
 * square roots, since Math.hypot allocates its argument list in V8.
 */
export function boundsDistance(b: Bounds, px: number, py: number, pz: number): number {
  if (b.kind === 'sphere') {
    const dx = px - b.x;
    const dy = py - b.y;
    const dz = pz - b.z;
    return Math.max(0, Math.sqrt(dx * dx + dy * dy + dz * dz) - b.radius);
  }
  const dx = px - b.x;
  const dz = pz - b.z;
  const out = Math.max(0, Math.sqrt(dx * dx + dz * dz) - b.radius);
  const vy = py > b.maxY ? py - b.maxY : py < b.minY ? b.minY - py : 0;
  return Math.sqrt(out * out + vy * vy);
}

const camPos = new Vector3();

export class BoundsLOD extends LOD {
  readonly bounds: Bounds;
  /** Distance used at the last update (for the build scheduler and debugging). */
  lastDistance = Infinity;
  /**
   * Called with the visible level's object whenever a level is picked (each update, during the
   * main pass's scene walk and so before the shadow pass, and after levels change).
   */
  onSelect: ((object: Object3D) => void) | null = null;

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
    const current = levels[i - 1].object;
    for (; i < levels.length; i++) levels[i].object.visible = false;
    this.onSelect?.(current);
  }
}
