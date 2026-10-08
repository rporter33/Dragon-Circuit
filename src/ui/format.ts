// Number and time formatting for the HUD and menus. Pure, so it is unit-tested.

import type { Medal } from '../core/types';

const MINUS = '−';

/** Race time: m:ss.cc (hundredths). Negative or non-finite values read as 0. */
export function formatTime(ms: number): string {
  const t = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 10) : 0; // hundredths
  const cs = t % 100;
  const s = Math.floor(t / 100) % 60;
  const m = Math.floor(t / 6000);
  return `${m}:${s < 10 ? '0' : ''}${s}.${cs < 10 ? '0' : ''}${cs}`;
}

/** Split delta against the best run: "−0.42" when ahead, "+1.07" when behind, seconds. */
export function formatDelta(ms: number): string {
  const sign = ms < 0 ? MINUS : '+';
  const a = Math.abs(ms) / 1000;
  if (a >= 60) return sign + formatTime(Math.abs(ms));
  return sign + a.toFixed(2);
}

/** Whole km/h from m/s. */
export function kmh(ms: number): number {
  return Math.max(0, Math.round(ms * 3.6));
}

/** Distances: "85 m", "1.2 km". */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return '';
  if (m < 995) return `${Math.max(0, Math.round(m / 5) * 5)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

/** Play time: "3 h 12 min", "12 min", "< 1 min". */
export function formatPlayTime(seconds: number): string {
  const min = Math.floor(seconds / 60);
  if (min < 1) return '< 1 min';
  const hr = Math.floor(min / 60);
  return hr > 0 ? `${hr} h ${min % 60} min` : `${min} min`;
}

export const MEDAL_RANK: Record<Medal, number> = { none: 0, bronze: 1, silver: 2, gold: 3 };

export function medalName(m: Medal): string {
  return m === 'none' ? 'No medal' : m[0].toUpperCase() + m.slice(1);
}

/** Medal a time earns against a race's targets. */
export function medalFor(ms: number, targets: { gold: number; silver: number; bronze: number }): Medal {
  if (ms <= targets.gold) return 'gold';
  if (ms <= targets.silver) return 'silver';
  if (ms <= targets.bronze) return 'bronze';
  return 'none';
}

/** "roost-loop" → "Roost Loop" (fallback names for ids nothing else names). */
export function titleCase(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/** Percent label for a 0..1 value. */
export function percent(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** "Dawn", "Morning", ... for a 0..1 time of day (0 = midnight). */
export function timeOfDayName(t: number): string {
  const d = ((t % 1) + 1) % 1;
  if (d < 0.2) return 'Night';
  if (d < 0.3) return 'Dawn';
  if (d < 0.45) return 'Morning';
  if (d < 0.56) return 'Midday';
  if (d < 0.68) return 'Afternoon';
  if (d < 0.79) return 'Dusk';
  return 'Night';
}

const WEATHER_NAMES: Record<string, string> = {
  clear: 'Clear skies',
  breezy: 'Breezy',
  overcast: 'Overcast',
  mist: 'Mist',
  rain: 'Rain',
};

export function weatherName(kind: string): string {
  return WEATHER_NAMES[kind] ?? titleCase(kind);
}

/** Eight-way compass word for a heading in radians clockwise from north. */
export function compassWord(heading: number): string {
  const words = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const i = Math.round((((heading / (Math.PI * 2)) % 1) + 1) % 1 * 8) % 8;
  return words[i];
}
