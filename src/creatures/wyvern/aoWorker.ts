// Web Worker that bakes the wyvern's ambient occlusion off the main thread (see ao.ts).

import { bakeAO, type AOJob } from './ao';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<AOJob & { id: number }>) => void) | null;
  postMessage(msg: unknown, transfer: Transferable[]): void;
};

scope.onmessage = (e) => {
  const { id, pos, nrm, tris, mask } = e.data;
  const ao = bakeAO(pos, nrm, tris, mask);
  scope.postMessage({ id, ao }, [ao.buffer]);
};
