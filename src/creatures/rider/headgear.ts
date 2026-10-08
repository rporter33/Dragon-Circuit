// Headgear: goggles, aviator cap, hood, winged helm and the wind circlet, all rigid on the head
// bone (the hood's lower edge rests on the shoulders and follows the chest).

import { Color, Quaternion, Vector3 } from 'three';
import type { RiderLook } from '../../core/types';
import { B } from './rig';
import { sk, sk2, type RingSpec } from './meshKit';
import { shapeHead, type BodyCtx } from './body';
import { hairThickness } from './hair';
import { mixSrgb, tone } from './palette';

const UPV = new Vector3(0, 1, 0);
const ZV = new Vector3(0, 0, 1);

/** Does this headgear cover the crown (so the hair cap is hidden)? */
export function coversCrown(headgear: string): boolean {
  return headgear === 'hood' || headgear === 'helm' || headgear === 'cap';
}

/**
 * A band around the head following the skull: front height yF and back height yB (unit-sphere
 * y), lifted `inflate` off the scalp.
 */
function headBand(ctx: BodyCtx, yF: number, yB: number, inflate: number, halfH: number, color: Color | ((phi: number) => Color), glow = 0): void {
  const { head } = ctx;
  const hb = sk(B.head);
  const seg = 28;
  const b = ctx.b;
  b.begin();
  // Four rows around the head: inner-bottom, outer-bottom, outer-top, inner-top.
  const layers: [number, number][] = [
    [-halfH, inflate * 0.55],
    [-halfH, inflate],
    [halfH, inflate],
    [halfH, inflate * 0.55],
  ];
  const rows: number[][] = [];
  const p = new Vector3();
  const dir = new Vector3();
  for (const [dy, inf] of layers) {
    const row: number[] = [];
    for (let j = 0; j < seg; j++) {
      const phi = (j / seg) * Math.PI * 2;
      const back = 0.5 - 0.5 * Math.cos(phi);
      const y = yF + (yB - yF) * back + dy / head.radii.y;
      const r = Math.sqrt(Math.max(0.02, 1 - y * y));
      dir.set(Math.sin(phi) * r, y, Math.cos(phi) * r);
      head.surface(dir, p, inf);
      row.push(b.vertex(p, typeof color === 'function' ? color(phi > Math.PI ? phi - 2 * Math.PI : phi) : color, hb, glow));
    }
    rows.push(row);
  }
  const facing = new Vector3();
  for (let l = 0; l < 3; l++) {
    for (let j = 0; j < seg; j++) {
      const a = rows[l][j];
      const c = rows[l][(j + 1) % seg];
      const d = rows[l + 1][(j + 1) % seg];
      const e = rows[l + 1][j];
      if (l === 1) b.pos(a, facing).sub(head.center);
      else facing.set(0, l === 0 ? -1 : 1, 0);
      b.quadFacing(a, c, d, e, facing);
    }
  }
  b.end();
}

