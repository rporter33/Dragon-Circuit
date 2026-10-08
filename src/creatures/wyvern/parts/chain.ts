// Tent-function skin weights along a chain of bones: every bone owns a segment of a 1D
// coordinate (arc length along a tube); a vertex blends linearly between the two bones whose
// segment centers it lies between, so joints bend smoothly instead of creasing.

import { Skin } from '../builder';

export interface ChainSegment {
  bone: number;
  s0: number;
  s1: number;
}

export class SkinChain {
  private centers: number[];
  private bones: number[];

  constructor(segments: ChainSegment[]) {
    this.bones = segments.map((s) => s.bone);
    this.centers = segments.map((s) => (s.s0 + s.s1) / 2);
  }

  skin(s: number, out = new Skin(), weight = 1): Skin {
    const c = this.centers;
    const n = c.length;
    if (n === 1 || s <= c[0]) return out.add(this.bones[0], weight);
    if (s >= c[n - 1]) return out.add(this.bones[n - 1], weight);
    let i = 0;
    while (i < n - 2 && c[i + 1] <= s) i++;
    const t = (s - c[i]) / Math.max(1e-6, c[i + 1] - c[i]);
    out.add(this.bones[i], (1 - t) * weight);
    out.add(this.bones[i + 1], t * weight);
    return out;
  }
}
