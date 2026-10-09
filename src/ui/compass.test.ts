import { describe, expect, it } from 'vitest';
import { headingFromYaw, headingOf, layoutLabels, relativeBearing, ribbonPosition, wrapPi } from './compass';

const D = Math.PI / 180;

describe('compass headings', () => {
  it('puts north at −Z and east at +X (where the sun rises)', () => {
    expect(headingOf(0, -1)).toBeCloseTo(0);
    expect(headingOf(1, 0)).toBeCloseTo(90 * D);
    expect(headingOf(0, 1)).toBeCloseTo(180 * D);
    expect(headingOf(-1, 0)).toBeCloseTo(270 * D);
  });
  it('converts a camera yaw (facing = sin, cos) to a heading', () => {
    expect(headingFromYaw(0)).toBeCloseTo(180 * D); // facing +Z = south
    expect(headingFromYaw(Math.PI / 2)).toBeCloseTo(90 * D); // facing +X = east
    expect(headingFromYaw(Math.PI)).toBeCloseTo(0);
  });
  it('measures relative bearings with right positive, wrapped to ±180°', () => {
    expect(relativeBearing(90 * D, 0)).toBeCloseTo(90 * D);
    expect(relativeBearing(350 * D, 10 * D)).toBeCloseTo(-20 * D);
    expect(relativeBearing(10 * D, 350 * D)).toBeCloseTo(20 * D);
    expect(Math.abs(wrapPi(3 * Math.PI))).toBeCloseTo(Math.PI);
  });
  it('facing north, east is to the right', () => {
    const view = headingFromYaw(Math.PI); // facing −Z
    expect(relativeBearing(headingOf(1, 0), view)).toBeGreaterThan(0);
  });
});

describe('ribbonPosition', () => {
  it('maps the visible span to −1..1 and clamps beyond it', () => {
    const out = { x: 0, edge: false };
    expect(ribbonPosition(30 * D, 60 * D, out)).toEqual({ x: 0.5, edge: false });
    expect(ribbonPosition(-90 * D, 60 * D, out)).toEqual({ x: -1, edge: true });
    expect(ribbonPosition(170 * D, 60 * D, out)).toEqual({ x: 1, edge: true });
  });
});

describe('compass label layout', () => {
  const out: number[] = [];
  it('keeps labels apart: the waypoint wins the first row, a clash drops to the second row', () => {
    const rows = layoutLabels(
      [
        { x: 10, width: 120, priority: 1 }, // Unexplored · 1.8 km
        { x: 0, width: 50, priority: 5 }, // waypoint 615 m
        { x: 300, width: 100, priority: 2 }, // far enough away to share the row
      ],
      6,
      2,
      out,
    );
    expect(rows).toEqual([1, 0, 0]);
  });
  it('hides what fits nowhere, preferring the label nearest the center', () => {
    const rows = layoutLabels(
      [
        { x: 40, width: 100, priority: 1 },
        { x: -20, width: 100, priority: 1 },
        { x: 5, width: 100, priority: 1 },
      ],
      4,
      1,
      out,
    );
    expect(rows).toEqual([-1, -1, 0]);
  });
});
