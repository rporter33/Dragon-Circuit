import { describe, expect, it } from 'vitest';
import { pickSpatial, pickWrap, type Rect } from './nav';

const r = (x: number, y: number, w = 100, h = 40): Rect => ({ x, y, w, h });

describe('pickSpatial', () => {
  // A 2 × 3 grid of tiles, then a full-width button under it.
  const grid: (Rect | null)[] = [r(0, 0), r(110, 0), r(0, 50), r(110, 50), r(0, 100), r(110, 100), r(0, 160, 210, 40)];

  it('moves within a column and a row', () => {
    expect(pickSpatial(grid[0]!, grid, 'down', 0)).toBe(2);
    expect(pickSpatial(grid[3]!, grid, 'down', 3)).toBe(5);
    expect(pickSpatial(grid[2]!, grid, 'right', 2)).toBe(3);
    expect(pickSpatial(grid[3]!, grid, 'left', 3)).toBe(2);
    expect(pickSpatial(grid[5]!, grid, 'up', 5)).toBe(3);
  });
  it('reaches the wide button below the last row from either column', () => {
    expect(pickSpatial(grid[4]!, grid, 'down', 4)).toBe(6);
    expect(pickSpatial(grid[5]!, grid, 'down', 5)).toBe(6);
  });
  it('returns −1 at an edge', () => {
    expect(pickSpatial(grid[0]!, grid, 'up', 0)).toBe(-1);
    expect(pickSpatial(grid[1]!, grid, 'right', 1)).toBe(-1);
  });
  it('skips hidden (null or empty) items', () => {
    const g = [r(0, 0), null, r(0, 100), { x: 0, y: 50, w: 0, h: 0 }];
    expect(pickSpatial(g[0]!, g, 'down', 0)).toBe(2);
  });
  it('prefers the item in line over a nearer one off to the side', () => {
    const g = [r(0, 0), r(300, 45), r(0, 120)];
    expect(pickSpatial(g[0]!, g, 'down', 0)).toBe(2);
  });
});

describe('pickWrap', () => {
  const list = [r(0, 0), r(0, 50), r(0, 100)];
  it('wraps a column from the bottom to the top and back', () => {
    expect(pickWrap(list[2], list, 'down', 2)).toBe(0);
    expect(pickWrap(list[0], list, 'up', 0)).toBe(2);
  });
});
