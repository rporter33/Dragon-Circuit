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
function headBand(ctx: BodyCtx, yF: number, yB: number, inflate: number, halfH: number, color: Color | ((phi: number) => Color), glow = 0, inflateBack = inflate): void {
  const { head } = ctx;
  const hb = sk(B.head);
  const seg = 28;
  const b = ctx.b;
  b.begin();
  // Four rows around the head: inner-bottom, outer-bottom, outer-top, inner-top.
  const layers: [number, number][] = [
    [-halfH, 0.55],
    [-halfH, 1],
    [halfH, 1],
    [halfH, 0.55],
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
      const frontK = Math.pow(Math.max(0, Math.cos(phi)), 1.5);
      head.surface(dir, p, inf * (inflateBack + (inflate - inflateBack) * frontK));
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
      // Aviator cap: a stitched leather dome down over the ears, flaps with fleece edges, a
      // dangling chin strap.
      const leather = mixSrgb(pal.leather, pal.leatherDark, 0.35);
      const seam = tone(leather, 0.72);
      const brim = (phi: number) => {
        const a = Math.abs(phi);
        return a < 0.75 ? 0.4 : a < 1.25 ? 0.4 - (a - 0.75) * 0.9 : a < 2.2 ? -0.05 - (a - 1.25) * 0.5 : -0.52 + (a - 2.2) * 0.1;
      };
      b.ellipsoid(
        head.center,
        head.radii.clone().addScalar(t * 0.5 + 0.013),
        hb,
        (u) => {
          const phi = Math.atan2(u.x, u.z);
          // Seams: one down the middle, one each side.
          const seamLine = Math.abs(u.x) < 0.035 || Math.abs(Math.abs(phi) - 1.15) < 0.05;
          return seamLine && u.y > brim(phi) + 0.08 ? seam : leather;
        },
        {
          lat: 16,
          lon: 24,
          deform: (u) => {
            const phi = Math.atan2(u.x, u.z);
            const inside = 1 - Math.min(1, Math.max(0, (u.y - brim(phi)) / 0.05));
            shapeHead(u);
            u.multiplyScalar(1 - inside * 0.25);
          },
        },
      );
      // Fleece roll along the brim over the brow.
      headBand(ctx, 0.41, 0.36, t + 0.018, 0.009, (phi) => (Math.abs(phi) < 0.9 ? tone(leather, 1.15) : leather));
      // Ear flaps.
      for (const s of [1, -1]) {
        const top = head.surface(new Vector3(s, -0.05, -0.05), new Vector3(), t + 0.018);
        const n = top.clone().sub(head.center).setY(0).normalize();
        b.sheet(
          3,
          4,
          (u, v, p, nn) => {
            const w = 0.075 * (1 - 0.3 * v * v);
            const y = 0.05 - v * 0.85;
            const along = (u - 0.5) * 2 * w;
            const dir = new Vector3(s, y, -0.02 + along * 6);
            head.surface(dir, p, t + 0.018 + 0.012 * v);
            nn.copy(p).sub(head.center).normalize();
          },
          0.007,
          () => hb,
          (u, v, inner) => (inner || v > 0.9 ? pal.cream : leather),
        );
        void n;
      }
      // Chin strap hanging loose from one flap.
      const a = head.surface(new Vector3(-0.92, -0.62, 0.1), new Vector3(), 0.02);
      const c = a.clone().add(new Vector3(0.018, -0.06, 0.02));
      b.bar(a, c, ZV, 0.004, 0.009, hb, tone(leather, 0.85), { exp: 3 });
      b.ellipsoid(c, new Vector3(0.008, 0.008, 0.005), hb, pal.brass, { lat: 4, lon: 6 });
      break;
    }
    case 'hood': {
      // Deep hood: a thick shell framing the face in a soft oval, peaked at the back, settling
      // into a cowl over the shoulders. Lined in a deeper tone, with a rolled rim at the face.
      const cape = pal.cape;
      const lining = tone(cape, 0.55);
      const center = head.center;
      const hoodAt = (u: number, v: number, p: Vector3, n: Vector3) => {
        // Opening half-angle around the face by height: covers the brow, opens around the
        // face, closes again under the chin.
        const pol = 0.02 + v * 2.42;
        const open = 0.2 + 0.55 * Math.sin(Math.min(Math.PI, Math.max(0, (pol - 0.25) / 1.7) * Math.PI)) - (0.1 * Math.max(0, v - 0.85)) / 0.15;
        const phi = open + u * (2 * Math.PI - 2 * open);
        const dir = new Vector3(Math.sin(phi) * Math.sin(pol), Math.cos(pol), Math.cos(phi) * Math.sin(pol));
        const rim = Math.max(0, Math.cos(phi));
        const inf = 0.032 + 0.016 * (1 - rim) + (0.05 * Math.max(0, v - 0.62)) / 0.38;
        p.set(dir.x * (head.radii.x + inf), dir.y * (head.radii.y + inf), dir.z * (head.radii.z + inf) + 0.018 * rim * (v < 0.6 ? 1 : 0)).add(center);
        // Peak at the back of the crown.
        const back = Math.max(0, -Math.cos(phi));
        p.addScaledVector(new Vector3(0, 0.25, -1).normalize(), 0.085 * back * back * Math.exp(-((pol - 0.8) ** 2) / 0.1));
        // The cowl: below the jaw the cloth falls outward and down onto the shoulders.
        if (v > 0.58) {
          const k = (v - 0.58) / 0.42;
          p.y -= k * k * 0.07;
          p.x += Math.sin(phi) * k * 0.11;
          p.z += Math.cos(phi) * k * 0.04 - 0.03 * k;
        }
        n.copy(dir);
      };
      const hoodSkin = (u: number, v: number) => (v < 0.6 ? sk(B.head) : sk2(B.head, B.chest, Math.min(1, (v - 0.6) / 0.4) * 0.85));
      b.sheet(18, 12, hoodAt, 0.012, hoodSkin, (u, v, inner) => (inner ? lining : cape));
      // Rolled rim around the face opening: up the left edge, over the brow, down the right.
      const rim: RingSpec[] = [];
      const p = new Vector3();
      const n = new Vector3();
      const pts: [number, number][] = [];
      for (let i = 0; i <= 8; i++) pts.push([0, 0.62 - (0.62 * i) / 8]);
      for (let i = 1; i <= 8; i++) pts.push([1, (0.62 * i) / 8]);
      for (const [u, v] of pts) {
        hoodAt(u, v, p, n);
        rim.push({ c: p.clone(), ax: n.clone(), ay: new Vector3(0, 0, 1), rx: 0.011, ry: 0.011, skin: hoodSkin(u, v), color: tone(cape, 0.85) });
      }
      // Ring axes perpendicular to the path.
      for (let i = 0; i < rim.length; i++) {
        const a = rim[Math.max(0, i - 1)].c;
        const c = rim[Math.min(rim.length - 1, i + 1)].c;
        const tan = c.clone().sub(a).normalize();
        const nn = rim[i].ax.clone().addScaledVector(tan, -rim[i].ax.dot(tan)).normalize();
        rim[i].ax = nn;
        rim[i].ay = new Vector3().crossVectors(tan, nn).normalize();
      }
      b.loft(rim, 8, { capStart: true, capEnd: true });
      break;
    }
    case 'helm': {
      const steel = pal.steel;
      const bright = tone(steel, 1.12);
      b.ellipsoid(head.center, head.radii.clone().addScalar(t * 0.4 + 0.016), hb, (u) => (Math.abs(u.x) < 0.06 && u.y > -0.2 ? bright : steel), {
        lat: 14,
        lon: 22,
        deform: (u) => {
          const phi = Math.atan2(u.x, u.z);
          const a = Math.abs(phi);
          const line = a < 0.8 ? 0.36 : a < 1.7 ? 0.36 - (a - 0.8) * 0.6 : -0.18 - (a - 1.7) * 0.12;
          const inside = 1 - Math.min(1, Math.max(0, (u.y - line) / 0.04));
          shapeHead(u);
          u.multiplyScalar(1 - inside * 0.25);
          // A low crest ridge front to back.
          if (inside < 0.5) u.multiplyScalar(1 + 0.05 * Math.exp(-(u.x * u.x) / 0.004) * Math.max(0, u.y));
        },
      });
      headBand(ctx, 0.36, -0.2, t + 0.022, 0.012, pal.secondary);
      // Swept wings: five feather blades fanned back from each temple.
      for (const s of [1, -1]) {
        const root = head.surface(new Vector3(s * 0.95, 0.3, -0.05), new Vector3(), t + 0.02);
        for (let i = 0; i < 5; i++) {
          const a = 0.38 + i * 0.25;
          const dir = new Vector3(s * 0.38, Math.cos(a) * 0.95, -Math.sin(a) * 1.05).normalize();
          const len = 0.17 - i * 0.022;
          const base = root.clone().addScaledVector(dir, 0.006);
          const tip = root.clone().addScaledVector(dir, len);
          b.bar(base, tip, new Vector3(s, 0.2, 0), 0.016 - i * 0.0018, 0.0035, hb, i % 2 === 0 ? bright : steel, { exp: 2.2 });
        }
        b.ellipsoid(root, new Vector3(0.02, 0.02, 0.014), hb, pal.secondary, { lat: 5, lon: 8 });
      }
      // Nasal ridge.
      const top = head.surface(new Vector3(0, 0.5, 0.86), new Vector3(), t + 0.022);
      const bot = head.surface(new Vector3(0, 0.12, 0.99), new Vector3(), 0.03);
      b.bar(top, bot, new Vector3(1, 0, 0), 0.007, 0.005, hb, steel, { exp: 3 });
      break;
    }
    case 'circlet': {
      const gold = mixSrgb(brass, new Color('#fff0b0'), 0.25);
      // Sits over the fringe at the front.
      headBand(ctx, 0.42, 0.18, t + 0.024, 0.007, gold, 0, t + 0.004);
      const c = head.surface(new Vector3(0, 0.44, 0.9), new Vector3(), t + 0.03);
      const n = c.clone().sub(head.center).normalize();
      const q = new Quaternion().setFromUnitVectors(ZV, n);
      b.ellipsoid(c, new Vector3(0.02, 0.025, 0.009), hb, gold, { rot: q, lat: 5, lon: 10 });
      b.ellipsoid(c.clone().addScaledVector(n, 0.006), new Vector3(0.015, 0.019, 0.009), hb, pal.glow, { rot: q, lat: 6, lon: 10, glow: 1.6 });
      // Little wings of gold either side of the stone.
      for (const sgn of [1, -1]) {
        const a = head.surface(new Vector3(sgn * 0.12, 0.45, 0.88), new Vector3(), t + 0.029);
        const e = head.surface(new Vector3(sgn * 0.34, 0.5, 0.82), new Vector3(), t + 0.028);
        b.bar(a, e, n, 0.005, 0.0025, hb, gold, { exp: 2 });
      }
      break;
    }
    case 'none':
    default:
      break;
  }
  void d;
}
