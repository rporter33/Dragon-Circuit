// Cosmetic shapes: horns, frills/crests, tail tips and the ironback's armor plates. Every id in
// the catalog (cosmetics/catalog.ts) for wyvernHorns, wyvernFrill and wyvernTail is handled here;
// unknown ids fall back to the default of their slot.

import { Vector3 } from 'three';
import { clamp, lerp, smoothstep } from '../../../core/math';
import type { WyvernLook } from '../../../core/types';
import { GeoBuilder, MREGION, REGION, Skin, tube } from '../builder';
import type { RigDef } from '../rig';
import { bodyChain } from './body';
import type { HeadInfo } from './head';
import { bezier3, bezier4, leaf, spike, strip } from './shape';
import { RES, sides as nsides, steps, type Res } from './res';

const UP = new Vector3(0, 1, 0);

/** Head-space helpers: points relative to the head pivot, scaled by head length. */
function headFrame(rig: RigDef) {
  const H = rig.bones[rig.idx.head].pos;
  const L = rig.props.shape.headLength;
  const Wd = rig.props.shape.headHalfWidth;
  const Hh = rig.props.shape.headHalfHeight;
  const at = (x: number, y: number, z: number) => new Vector3(H.x + x * Wd, H.y + y * Hh, H.z + z * L);
  return { H, L, Wd, Hh, at };
}

// ---------------------------------------------------------------------------------------------
// Horns
// ---------------------------------------------------------------------------------------------

