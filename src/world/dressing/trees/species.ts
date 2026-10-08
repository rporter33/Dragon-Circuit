// Procedural plant and rock geometry, each species in three LODs. Everything is vertex-colored
// and carries a per-vertex sway weight (aSway, meters at full wind) and, for glowing species, a
// night-glow mask (aGlow). Canopies get normals pointing out from the canopy's center so a cluster
// of blobs shades like one soft painted ball instead of a bag of marbles.

import { BufferGeometry, Color, ConeGeometry, CylinderGeometry, IcosahedronGeometry, LatheGeometry, Matrix4, Vector2, Vector3 } from 'three';
import { mulberry32 } from '../../../core/rng';
import { noise3 } from '../../../core/noise';
import { GeoBuilder, bezier, displace, mixColor, tube, welded, xf, type AddOptions } from '../geom';

export type SpeciesId =
  | 'broadleaf'
  | 'giant'
  | 'conifer'
  | 'windbent'
  | 'blossom'
  | 'glowcap'
  | 'bush'
  | 'boulder'
  | 'log'
  | 'shrooms'
  | 'fern';

export interface SpeciesGeometry {
  /** LOD0 (near) .. LOD2 (far). */
  lods: BufferGeometry[];
  /** Typical height at scale 1 (m). */
  height: number;
  /** Trunk/stem radius at the base at scale 1 (m); 0 for things you can walk through. */
  trunkRadius: number;
}

const tmpC = new Color();

/** While set, trunk() and addCanopy() note what they build (to fit collision shapes to it). */
let recording: { stems: { path: Vector3[]; radii: number[] }[]; blobs: { c: Vector3; r: number; sy: number }[] } | null = null;

/** Canopy normals: blend each vertex normal toward "out from the canopy center". */
function canopyNormal(center: Vector3, amount = 0.78) {
  const d = new Vector3();
  return (p: Vector3, n: Vector3) => {
    d.subVectors(p, center).normalize();
    n.lerp(d, amount).normalize();
  };
}

/**
 * Vertical gradient + noise mottling for foliage. With a canopy center/radius, crevices between
 * blobs (vertices deep inside the canopy) darken like ambient occlusion.
 */
function foliageColor(bottom: Color, top: Color, y0: number, y1: number, seed: number, mottle = 0.12, sparkle?: Color, center?: Vector3, radius = 1) {
  const n3 = noise3(seed);
  return (p: Vector3, n: Vector3, out: Color) => {
    const t = Math.min(1, Math.max(0, (p.y - y0) / (y1 - y0)));
    out.copy(bottom).lerp(top, Math.pow(t, 0.85));
    if (center) {
      const d = p.distanceTo(center) / radius;
      out.multiplyScalar(0.55 + 0.45 * Math.min(1, Math.max(0, (d - 0.45) / 0.55)));
    }
    // Undersides sit in the canopy's own shade.
    if (n.y < 0) out.multiplyScalar(1 + n.y * 0.22);
    const m = n3(p.x * 0.9, p.y * 0.9, p.z * 0.9);
    out.multiplyScalar(1 + m * mottle);
    if (sparkle) {
      const s = n3(p.x * 2.7 + 11, p.y * 2.7, p.z * 2.7 - 5);
      if (s > 0.45) out.lerp(sparkle, Math.min(1, (s - 0.45) * 3));
    }
  };
}

function barkColor(base: Color, seed: number) {
  const n3 = noise3(seed);
  return (p: Vector3, _n: Vector3, out: Color) => {
    const v = n3(p.x * 1.5, p.y * 0.35, p.z * 1.5);
    out.copy(base).multiplyScalar(0.85 + 0.25 * v);
    // Darker, mossier at the root.
    if (p.y < 1.2) out.lerp(tmpC.set('#4b5a2e'), (1.2 - Math.max(p.y, 0)) * 0.35);
  };
}

function blob(radius: number, detail: number, seed: number, lump = 0.2): BufferGeometry {
  const g = new IcosahedronGeometry(radius, detail);
  // Same seed and frequency at every detail so LODs keep the same lumpy silhouette.
  return detail > 0 ? displace(g, radius * lump, 1.1 / radius, seed) : welded(g);
}

interface BlobSpec {
  c: Vector3;
  r: number;
  sy?: number;
}

function addCanopy(
  b: GeoBuilder,
  blobs: BlobSpec[],
  detail: number,
  seed: number,
  center: Vector3,
  color: AddOptions['color'],
  sway: (p: Vector3) => number,
  normalBlend = 0.78,
): void {
  const nf = canopyNormal(center, normalBlend);
  if (recording) for (const s of blobs) recording.blobs.push({ c: s.c.clone(), r: s.r, sy: s.sy ?? 1 });
  blobs.forEach((s, i) => {
    const g = blob(s.r, detail, seed + i * 7);
    b.add(g, xf(s.c.x, s.c.y, s.c.z, 0, i * 1.3, 0, 1, s.sy ?? 1, 1), { color, sway, normal: nf });
  });
}

function trunk(b: GeoBuilder, path: Vector3[], r0: number, r1: number, radial: number, color: AddOptions['color'], sway: (p: Vector3) => number, part: 'stem' | 'limb' = 'stem'): void {
  const radii = path.map((_, i) => r0 + (r1 - r0) * Math.pow(i / (path.length - 1), 0.8));
  b.add(tube(path, radii, radial, true), null, { color, sway });
  if (recording && part === 'stem') recording.stems.push({ path: path.map((p) => p.clone()), radii });
}

