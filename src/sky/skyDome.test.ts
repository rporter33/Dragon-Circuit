import { describe, expect, it } from 'vitest';
import { Color, DataTexture, Scene, Vector2, Vector3 } from 'three';
import { DOME_FRAGMENT, STAR_GLINTS, STAR_GLINT_K, STAR_R_PX, SkyDome } from './SkyDome';

// The night sky's "little squares" (fix/gfx): stars took fwidth() after an early return for
// empty cells, which is undefined, and some GPUs drew each star's cell as a square outline; the
// milky way was painted per cube face, so the cube's seams cut it with straight edges; stars on a
// seam smeared into dashes; and stars crowded toward the cube's edges.

/** The body of a GLSL function, from its signature to the matching closing brace. */
function body(src: string, signature: string): string {
  const start = src.indexOf(signature);
  expect(start, signature).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${signature}`);
}

const DERIVATIVE = /\b(dFdx|dFdy|fwidth)\s*\(/g;

describe('sky dome shader (night-sky squares)', () => {
  it('takes every screen-space derivative in main() before anything branches', () => {
    const main = body(DOME_FRAGMENT, 'void main()');
    const firstBranch = main.search(/\bif\s*\(/);
    expect(firstBranch).toBeGreaterThan(0);
    const inMain = [...main.matchAll(DERIVATIVE)];
    expect(inMain.length).toBeGreaterThan(0);
    for (const m of inMain) expect(m.index, `${m[0]} after a branch`).toBeLessThan(firstBranch);
    // ...and nowhere else in the shader (helpers run inside branches).
    const all = [...DOME_FRAGMENT.matchAll(DERIVATIVE)];
    expect(all.length).toBe(inMain.length);
  });

  it('paints the milky way without per-face coordinates (no cube seams)', () => {
    const stars = body(DOME_FRAGMENT, 'vec3 stars(');
    const noise = stars.split('\n').filter((l) => /dwFbm|dwVnoise/.test(l));
    expect(noise.length).toBeGreaterThan(0);
    for (const l of noise) {
      expect(l, 'milky-way noise must not use the face index').not.toMatch(/\bface\b/);
      expect(l, 'milky-way noise must not use the face uv').not.toMatch(/\buv\b/);
    }
  });

  it('keeps stars as many per steradian at a face middle as at its rim, same total', () => {
    const norm = Number(/STAR_AREA_NORM = ([0-9.]+)/.exec(DOME_FRAGMENT)?.[1]);
    // Solid angle of one cube face, by integrating (1+u²+v²)^-1.5 over the face's uv square.
    const cells = 55;
    let sum = 0;
    for (let i = -cells; i < cells; i++) {
      for (let j = -cells; j < cells; j++) {
        const u = (i + 0.5) / cells;
        const v = (j + 0.5) / cells;
        sum += Math.pow(1 + u * u + v * v, -1.5);
      }
    }
    const mean = sum / (2 * cells) ** 2;
    expect(mean * 4).toBeCloseTo((4 * Math.PI) / 6, 3);
    // The weighting keeps the star count per face (mean weight 1).
    expect(mean * norm).toBeCloseTo(1, 3);
  });

  it('has the exact screen derivative of the face uv on all six faces (seam-continuous)', () => {
    // Mirror of the quotient rule in stars(): uv = s.<minor>/|s.<major>|, so
    // duv = (ds.<minor> - uv * sign(s.<major>) * ds.<major>) / |s.<major>|.
    const minor = [
      [1, 2],
      [0, 2],
      [0, 1],
    ];
    const faceUv = (s: number[]) => {
      const a = s.map(Math.abs);
      const ax = a[0] > a[1] && a[0] > a[2] ? 0 : a[1] > a[2] ? 1 : 2;
      const [p, q] = minor[ax];
      return { ax, uv: [s[p] / a[ax], s[q] / a[ax]] };
    };
    const jac = (s: number[], ds: number[]) => {
      const { ax, uv } = faceUv(s);
      const [p, q] = minor[ax];
      const m = Math.sign(s[ax]);
      const a = Math.abs(s[ax]);
      return [(ds[p] - uv[0] * m * ds[ax]) / a, (ds[q] - uv[1] * m * ds[ax]) / a];
    };
    const norm = (v: number[]) => {
      const l = Math.hypot(...v);
      return v.map((x) => x / l);
    };
    const h = 1e-6;
    for (const dir of [
      [0.9, 0.3, -0.2],
      [-0.8, 0.4, 0.3],
      [0.2, 0.95, -0.1],
      [0.3, -0.85, 0.2],
      [-0.1, 0.3, 0.9],
      [0.25, -0.2, -0.9],
    ]) {
      const s = norm(dir);
      const ds = [0.31, -0.17, 0.23];
      const { uv: u0 } = faceUv(s);
      const { uv: u1 } = faceUv(s.map((x, i) => x + ds[i] * h));
      const j = jac(s, ds);
      expect(j[0]).toBeCloseTo((u1[0] - u0[0]) / h, 4);
      expect(j[1]).toBeCloseTo((u1[1] - u0[1]) / h, 4);
    }
    // Two neighbouring pixels either side of a seam (x face | z face, one pixel ≈ 1.5 mrad apart).
    // A finite difference of the face uv between them (what fwidth took) jumps by about the face's
    // whole width, so a star there was drawn hundreds of cells wide: a dash along the seam. The
    // exact derivative stays a pixel's worth of uv on both sides.
    const px = 0.0015;
    const left = norm([1, 0.2, 1 - px / 2]);
    const right = norm([1 - px / 2, 0.2, 1]);
    const step = right.map((x, i) => (x - left[i]) / px);
    const jump = Math.hypot(...faceUv(right).uv.map((x, i) => x - faceUv(left).uv[i]));
    const exactL = Math.hypot(...jac(left, step)) * px;
    const exactR = Math.hypot(...jac(right, step)) * px;
    expect(jump).toBeGreaterThan(0.5);
    for (const exact of [exactL, exactR]) {
      expect(exact).toBeLessThan(0.005);
      expect(jump / exact).toBeGreaterThan(100);
    }
  });

  it('draws stars as crisp points by default; glints are an opt-in look', () => {
    expect(STAR_R_PX).toBeGreaterThanOrEqual(1);
    expect(STAR_R_PX).toBeLessThanOrEqual(2);
    expect(STAR_GLINTS).toBe(0);
    expect(STAR_GLINT_K).toBeGreaterThan(0);
    expect(STAR_GLINT_K).toBeLessThan(0.3);
    const dome = new SkyDome(new Scene(), {
      uCloudLit: { value: new Color() },
      uCloudShade: { value: new Color() },
      uFlashPos: { value: new Vector3() },
      uFlash: { value: 0 },
      uCloudDirect: { value: 0 },
      uSeaTex: { value: new DataTexture() },
      uScrollMacro: { value: new Vector2() },
      uSeaMean01: { value: 0.5 },
    });
    expect(dome.uniforms.uStarGlints.value).toBe(STAR_GLINTS);
  });
});
