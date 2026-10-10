// Hand-authored stroke capitals; no browser fonts or downloaded assets.
import { BoxGeometry, Matrix4 } from 'three';
import { GeoBuilder, xf } from '../geom';

type Stroke = [number, number, number, number];
const strokes: Record<string, Stroke[]> = {
  Α: [[0,0,.5,1],[.5,1,1,0],[.2,.4,.8,.4]],
  Ρ: [[0,0,0,1],[0,1,.8,1],[.8,1,1,.75],[1,.75,.8,.5],[.8,.5,0,.5]],
  Π: [[0,0,0,1],[0,1,1,1],[1,1,1,0]],
  Ο: [[.2,0,.8,0],[.8,0,1,.2],[1,.2,1,.8],[1,.8,.8,1],[.8,1,.2,1],[.2,1,0,.8],[0,.8,0,.2],[0,.2,.2,0]],
  Ϲ: [[1,.9,.3,1],[.3,1,0,.7],[0,.7,0,.3],[0,.3,.3,0],[.3,0,1,.1]],
  Ε: [[0,0,0,1],[0,1,1,1],[0,.5,.8,.5],[0,0,1,0]],
  Ν: [[0,0,0,1],[0,1,1,0],[1,0,1,1]],
  Ζ: [[0,1,1,1],[1,1,0,0],[0,0,1,0]],
  Η: [[0,0,0,1],[1,0,1,1],[0,.5,1,.5]],
  Τ: [[0,1,1,1],[.5,1,.5,0]],
  Ι: [[.5,0,.5,1]],
  Υ: [[0,1,.5,.5],[1,1,.5,.5],[.5,.5,.5,0]],
  Ψ: [[.5,0,.5,1],[0,1,0,.6],[0,.6,.5,.4],[.5,.4,1,.6],[1,.6,1,1]],
  Λ: [[0,0,.5,1],[.5,1,1,0]],
  Δ: [[0,0,.5,1],[.5,1,1,0],[0,0,1,0]],
  Κ: [[0,0,0,1],[0,.5,1,1],[0,.5,1,0]],
  Θ: [[.2,0,.8,0],[.8,0,1,.3],[1,.3,1,.7],[1,.7,.8,1],[.8,1,.2,1],[.2,1,0,.7],[0,.7,0,.3],[0,.3,.2,0],[0,.5,1,.5]],
  Ω: [[0,0,.3,0],[.3,0,0,.4],[0,.4,0,.8],[0,.8,.3,1],[.3,1,.7,1],[.7,1,1,.8],[1,.8,1,.4],[1,.4,.7,0],[.7,0,1,0]],
  Μ: [[0,0,0,1],[0,1,.5,.4],[.5,.4,1,1],[1,1,1,0]],
  Β: [[0,0,0,1],[0,1,.7,1],[.7,1,1,.75],[1,.75,0,.5],[0,.5,1,.25],[1,.25,.7,0],[.7,0,0,0]],
};
export function supportsGlyph(char: string): boolean { return char in strokes; }

export function carvedText(builder: GeoBuilder, frame: Matrix4, lines: readonly string[]): void {
  const primitive = new BoxGeometry(1, 1, 1);
  lines.forEach((line, row) => {
    for (let i = 0; i < line.length; i++) {
      const glyph = strokes[line[i]];
      if (!glyph) throw new Error(`Unsupported inscription glyph: ${line[i]}`);
      for (const [ax, ay, bx, by] of glyph) {
        const dx = (bx - ax) * .095, dy = (by - ay) * .17;
        const local = xf((i - line.length / 2) * .13 + (ax + bx) * .0475,
          1.6 - row * .29 + (ay + by) * .085, .311, 0, 0, Math.atan2(dy, dx), Math.hypot(dx, dy), .017, .012);
        builder.add(primitive, new Matrix4().multiplyMatrices(frame, local), { color: '#625b50' });
      }
    }
  });
  primitive.dispose();
}