/** Little root flares around a trunk base. */
function rootFlare(b: GeoBuilder, r: number, count: number, seed: number, color: AddOptions['color'], radial = 5): void {
  const rnd = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd() * 0.5;
    const len = r * (2.2 + rnd() * 1.2);
    const p0 = new Vector3(Math.cos(a) * r * 0.4, r * 1.6, Math.sin(a) * r * 0.4);
    const p1 = new Vector3(Math.cos(a) * len * 0.6, r * 0.3, Math.sin(a) * len * 0.6);
    const p2 = new Vector3(Math.cos(a) * len, -0.25, Math.sin(a) * len);
    trunk(b, bezier([p0, p1, p2], 4), r * 0.55, r * 0.12, radial, color, () => 0, 'limb');
  }
}

// ---------------------------------------------------------------------------------------------
// Broadleaf (and the giant old-growth variant for Rootfall)
// ---------------------------------------------------------------------------------------------

function broadleafLod(lod: number, opts: { giant: boolean; blossom: boolean }): BufferGeometry {
  const rnd = mulberry32(opts.blossom ? 0xb10 : opts.giant ? 0x61a : 0xb7ad);
  const b = new GeoBuilder();
  const H = opts.giant ? 19 : opts.blossom ? 7 : 11;
  const trunkH = H * (opts.blossom ? 0.45 : 0.42);
  const tr = opts.giant ? 1.15 : opts.blossom ? 0.34 : 0.45;
  const crown = new Vector3(opts.blossom ? 0.3 : 0.2, trunkH + (opts.giant ? 5 : 2.8), 0);
  const R = opts.giant ? 7.5 : opts.blossom ? 3.8 : 4.6;
  const barkC = new Color(opts.blossom ? '#4d3b38' : opts.giant ? '#5a4a3c' : '#6a5440');
  const bark = barkColor(barkC, 31);
  const swayY = (p: Vector3) => Math.pow(Math.max(0, p.y) / H, 2) * 0.35;

  // Trunk with a gentle S-bend.
  const segs = lod === 0 ? 6 : lod === 3 ? 1 : 3;
  const radial = lod === 0 ? 8 : lod === 1 ? 6 : lod === 2 ? 4 : 3;
  const tp = bezier(
    [new Vector3(0, -0.4, 0), new Vector3(-0.3, trunkH * 0.4, 0.2), new Vector3(0.4, trunkH * 0.75, -0.1), new Vector3(crown.x, trunkH + 1.2, crown.z)],
    segs,
  );
  trunk(b, tp, tr, tr * 0.45, radial, bark, swayY);
  if (lod === 0) rootFlare(b, tr, opts.giant ? 6 : 4, 77, bark);

  // Canopy blobs on a loose dome.
  const blobs: BlobSpec[] = [{ c: crown.clone().add(new Vector3(0, R * 0.15, 0)), r: R * 0.62 }];
  const ring = opts.blossom ? 8 : 6;
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2 + rnd() * 0.5;
    const d = R * (0.5 + rnd() * 0.2) * (opts.blossom ? 1.15 : 1);
    blobs.push({
      c: new Vector3(crown.x + Math.cos(a) * d, crown.y + (rnd() - 0.6) * R * 0.35, crown.z + Math.sin(a) * d),
      r: R * (0.36 + rnd() * 0.14),
      sy: opts.blossom ? 0.8 : 0.92,
    });
  }
  blobs.push({ c: crown.clone().add(new Vector3((rnd() - 0.5) * R * 0.4, R * 0.55, (rnd() - 0.5) * R * 0.4)), r: R * 0.42 });

  // Branches toward the lower blobs (seen from beneath).
  if (lod === 0) {
    for (let i = 1; i < blobs.length - 1; i += 2) {
      const tgt = blobs[i].c;
      const from = new Vector3(crown.x * 0.8, trunkH * 0.85, crown.z * 0.8);
      const mid = from.clone().lerp(tgt, 0.5).add(new Vector3(0, 0.6, 0));
      trunk(b, bezier([from, mid, tgt.clone().lerp(from, 0.25)], 3), tr * 0.35, tr * 0.12, 5, bark, swayY, 'limb');
    }
  }

  const bottom = new Color(opts.blossom ? '#b8668b' : opts.giant ? '#1f4426' : '#244f28');
  const top = new Color(opts.blossom ? '#fbd3de' : opts.giant ? '#6a9a42' : '#79aa44');
  const sparkle = opts.blossom ? new Color('#fff4f6') : new Color(opts.giant ? '#8fb853' : '#a3c95b');
  const fol = foliageColor(bottom, top, crown.y - R * 0.6, crown.y + R * 0.9, opts.blossom ? 91 : 93, 0.16, sparkle, crown, R * 1.05);
  const detail = lod === 0 ? 2 : lod === 1 ? 1 : 0;
  // Far away the crown is one soft lump (LOD3: a silhouette, 20 triangles).
  const useBlobs =
    lod === 3
      ? [{ c: crown.clone().add(new Vector3(0, R * 0.15, 0)), r: R * 1.05, sy: opts.blossom ? 0.75 : 0.82 }]
      : lod === 2
        ? [blobs[0], blobs[2], blobs[5], blobs[blobs.length - 1]].map((s) => ({ ...s, r: s.r * 1.25 }))
        : blobs;
  addCanopy(b, useBlobs, detail, opts.blossom ? 501 : 401, crown.clone().add(new Vector3(0, -R * 0.15, 0)), fol, (p) => 0.12 + swayY(p));
  return b.build(true);
}

// ---------------------------------------------------------------------------------------------
// Conifer
// ---------------------------------------------------------------------------------------------

