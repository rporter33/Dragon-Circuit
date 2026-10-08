// Web Worker that generates ground-cover chunks off the main thread. It builds its own Terrain
// from the shared layout (the terrain is pure and deterministic, so results match the main
// thread exactly) and receives the keep-out zones once at init.

import { LAYOUT } from '../../layout';
import { Terrain } from '../../terrain';
import { ExclusionSet, type Exclusion } from '../exclusions';
import { generateFieldChunk, type FieldParams } from './fieldChunk';

export type FieldWorkerRequest =
  | { type: 'init'; exclusions: Exclusion[]; params: FieldParams; gen: number }
  | { type: 'gen'; key: number; cx: number; cz: number; gen: number };

let terrain: Terrain | null = null;
let exclusions = new ExclusionSet();
let params: FieldParams = { density: 1, flowerDensity: 1 };
let generation = 0;

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<FieldWorkerRequest>) => void) | null;
  postMessage(msg: unknown, transfer: Transferable[]): void;
};

scope.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    terrain ??= new Terrain(LAYOUT);
    exclusions = new ExclusionSet();
    for (const x of m.exclusions) exclusions.add(x);
    params = m.params;
    generation = m.gen;
    return;
  }
  if (!terrain || m.gen !== generation) return;
  const d = generateFieldChunk(terrain, exclusions, m.cx, m.cz, params);
  const cut = (a: typeof d.tufts) => {
    const n = a.count * 4;
    return { count: a.count, pos: a.pos.slice(0, n), shape: a.shape.slice(0, n), base: a.base.slice(0, n), tip: a.tip.slice(0, n) };
  };
  const tufts = cut(d.tufts);
  const flowers = cut(d.flowers);
  scope.postMessage({ key: m.key, gen: m.gen, cx: m.cx, cz: m.cz, tufts, flowers, minY: d.minY, maxY: d.maxY }, [
    tufts.pos.buffer,
    tufts.shape.buffer,
    tufts.base.buffer,
    tufts.tip.buffer,
    flowers.pos.buffer,
    flowers.shape.buffer,
    flowers.base.buffer,
    flowers.tip.buffer,
  ]);
};