export function buildHorns(b: GeoBuilder, rig: RigDef, head: HeadInfo, id: string, res: Res = RES[0]): void {
  const { L, at } = headFrame(rig);
  const skin = Skin.of(rig.idx.head);
  const horn = (i: number, t: number) => ({ region: REGION.horn, belly: 0, dorsal: t });
  const bulk = rig.props.shape.plates ? 1.25 : 1;
  b.begin(0);
  switch (id) {
    case 'none':
      // Hornless: just low brow nubs so the skull still has a silhouette.
      for (const sx of [1, -1]) {
        const base = at(0.55 * sx, 1.0, 0.36);
        spike(b, [base, base.clone().add(new Vector3(0.02 * sx * L, 0.05 * L, -0.06 * L))], 0.05 * L, skin, horn, nsides(res, 6));
      }
      break;
    case 'ram':
      for (const sx of [1, -1]) {
        // A heavy curl: back, down and forward around the cheek.
        const c = at(0.95 * sx, 0.55, 0.06);
        const pts: Vector3[] = [];
        const turns = 1.15;
        const N = steps(res, 16) + (res.lod === 2 ? 2 : 0);
        for (let i = 0; i <= N; i++) {
          const t = i / N;
          const a = 0.6 + t * turns * Math.PI * 2;
          const r = (0.42 - 0.24 * t) * L;
          pts.push(
            new Vector3(
              c.x + sx * (0.06 + 0.22 * t) * L,
              c.y + Math.cos(a) * r * 0.95,
              c.z - Math.sin(a) * r,
            ),
          );
        }
        // Start inside the skull so the base is buried.
        pts.unshift(at(0.55 * sx, 0.95, 0.12));
        spike(b, pts, 0.13 * L * bulk, skin, horn, nsides(res, 10), new Vector3(sx, 0, 0), 1, 0.7);
      }
      break;
    case 'crown': {
      // A ring of short spikes around the back of the skull.
      for (let i = 0; i < 9; i++) {
        const a = (i / 8 - 0.5) * 2.6; // around the back, from one side over the top to the other
        const base = at(Math.sin(a) * 0.9, 0.55 + Math.cos(a) * 0.6, 0.02 + 0.05 * Math.abs(Math.sin(a)));
        const out = new Vector3(Math.sin(a) * 0.8, Math.cos(a) * 0.9 + 0.2, -0.6).normalize();
        const len = (0.26 + 0.08 * Math.cos(a)) * L;
        const tip = base.clone().addScaledVector(out, len);
        spike(b, res.lod === 2 ? [base.clone().addScaledVector(out, -0.04 * L), tip] : [base.clone().addScaledVector(out, -0.04 * L), base.clone().addScaledVector(out, len * 0.5), tip], 0.055 * L * bulk, skin, horn, nsides(res, 6));
      }
      break;
    }
    case 'antler':
      for (const sx of [1, -1]) {
        const base = at(0.5 * sx, 1.0, 0.16);
        const beam = bezier4(base, base.clone().add(new Vector3(0.12 * sx * L, 0.4 * L, -0.1 * L)), base.clone().add(new Vector3(0.32 * sx * L, 0.75 * L, -0.15 * L)), base.clone().add(new Vector3(0.42 * sx * L, 1.0 * L, -0.42 * L)), 9);
        const beamPath = res.lod === 0 ? beam : beam.filter((_, i) => i % (res.lod === 1 ? 2 : 4) === 0 || i === beam.length - 1);
        spike(b, beamPath, 0.07 * L, skin, horn, nsides(res, 8), new Vector3(sx, 0, 0), 1, 0.6);
        // Tines branch forward and up off the beam.
        for (const [k, len, fwd] of [
          [2, 0.32, 0.9],
          [5, 0.36, 0.6],
          [7, 0.26, 0.2],
        ] as const) {
          if (res.lod === 2 && k !== 5) continue;
          const p0 = beam[k];
          const dir = new Vector3(0.25 * sx, 0.7, fwd).normalize();
          const tip = p0.clone().addScaledVector(dir, len * L);
          const mid = p0.clone().addScaledVector(dir, len * L * 0.5).add(new Vector3(0, 0.04 * L, -0.04 * L));
          spike(b, [p0.clone().addScaledVector(dir, -0.03 * L), mid, tip], 0.04 * L, skin, horn, nsides(res, 6));
        }
      }
      break;
    case 'unicorn': {
      // Lancehorn: one spiral horn on the brow.
      const base = at(0, 0.95, 0.44);
      const dir = new Vector3(0, 0.55, 0.84).normalize();
      const len = 0.85 * L;
      const pts: Vector3[] = [base.clone().addScaledVector(dir, -0.06 * L)];
      const NU = steps(res, 14);
      for (let i = 1; i <= NU; i++) pts.push(base.clone().addScaledVector(dir, (i / NU) * len));
      b.end();
      b.begin(0);
      const start = b.vertexCount;
      spike(b, pts, 0.1 * L, skin, horn, nsides(res, 10), UP, 1, 0.9);
      // Twist a spiral groove into it: push vertices in and out along a helix.
      const P = new Vector3();
      for (let vi = start; vi < b.vertexCount; vi++) {
        b.getPosition(vi, P);
        const rel = P.clone().sub(base);
        const s = rel.dot(dir);
        const radial = rel.addScaledVector(dir, -s);
        const r = radial.length();
        if (r < 1e-4) continue;
        const ang = Math.atan2(radial.x, radial.dot(new Vector3().crossVectors(dir, new Vector3(1, 0, 0)).normalize()));
        const groove = 1 - 0.22 * (0.5 + 0.5 * Math.sin(ang * 2 + (s / L) * 26));
        b.setPosition(vi, P.copy(base).addScaledVector(dir, s).addScaledVector(radial.normalize(), r * groove));
      }
      break;
    }
    case 'swept':
    default:
      for (const sx of [1, -1]) {
        // Long horns swept back along the neck, tips lifting.
        const base = at(0.6 * sx, 0.95, 0.14);
        const pts = bezier4(
          base.clone().add(new Vector3(-0.1 * sx * L, -0.06 * L, 0.06 * L)),
          base.clone().add(new Vector3(0.1 * sx * L, 0.1 * L, -0.22 * L)),
          base.clone().add(new Vector3(0.16 * sx * L, 0.06 * L, -0.6 * L)),
          base.clone().add(new Vector3(0.2 * sx * L, 0.22 * L, -0.92 * L)),
          steps(res, 12) + (res.lod === 2 ? 1 : 0),
        );
        const r0 = 0.12 * L * bulk;
        spike(b, pts, r0, skin, horn, nsides(res, 9), new Vector3(sx, 0, 0), 1, 0.8);
        // A bony boss rooting the horn in the skull: a cone collar half sunk in, wider than the
        // horn (the horn itself does not move).
        if (res.lod < 2) {
          const d = pts[1].clone().sub(pts[0]).normalize();
          tube(b, {
            points: [pts[0].clone().addScaledVector(d, -0.05 * L), pts[0].clone().addScaledVector(d, -0.01 * L), pts[0].clone().addScaledVector(d, 0.03 * L)],
            radii: [1.4 * r0, 1.32 * r0, 1.02 * r0],
            segments: nsides(res, 9),
            hint: new Vector3(sx, 0, 0),
            skin: () => skin,
            mat: () => ({ region: REGION.horn, dorsal: 0 }),
          });
        }
        // A smaller second pair below.
        const b2 = at(0.88 * sx, 0.45, 0.06);
        spike(
          b,
          bezier3(b2.clone().add(new Vector3(-0.06 * sx * L, 0, 0.04 * L)), b2.clone().add(new Vector3(0.14 * sx * L, 0.02 * L, -0.2 * L)), b2.clone().add(new Vector3(0.2 * sx * L, 0.1 * L, -0.42 * L)), steps(res, 6)),
          0.055 * L * bulk,
          skin,
          horn,
          nsides(res, 7),
        );
      }
      break;
  }
  b.end();
  void head;
}