function coniferLod(lod: number): BufferGeometry {
  const rnd = mulberry32(0xc0f1);
  const b = new GeoBuilder();
  const H = 15;
  const bark = barkColor(new Color('#5a4434'), 37);
  const swayY = (p: Vector3) => Math.pow(Math.max(0, p.y) / H, 2) * 0.3;
  if (lod === 3) {
    // Silhouette: a single dark cone.
    const g = welded(new ConeGeometry(3.5, 13.6, 5, 1, false));
    b.add(g, xf(0, 1.4 + 6.8, 0), {
      color: (p, n, out) => out.set('#2a5a3e').lerp(tmpC.set('#4f8d55'), Math.min(1, Math.max(0, p.y / 15))).multiplyScalar(n.y < -0.3 ? 0.7 : 1),
      sway: (p) => 0.08 + swayY(p),
    });
    return b.build(true);
  }
  const radial = lod === 0 ? 6 : 4;
  trunk(b, [new Vector3(0, -0.4, 0), new Vector3(0, H * 0.45, 0), new Vector3(0, H * 0.9, 0)], 0.36, 0.08, radial, bark, swayY);
  const tiers = lod === 0 ? 6 : lod === 1 ? 4 : 2;
  const segs = lod === 0 ? 14 : lod === 1 ? 9 : 6;
  const dark = new Color('#1f4a35');
  const light = new Color('#4f8d55');
  const tipC = new Color('#7aae63');
  const n3 = noise3(57);
  for (let k = 0; k < tiers; k++) {
    const f = k / tiers;
    const r = 3.7 * (1 - f * 0.78);
    const h = (H * 0.95) / tiers + 1.2;
    const yBase = 1.8 + f * (H - 3.2);
    const g = welded(new ConeGeometry(r, h, segs, lod === 0 ? 3 : 2, false));
    // Jag and droop the skirt: alternate ring vertices dip, radius wobbles.
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const rr = Math.hypot(x, z);
      if (rr < 0.05) continue;
      const a = Math.atan2(z, x);
      const wob = 1 + 0.16 * n3(Math.cos(a) * 2 + k, Math.sin(a) * 2, k * 3.1);
      const lobe = Math.cos(a * segs) * 0.5 + 0.5;
      const dip = y < -h * 0.45 ? -0.3 * lobe - 0.25 : 0;
      pos.setXYZ(i, x * wob, y + dip, z * wob);
    }
    g.computeVertexNormals();
    const yMid = yBase + h / 2;
    const top = yBase + h;
    const col = (p: Vector3, n: Vector3, out: Color) => {
      const tt = Math.min(1, Math.max(0, (p.y - yBase) / h));
      out.copy(dark).lerp(light, 0.25 + 0.5 * (k / tiers) + 0.25 * tt);
      // Lighter needle tips on the skirt's outer edge.
      const rr = Math.hypot(p.x, p.z) / r;
      if (rr > 0.75 && n.y > -0.2) out.lerp(tipC, (rr - 0.75) * 1.4);
      if (n.y < -0.3) out.multiplyScalar(0.7);
      out.multiplyScalar(0.92 + 0.16 * rnd());
    };
    const center = new Vector3(0, yMid - h * 0.15, 0);
    const d = new Vector3();
    b.add(g, xf(0, yMid, 0, 0, k * 0.7, 0), {
      color: col,
      sway: (p) => 0.08 + swayY(p),
      normal: (p, n) => {
        d.subVectors(p, center);
        d.y = d.y * 0.5 + 0.6;
        n.lerp(d.normalize(), 0.55).normalize();
        void top;
      },
    });
  }
  return b.build(true);
}

// ---------------------------------------------------------------------------------------------
// Wind-bent (Highmoor, rocky islands): leans toward local +X; instances yaw it downwind.
// ---------------------------------------------------------------------------------------------

function windbentLod(lod: number): BufferGeometry {
  const rnd = mulberry32(0x3e17);
  const b = new GeoBuilder();
  const H = 7;
  const bark = barkColor(new Color('#6b5a4a'), 41);
  const swayY = (p: Vector3) => Math.pow(Math.max(0, p.y) / H, 2) * 0.3;
  const segs = lod === 0 ? 8 : lod === 3 ? 2 : 4;
  const path = bezier([new Vector3(0, -0.4, 0), new Vector3(-0.4, 2.6, 0.2), new Vector3(0.6, 4.6, -0.1), new Vector3(3.2, 5.6, 0.1)], segs);
  trunk(b, path, 0.38, 0.13, lod === 0 ? 7 : lod === 3 ? 3 : 5, bark, swayY);
  if (lod === 0) {
    // A second, broken-off limb on the windward side.
    trunk(b, bezier([new Vector3(-0.2, 3.2, 0), new Vector3(-1.2, 4.0, 0.3), new Vector3(-1.6, 4.9, 0.2)], 3), 0.14, 0.05, 5, bark, swayY, 'limb');
    rootFlare(b, 0.38, 3, 79, bark);
  }
  const crown = new Vector3(3.0, 5.9, 0);
  const blobs: BlobSpec[] = [
    { c: new Vector3(2.0, 5.9, 0), r: 1.7, sy: 0.55 },
    { c: new Vector3(3.6, 5.7, 0.6), r: 1.6, sy: 0.5 },
    { c: new Vector3(4.8, 5.4, -0.4), r: 1.3, sy: 0.5 },
    { c: new Vector3(3.0, 6.4, -0.8), r: 1.4, sy: 0.5 },
    { c: new Vector3(1.0, 6.1, 0.7), r: 1.1, sy: 0.55 },
    { c: new Vector3(5.6, 5.0, 0.4), r: 0.9, sy: 0.55 },
  ];
  for (const s of blobs) s.c.z += (rnd() - 0.5) * 0.4;
  const fol = foliageColor(new Color('#3f5f2e'), new Color('#a2b358'), 4.8, 7.2, 97, 0.15, new Color('#c2c56d'), new Vector3(3, 5.8, 0), 3.2);
  const far = lod === 3 ? blobs.slice(0, 2).map((s) => ({ ...s, r: s.r * 1.55 })) : lod === 2 ? blobs.slice(0, 3).map((s) => ({ ...s, r: s.r * 1.3 })) : blobs;
  addCanopy(b, far, lod === 0 ? 2 : lod === 1 ? 1 : 0, 601, crown, fol, (p) => 0.12 + swayY(p), 0.7);
  return b.build(true);
}