export function buildHeadgear(ctx: BodyCtx, look: RiderLook): void {
  const { b, pal, head, d } = ctx;
  const hb = sk(B.head);
  const t = hairThickness(look.hair);
  const brass = pal.brass;
  switch (look.headgear) {
    case 'goggles': {
      // Strap around the head, lenses pushed up on the forehead.
      headBand(ctx, 0.5, 0.05, t + 0.006, 0.011, pal.leatherDark);
      for (const s of [1, -1]) {
        const dir = new Vector3(s * 0.36, 0.56, 0.78);
        const c = head.surface(dir, new Vector3(), t + 0.012);
        const n = c.clone().sub(head.center).normalize();
        n.y += 0.25;
        n.normalize();
        const q = new Quaternion().setFromUnitVectors(ZV, n);
        const ax = new Vector3(1, 0, 0).applyQuaternion(q);
        const ay = new Vector3(0, 1, 0).applyQuaternion(q);
        const r = 0.027;
        const rim: RingSpec[] = [
          { c: c.clone().addScaledVector(n, -0.004), ax, ay, rx: r * 0.92, ry: r * 0.85, skin: hb, color: brass },
          { c: c.clone().addScaledVector(n, 0.012), ax, ay, rx: r, ry: r * 0.92, skin: hb, color: brass },
          { c: c.clone().addScaledVector(n, 0.018), ax, ay, rx: r * 0.95, ry: r * 0.87, skin: hb, color: tone(brass, 0.85) },
          { c: c.clone().addScaledVector(n, 0.016), ax, ay, rx: r * 0.72, ry: r * 0.66, skin: hb, color: tone(brass, 0.7) },
        ];
        b.loft(rim, 14);
        // Glass: a slightly domed amber lens with a little glint.
        b.ellipsoid(c.clone().addScaledVector(n, 0.014), new Vector3(r * 0.74, r * 0.68, 0.006), hb, mixSrgb(new Color('#d8a050'), new Color('#ffe8b0'), 0.3), {
          rot: q,
          lat: 5,
          lon: 10,
          glow: (u) => (u.x < -0.2 && u.y > 0.2 ? 0.6 : 0.12),
        });
      }
      // Bridge between the lenses.
      const l = head.surface(new Vector3(0.12, 0.6, 0.79), new Vector3(), t + 0.016);
      const rr = head.surface(new Vector3(-0.12, 0.6, 0.79), new Vector3(), t + 0.016);
      b.bar(l, rr, UPV, 0.005, 0.004, hb, brass, { exp: 2 });
      break;
    }
    case 'cap': {
      // Aviator cap: leather dome down over the ears with flaps, a fleece edge.
      const leather = mixSrgb(pal.leather, pal.leatherDark, 0.2);
      b.ellipsoid(head.center, head.radii.clone().addScalar(t * 0.5 + 0.012), hb, (u) => (Math.abs(u.x) < 0.05 && u.y > 0 ? tone(leather, 0.8) : leather), {
        lat: 14,
        lon: 22,
        deform: (u) => {
          const phi = Math.atan2(u.x, u.z);
          const a = Math.abs(phi);
          // Brim line: high over the brow, down over the ears, nape at the back.
          const line = a < 0.7 ? 0.42 : a < 1.9 ? 0.42 - (a - 0.7) * 1.05 : -0.84 + (a - 1.9) * 0.3;
          const inside = 1 - Math.min(1, Math.max(0, (u.y - line) / 0.05));
          shapeHead(u);
          u.multiplyScalar(1 - inside * 0.25);
        },
      });
      // Fleece trim along the brow.
      headBand(ctx, 0.43, 0.05, t + 0.02, 0.008, (phi) => (Math.abs(phi) < 0.7 || Math.abs(phi) > 2.4 ? pal.cream : leather));
      // Chin strap.
      for (const s of [1, -1]) {
        const a = head.surface(new Vector3(s, -0.35, 0.05), new Vector3(), t + 0.014);
        const c = head.surface(new Vector3(s * 0.5, -0.92, 0.25), new Vector3(), 0.006);
        b.bar(a, c, ZV, 0.004, 0.012, hb, tone(leather, 0.85), { exp: 3 });
      }
      break;
    }
    case 'hood': {
      // Deep hood: a thick shell open at the face, peaked at the back, draped onto the shoulders.
      const cape = pal.cape;
      const lining = tone(cape, 0.6);
      const center = head.center;
      b.sheet(
        16,
        10,
        (u, v, p, n) => {
          // u wraps around the head from the left cheek over the back to the right cheek.
          const phi = 0.55 + u * (2 * Math.PI - 1.1);
          const pol = 0.05 + v * 2.45; // from the crown down past the jaw
          const dir = new Vector3(Math.sin(phi) * Math.sin(pol), Math.cos(pol), Math.cos(phi) * Math.sin(pol));
          const inf = 0.026 + 0.03 * Math.max(0, v - 0.55) + 0.012 * (1 - Math.abs(Math.cos(phi)));
          const sx = head.radii.x + inf + 0.035 * Math.max(0, v - 0.6);
          const sy = head.radii.y + inf;
          const sz = head.radii.z + inf;
          p.set(dir.x * sx, dir.y * sy, dir.z * sz).add(center);
          // A soft peak at the back of the crown.
          const peak = Math.max(0, -Math.cos(phi)) * Math.exp(-((pol - 0.7) ** 2) / 0.08);
          p.addScaledVector(new Vector3(0, 0.4, -1).normalize(), 0.05 * peak);
          // The lower drape falls onto the shoulders.
          if (v > 0.7) p.y -= (v - 0.7) * 0.18;
          n.copy(dir);
        },
        0.012,
        (u, v) => (v < 0.65 ? sk(B.head) : sk2(B.head, B.chest, Math.min(1, (v - 0.65) / 0.35) * 0.8)),
        (u, v, inner) => (inner ? lining : u < 0.04 || u > 0.96 ? tone(cape, 0.85) : cape),
      );
      break;
    }
    case 'helm': {
      const steel = pal.steel;
      b.ellipsoid(head.center, head.radii.clone().addScalar(t * 0.4 + 0.016), hb, (u) => (Math.abs(u.x) < 0.05 && u.y > -0.2 ? tone(steel, 1.15) : steel), {
        lat: 14,
        lon: 22,
        deform: (u) => {
          const phi = Math.atan2(u.x, u.z);
          const a = Math.abs(phi);
          const line = a < 0.8 ? 0.36 : a < 1.7 ? 0.36 - (a - 0.8) * 0.6 : -0.18 - (a - 1.7) * 0.12;
          const inside = 1 - Math.min(1, Math.max(0, (u.y - line) / 0.04));
          shapeHead(u);
          u.multiplyScalar(1 - inside * 0.25);
        },
      });
      headBand(ctx, 0.36, -0.2, t + 0.022, 0.011, pal.secondary);
      // Swept wings: four blades fanned back from each temple.
      for (const s of [1, -1]) {
        const root = head.surface(new Vector3(s * 0.95, 0.3, -0.05), new Vector3(), t + 0.02);
        for (let i = 0; i < 4; i++) {
          const a = 0.5 + i * 0.28;
          const dir = new Vector3(s * 0.32, Math.cos(a) * 0.95, -Math.sin(a)).normalize();
          const len = 0.11 - i * 0.017;
          b.bar(root.clone().addScaledVector(dir, 0.005), root.clone().addScaledVector(dir, len), new Vector3(s, 0, 0), 0.011 - i * 0.0012, 0.0035, hb, i === 0 ? tone(steel, 1.12) : steel, { exp: 2.2 });
        }
        b.ellipsoid(root, new Vector3(0.016, 0.016, 0.012), hb, pal.secondary, { lat: 5, lon: 8 });
      }
      // Nasal ridge.
      const top = head.surface(new Vector3(0, 0.5, 0.86), new Vector3(), t + 0.022);
      const bot = head.surface(new Vector3(0, 0.12, 0.99), new Vector3(), 0.03);
      b.bar(top, bot, new Vector3(1, 0, 0), 0.007, 0.005, hb, steel, { exp: 3 });
      break;
    }
    case 'circlet': {
      const gold = mixSrgb(brass, new Color('#fff0b0'), 0.25);
      headBand(ctx, 0.42, 0.18, t + 0.004, 0.0045, gold);
      const c = head.surface(new Vector3(0, 0.46, 0.89), new Vector3(), t + 0.01);
      const n = c.clone().sub(head.center).normalize();
      const q = new Quaternion().setFromUnitVectors(ZV, n);
      b.ellipsoid(c, new Vector3(0.014, 0.018, 0.008), hb, gold, { rot: q, lat: 5, lon: 10 });
      b.ellipsoid(c.clone().addScaledVector(n, 0.005), new Vector3(0.0095, 0.013, 0.0065), hb, pal.glow, { rot: q, lat: 6, lon: 10, glow: 1 });
      break;
    }
    case 'none':
    default:
      break;
  }
  void d;
}
