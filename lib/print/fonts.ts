/**
 * QR-4c: the typefaces a design can use. A short list on purpose: each one is
 * downloaded by the studio, and a printed sign needs a good choice more than a
 * long one. Two are the site's own (Fraunces and Geist, loaded on every page);
 * the rest are loaded by the studio's layout through `next/font`, which serves
 * them from this site rather than from Google, so the browser that exports a
 * design draws exactly the type it showed.
 *
 * A design stores the key, never a family name: `next/font` names its families
 * with a build hash, which changes between deployments.
 */

export interface PrintFont {
  key: string;
  label: string;
  /** The CSS variable that holds the family on the studio's pages. */
  cssVar: string;
  fallback: string;
  weights: number[];
  italic: boolean;
  /** How the list groups it. */
  kind: "serif" | "sans" | "display" | "script";
}

export const PRINT_FONTS: PrintFont[] = [
  { key: "fraunces", label: "Fraunces", cssVar: "--font-fraunces", fallback: "Georgia, serif", weights: [400, 500, 600, 700], italic: true, kind: "serif" },
  { key: "geist", label: "Geist", cssVar: "--font-geist-sans", fallback: "Arial, sans-serif", weights: [400, 500, 600, 700, 800], italic: false, kind: "sans" },
  { key: "playfair", label: "Playfair Display", cssVar: "--font-print-playfair", fallback: "Georgia, serif", weights: [400, 500, 600, 700, 800], italic: true, kind: "serif" },
  { key: "cormorant", label: "Cormorant Garamond", cssVar: "--font-print-cormorant", fallback: "Georgia, serif", weights: [400, 500, 600, 700], italic: true, kind: "serif" },
  { key: "montserrat", label: "Montserrat", cssVar: "--font-print-montserrat", fallback: "Arial, sans-serif", weights: [400, 500, 600, 700, 800], italic: false, kind: "sans" },
  { key: "bebas", label: "Bebas Neue", cssVar: "--font-print-bebas", fallback: "Impact, sans-serif", weights: [400], italic: false, kind: "display" },
  { key: "greatvibes", label: "Great Vibes", cssVar: "--font-print-greatvibes", fallback: "cursive", weights: [400], italic: false, kind: "script" },
  { key: "caveat", label: "Caveat", cssVar: "--font-print-caveat", fallback: "cursive", weights: [400, 500, 600, 700], italic: false, kind: "script" },
];

export const PRINT_FONT_KEYS = PRINT_FONTS.map((font) => font.key) as [string, ...string[]];

export const DEFAULT_FONT_KEY = "geist";

export function findFont(key: string): PrintFont {
  return PRINT_FONTS.find((font) => font.key === key) ?? PRINT_FONTS.find((font) => font.key === DEFAULT_FONT_KEY)!;
}

/** The nearest weight a font has, so a heading switched to Bebas still draws. */
export function nearestWeight(font: PrintFont, weight: number): number {
  return font.weights.reduce((best, candidate) =>
    Math.abs(candidate - weight) < Math.abs(best - weight) ? candidate : best,
  );
}

/** Points to millimetres: type is sized in points everywhere in print. */
export const MM_PER_POINT = 25.4 / 72;
