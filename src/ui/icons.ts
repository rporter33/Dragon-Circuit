// Inline SVG icons for the overlay. Hand-drawn paths, all `currentColor` unless they carry
// their own palette (medals), so CSS decides how they read on each surface.

import type { Medal } from '../core/types';

const s = (body: string, cls = '', vb = '0 0 24 24') =>
  `<svg class="dw-icon ${cls}" viewBox="${vb}" aria-hidden="true">${body}</svg>`;

/** A swept wing of layered primaries: the game's emblem (stamina gauge, logo, favicon). */
export const WING_PATHS =
  '<path d="M3 15.5 C6.5 9.5 12 6 21 4.5 C18.5 7 17.2 8.4 15.6 10.4 C17.4 10.1 18.6 10.1 19.8 10.4 C17.6 11.6 16.2 12.6 14.6 14.2 C15.8 14.3 16.7 14.6 17.6 15.1 C14.8 15.6 12.6 16.6 10.6 18.2 C8.6 16.6 5.8 15.8 3 15.5 Z"/>' +
  '<path d="M3 15.5 C6.4 15.1 9 16.2 10.6 18.2" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width=".6"/>';

export const ICONS = {
  wing: s(`<g fill="currentColor">${WING_PATHS}</g>`, 'dw-icon-wing'),
  feather: s(
    '<path d="M18.8 3.6 C12.6 4.4 8 9.2 6.7 15.4 L5.2 20.6 L6.4 20.9 L7.9 16.6 C13.8 15.8 18.4 11 18.8 3.6 Z" fill="currentColor"/>' +
      '<path d="M7.6 16.6 C10 12.6 12.8 9.6 16.4 6.6" fill="none" stroke="#000" stroke-opacity=".28" stroke-width=".9" stroke-linecap="round"/>',
  ),
  relic: s(
    '<path d="M12 2.6 L18.4 8.6 L12 21.4 L5.6 8.6 Z" fill="currentColor" fill-opacity=".9"/>' +
      '<path d="M5.6 8.6 H18.4 M12 2.6 L9.2 8.6 L12 21.4 L14.8 8.6 Z" fill="none" stroke="#000" stroke-opacity=".3" stroke-width=".8" stroke-linejoin="round"/>',
  ),
  unlock: s(
    '<rect x="5" y="10.5" width="14" height="10" rx="2" fill="currentColor"/>' +
      '<path d="M8.4 10.5 V7.4 C8.4 4.9 10 3.4 12.2 3.4 C14.2 3.4 15.6 4.6 16 6.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<circle cx="12" cy="15.4" r="1.6" fill="#000" fill-opacity=".35"/>',
  ),
  lock: s(
    '<rect x="5" y="10.5" width="14" height="10" rx="2" fill="currentColor"/>' +
      '<path d="M8.2 10.5 V7.6 C8.2 5.2 9.8 3.5 12 3.5 C14.2 3.5 15.8 5.2 15.8 7.6 V10.5" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<circle cx="12" cy="15.4" r="1.6" fill="#000" fill-opacity=".35"/>',
    'dw-icon-lock',
  ),
  race: s(
    '<ellipse cx="12" cy="12" rx="6.2" ry="8.8" fill="none" stroke="currentColor" stroke-width="2.4"/>' +
      '<path d="M2.5 12 H9 M15 12 H21.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="1.4 2.2"/>',
  ),
  info: s(
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 10.6 V16.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="7.6" r="1.25" fill="currentColor"/>',
  ),
  check: s('<path d="M5 12.6 L10 17.4 L19.2 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'),
  compassStar: s(
    '<path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="#000" fill-opacity=".35"/>',
  ),
  landmark: s('<path d="M12 3 L19 12 L12 21 L5 12 Z" fill="currentColor"/>'),
  home: s(
    '<path d="M4 20 V10.5 L12 4 L20 10.5 V20 H14.5 V14.5 H9.5 V20 Z" fill="currentColor"/>',
  ),
  /** Waypoint: a downward chevron pin. */
  waypoint: s('<path d="M12 21.5 L4.5 9.5 C3 6.5 6 2.5 12 2.5 C18 2.5 21 6.5 19.5 9.5 Z" fill="currentColor"/><circle cx="12" cy="8.6" r="2.6" fill="#1a120d" fill-opacity=".75"/>'),
  arrow: s('<path d="M12 2.5 L21 20.5 L12 16 L3 20.5 Z" fill="currentColor"/>'),
  clock: s('<circle cx="12" cy="12.5" r="8.4" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M12 8 V12.8 L15.2 14.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M9.6 2.6 H14.4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'),
  camera: s('<path d="M4 8 H8 L9.6 5.6 H14.4 L16 8 H20 V19 H4 Z" fill="currentColor"/><circle cx="12" cy="13.2" r="3.4" fill="#000" fill-opacity=".38"/>'),
  stall: s('<path d="M12 3 L22 20.5 H2 Z" fill="currentColor"/><path d="M12 9.5 V14.5" stroke="#1a120d" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17.6" r="1.3" fill="#1a120d"/>'),
  pip: s('<path d="M12 4 L20 12 L12 20 L4 12 Z" fill="currentColor"/>'),
  /** Sun-warmed (the Rested bonus by day): a small sun. */
  sun: s(
    '<circle cx="12" cy="12" r="4.6" fill="currentColor"/>' +
      '<path d="M12 2.6 V5.2 M12 18.8 V21.4 M2.6 12 H5.2 M18.8 12 H21.4 M5.4 5.4 L7.2 7.2 M16.8 16.8 L18.6 18.6 M5.4 18.6 L7.2 16.8 M16.8 7.2 L18.6 5.4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  ),
  /** Rested (by night): a crescent. */
  moon: s('<path d="M15.5 3.4 C10.4 4.3 7 8.6 7 13 C7 17.6 10.6 21 15.2 21 C17.2 21 19 20.3 20.4 19.2 C14.9 19.4 11.2 15.8 11.2 11.2 C11.2 7.9 12.9 5.1 15.5 3.4 Z" fill="currentColor"/>'),
};

const MEDAL_COLORS: Record<Exclude<Medal, 'none'>, [string, string, string]> = {
  gold: ['#ffe39a', '#e2a83c', '#8a5a14'],
  silver: ['#f4f4f0', '#b9c0c8', '#5d6670'],
  bronze: ['#f2c49a', '#c47a44', '#6e3a18'],
};

let medalId = 0;

/** A medal with its ribbon; 'none' draws an empty ring. */
export function medalIcon(m: Medal, cls = ''): string {
  if (m === 'none') {
    return s('<circle cx="12" cy="14" r="7" fill="none" stroke="currentColor" stroke-opacity=".45" stroke-width="1.6" stroke-dasharray="2.2 2.2"/>', `dw-medal dw-medal--none ${cls}`);
  }
  const [hi, mid, lo] = MEDAL_COLORS[m];
  const id = `dwm${medalId++}`;
  return s(
    `<defs><radialGradient id="${id}" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="${hi}"/><stop offset=".6" stop-color="${mid}"/><stop offset="1" stop-color="${lo}"/></radialGradient></defs>` +
      '<path d="M7.5 1.5 H11 L13 7.5 L10 9 Z" fill="#7a2f2a"/><path d="M16.5 1.5 H13 L11 7.5 L14 9 Z" fill="#a8473c"/>' +
      `<circle cx="12" cy="14.2" r="7.6" fill="url(#${id})" stroke="${lo}" stroke-width=".8"/>` +
      `<path d="M12 9.6 L13.3 12.6 L16.5 12.9 L14.1 15 L14.8 18.2 L12 16.5 L9.2 18.2 L9.9 15 L7.5 12.9 L10.7 12.6 Z" fill="${hi}" fill-opacity=".85"/>`,
    `dw-medal dw-medal--${m} ${cls}`,
  );
}

/**
 * Ornamental divider: hairlines either side of a diamond with two curls. The hairlines are CSS
 * (they stretch); the ornament keeps its proportions.
 */
export const RULE =
  '<div class="dw-rule" aria-hidden="true"><span></span>' +
  '<svg viewBox="0 0 48 16"><path d="M24 2.5 L29.5 8 L24 13.5 L18.5 8 Z" fill="currentColor"/>' +
  '<path d="M1 8 C7 3 12 3 15.5 8 M47 8 C41 13 36 13 32.5 8" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>' +
  '<span></span></div>';