// ---------------------------------------------------------------------------------------------
// Glowcap: giant mushroom whose cap spots and gills glow after dusk.
// ---------------------------------------------------------------------------------------------

function glowcapLod(lod: number): BufferGeometry {
  const rnd = mulberry32(0x9c0);
  const b = new GeoBuilder();
  const H = 11;
  const seg = lod === 0 ? 22 : lod === 1 ? 12 : lod === 2 ? 7 : 5;
  const lean = (y: number) => Math.sin((y / H) * 1.4) * 1.1;
  const stemPts = [
    [1.5, 0], [1.05, 0.7], [0.82, 2.2], [0.7, 5], [0.72, 8], [0.85, H - 0.5], [0.95, H + 0.4],
  ].map(([r, y]) => new Vector2(r, y));
  const stem = new LatheGeometry(stemPts, seg);
  // Warm ivory, darker toward the root: stays under the bloom threshold at noon. Only the cap's
  // spots, rim and gills glow (after dusk).
  const stemLo = new Color('#8f8678');
  const stemMid = new Color('#c4bba8');
  const stemHi = new Color('#b4abc4');
  const stemN = noise3(223);
  const leanM = (g: BufferGeometry) => {
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) + lean(pos.getY(i)));
    g.computeVertexNormals();
    return g;
  };
  b.add(leanM(welded(stem)), null, {
    color: (p, _n, out) => {
      const t = Math.min(1, Math.max(0, p.y / H));
      out.copy(stemLo).lerp(stemMid, Math.min(1, t * 3.5));
      if (t > 0.6) out.lerp(stemHi, (t - 0.6) * 1.6);
      // Fibrous vertical streaks, and the cap's shadow on the top of the stem.
      out.multiplyScalar(0.8 + 0.3 * stemN(p.x * 2.6, p.y * 0.2, p.z * 2.6));
      out.multiplyScalar(1 - 0.4 * Math.min(1, Math.max(0, (p.y - (H - 2.5)) / 2.5)));
    },
    sway: (p) => Math.pow(Math.max(0, p.y) / H, 2) * 0.1,
    // Only the gills' light spilling onto the top of the stem (after dusk).
    glow: (p) => 0.2 * Math.min(1, Math.max(0, (p.y - (H - 1.8)) / 1.8)),
  });
  // Skirt ring on the stem.
  if (lod < 2) {
    // Lathe profiles run bottom → top so faces point outward.
    const ring = new LatheGeometry([new Vector2(1.6, -0.75), new Vector2(1.5, -0.5), new Vector2(0.75, 0.3)], seg);
    const skirt = new Color('#b9b1c6');
    b.add(welded(ring), xf(lean(H * 0.7), H * 0.7, 0), {
      // The skirt's underside sits in its own shade.
      color: (_p, n, out) => out.copy(skirt).multiplyScalar(n.y < 0 ? 0.5 : 0.92),
      sway: 0.06,
    });
  }
  // Cap: a dome with a rolled lip, and a glowing gill underside.
  const capR = 5.8;
  const cy = H;
  const capPts = [
    [0.001, 3.3], [1.6, 3.15], [3.2, 2.6], [4.5, 1.7], [5.4, 0.8], [capR, 0.15], [5.65, -0.25], [5.2, -0.3],
  ].map(([r, y]) => new Vector2(r, y));
  const cap = new LatheGeometry([...capPts].reverse(), seg);
  const capTop = new Color('#4a46ad');
  const capRim = new Color('#8a5fd6');
  const capN = noise3(211);
  const cx = lean(cy);
  b.add(welded(cap), xf(cx, cy, 0), {
    color: (p, _n, out) => {
      const rr = Math.hypot(p.x - cx, p.z) / capR;
      out.copy(capTop).lerp(capRim, Math.pow(rr, 1.5));
      out.multiplyScalar(0.9 + 0.2 * capN(p.x * 0.4, p.y * 0.4, p.z * 0.4));
    },
    sway: 0.12,
    glow: (p) => (Math.hypot(p.x - cx, p.z) > capR * 0.88 ? 0.45 : 0.06),
  });
  // Gills face down: profile runs from the stem outward and down.
  const gills = new LatheGeometry([new Vector2(1.0, 0.55), new Vector2(3.5, 0.2), new Vector2(5.25, -0.28)], seg);
  b.add(welded(gills), xf(cx, cy, 0), { color: '#3fd9c8', sway: 0.12, glow: 0.38 });
  // Raised luminous spots.
  if (lod < 2) {
    const spots = lod === 0 ? 16 : 9;
    for (let i = 0; i < spots; i++) {
      const a = rnd() * Math.PI * 2;
      const t = 0.15 + rnd() * 0.75;
      // Height on the dome profile at radius t * capR (piecewise linear on capPts).
      const rr = t * capR;
      let y = 0;
      for (let k = 0; k < capPts.length - 1; k++) {
        const p0 = capPts[k];
        const p1 = capPts[k + 1];
        if (rr >= p0.x && rr <= p1.x) {
          y = p0.y + ((rr - p0.x) / (p1.x - p0.x)) * (p1.y - p0.y);
          break;
        }
      }
      const s = 0.35 + rnd() * 0.4;
      const g = welded(new IcosahedronGeometry(1, lod === 0 ? 1 : 0));
      b.add(g, xf(cx + Math.cos(a) * rr, cy + y + 0.02, Math.sin(a) * rr, 0, 0, 0, s, s * 0.35, s), {
        color: '#66dcff',
        sway: 0.12,
        glow: 0.85,
      });
    }
  }
  return b.build(true);
}

