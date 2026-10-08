// Keep-out zones for scattered dressing. Structures and streams register their footprints first;
// trees, rocks, grass and flowers then skip anything inside. Pure data, no three.js.

export type Exclusion =
  | { kind: 'circle'; x: number; z: number; r: number; /** Grass may still grow inside (trees/rocks may not). */ grassOk: boolean }
  | { kind: 'capsule'; ax: number; az: number; bx: number; bz: number; r: number; grassOk: boolean };

const CELL = 64;

function bounds(e: Exclusion): [number, number, number, number] {
  if (e.kind === 'circle') return [e.x - e.r, e.z - e.r, e.x + e.r, e.z + e.r];
  return [Math.min(e.ax, e.bx) - e.r, Math.min(e.az, e.bz) - e.r, Math.max(e.ax, e.bx) + e.r, Math.max(e.az, e.bz) + e.r];
}

/** Signed distance from (x, z) to the zone's edge (negative inside). */
export function exclusionDistance(e: Exclusion, x: number, z: number): number {
  if (e.kind === 'circle') return Math.hypot(x - e.x, z - e.z) - e.r;
  const abx = e.bx - e.ax;
  const abz = e.bz - e.az;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 0 ? ((x - e.ax) * abx + (z - e.az) * abz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - (e.ax + abx * t), z - (e.az + abz * t)) - e.r;
}

export class ExclusionSet {
  readonly items: Exclusion[] = [];
  private grid = new Map<number, Exclusion[]>();

  private key(cx: number, cz: number): number {
    return (cx + 2000) * 8192 + (cz + 2000);
  }

  add(e: Exclusion): void {
    this.items.push(e);
    const [x0, z0, x1, z1] = bounds(e);
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const k = this.key(cx, cz);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(e);
      }
    }
  }

  circle(x: number, z: number, r: number, grassOk = false): void {
    this.add({ kind: 'circle', x, z, r, grassOk });
  }

  capsule(ax: number, az: number, bx: number, bz: number, r: number, grassOk = false): void {
    this.add({ kind: 'capsule', ax, az, bx, bz, r, grassOk });
  }

  /**
   * Distance from (x, z) to the nearest zone edge (negative inside), or +Infinity if no zone is
   * within a cell. `forGrass` ignores zones that let grass grow.
   */
  distance(x: number, z: number, forGrass = false): number {
    const list = this.grid.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return Infinity;
    let best = Infinity;
    for (const e of list) {
      if (forGrass && e.grassOk) continue;
      const d = exclusionDistance(e, x, z);
      if (d < best) best = d;
    }
    return best;
  }

  blocked(x: number, z: number, pad = 0, forGrass = false): boolean {
    return this.distance(x, z, forGrass) < pad;
  }

  /** Zones touching an axis-aligned box (for per-chunk prefiltering). */
  inBox(x0: number, z0: number, x1: number, z1: number, out: Exclusion[] = []): Exclusion[] {
    out.length = 0;
    const seen = new Set<Exclusion>();
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const list = this.grid.get(this.key(cx, cz));
        if (!list) continue;
        for (const e of list) {
          if (seen.has(e)) continue;
          seen.add(e);
          const [ex0, ez0, ex1, ez1] = bounds(e);
          if (ex1 < x0 || ex0 > x1 || ez1 < z0 || ez0 > z1) continue;
          out.push(e);
        }
      }
    }
    return out;
  }
}
