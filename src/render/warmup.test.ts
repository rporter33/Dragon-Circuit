import { describe, expect, it } from 'vitest';
import {
  BoxGeometry,
  DoubleSide,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderTarget,
  type Material,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import { COMPILING_LAYER, ShaderWarmup } from './warmup';

/** Just enough of WebGLRenderer for the warmup: compile() records, programs report readiness. */
function fakeRenderer(parallel: boolean) {
  const ready = new Map<Material, boolean>();
  const compiled: Object3D[][] = [];
  let target: WebGLRenderTarget | null = null;
  const gl = {
    extensions: { has: (n: string) => parallel && n === 'KHR_parallel_shader_compile' },
    getRenderTarget: () => target,
    setRenderTarget: (t: WebGLRenderTarget | null) => (target = t),
    compile(root: { traverse(fn: (o: Object3D) => void): void }) {
      const objs: Object3D[] = [];
      root.traverse((o) => objs.push(o));
      compiled.push(objs);
      return new Set();
    },
    properties: {
      get: (m: Material) => ({ currentProgram: { isReady: () => ready.get(m) ?? true } }),
    },
  };
  return { gl: gl as unknown as WebGLRenderer, ready, compiled };
}

const camera = new PerspectiveCamera();
const target = new WebGLRenderTarget(4, 4);

describe('ShaderWarmup (first sight)', () => {
  it('compiles a material the first time it appears, and only then', () => {
    const { gl, compiled } = fakeRenderer(false);
    const w = new ShaderWarmup(gl);
    const scene = new Scene();
    const a = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    scene.add(a);
    w.update(scene, camera, target, 1 / 60);
    expect(compiled.length).toBe(1);
    expect(compiled[0]).toContain(a);
    w.update(scene, camera, target, 1 / 60);
    expect(compiled.length).toBe(1);
    // Another mesh with the same material: nothing new to compile.
    scene.add(new Mesh(a.geometry, a.material));
    w.update(scene, camera, target, 1 / 60);
    expect(compiled.length).toBe(1);
    // The same material on an instanced mesh is a different program.
    const inst = new InstancedMesh(a.geometry, a.material, 4);
    scene.add(inst);
    w.update(scene, camera, target, 1 / 60);
    expect(compiled.length).toBe(2);
    expect(compiled[1]).toEqual([inst]);
  });

  it('recompiles after needsUpdate, but ignores the side flips of transparent double-sided materials', () => {
    const { gl, compiled } = fakeRenderer(false);
    const w = new ShaderWarmup(gl);
    const scene = new Scene();
    const m = new MeshBasicMaterial();
    const glass = new MeshBasicMaterial({ transparent: true, side: DoubleSide });
    scene.add(new Mesh(new BoxGeometry(), m), new Mesh(new BoxGeometry(), glass));
    w.update(scene, camera, target, 1 / 60);
    expect(compiled.length).toBe(1);
    m.needsUpdate = true;
    w.update(scene, camera, target, 1 / 60);
    expect(compiled.length).toBe(2);
    // three flips these every frame while drawing back and front faces.
    glass.needsUpdate = true;
    glass.needsUpdate = true;
    w.update(scene, camera, target, 1 / 60);
    expect(compiled.length).toBe(2);
  });

  it('stops chasing a material that changes every frame', () => {
    const { gl, compiled } = fakeRenderer(false);
    const w = new ShaderWarmup(gl);
    const scene = new Scene();
    const m = new MeshBasicMaterial();
    scene.add(new Mesh(new BoxGeometry(), m));
    for (let i = 0; i < 30; i++) {
      m.needsUpdate = true;
      w.update(scene, camera, target, 1 / 60);
    }
    expect(compiled.length).toBeLessThan(8);
  });

  it('with parallel compilation, holds new objects off camera until their program is ready', () => {
    const { gl, ready } = fakeRenderer(true);
    const w = new ShaderWarmup(gl);
    const scene = new Scene();
    const m = new MeshBasicMaterial();
    const mesh = new Mesh(new BoxGeometry(), m);
    scene.add(mesh);
    ready.set(m, false);
    w.update(scene, camera, target, 1 / 60);
    expect(mesh.layers.isEnabled(0)).toBe(false);
    expect(mesh.layers.isEnabled(COMPILING_LAYER)).toBe(true);
    expect(w.compiling).toBe(1);
    w.update(scene, camera, target, 1 / 60);
    expect(mesh.layers.isEnabled(0)).toBe(false);
    ready.set(m, true);
    w.update(scene, camera, target, 1 / 60);
    expect(mesh.layers.isEnabled(0)).toBe(true);
    expect(w.compiling).toBe(0);
  });

  it('never holds an object back for more than a few seconds', () => {
    const { gl, ready } = fakeRenderer(true);
    const w = new ShaderWarmup(gl);
    const scene = new Scene();
    const m = new MeshBasicMaterial();
    const mesh = new Mesh(new BoxGeometry(), m);
    scene.add(mesh);
    ready.set(m, false);
    w.update(scene, camera, target, 1 / 60);
    for (let i = 0; i < 60 * 4; i++) w.update(scene, camera, target, 1 / 60);
    expect(mesh.layers.isEnabled(0)).toBe(true);
  });

  it('objects whose programs were already linked are never hidden', () => {
    const { gl } = fakeRenderer(true);
    const w = new ShaderWarmup(gl);
    const scene = new Scene();
    const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    scene.add(mesh);
    w.update(scene, camera, target, 1 / 60);
    expect(mesh.layers.isEnabled(0)).toBe(true);
  });

  it('compiles against the scene target and restores the previous one', () => {
    const { gl } = fakeRenderer(false);
    const seen: (WebGLRenderTarget | null)[] = [];
    const g = gl as unknown as { compile: (r: unknown) => unknown; getRenderTarget(): WebGLRenderTarget | null };
    const orig = g.compile;
    g.compile = (r: unknown) => {
      seen.push(g.getRenderTarget());
      return orig(r);
    };
    const w = new ShaderWarmup(gl);
    const scene = new Scene();
    scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    w.update(scene, camera, target, 1 / 60);
    expect(seen).toEqual([target]);
    expect(gl.getRenderTarget()).toBe(null);
  });
});
