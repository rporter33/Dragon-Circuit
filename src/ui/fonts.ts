// Bundled faces (no CDN): Cinzel for display — the logotype, headings, menu items — and
// Alegreya Sans for body text and numerals. Latin subsets only, to keep the build small.

import '@fontsource/cinzel/latin-500.css';
import '@fontsource/cinzel/latin-600.css';
import '@fontsource/cinzel/latin-700.css';
import '@fontsource/alegreya-sans/latin-400.css';
import '@fontsource/alegreya-sans/latin-400-italic.css';
import '@fontsource/alegreya-sans/latin-500.css';
import '@fontsource/alegreya-sans/latin-700.css';
import '@fontsource/alegreya-sans/latin-800.css';

/** Ask for the faces up front so the title never flashes a fallback font. */
export function preloadFonts(): void {
  if (typeof document === 'undefined' || !document.fonts) return;
  for (const f of ['600 32px Cinzel', '700 32px Cinzel', '500 16px Cinzel', '400 16px "Alegreya Sans"', 'italic 400 16px "Alegreya Sans"', '700 16px "Alegreya Sans"', '800 16px "Alegreya Sans"']) {
    document.fonts.load(f).catch(() => {});
  }
}