// ---------------------------------------------------------------------------------------------
// Ground props
// ---------------------------------------------------------------------------------------------

function bushLod(lod: number): BufferGeometry {
  const rnd = mulberry32(0xb05);
  const b = new GeoBuilder();
  const blobs: BlobSpec[] = [{ c: new Vector3(0, 0.9, 0), r: 1.15 }];
  const n = lod === 0 ? 5 : 3;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd();
    blobs.push({ c: new Vector3(Math.cos(a) * 0.9, 0.55 + rnd() * 0.4, Math.sin(a) * 0.9), r: 0.7 + rnd() * 0.35 });
  }
  const fol = foliageColor(new Color('#244a26'), new Color('#73a443'), 0, 2.1, 103, 0.15, new Color('#9cc25a'), new Vector3(0, 0.7, 0), 1.9);
  const use = lod === 3 ? [{ c: new Vector3(0, 0.75, 0), r: 1.55, sy: 0.8 }] : blobs;
  addCanopy(b, use, lod === 0 ? 1 : 0, 701, new Vector3(0, 0.5, 0), fol, (p) => Math.max(0, p.y) * 0.08);
  return b.build(true);
}

function boulderLod(lod: number): BufferGeometry {
  const b = new GeoBuilder();
  const g = new IcosahedronGeometry(1, lod === 0 ? 3 : lod === 1 ? 1 : 0);
  const rock = lod === 2 ? welded(g) : displace(g, 0.3, 1.3, 811, 3);
  const n3 = noise3(813);
  const stone = new Color('#8d857b');
  const dark = new Color('#5f5a55');
  const moss = new Color('#6d8f3c');
  b.add(rock, xf(0, 0.35, 0, 0, 0, 0, 1, 0.72, 1), {
    color: (p, n, out) => {
      const v = n3(p.x * 2, p.y * 2, p.z * 2);
      out.copy(dark).lerp(stone, 0.55 + 0.45 * v);
      // Moss creeps over the top, thickest where it faces up.
      const m = Math.min(1, Math.max(0, (n.y - 0.25) * 2.2 + n3(p.x * 1.3 + 9, p.y, p.z * 1.3) * 0.4));
      out.lerp(moss, m * 0.85);
    },
  });
  return b.build(true);
}

function logLod(lod: number): BufferGeometry {
  const b = new GeoBuilder();
  const L = 7;
  const bark = barkColor(new Color('#6a5643'), 43);
  const moss = new Color('#6f9440');
  const n3 = noise3(47);
  const radial = lod === 0 ? 9 : 5;
  const path = bezier([new Vector3(-L / 2, 0.45, 0), new Vector3(0, 0.6, 0.3), new Vector3(L / 2, 0.42, -0.1)], lod === 0 ? 6 : 2);
  const radii = path.map((_, i) => 0.5 - (i / (path.length - 1)) * 0.12);
  const logColor = (p: Vector3, n: Vector3, out: Color) => {
    bark(p, n, out);
    const m = Math.min(1, Math.max(0, (n.y - 0.3) * 2 + n3(p.x * 0.8, p.y, p.z * 0.8) * 0.5));
    out.lerp(moss, m * 0.8);
  };
  b.add(tube(path, radii, radial, false), null, { color: logColor });
  // Cut-wood end caps.
  const capG = new CylinderGeometry(1, 1, 0.04, radial);
  b.add(capG, xf(-L / 2, 0.45, 0, 0, 0, Math.PI / 2, 0.5, 1, 0.5), { color: '#c9a77a' });
  b.add(capG, xf(L / 2, 0.42, -0.1, 0, 0, Math.PI / 2, 0.38, 1, 0.38), { color: '#c9a77a' });
  if (lod === 0) {
    // Branch stubs.
    trunk(b, [new Vector3(-1, 0.8, 0.1), new Vector3(-1.4, 1.5, 0.4), new Vector3(-1.5, 2.0, 0.6)], 0.14, 0.05, 5, logColor, () => 0, 'limb');
    trunk(b, [new Vector3(1.6, 0.7, 0.2), new Vector3(2.0, 0.9, 0.9), new Vector3(2.2, 1.0, 1.4)], 0.12, 0.04, 5, logColor, () => 0, 'limb');
  }
  return b.build(true);
}

