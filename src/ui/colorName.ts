// A painterly name for a swatch ("Deep moss", "Pale gold", "Slate") so the Stable can say what
// you are looking at. Pure, unit-tested.

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}

const HUES: [number, string][] = [
  [12, 'crimson'],
  [32, 'rust'],
  [48, 'ochre'],
  [64, 'gold'],
  [90, 'olive'],
  [150, 'moss'],
  [185, 'teal'],
  [205, 'sky'],
  [245, 'blue'],
  [280, 'indigo'],
  [320, 'plum'],
  [345, 'rose'],
  [360, 'crimson'],
];

function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

export function colorName(hex: string): string {
  const { h, s, l } = hexToHsl(hex);
  if (s < 0.14 || (s < 0.22 && (l < 0.2 || l > 0.85))) {
    if (l < 0.2) return 'Charcoal';
    if (l < 0.4) return 'Slate';
    if (l < 0.62) return 'Ash';
    if (l < 0.84) return 'Bone';
    return 'Ivory';
  }
  // Warm, light and not very saturated reads as cream / sand rather than "pale ochre".
  if (h >= 20 && h < 60 && l > 0.7) return s > 0.5 ? 'Cream' : 'Sand';
  let base = 'crimson';
  for (const [limit, name] of HUES) {
    if (h < limit) {
      base = name;
      break;
    }
  }
  const tone = l < 0.3 ? 'Deep ' : l > 0.7 ? 'Pale ' : s < 0.35 ? 'Dusty ' : '';
  return tone ? tone + base : cap(base);
}
