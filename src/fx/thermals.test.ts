import { describe, expect, it } from 'vitest';
import { Scene } from 'three';
import { LAYOUT } from '../world/layout';
import { SLOT_HANDOFF, THERMAL_SLOTS, ThermalMotes, assignThermalSlots } from './thermals';

// The "white light pillar" (fix/gfx): a thermal's column used to appear or vanish in one frame
// when the camera crossed a line where the 4th and 5th nearest thermals swap rank, because only
// the 4 nearest were drawn, each at a visibility set by its own distance alone.

const STEP = 1 / 30;
const MAX_D = 2200;
/** The most any column may change in one 1/30 s frame (a fade, not a pop). */
const MAX_JUMP = 0.05;

type Cam = { x: number; y: number; z: number };

/** Per-thermal strength of the motes and lines, summed over the slots that show it. */
function moteVis(t: ThermalMotes, n: number): number[] {
  const v = new Array<number>(n).fill(0);
  t.slotThermals.forEach((i, s) => {
    if (i >= 0) v[i] += t.slotVisibility(s);
  });
  return v;
}

function hazeVis(t: ThermalMotes, n: number): number[] {
  return Array.from({ length: n }, (_, i) => t.hazeVisibility(i));
}

/**
 * Fly the camera along `path` one frame at a time and check every thermal's motes, lines and
 * haze change smoothly, and that a thermal never changes slot while it stays drawn.
 */
function walk(path: Cam[]): { setChanges: number; maxJump: number } {
  const n = LAYOUT.thermals.length;
  const t = new ThermalMotes(new Scene(), LAYOUT.thermals);
  t.update(STEP, path[0], MAX_D, 1);
  let prevM = moteVis(t, n);
  let prevH = hazeVis(t, n);
  let prevSlots = [...t.slotThermals];
  let setChanges = 0;
  let maxJump = 0;
  for (let k = 1; k < path.length; k++) {
    t.update(STEP, path[k], MAX_D, 1);
    const m = moteVis(t, n);
    const h = hazeVis(t, n);
    for (let i = 0; i < n; i++) {
      maxJump = Math.max(maxJump, Math.abs(m[i] - prevM[i]), Math.abs(h[i] - prevH[i]));
    }
    const slots = [...t.slotThermals];
    for (let s = 0; s < THERMAL_SLOTS; s++) {
      const i = prevSlots[s];
      // Sticky: a thermal still in the set holds the same slot (its motes keep their pattern).
      if (i >= 0 && slots.includes(i)) expect(slots[s], `step ${k}: thermal ${i} moved slot`).toBe(i);
    }
    if (slots.some((i) => !prevSlots.includes(i))) setChanges++;
    prevM = m;
    prevH = h;
    prevSlots = slots;
  }
  t.dispose();
  return { setChanges, maxJump };
}

describe('thermal columns hand over without popping (the light pillar)', () => {
  it('fades across the Roost deck line where thermals 2 and 7 trade 4th place', () => {
    // Walking pace would be gentler; this is a 30 m/s flight across the deck at z ≈ -84.
    const path: Cam[] = [];
    for (let z = -110; z <= -58; z += 1) path.push({ x: 30, y: 262, z });
    const r = walk(path);
    // The line really is crossed: the drawn set changes on the way.
    expect(r.setChanges).toBeGreaterThan(0);
    expect(r.maxJump).toBeLessThan(MAX_JUMP);
  });

  it('fades across the x ≈ 367 line where thermals 6 and 7 trade places', () => {
    const path: Cam[] = [];
    for (let x = 330; x <= 410; x += 1) path.push({ x, y: 420, z: -50 });
    const r = walk(path);
    expect(r.setChanges).toBeGreaterThan(0);
    expect(r.maxJump).toBeLessThan(MAX_JUMP);
  });

  for (const id of [1, 2, 3]) {
    it(`fades while circling in thermal ${id}`, () => {
      const c = LAYOUT.thermals[id];
      const path: Cam[] = [];
      // Radius 56 m at ~25 m/s: about a degree a frame, two full turns.
      for (let a = 0; a <= 720; a += 1) {
        const r = (a * Math.PI) / 180;
        path.push({ x: c.x + Math.cos(r) * 56, y: 400, z: c.z + Math.sin(r) * 56 });
      }
      expect(walk(path).maxJump).toBeLessThan(MAX_JUMP);
    });
  }

  it('fades on a long glide east from the Roost', () => {
    const path: Cam[] = [];
    for (let k = 0; k < 60 * 30; k++) path.push({ x: k * 1.2, y: 300 + k * 0.05, z: 10 });
    const r = walk(path);
    expect(r.setChanges).toBeGreaterThan(0);
    expect(r.maxJump).toBeLessThan(MAX_JUMP);
  });

  it('draws every thermal haze column near the Roost, by distance alone', () => {
    const t = new ThermalMotes(new Scene(), LAYOUT.thermals);
    t.update(STEP, { x: 30, y: 262, z: -84 }, MAX_D, 1);
    // All eight lie within ~1.5 km of the Roost deck: none is left out for want of a slot.
    for (let i = 0; i < LAYOUT.thermals.length; i++) expect(t.hazeVisibility(i), `thermal ${i}`).toBeGreaterThan(0.8);
    t.dispose();
  });
});

describe('assignThermalSlots', () => {
  it('keeps a thermal in its slot when ranks change inside the set', () => {
    const slots = [-1, -1];
    const fades = [0, 0];
    const dists = [100, 200, 900];
    assignThermalSlots([0, 1, 2], dists, slots, fades, SLOT_HANDOFF);
    expect(slots).toEqual([0, 1]);
    dists[0] = 300; // 0 and 1 swap ranks
    assignThermalSlots([1, 0, 2], dists, slots, fades, SLOT_HANDOFF);
    expect(slots).toEqual([0, 1]);
    expect(fades).toEqual([1, 1]);
  });

  it('hands a slot over at zero when the nearest left-out thermal draws level', () => {
    const slots = [-1, -1];
    const fades = [0, 0];
    const dists = [100, 500, 500];
    assignThermalSlots([0, 1, 2], dists, slots, fades, SLOT_HANDOFF);
    expect(slots).toEqual([0, 1]);
    expect(fades[0]).toBe(1);
    expect(fades[1]).toBe(0);
    dists[2] = 499; // thermal 2 overtakes thermal 1 and takes its slot, still at zero
    assignThermalSlots([0, 2, 1], dists, slots, fades, SLOT_HANDOFF);
    expect(slots).toEqual([0, 2]);
    expect(fades[1]).toBeLessThan(1e-3);
  });

  it('shows every thermal at full strength when there are no more than slots', () => {
    const slots = [-1, -1, -1];
    const fades = [0, 0, 0];
    assignThermalSlots([1, 0], [400, 50], slots, fades, SLOT_HANDOFF);
    expect(slots).toEqual([1, 0, -1]);
    expect(fades).toEqual([1, 1, 0]);
  });
});
