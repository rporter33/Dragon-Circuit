import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { LAYOUT } from '../world/layout';
import { CloudBankField, buildBanks, islandClearance } from './cloudBankField';
import { SEA_TILE, generateSeaField, seaComposite } from './cloudTextures';

describe('cloud banks', () => {
  const banks = buildBanks(LAYOUT, 30, 14);

  it('builds the requested banks deterministically, clear of the islands', () => {
    expect(banks.length).toBe(30);
    expect(buildBanks(LAYOUT, 30, 14)).toEqual(banks);
    for (const b of banks) {
      expect(b.puffs.length).toBe(14);
      expect(islandClearance(LAYOUT, b.ax, b.ay, b.az, b.width, b.height)).toBeGreaterThanOrEqual(40);
      expect(b.threshold).toBeGreaterThan(0);
      expect(b.threshold).toBeLessThan(1);
    }
  });

  it('shows more banks as cover rises', () => {
    const field = new CloudBankField(LAYOUT, banks);
    const visible = (cover: number) => {
      field.update(new Vector3(), 0, cover, 1);
      let n = 0;
      for (const a of field.bankAlpha) if (a > 0.05) n++;
      return n;
    };
    const clear = visible(0.3);
    const full = visible(1);
    expect(visible(0)).toBe(0);
    expect(clear).toBeGreaterThan(2);
    expect(full).toBeGreaterThan(clear * 2);
  });

  it('veils smoothly from clear air to the heart of a puff', () => {
    const field = new CloudBankField(LAYOUT, banks);
    field.update(new Vector3(), 0, 1, 1);
    // Find the most opaque bank and its biggest puff.
    let b = 0;
    for (let i = 1; i < banks.length; i++) if (field.bankAlpha[i] > field.bankAlpha[b]) b = i;
    expect(field.bankAlpha[b]).toBeGreaterThan(0.9);
    let k = 0;
    for (let i = 0; i < b; i++) k += banks[i].puffs.length;
    const c = new Vector3(field.centers[k * 3], field.centers[k * 3 + 1], field.centers[k * 3 + 2]);
    const r = field.radii[k];

    expect(field.veilAt(c)).toBeGreaterThan(0.85);
    expect(field.veilAt(new Vector3(c.x, c.y + 2000, c.z))).toBe(0);

    // Walk out of the puff in small steps: the veil never jumps and stays in 0..1.
    const dir = new Vector3(0.6, 0.8, 0).normalize();
    const p = new Vector3();
    let prev = field.veilAt(c);
    for (let s = 0; s <= r * 4; s += r / 60) {
      p.copy(c).addScaledVector(dir, s);
      const v = field.veilAt(p);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(v - prev)).toBeLessThan(0.08);
      prev = v;
    }
  });

  it('whites out the heart of a bank, between its puffs as well as inside them', () => {
    const field = new CloudBankField(LAYOUT, banks);
    field.update(new Vector3(), 0, 1, 1);
    for (let b = 0; b < banks.length; b++) {
      if (field.bankAlpha[b] < 0.95) continue;
      const heart = new Vector3(field.bankPos[b * 3], field.bankPos[b * 3 + 1] + banks[b].height * 0.42, field.bankPos[b * 3 + 2]);
      expect(field.veilAt(heart)).toBeGreaterThan(0.9);
      // Well outside the bank's bounds: clear air.
      expect(field.veilAt(heart.clone().add(new Vector3(banks[b].bound * 1.5, 0, 0)))).toBeLessThan(0.05);
    }
  });

  it('drifts with the wind and wraps around the world', () => {
    const field = new CloudBankField(LAYOUT, banks);
    field.update(new Vector3(), 0, 1, 1);
    const x0 = field.bankPos[0];
    field.update(new Vector3(100, 0, 0), 0, 1, 1);
    expect(field.bankPos[0] - x0).toBeCloseTo(92, 3);
    field.update(new Vector3(1e6, 0, -1e6), 0, 1, 1);
    for (let i = 0; i < banks.length; i++) {
      expect(Math.abs(field.bankPos[i * 3])).toBeLessThanOrEqual(3300);
      expect(Math.abs(field.bankPos[i * 3 + 2])).toBeLessThanOrEqual(3300);
    }
  });
});

describe('cloud sea field', () => {
  const field = generateSeaField(128);

  it('tiles seamlessly', () => {
    const n = field.size;
    let maxEdge = 0;
    let maxInner = 0;
    for (let j = 0; j < n; j++) {
      maxEdge = Math.max(maxEdge, Math.abs(field.billow[j * n] - field.billow[j * n + n - 1]));
      maxInner = Math.max(maxInner, Math.abs(field.billow[j * n + 1] - field.billow[j * n]));
    }
    // The wrap-around step is no bigger than an ordinary neighbouring step.
    expect(maxEdge).toBeLessThanOrEqual(maxInner * 1.5 + 0.02);
  });

  it('spans its range with a sensible mean', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < field.billow.length; i++) {
      const h = seaComposite(field.billow[i], field.macro[i]);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
    expect(hi - lo).toBeGreaterThan(0.6);
    expect(field.mean01).toBeGreaterThan(0.25);
    expect(field.mean01).toBeLessThan(0.75);
    expect(SEA_TILE).toBeGreaterThan(1000);
  });
});
