// Spatial focus navigation: given the focused item's box and every candidate's box, pick the one
// a D-pad press in a direction should land on. Pure (boxes in, index out) so it is unit-tested;
// FocusScope feeds it getBoundingClientRect() boxes only when a direction is pressed.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type NavDir = 'up' | 'down' | 'left' | 'right';

/** Gap between intervals [a0,a1] and [b0,b1]; 0 when they overlap. */
function gap(a0: number, a1: number, b0: number, b1: number): number {
  if (b1 < a0) return a0 - b1;
  if (b0 > a1) return b0 - a1;
  return 0;
}

/**
 * Index of the best candidate in `dir` from `from`, or −1. Candidates must lie beyond `from` in
 * that direction (by their centers). Among those, the nearest along the axis wins, with a heavy
 * penalty for being off to the side, so moving down a grid column stays in the column and moving
 * down from a row of tiles reaches the button under them.
 */
export function pickSpatial(from: Rect, cands: readonly (Rect | null)[], dir: NavDir, self = -1): number {
  const fcx = from.x + from.w / 2;
  const fcy = from.y + from.h / 2;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (!c || i === self || c.w <= 0 || c.h <= 0) continue;
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    let along: number;
    let side: number;
    let sideCenter: number;
    switch (dir) {
      case 'down':
        if (cy <= fcy + 1) continue;
        along = Math.max(0, c.y - (from.y + from.h)) + (cy - fcy) * 0.05;
        side = gap(from.x, from.x + from.w, c.x, c.x + c.w);
        sideCenter = Math.abs(cx - fcx);
        break;
      case 'up':
        if (cy >= fcy - 1) continue;
        along = Math.max(0, from.y - (c.y + c.h)) + (fcy - cy) * 0.05;
        side = gap(from.x, from.x + from.w, c.x, c.x + c.w);
        sideCenter = Math.abs(cx - fcx);
        break;
      case 'right':
        if (cx <= fcx + 1) continue;
        along = Math.max(0, c.x - (from.x + from.w)) + (cx - fcx) * 0.05;
        side = gap(from.y, from.y + from.h, c.y, c.y + c.h);
        sideCenter = Math.abs(cy - fcy);
        break;
      case 'left':
        if (cx >= fcx - 1) continue;
        along = Math.max(0, from.x - (c.x + c.w)) + (fcx - cx) * 0.05;
        side = gap(from.y, from.y + from.h, c.y, c.y + c.h);
        sideCenter = Math.abs(cy - fcy);
        break;
    }
    // Stay roughly in the pressed direction: a candidate that does not share the row (or
    // column) must lie within a cone, so "right" never drops to a button far below.
    if (side > 0) {
      const dAlong = dir === 'left' || dir === 'right' ? Math.abs(cx - fcx) : Math.abs(cy - fcy);
      const dSide = dir === 'left' || dir === 'right' ? Math.abs(cy - fcy) : Math.abs(cx - fcx);
      const cone = dir === 'left' || dir === 'right' ? 0.75 : 2.5;
      if (dSide > dAlong * cone) continue;
    }
    const score = along + side * 3 + sideCenter * 0.15;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * Wrap-around for simple lists: from the end of a column, the item furthest back the other way
 * (the top of the list when pressing down at the bottom). −1 if nothing qualifies.
 */
export function pickWrap(from: Rect, cands: readonly (Rect | null)[], dir: NavDir, self = -1): number {
  const vertical = dir === 'up' || dir === 'down';
  const fc = vertical ? from.x + from.w / 2 : from.y + from.h / 2;
  let best = -1;
  let bestKey = -Infinity;
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (!c || i === self || c.w <= 0 || c.h <= 0) continue;
    // Same column (or row) only.
    const lo = vertical ? c.x : c.y;
    const hi = vertical ? c.x + c.w : c.y + c.h;
    if (fc < lo - 1 || fc > hi + 1) continue;
    const pos = vertical ? c.y + c.h / 2 : c.x + c.w / 2;
    // Pressing down wraps to the smallest y; up wraps to the largest.
    const key = dir === 'down' || dir === 'right' ? -pos : pos;
    if (key > bestKey) {
      bestKey = key;
      best = i;
    }
  }
  return best;
}