/** A cluster of small glowing mushrooms (forest floors, the grove). */
function shroomsLod(lod: number): BufferGeometry {
  const rnd = mulberry32(0x5440);
  const b = new GeoBuilder();
  const n = lod === 0 ? 6 : 3;
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = i === 0 ? 0 : 0.25 + rnd() * 0.45;
    const h = (i === 0 ? 0.8 : 0.3 + rnd() * 0.45) * 1;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const seg = lod === 0 ? 8 : 5;
    b.add(new CylinderGeometry(0.05, 0.08, h, seg - 2), xf(x, h / 2, z, (rnd() - 0.5) * 0.3, 0, (rnd() - 0.5) * 0.3), { color: '#d8cdbd', glow: 0.04 });
    const capR = h * 0.45 + 0.08;
    const cap = new LatheGeometry([new Vector2(capR * 0.4, -0.02), new Vector2(capR, 0), new Vector2(capR * 0.7, capR * 0.45), new Vector2(0.001, capR * 0.6)], seg);
    b.add(welded(cap), xf(x, h, z), {
      color: (p, nn, out) => out.set(nn.y > 0 ? '#5a52c8' : '#44d8c6'),
      glow: (p, nn) => (nn.y > 0 ? 0.35 : 0.9),
    });
  }
  return b.build(true);
}

/** A fern: arching fronds with sawtooth leaflets (double-sided card material). */
function fernLod(lod: number): BufferGeometry {
  const rnd = mulberry32(0xfe4);
  const b = new GeoBuilder();
  const fronds = lod === 0 ? 8 : 5;
  const segs = lod === 0 ? 6 : 3;
  const dark = new Color('#2f5f2a');
  const light = new Color('#8cc251');
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + rnd() * 0.4;
    const len = 1.0 + rnd() * 0.5;
    const dir = new Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new Vector3(-dir.z, 0, dir.x);
    const verts: number[] = [];
    let prevL: Vector3 | null = null;
    let prevR: Vector3 | null = null;
    let prevC: Vector3 | null = null;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      // Arch up then droop.
      const c = dir.clone().multiplyScalar(t * len).add(new Vector3(0, Math.sin(t * Math.PI * 0.8) * 0.75 * len - t * t * 0.25, 0));
      const w = Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05)) * 0.22 * len * (s % 2 === 0 ? 1 : 0.6);
      const L = c.clone().addScaledVector(side, w).add(new Vector3(0, -w * 0.3, 0));
      const R = c.clone().addScaledVector(side, -w).add(new Vector3(0, -w * 0.3, 0));
      if (prevC && prevL && prevR) {
        verts.push(prevC.x, prevC.y, prevC.z, prevL.x, prevL.y, prevL.z, c.x, c.y, c.z);
        verts.push(prevL.x, prevL.y, prevL.z, L.x, L.y, L.z, c.x, c.y, c.z);
        verts.push(prevC.x, prevC.y, prevC.z, c.x, c.y, c.z, prevR.x, prevR.y, prevR.z);
        verts.push(prevR.x, prevR.y, prevR.z, c.x, c.y, c.z, R.x, R.y, R.z);
      }
      prevC = c;
      prevL = L;
      prevR = R;
    }
    b.addTriangles(verts, {
      color: (p, _n, out) => out.copy(dark).lerp(light, Math.min(1, Math.hypot(p.x, p.z) / len + 0.1)),
      sway: (p) => Math.hypot(p.x, p.z) * 0.12,
      normal: (_p, n) => n.set(n.x * 0.3, Math.abs(n.y) + 0.8, n.z * 0.3).normalize(),
    });
  }
  return b.build(true);
}

// ---------------------------------------------------------------------------------------------

export interface SpeciesSpec {
  id: SpeciesId;
  build: (lod: number) => BufferGeometry;
  height: number;
  trunkRadius: number;
  /**
   * Distances (m, at scale 1, at 'high' quality) where each LOD hands over to the next; the
   * last entry is where it is culled. Three or four LODs.
   */
  lodDist: number[];
  /** Material flavor. */
  material: 'foliage' | 'glow' | 'rock' | 'card';
  castShadow: boolean;
}

export const SPECIES: Record<SpeciesId, SpeciesSpec> = {
  broadleaf: { id: 'broadleaf', build: (l) => broadleafLod(l, { giant: false, blossom: false }), height: 11, trunkRadius: 0.45, lodDist: [75, 270, 620, 9000], material: 'foliage', castShadow: true },
  giant: { id: 'giant', build: (l) => broadleafLod(l, { giant: true, blossom: false }), height: 20, trunkRadius: 1.15, lodDist: [100, 380, 850, 9000], material: 'foliage', castShadow: true },
  blossom: { id: 'blossom', build: (l) => broadleafLod(l, { giant: false, blossom: true }), height: 8, trunkRadius: 0.34, lodDist: [75, 250, 560, 9000], material: 'foliage', castShadow: true },
  conifer: { id: 'conifer', build: coniferLod, height: 15, trunkRadius: 0.36, lodDist: [80, 300, 650, 9000], material: 'foliage', castShadow: true },
  windbent: { id: 'windbent', build: windbentLod, height: 7, trunkRadius: 0.38, lodDist: [70, 260, 560, 9000], material: 'foliage', castShadow: true },
  glowcap: { id: 'glowcap', build: glowcapLod, height: 14, trunkRadius: 1.1, lodDist: [110, 380, 850, 9000], material: 'glow', castShadow: true },
  bush: { id: 'bush', build: bushLod, height: 2, trunkRadius: 0, lodDist: [55, 260, 420, 700], material: 'foliage', castShadow: true },
  boulder: { id: 'boulder', build: boulderLod, height: 1.5, trunkRadius: 0, lodDist: [60, 300, 1600], material: 'rock', castShadow: true },
  log: { id: 'log', build: logLod, height: 1, trunkRadius: 0, lodDist: [55, 240, 500], material: 'rock', castShadow: true },
  shrooms: { id: 'shrooms', build: shroomsLod, height: 0.9, trunkRadius: 0, lodDist: [40, 160, 400], material: 'glow', castShadow: false },
  fern: { id: 'fern', build: fernLod, height: 0.9, trunkRadius: 0, lodDist: [35, 110, 170], material: 'card', castShadow: false },
};

