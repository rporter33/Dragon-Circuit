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

/** A compass label that wants to show: where it sits on the ribbon and how much it matters. */
export interface LabelCandidate {
  /** Center on the ribbon (px). */
  x: number;
  /** Estimated width (px). */
  width: number;
  /** Higher keeps its place first (the race waypoint beats landmarks). */
  priority: number;
}

const ORDER: number[] = [];

/** Higher priority first, then nearer the ribbon's center. */
function before(a: LabelCandidate, b: LabelCandidate): boolean {
  return a.priority !== b.priority ? a.priority > b.priority : Math.abs(a.x) < Math.abs(b.x);
}

/**
 * Give each candidate a row (0, 1, ...) so no two labels overlap, or -1 to hide it. Higher
 * priority first, then the one nearest the ribbon's center; each takes the first row where it
 * fits with `gap` px to spare. Writes into `out` (indexed like `labels`) and returns it.
 */
export function layoutLabels(labels: readonly LabelCandidate[], gap: number, rows: number, out: number[]): number[] {
  // Insertion sort into a reused array: a handful of labels, every frame, no garbage.
  const order = ORDER;
  order.length = 0;
  for (let i = 0; i < labels.length; i++) {
    let k = order.length;
    while (k > 0 && before(labels[i], labels[order[k - 1]])) {
      order[k] = order[k - 1];
      k--;
    }
    order[k] = i;
  }
  out.length = labels.length;
  for (let i = 0; i < labels.length; i++) out[i] = -1;
  for (let n = 0; n < order.length; n++) {
    const i = order[n];
    const a = labels[i];
    for (let row = 0; row < rows && out[i] < 0; row++) {
      let free = true;
      for (let j = 0; j < labels.length && free; j++) {
        if (out[j] !== row) continue;
        const b = labels[j];
        if (Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap) free = false;
      }
      if (free) out[i] = row;
    }
  }
  return out;
}
