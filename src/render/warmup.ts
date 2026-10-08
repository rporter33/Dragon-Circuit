// Shader warmup. WebGL links a program the first time something draws with it, which stalls the
// frame (50-300 ms per program on Windows/ANGLE, seconds in a software rasterizer). Three things
// keep those stalls out of play:
//
//   1. Boot (behind the splash): compile every material in the scene for the real render target
//      (KHR_parallel_shader_compile lets the driver link them in parallel), then draw everything
//      once into a tiny target with culling off. That last draw builds the shadow-depth variants
//      and uploads every geometry and texture, so the first visible frame is cheap.
//   2. First sight: materials that appear later (a site dressed on the far side of the archipelago,
//      rain, a race's rings) are noticed by a cheap per-frame scan and compiled before they are
//      drawn. Where the driver compiles in parallel, the new objects stay on a hidden layer until
//      their programs are ready (they pop in a few frames later, far away in the fog), so the
//      frame never blocks.
//   3. Quality changes: every program depends on shadows, MSAA-free targets, defines the systems
//      toggle... so the whole scene is recompiled right after the change (see Renderer).
//
// Nothing here knows about game content: anything added to the scene is covered, including
// things built far from the starting island (a movable base included).

import {
  DoubleSide,
  HalfFloatType,
  WebGLRenderTarget,
  type Camera,
  type Material,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three';

/** Layer used to hide objects whose programs are still compiling (cameras render layer 0). */
export const COMPILING_LAYER = 31;

const KIND_PLAIN = 1;
const KIND_INSTANCED = 2;
const KIND_SKINNED = 4;
const KIND_BATCHED = 8;
const KIND_INSTANCE_COLOR = 16;

interface Renderable extends Object3D {
  material: Material | Material[];
  isMesh?: boolean;
  isPoints?: boolean;
  isLine?: boolean;
  isSprite?: boolean;
  isInstancedMesh?: boolean;
  isSkinnedMesh?: boolean;
  isBatchedMesh?: boolean;
  instanceColor?: unknown;
}

interface Seen {
  version: number;
  /** Object kinds (plain, instanced, skinned...) it was compiled for. */
  kinds: number;
  changes: number;
  volatile: boolean;
}

interface Pending {
  object: Object3D;
  mask: number;
  materials: Material[];
  since: number;
}

interface ProgramLike {
  isReady(): boolean;
}

function isRenderable(o: Object3D): o is Renderable {
  const r = o as Renderable;
  return !!(r.isMesh || r.isPoints || r.isLine || r.isSprite) && !!r.material;
}

function kindOf(o: Renderable): number {
  let k = 0;
  if (o.isInstancedMesh) k |= KIND_INSTANCED | (o.instanceColor ? KIND_INSTANCE_COLOR : 0);
  if (o.isSkinnedMesh) k |= KIND_SKINNED;
  if (o.isBatchedMesh) k |= KIND_BATCHED;
  return k || KIND_PLAIN;
}

export interface WarmupStats {
  /** Programs that existed before / after. */
  programsBefore: number;
  programsAfter: number;
  /** Milliseconds spent issuing compiles (main thread). */
  compileMs: number;
  /** Milliseconds until every program reported ready. */
  readyMs: number;
  /** Milliseconds of the draw-everything pass (shadow variants, uploads). */
  drawMs: number;
}

export class ShaderWarmup {
  /** Materials already compiled: version and the object kinds they were compiled for. */
  private seen = new WeakMap<Material, Seen>();
  private pending: Pending[] = [];
  private batch: Object3D[] = [];
  /** A stand-in root for compile(): it only walks these objects, which stay where they are. */
  private fakeRoot: {
    children: Object3D[];
    traverse(fn: (o: Object3D) => void): void;
    traverseVisible(fn: (o: Object3D) => void): void;
  } = {
    children: [],
    traverse(fn) {
      for (const c of this.children) c.traverse(fn);
    },
    // compile() gathers lights from here as well as from the scene; these objects are already in
    // the scene, so their lights must not be counted twice (light counts key every lit program).
    traverseVisible() {},
  };
  private time = 0;
  /** Objects compiled on first sight since boot (for diagnostics). */
  firstSight = 0;
  readonly parallel: boolean;

  constructor(private gl: WebGLRenderer) {
    this.parallel = gl.extensions.has('KHR_parallel_shader_compile');
  }

  /** Forget everything compiled (after a quality change every program may differ). */
  reset(): void {
    this.seen = new WeakMap();
  }

  /**
   * Compile every material under `scene` against `target` (the scene render target: programs
   * differ between drawing to a target and to the canvas). Resolves when all report ready.
   */
  async compileAll(scene: Scene, camera: Camera, target: WebGLRenderTarget | null): Promise<{ compileMs: number; readyMs: number }> {
    const t0 = performance.now();
    const prev = this.gl.getRenderTarget();
    this.gl.setRenderTarget(target);
    let done: Promise<unknown> = Promise.resolve();
    try {
      // Without parallel compilation there is nothing to wait for (programs link on first use).
      if (this.parallel) done = this.gl.compileAsync(scene, camera);
      else this.gl.compile(scene, camera);
    } finally {
      this.gl.setRenderTarget(prev);
    }
    const compileMs = performance.now() - t0;
    this.markAll(scene);
    await done;
    return { compileMs, readyMs: performance.now() - t0 };
  }

  /**
   * Draw every object once, culling off, into a tiny target: builds the shadow-depth programs
   * and uploads all geometry and textures. Lights keep their visibility (the light count is part
   * of every lit program).
   */
  drawAll(scene: Scene, camera: Camera, like: WebGLRenderTarget): number {
    const t0 = performance.now();
    const target = new WebGLRenderTarget(16, 16, { type: like.texture.type ?? HalfFloatType, samples: 0 });
    const objects: Object3D[] = [];
    const visible: boolean[] = [];
    const culled: boolean[] = [];
    const lights: { light: Object3D; visible: boolean }[] = [];
    scene.traverse((o) => {
      if ((o as unknown as { isLight?: boolean }).isLight) lights.push({ light: o, visible: effectivelyVisible(o) });
    });
    scene.traverse((o) => {
      objects.push(o);
      visible.push(o.visible);
      culled.push(o.frustumCulled);
      o.visible = true;
      o.frustumCulled = false;
    });
    for (const l of lights) l.light.visible = l.visible;
    const prev = this.gl.getRenderTarget();
    try {
      this.gl.setRenderTarget(target);
      this.gl.render(scene, camera);
    } finally {
      for (let i = 0; i < objects.length; i++) {
        objects[i].visible = visible[i];
        objects[i].frustumCulled = culled[i];
      }
      this.gl.setRenderTarget(prev);
      target.dispose();
      this.gl.shadowMap.needsUpdate = true;
    }
    this.markAll(scene);
    return performance.now() - t0;
  }

  /**
   * Per frame, before drawing: compile materials the scene gained since the last call, and
   * release objects whose programs finished compiling.
   */
  update(scene: Scene, camera: Camera, target: WebGLRenderTarget, dt: number): void {
    this.time += dt;
    if (this.pending.length) this.releaseReady();
    const batch = this.batch;
    batch.length = 0;
    scene.traverse((o) => {
      if (!isRenderable(o)) return;
      if ((o.layers.mask & 1) === 0) return; // hidden from the camera (or already compiling)
      const kind = kindOf(o);
      const m = o.material;
      if (Array.isArray(m)) {
        for (const mm of m) if (this.unknown(mm, kind)) return void batch.push(o);
      } else if (this.unknown(m, kind)) batch.push(o);
    });
    if (!batch.length) return;
    this.compileObjects(batch, scene, camera, target);
    batch.length = 0;
  }

  private compileObjects(objects: Object3D[], scene: Scene, camera: Camera, target: WebGLRenderTarget): void {
    this.fakeRoot.children = objects;
    const prev = this.gl.getRenderTarget();
    this.gl.setRenderTarget(target);
    try {
      // compile() only needs traverse(); the objects stay where they are in the scene graph.
      this.gl.compile(this.fakeRoot as unknown as Object3D, camera, scene);
    } finally {
      this.gl.setRenderTarget(prev);
      this.fakeRoot.children = [];
    }
    for (const o of objects) {
      const r = o as Renderable;
      const mats = Array.isArray(r.material) ? r.material : [r.material];
      for (const m of mats) this.mark(m, kindOf(r));
      this.firstSight++;
      if (!this.parallel) continue;
      if (mats.every((m) => this.ready(m))) continue;
      // Keep it off camera (and out of the shadow map) until the driver has linked it.
      this.pending.push({ object: o, mask: o.layers.mask, materials: mats, since: this.time });
      o.layers.set(COMPILING_LAYER);
    }
  }

  private releaseReady(): void {
    const keep: Pending[] = [];
    for (const p of this.pending) {
      if (this.time - p.since > 3 || p.materials.every((m) => this.ready(m))) p.object.layers.mask = p.mask;
      else keep.push(p);
    }
    this.pending = keep;
  }

  /** True while objects are held back waiting for their programs. */
  get compiling(): number {
    return this.pending.length;
  }

  private ready(m: Material): boolean {
    const props = (this.gl.properties as unknown as { get(o: object): { currentProgram?: ProgramLike } }).get(m);
    const program = props.currentProgram;
    return !program || program.isReady();
  }

  private unknown(m: Material, kind: number): boolean {
    const s = this.seen.get(m);
    if (!s) return true;
    if ((s.kinds & kind) === 0) return true;
    return s.version !== m.version && !s.volatile && !flipsSides(m);
  }

  private mark(m: Material, kind: number): void {
    const s = this.seen.get(m);
    if (!s) {
      this.seen.set(m, { version: m.version, kinds: kind, changes: 0, volatile: false });
      return;
    }
    if (s.version !== m.version) {
      // A material that keeps changing (needsUpdate every frame) would be recompiled forever;
      // after a few changes trust three's own per-draw check for it.
      if (++s.changes > 4) s.volatile = true;
      s.version = m.version;
    }
    s.kinds |= kind;
  }

  private markAll(scene: Object3D): void {
    scene.traverse((o) => {
      if (!isRenderable(o)) return;
      const kind = kindOf(o);
      const m = o.material;
      if (Array.isArray(m)) for (const mm of m) this.mark(mm, kind);
      else this.mark(m, kind);
    });
  }
}

/**
 * Transparent double-sided materials are drawn back face then front face, and three bumps their
 * version for each half every frame; their programs don't change, so ignore those bumps.
 */
function flipsSides(m: Material): boolean {
  return m.transparent && m.side === DoubleSide && !m.forceSinglePass;
}

function effectivelyVisible(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