export const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[];

/** Matrix helper used by placement: yaw, optional lean, non-uniform scale. */
export function instanceMatrix(x: number, y: number, z: number, yaw: number, scale: number, scaleY: number, leanX = 0, leanZ = 0): Matrix4 {
  return xf(x, y, z, leanX, yaw, leanZ, scale, scale * scaleY, scale);
}

export { mixColor };

// ---------------------------------------------------------------------------------------------
// Collision shapes
// ---------------------------------------------------------------------------------------------

/**
 * A collision shape in a species' own frame at scale 1 (the instance matrix places, turns and
 * scales it). Ellipsoids become spheres per instance (radius between the two semi-axes, so a
 * squashed boulder or canopy doesn't grow far past what's drawn); `top` keeps its top where the
 * drawn top is (hard rock you might bump from above).
 */
export type SpeciesShape =
  | { t: 'cyl'; x: number; z: number; r: number; y0: number; y1: number; soft?: boolean }
  | { t: 'ell'; x: number; y: number; z: number; a: number; b: number; soft?: boolean; top?: boolean }
  | { t: 'box'; x: number; y: number; z: number; hx: number; hy: number; hz: number };

/**
 * Fit a trunk cylinder to the recorded stems: centered on the lower trunk, as tall as the stem
 * stays within ~0.6 m of that axis (a strongly bent stem ends where the canopy takes over).
 */
function fitTrunk(stems: { path: Vector3[]; radii: number[] }[]): SpeciesShape | null {
  const st = stems[0];
  if (!st) return null;
  const p0 = st.path[0];
  const r0 = st.radii[0];
  let cx = p0.x;
  let cz = p0.z;
  let top = p0.y;
  let radius = r0;
  // Walk up while the stem stays near the base axis.
  for (let i = 1; i < st.path.length; i++) {
    const p = st.path[i];
    const off = Math.hypot(p.x - p0.x, p.z - p0.z);
    if (off > 0.9) break;
    top = p.y + st.radii[i] * 0.5;
  }
  // Center on the part kept, then grow the radius to enclose it.
  let n = 0;
  cx = 0;
  cz = 0;
  for (const p of st.path) {
    if (p.y > top) break;
    cx += p.x;
    cz += p.z;
    n++;
  }
  cx /= n;
  cz /= n;
  st.path.forEach((p, i) => {
    if (p.y > top) return;
    radius = Math.max(radius, Math.hypot(p.x - cx, p.z - cz) + st.radii[i]);
  });
  return { t: 'cyl', x: cx, z: cz, r: radius, y0: p0.y - 0.5, y1: top };
}

/**
 * Fit one soft sphere to a canopy's blobs, or two along its long axis when it is lopsided (the
 * wind-bent trees): a small search over center height, radius and split that maximizes how much
 * of the drawn canopy is inside (within 0.5 m) plus how much of the sphere lies on foliage
 * (within 0.75 m), so the cushion is where the leaves are, not out in the air around them.
 */
