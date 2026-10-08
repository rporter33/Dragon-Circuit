// Compass math for the HUD ribbon. Pure, unit-tested.
//
// Convention: North = −Z, East = +X, so the sun (which rises toward +X) comes up in the east and,
// facing north, east is on your right. Headings are radians clockwise from north, 0..2π.

const TAU = Math.PI * 2;

export function wrapTau(a: number): number {
  return ((a % TAU) + TAU) % TAU;
}

export function wrapPi(a: number): number {
  return wrapTau(a + Math.PI) - Math.PI;
}

/** Compass heading of a horizontal world direction (dx, dz). */
export function headingOf(dx: number, dz: number): number {
  return wrapTau(Math.atan2(dx, -dz));
}

/** Heading of a camera whose horizontal facing is (sin yaw, 0, cos yaw). */
export function headingFromYaw(yaw: number): number {
  return headingOf(Math.sin(yaw), Math.cos(yaw));
}

/** Signed angle from the viewer's heading to a target heading, −π..π; positive = to the right. */
export function relativeBearing(targetHeading: number, viewHeading: number): number {
  return wrapPi(targetHeading - viewHeading);
}

/**
 * Horizontal position on the ribbon (−1 left edge … +1 right edge) of a relative bearing, given
 * the half-span the ribbon shows. Outside the span the marker clamps to the edge (and `edge` is
 * set), so a waypoint behind you still says which way to turn.
 */
export function ribbonPosition(rel: number, halfSpan: number, out: { x: number; edge: boolean }): { x: number; edge: boolean } {
  const x = rel / halfSpan;
  out.edge = x < -1 || x > 1;
  out.x = out.edge ? Math.sign(x) : x;
  return out;
}

export const CARDINALS: { label: string; deg: number; major: boolean }[] = [
  { label: 'N', deg: 0, major: true },
  { label: 'NE', deg: 45, major: false },
  { label: 'E', deg: 90, major: true },
  { label: 'SE', deg: 135, major: false },
  { label: 'S', deg: 180, major: true },
  { label: 'SW', deg: 225, major: false },
  { label: 'W', deg: 270, major: true },
  { label: 'NW', deg: 315, major: false },
];