// ---------------------------------------------------------------------------------------------
// Frills
// ---------------------------------------------------------------------------------------------

/** Points on the dorsal midline of the body plan between arc lengths s0..s1. */
function dorsal(rig: RigDef, s: number, lift: number, out: Vector3, outUp?: Vector3): Vector3 {
  const st = rig.plan.station(s);
  out.copy(st.center).addScaledVector(st.up, st.upper * (1.05) + lift);
  if (outUp) outUp.copy(st.up);
  return out;
}

/** Arc-length range of the saddle on the back (spines and plates leave it bare). */
function saddleGap(rig: RigDef): [number, number] {
  const s = rig.plan.sAtZ(rig.seat.z);
  const T = rig.props.shape.torsoLength;
  return [s - 0.22 * T, s + 0.2 * T];
}

export function buildFrill(b: GeoBuilder, rig: RigDef, head: HeadInfo, id: string, saddle: string, res: Res = RES[0]): void {
  const plan = rig.plan;
  const k = plan.keyS;
  const m = plan.marks;
  const chain = bodyChain(rig);
  const S = rig.props.shape;
  const L = S.headLength;
  const scale = S.torsoHalfHeight / 0.92;
  const p = new Vector3();
  const up = new Vector3();
  switch (id) {
    case 'none':
      return;
    case 'sail': {
      // Webbed crest from the back of the skull down the neck, held up by spines.
      const s0 = k[m.neckTop] - 0.05;
      const s1 = k[m.neckBase] + 0.1;
      const N = Math.max(7, steps(res, 26));
      const pts: Vector3[] = [];
      const sides: Vector3[] = [];
      const widths: number[] = [];
      const ss: number[] = [];
      b.begin(1);
      const rays = 7;
      const base: Vector3[] = [];
      const top: Vector3[] = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const s = lerp(s0, s1, t);
        dorsal(rig, s, -0.04, p, up);
        const ray = (t * rays) % 1;
        const h = 0.55 * scale * Math.pow(Math.sin(Math.PI * clamp(t * 1.05, 0, 1)), 0.7) * (0.82 + 0.18 * Math.cos(ray * Math.PI * 2));
        base.push(p.clone());
        top.push(p.clone().addScaledVector(up, h).add(new Vector3(0, 0, 0)).addScaledVector(rig.plan.station(s).tangent, h * 0.35));
        ss.push(s);
      }
      // Two rows of quads (base → mid → top) so the membrane can ripple.
      const rows: number[][] = [];
      for (let i = 0; i <= N; i++) {
        const row: number[] = [];
        const NJ = res.lod === 0 ? 3 : 1;
        for (let j = 0; j <= NJ; j++) {
          const f = j / NJ;
          p.lerpVectors(base[i], top[i], f);
          row.push(b.vertex(p, chain.skin(ss[i]), { region: MREGION.fin, belly: 0.4 + 0.6 * f, dorsal: f, flutter: f * f }, f, (i / N) * rays));
        }
        rows.push(row);
      }
      const NJ = rows[0].length - 1;
      for (let i = 0; i < N; i++) for (let j = 0; j < NJ; j++) b.quad(rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]);
      b.end();
      // Spines along the rays (solid).
      b.begin(0);
      for (let r = 0; r <= rays; r++) {
        const i = Math.round((r / rays) * N);
        const a = base[i];
        const c = top[i].clone().addScaledVector(up.subVectors(top[i], a).normalize(), 0.06 * scale);
        spike(b, [a.clone().addScaledVector(up, -0.05), a.clone().lerp(c, 0.5), c], 0.035 * scale, chain.skin(ss[i]), { region: REGION.horn }, nsides(res, 5));
      }
      b.end();
      void pts;
      void sides;
      void widths;
      return;
    }
    case 'mane': {
      // Shaggy feathers around the upper neck and the back of the skull, streaming back.
      b.begin(1);
      const s0 = k[m.neckTop] - 0.05;
      const s1 = lerp(k[m.neckTop], k[m.neckBase], 0.62);
      let seed = 7;
      const rnd = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      const rowsN = res.lod === 0 ? 9 : res.lod === 1 ? 5 : 3;
      for (let r = 0; r < rowsN; r++) {
        const t = r / (rowsN - 1);
        const s = lerp(s0, s1, t);
        const st = plan.station(s);
        const span = res.lod === 2 ? 1 : 3;
        for (let a = -span; a <= span; a++) {
          const th = a * (1.26 / span) + (rnd() - 0.5) * 0.15;
          plan.surface(s, th, p, up);
          const len = (0.62 - 0.3 * t) * scale * (1 - Math.abs(a) * 0.08) * (0.85 + 0.3 * rnd());
          const back = st.tangent.clone();
          const dir = back.multiplyScalar(0.8).addScaledVector(up, 0.55).normalize();
          const side = new Vector3().crossVectors(dir, up).normalize();
          const pts: Vector3[] = [];
          const sides: Vector3[] = [];
          const widths: number[] = [];
          const NS = res.lod === 0 ? 4 : 2;
          for (let i = 0; i <= NS; i++) {
            const f = i / NS;
            pts.push(p.clone().addScaledVector(up, -0.03).addScaledVector(dir, len * f).addScaledVector(up, -len * 0.25 * f * f));
            sides.push(side);
            widths.push(0.075 * scale * Math.sin(Math.PI * (0.15 + 0.85 * f)) + 0.01);
          }
          const sk = chain.skin(s);
          strip(b, pts, sides, widths, () => sk, (i, f) => ({ region: MREGION.feather, belly: 0.7, dorsal: f, flutter: f * f * 0.8 }), res.lod === 0 ? 2 : 1);
        }
      }
      b.end();
      return;
    }
    case 'fan': {
      // Cheek fans on the fan bones: webbing with radiating spines, folded back along the neck.
      for (let side = 0; side < 2; side++) {
        const sx = side === 0 ? 1 : -1;
        const bone = rig.idx.fans[side];
        const pivot = rig.bones[bone].pos;
        const sk = Skin.of(bone);
        const rays = res.lod === 2 ? 3 : 6;
        const R = 0.62 * L;
        const tips: Vector3[] = [];
        for (let r = 0; r <= rays; r++) {
          const a = lerp(-0.95, 0.95, r / rays); // fan angle in the side plane
          tips.push(pivot.clone().add(new Vector3(0.1 * sx * L, Math.sin(a) * R, -Math.cos(a) * R * (1 - 0.15 * Math.abs(a)))));
        }
        b.begin(1);
        const center = b.vertex(pivot.clone().add(new Vector3(0.02 * sx, 0, 0)), sk, { region: MREGION.fin, belly: 0.3, dorsal: 0 }, 0, 0);
        const M = res.lod === 0 ? 4 : res.lod === 1 ? 2 : 1;
        const ring: number[][] = [];
        for (let r = 0; r <= rays; r++) {
          const col: number[] = [];
          for (let j = 1; j <= M; j++) {
            const f = j / M;
            col.push(b.vertex(p.lerpVectors(pivot, tips[r], f), sk, { region: MREGION.fin, belly: 0.3 + 0.7 * f, dorsal: f, flutter: 0.5 * f * f }, f, r + 0.5));
          }
          ring.push(col);
        }
        // Scalloped edge between rays: an extra vertex pulled inward.
        for (let r = 0; r < rays; r++) {
          b.tri(center, ring[r][0], ring[r + 1][0]);
          for (let j = 0; j < M - 1; j++) b.quad(ring[r][j], ring[r][j + 1], ring[r + 1][j + 1], ring[r + 1][j]);
          const mid = b.vertex(p.lerpVectors(tips[r], tips[r + 1], 0.5).lerp(pivot, 0.16), sk, { region: MREGION.fin, belly: 1, dorsal: 1, flutter: 0.5 }, 1, r + 0.5);
          b.tri(ring[r][M - 1], mid, ring[r + 1][M - 1]);
        }
        b.end();
        b.begin(0);
        for (let r = 0; r <= rays; r++) {
          if (res.lod === 2) break;
          const tip = tips[r].clone().lerp(pivot, -0.08);
          spike(b, [pivot.clone(), pivot.clone().lerp(tip, 0.5), tip], 0.028 * L, sk, { region: REGION.horn }, nsides(res, 5));
        }
        b.end();
      }
      return;
    }
    case 'spines':
    default: {
      // A row of short spines from the skull down the neck, back and most of the tail.
      const [g0, g1] = saddleGap(rig);
      const sStart = k[m.neckTop] - 0.02;
      const sEnd = lerp(k[m.tailBase], plan.length, 0.82);
      const step = 0.34 * scale;
      b.begin(0);
      const hasRoyal = saddle === 'royal' || saddle === 'nomad';
      let nth = 0;
      for (let s = sStart; s < sEnd; s += step) {
        if (s > g0 - (hasRoyal ? 0.4 : 0) && s < g1 + (hasRoyal ? 0.5 : 0)) continue;
        if (res.lod === 2 && nth++ % 2 === 1) continue;
        const st = plan.station(s);
        dorsal(rig, s, -0.06, p, up);
        const along = (s - sStart) / (sEnd - sStart);
        const h = (0.22 + 0.16 * Math.sin(Math.PI * clamp(along * 1.4, 0, 1))) * scale * (1 - 0.6 * smoothstep(0.7, 1, along));
        const tip = p.clone().addScaledVector(up, h).addScaledVector(st.tangent, h * 0.55);
        const mid = p.clone().addScaledVector(up, h * 0.55).addScaledVector(st.tangent, h * 0.12);
        spike(b, res.lod === 0 ? [p.clone(), mid, tip] : [p.clone(), tip], 0.07 * scale * (1 - 0.4 * along), chain.skin(s), { region: REGION.horn }, nsides(res, 5), st.tangent, 0.45);
      }
      b.end();
      void head;
      return;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Tail tips
// ---------------------------------------------------------------------------------------------

export function buildTailTip(b: GeoBuilder, rig: RigDef, id: string, res: Res = RES[0]): void {
  const leafRings = res.lod === 0 ? 3 : 1;
  const plan = rig.plan;
  const chain = bodyChain(rig);
  const len = plan.length;
  const S = rig.props.shape;
  const scale = S.tailBaseRadius / 0.5;
  const last = rig.idx.tail[rig.idx.tail.length - 1];
  const tipSkin = Skin.of(last);
  const st = plan.station(len - 0.05);
  const tip = rig.tailTip.clone();
  const back = st.tangent.clone(); // toward the tip
  const side = st.side.clone();
  const up = st.up.clone();
  const skinAt = (pp: Vector3) => chain.skin(clamp(len - pp.distanceTo(tip) * (pp.clone().sub(tip).dot(back) < 0 ? 1 : -1), 0, len));
  switch (id) {
    case 'blade': {
      // A long flat steering fin along the last stretch of the tail, past the tip.
      const Lb = 1.9 * scale;
      const W = 0.36 * scale;
      const center = tip.clone().addScaledVector(back, -Lb * 0.35);
      const outline: [number, number][] = [];
      for (let i = 0; i <= 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const along = Math.cos(a);
        // Teardrop: sharp at the front (+along = toward the tip) and the back.
        const w = Math.sin(a) * W * Math.pow(Math.abs(Math.sin(a)), 0.3) * (along > 0 ? 1 - 0.35 * along : 1 + 0.15 * along);
        outline.push([along * (along > 0 ? Lb * 0.62 : Lb * 0.55), w]);
      }
      b.begin(0);
      leaf(b, center, back, side, up, outline, 0.05 * scale, skinAt, () => ({ region: REGION.skin, dorsal: 0.9, belly: 0 }), leafRings);
      b.end();
      return;
    }
    case 'plume': {
      b.begin(1);
      const N = res.lod === 2 ? 3 : res.lod === 1 ? 5 : 9;
      for (let i = 0; i < N; i++) {
        const a = (i / (N - 1) - 0.5) * 1.3;
        const lift = (i % 2 === 0 ? 0.12 : -0.05) + 0.05 * Math.cos(a * 3);
        const dir = back.clone().multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a)).addScaledVector(up, lift).normalize();
        const fl = (1.15 + 0.45 * Math.cos(a * 1.6)) * scale;
        const fside = new Vector3().crossVectors(dir, up).normalize();
        const pts: Vector3[] = [];
        const sides: Vector3[] = [];
        const widths: number[] = [];
        const NS = res.lod === 0 ? 6 : 2;
        for (let k = 0; k <= NS; k++) {
          const f = k / NS;
          pts.push(tip.clone().addScaledVector(back, -0.12 * scale).addScaledVector(dir, fl * f).addScaledVector(up, -0.12 * fl * f * f));
          sides.push(fside);
          widths.push(0.1 * scale * Math.sin(Math.PI * (0.12 + 0.88 * f)) + 0.012);
        }
        strip(b, pts, sides, widths, () => tipSkin, (_k, f) => ({ region: MREGION.feather, belly: 0.8, dorsal: f, flutter: f * f }), res.lod === 0 ? 2 : 1);
      }
      b.end();
      return;
    }
    case 'club': {
      // A heavy knob of bone with a few blunt bosses.
      const c = tip.clone().addScaledVector(back, -0.1 * scale);
      const R = 0.34 * scale;
      b.begin(0);
      leaf(
        b,
        c,
        back,
        side,
        up,
        Array.from({ length: 14 }, (_, i) => {
          const a = (i / 14) * Math.PI * 2;
          return [Math.cos(a) * R * 1.25, Math.sin(a) * R * (1 + 0.12 * Math.cos(a * 3))] as [number, number];
        }),
        R * 0.75,
        () => tipSkin,
        (_top, f) => ({ region: REGION.horn, dorsal: 0.6, belly: 0 }) as const,
        res.lod === 0 ? 4 : 1,
      );
      b.end();
      b.begin(0);
      for (let i = 0; i < (res.lod === 2 ? 0 : 6); i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        const d = side.clone().multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a) * 0.8).addScaledVector(back, 0.2).normalize();
        const base = c.clone().addScaledVector(d, R * 0.7);
        spike(b, [base, base.clone().addScaledVector(d, R * 0.35), base.clone().addScaledVector(d, R * 0.6)], R * 0.3, tipSkin, { region: REGION.horn }, nsides(res, 6));
      }
      b.end();
      return;
    }
    case 'ribbon': {
      b.begin(1);
      for (const s of [1, -1]) {
        const dir = back.clone().addScaledVector(side, 0.22 * s).addScaledVector(up, 0.03).normalize();
        const Lr = 2.4 * scale;
        const pts: Vector3[] = [];
        const sides: Vector3[] = [];
        const widths: number[] = [];
        const fside = new Vector3().crossVectors(dir, up).normalize();
        const NR = res.lod === 0 ? 12 : res.lod === 1 ? 6 : 3;
        for (let k = 0; k <= NR; k++) {
          const f = k / NR;
          pts.push(tip.clone().addScaledVector(back, -0.2 * scale).addScaledVector(dir, Lr * f).addScaledVector(side, 0.12 * s * Math.sin(f * 5)));
          sides.push(fside);
          widths.push(0.13 * scale * (1 - 0.65 * f) * Math.min(1, f * 6 + 0.25));
        }
        strip(b, pts, sides, widths, (k) => (k < 1 ? chain.skin(len - 0.3) : tipSkin), (_k, f) => ({ region: MREGION.fin, belly: 0.9, dorsal: f, flutter: 0.4 + f }), res.lod === 0 ? 2 : 1);
      }
      b.end();
      return;
    }
    case 'spade':
    default: {
      // The classic arrowhead, flat, with backswept barbs.
      const Ls = 0.85 * scale;
      const W = 0.42 * scale;
      const outline: [number, number][] = [
        [Ls * 0.62, 0],
        [Ls * 0.1, W * 0.62],
        [-Ls * 0.32, W],
        [-Ls * 0.2, W * 0.42],
        [-Ls * 0.42, 0.06 * scale],
        [-Ls * 0.42, -0.06 * scale],
        [-Ls * 0.2, -W * 0.42],
        [-Ls * 0.32, -W],
        [Ls * 0.1, -W * 0.62],
      ];
      // u = toward the tip, v = side: (u × v) must be +n, so use n = back × side.
      const n = new Vector3().crossVectors(back, side).normalize();
      b.begin(0);
      leaf(b, tip.clone().addScaledVector(back, 0.12 * scale), back, side, n, outline, 0.06 * scale, () => tipSkin, () => ({ region: REGION.skin, dorsal: 0.9, belly: 0 }), leafRings);
      b.end();
      return;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Osteoderms (ironback)
// ---------------------------------------------------------------------------------------------

/**
 * One keeled osteoderm (bony scute) lying on the surface: a low rounded-rectangle shield whose
 * top rises to a ridge (keel) running along the body, highest toward the rear edge, with a skirt
 * sunk into the skin so it never floats. ~24 triangles. u: along the body (toward the tail),
 * v: across, n: surface normal. aUv2.x is 0 on the keel and 1 at the rim (for the shading).
 */
function keeledScute(b: GeoBuilder, c: Vector3, u: Vector3, v: Vector3, n: Vector3, halfLen: number, halfWid: number, keel: number, skin: Skin): void {
  const mat = { region: REGION.plate, dorsal: 1, belly: 0 };
  const P = new Vector3();
  const at = (a: number, w: number, h: number, rim: number) =>
    b.vertex(P.copy(c).addScaledVector(u, a * halfLen).addScaledVector(v, w * halfWid).addScaledVector(n, h), skin, mat, rim, w);
  // Top: three cross rows (front, middle, rear) of left edge, keel, right edge.
  const rows = [-0.9, 0.05, 0.95];
  const keelH = [0.45, 0.85, 1.0];
  const top: number[][] = rows.map((a, r) => [at(a, -1, keel * 0.12, 0.85), at(a, 0, keel * keelH[r], 0), at(a, 1, keel * 0.12, 0.85)]);
  // Rim around the top, then a skirt sunk below the skin.
  const ring: [number, number][] = [
    [-1, -0.75],
    [-1, 0],
    [-1, 0.75],
    [0.05, 1.08],
    [1, 0.75],
    [1, 0],
    [1, -0.75],
    [0.05, -1.08],
  ];
  const rim = ring.map(([a, w]) => at(a, w, 0, 1));
  const skirt = ring.map(([a, w]) => at(a * 1.04, w * 1.04, -keel * 0.9 - 0.02, 1));
  // Top quads (2 x 2), counter-clockwise seen from outside (u x v = n).
  for (let r = 0; r < 2; r++) {
    for (let k = 0; k < 2; k++) b.quad(top[r][k], top[r + 1][k], top[r + 1][k + 1], top[r][k + 1]);
  }
  // Top border to the rim: front edge, right edge, rear edge, left edge (outline order).
  const border = [top[0][0], top[0][1], top[0][2], top[1][2], top[2][2], top[2][1], top[2][0], top[1][0]];
  for (let k = 0; k < 8; k++) {
    const j = (k + 1) % 8;
    // (The outline runs clockwise seen from outside, so these wind inner -> next -> outer.)
    b.quad(border[k], border[j], rim[j], rim[k]);
    b.quad(rim[k], rim[j], skirt[j], skirt[k]);
  }
}

/** Dorsal shield columns: girth angle, width (× body radius), keel height (× scale). */
const DORSAL_SHIELD: [number, number, number][] = [
  [0.17, 0.15, 0.075],
  [0.52, 0.15, 0.065],
  [0.88, 0.12, 0.045],
];
const DORSAL_SHIELD_FAR: [number, number, number][] = [[0.3, 0.2, 0.075]];

/**
 * The far-LOD osteoderm: a keeled ridge of six triangles, its rim sunk into the skin (same frame
 * and aUv2 convention as keeledScute).
 */
function lowScute(b: GeoBuilder, c: Vector3, u: Vector3, v: Vector3, n: Vector3, halfLen: number, halfWid: number, keel: number, skin: Skin): void {
  const mat = { region: REGION.plate, dorsal: 1, belly: 0 };
  const P = new Vector3();
  const at = (a: number, w: number, h: number, rim: number) =>
    b.vertex(P.copy(c).addScaledVector(u, a * halfLen).addScaledVector(v, w * halfWid).addScaledVector(n, h), skin, mat, rim, w);
  const sink = -0.3 * keel - 0.01;
  const fl = at(-1, -1, sink, 1);
  const fr = at(-1, 1, sink, 1);
  const br = at(1, 1, sink, 1);
  const bl = at(1, -1, sink, 1);
  const kf = at(-0.9, 0, keel * 0.45, 0);
  const kb = at(0.95, 0, keel, 0);
  // Counter-clockwise seen from outside (u × v = n).
  b.quad(fl, bl, kb, kf);
  b.quad(kf, kb, br, fr);
  b.tri(fl, kf, fr);
  b.tri(bl, br, kb);
}

/**
 * Crocodilian armor down the ironback: a nuchal shield of big scutes behind the head, paired
 * transverse rows of keeled osteoderms down the neck and over the back (the saddle sits on bare
 * hide), and two rows of tall keeled crests down the tail, converging and shrinking toward the tip.
 */
export function buildPlates(b: GeoBuilder, rig: RigDef, look: WyvernLook, res: Res = RES[0]): void {
  const plan = rig.plan;
  const k = plan.keyS;
  const m = plan.marks;
  const chain = bodyChain(rig);
  const [g0, g1] = saddleGap(rig);
  const extraGap = look.saddle === 'royal' || look.saddle === 'nomad' ? 0.4 : 0.12;
  const S = rig.props.shape;
  const scale = S.torsoHalfHeight / 1.04;
  const p = new Vector3();
  const n = new Vector3();
  const u = new Vector3();
  const v = new Vector3();
  const sNeck0 = lerp(k[m.neckTop], k[m.neckBase], 0.18);
  const sNuchal = lerp(k[m.neckTop], k[m.neckBase], 0.78);
  const sTail = k[m.tailBase];
  const sEnd = lerp(sTail, plan.length, 0.8);
  b.begin(0);
  const place = (s: number, th: number, halfLen: number, halfWid: number, keel: number) => {
    plan.surface(s, th, p, n);
    const st = plan.station(s);
    u.copy(st.tangent).addScaledVector(n, -st.tangent.dot(n)).normalize();
    v.crossVectors(n, u).normalize();
    if (res.tack === 2) keeledScute(b, p, u, v, n, halfLen, halfWid, keel, chain.skin(s));
    else lowScute(b, p, u, v, n, halfLen, halfWid, keel, chain.skin(s));
  };
  let s = sNeck0;
  while (s < sEnd) {
    const st = plan.station(s);
    const r = Math.max(0.05, Math.min(st.halfWidth, st.upper));
    const onTail = s > sTail + 0.1;
    // Rows about as long as the body is round here (a tighter pitch down the tail).
    // Coarser LODs lay fewer, longer rows (the same armour read from further away).
    const coarse = res.tack === 2 ? 1 : res.tack === 1 ? 1.5 : 2.8;
    const pitch = clamp(r * (onTail ? 0.42 : 0.3), 0.1, 0.3 * scale) * coarse;
    const inSaddle = s > g0 - extraGap && s < g1 + extraGap;
    if (!inSaddle) {
      if (onTail) {
        // Double crest: two rows of upright keels converging toward the tip.
        const f = (s - sTail) / (sEnd - sTail);
        const th = lerp(0.42, 0.22, f);
        const keel = (0.16 - 0.1 * f) * scale + 0.25 * r * (1 - f);
        for (const sx of [1, -1]) place(s, th * sx, pitch * 0.42, r * 0.17, keel);
      } else if (s < sNuchal) {
        // Neck: paired rows, a smaller outer pair further down.
        const cols = s > lerp(sNeck0, sNuchal, 0.5) && res.tack > 0 ? [0.3, 0.78] : [0.32];
        for (const th of cols) for (const sx of [1, -1]) place(s, th * sx, pitch * 0.42, r * (th < 0.5 ? 0.24 : 0.18), 0.05 * scale);
      } else if (s < k[m.chest]) {
        // Nuchal shield at the neck base: two rows of big scutes.
        for (const th of res.tack > 0 ? [0.24, 0.66] : [0.3]) for (const sx of [1, -1]) place(s, th * sx, pitch * 0.46, r * 0.22, 0.07 * scale);
      } else {
        // Dorsal shield: three pairs across the back, the outer ones lower and smaller.
        for (const [th, wid, keel] of res.tack > 0 ? DORSAL_SHIELD : DORSAL_SHIELD_FAR)
          for (const sx of [1, -1]) place(s, th * sx, pitch * 0.42, r * wid, keel * scale);
      }
    }
    s += pitch;
  }
  b.end();
}

void bezier3;