function fitCanopy(blobs: { c: Vector3; r: number; sy: number }[]): SpeciesShape[] {
  if (blobs.length === 0) return [];
  const lump = 1.08; // displaced blobs bulge a little past their radius
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const b of blobs) {
    const r = b.r * lump;
    minX = Math.min(minX, b.c.x - r);
    maxX = Math.max(maxX, b.c.x + r);
    minZ = Math.min(minZ, b.c.z - r);
    maxZ = Math.max(maxZ, b.c.z + r);
    minY = Math.min(minY, b.c.y - r * b.sy);
    maxY = Math.max(maxY, b.c.y + r * b.sy);
  }
  const hx = (maxX - minX) / 2;
  const hz = (maxZ - minZ) / 2;
  const hy = (maxY - minY) / 2;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  // The drawn surface, sampled: points on each blob (ellipsoid) not buried inside another.
  const fib = (n: number, f: (x: number, y: number, z: number) => void) => {
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n;
      const rr = Math.sqrt(1 - y * y);
      const th = i * 2.399963;
      f(Math.cos(th) * rr, y, Math.sin(th) * rr);
    }
  };
  /** Signed distance (approx.) from p to the union of blobs. */
  const blobDist = (x: number, y: number, z: number) => {
    let d = Infinity;
    for (const b of blobs) {
      const r = b.r * lump;
      const dy = (y - b.c.y) / b.sy;
      d = Math.min(d, Math.hypot(x - b.c.x, dy, z - b.c.z) - r);
    }
    return d;
  };
  const surface: Vector3[] = [];
  for (const b of blobs) {
    fib(48, (ux, uy, uz) => {
      const r = b.r * lump;
      const p = new Vector3(b.c.x + ux * r, b.c.y + uy * r * b.sy, b.c.z + uz * r);
      if (blobDist(p.x, p.y, p.z) > -0.3) surface.push(p);
    });
  }
  const score = (spheres: { x: number; y: number; z: number; r: number }[]) => {
    let inside = 0;
    for (const p of surface) {
      for (const s of spheres) {
        if (Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z) <= s.r + 0.5) {
          inside++;
          break;
        }
      }
    }
    let onLeaves = 0;
    let total = 0;
    for (const s of spheres) {
      fib(64, (ux, uy, uz) => {
        const x = s.x + ux * s.r;
        const y = s.y + uy * s.r;
        const z = s.z + uz * s.r;
        // Skip points buried in the other sphere.
        if (spheres.some((o) => o !== s && Math.hypot(x - o.x, y - o.y, z - o.z) < o.r - 0.1)) return;
        total++;
        if (blobDist(x, y, z) < 0.75) onLeaves++;
      });
    }
    return inside / surface.length + 1.35 * (onLeaves / Math.max(1, total));
  };
  let best: { x: number; y: number; z: number; r: number }[] = [];
  let bestScore = -1;
  const consider = (cand: { x: number; y: number; z: number; r: number }[], penalty: number) => {
    // Never hang below the leaves: people walk under trees.
    for (const c of cand) if (c.y - c.r < minY - 0.4) return;
    const sc = score(cand) - penalty;
    if (sc > bestScore) {
      bestScore = sc;
      best = cand;
    }
  };
  const lo = Math.min(hx, hz, hy);
  const hi = Math.max(hx, hz);
  for (let yi = -4; yi <= 8; yi++) {
    const y = cy + (yi / 4) * hy * 0.35;
    for (let ri = 0; ri <= 8; ri++) {
      // One sphere.
      consider([{ x: cx, y, z: cz, r: lo + (hi - lo) * (ri / 8) }], 0);
      // Two, side by side along x or z.
      for (const alongX of [true, false]) {
        const long = alongX ? hx : hz;
        for (let oi = 1; oi <= 4; oi++) {
          const off = long * (0.15 + 0.12 * oi);
          const r = lo * (0.7 + 0.08 * ri);
          consider([-1, 1].map((sgn) => ({ x: cx + (alongX ? sgn * off : 0), y, z: cz + (alongX ? 0 : sgn * off), r })), 0.04);
        }
      }
      // Big crowns (the giants): three lobes.
      if (hi > 6) {
        for (let oi = 1; oi <= 4; oi++) {
          const off = hi * (0.15 + 0.12 * oi);
          const r = lo * (0.6 + 0.07 * ri);
          consider([0, 1, 2].map((k) => ({ x: cx + Math.cos(k * 2.094 + 0.3) * off, y, z: cz + Math.sin(k * 2.094 + 0.3) * off, r })), 0.08);
        }
      }
    }
  }
  return best.map((s) => ({ t: 'ell' as const, x: s.x, y: s.y, z: s.z, a: s.r, b: s.r, soft: true }));
}

const shapeCache = new Map<SpeciesId, SpeciesShape[]>();

/** Collision shapes of a species at scale 1 (cached). Empty for things you walk through. */
export function speciesShapes(id: SpeciesId): SpeciesShape[] {
  let shapes = shapeCache.get(id);
  if (shapes) return shapes;
  shapes = [];
  switch (id) {
    case 'broadleaf':
    case 'giant':
    case 'blossom':
    case 'windbent':
    case 'bush': {
      recording = { stems: [], blobs: [] };
      try {
        SPECIES[id].build(0);
      } finally {
        const rec = recording;
        recording = null;
        const trunkShape = fitTrunk(rec.stems);
        if (trunkShape) shapes.push(trunkShape);
        shapes.push(...fitCanopy(rec.blobs));
      }
      break;
    }
    case 'conifer':
      // Trunk to near the tip; the tiered skirt as a wide lower and a narrow upper cushion.
      shapes.push({ t: 'cyl', x: 0, z: 0, r: 0.42, y0: -0.9, y1: 13.2 });
      shapes.push({ t: 'ell', x: 0, y: 4.6, z: 0, a: 3.6, b: 3.2, soft: true });
      shapes.push({ t: 'ell', x: 0, y: 10.0, z: 0, a: 2.3, b: 2.5, soft: true });
      break;
    case 'glowcap': {
      // A firm, leaning stem with its skirt, and the cap as stepped tiers you can land on.
      const H = 11;
      const lean = (y: number) => Math.sin((y / H) * 1.4) * 1.1;
      shapes.push({ t: 'cyl', x: 0.05, z: 0, r: 1.45, y0: -0.5, y1: 1.2 });
      shapes.push({ t: 'cyl', x: lean(3.6), z: 0, r: 1.1, y0: 1.2, y1: 6.0 });
      shapes.push({ t: 'cyl', x: lean(8.5), z: 0, r: 0.95, y0: 6.0, y1: H });
      shapes.push({ t: 'cyl', x: lean(H * 0.7), z: 0, r: 1.6, y0: H * 0.7 - 0.75, y1: H * 0.7 + 0.3 });
      const cx = lean(H);
      for (const [r, y1] of [[5.7, 0.45], [5.2, 1.1], [4.4, 1.8], [3.3, 2.55], [2.0, 3.25]]) {
        shapes.push({ t: 'cyl', x: cx, z: 0, r, y0: H - 0.3, y1: H + y1 });
      }
      break;
    }
    case 'boulder':
      // Unit icosahedron (±0.3 lumps) at y 0.35, squashed to 0.72 tall.
      shapes.push({ t: 'ell', x: 0, y: 0.35, z: 0, a: 1.05, b: 0.78, top: true });
      break;
    case 'log':
      shapes.push({ t: 'box', x: 0, y: 0.5, z: 0.05, hx: 3.6, hy: 0.5, hz: 0.5 });
      break;
    case 'shrooms':
    case 'fern':
      break;
  }
  shapeCache.set(id, shapes);
  return shapes;
}
