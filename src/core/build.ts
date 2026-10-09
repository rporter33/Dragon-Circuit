// Which build this is: the commit and when it was built, baked in by vite.config.ts (`define`).
// Shown in the pause menu so a player can tell whether they're on the latest release.

declare const __DW_BUILD__: { sha: string; time: string } | undefined;

export interface BuildInfo {
  /** Short commit hash, or 'dev' when unknown. */
  sha: string;
  /** ISO time of the build, or '' when unknown. */
  time: string;
}

export const BUILD: BuildInfo = typeof __DW_BUILD__ !== 'undefined' && __DW_BUILD__ ? __DW_BUILD__ : { sha: 'dev', time: '' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Build 1b815b7 · 9 Oct 2026, 01:41 UTC" (UTC, so every player reads the same stamp). */
export function buildLabel(b: BuildInfo = BUILD): string {
  const d = b.time ? new Date(b.time) : null;
  if (!d || Number.isNaN(d.getTime())) return `Build ${b.sha}`;
  const two = (n: number) => String(n).padStart(2, '0');
  return `Build ${b.sha} · ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
}
