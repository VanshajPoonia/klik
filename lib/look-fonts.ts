import { Bodoni_Moda, Cinzel, Cormorant_Garamond, Fredoka, Pinyon_Script, Space_Grotesk } from "next/font/google";

/**
 * TPL-1: the display faces of the gallery looks (lib/gallery-templates.ts).
 *
 * Declared once, on the root element, and none of them preloaded: a browser
 * fetches a face only when something on the page is set in it, so a guest at a
 * wedding downloads Bodoni and nobody on the dashboard downloads anything until
 * the look picker draws its previews. The CSS that uses them is `.look-hero` in
 * app/globals.css.
 */

const bodoni = Bodoni_Moda({
  variable: "--font-bodoni",
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  preload: false,
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  preload: false,
});

const pinyon = Pinyon_Script({
  variable: "--font-pinyon",
  subsets: ["latin", "latin-ext"],
  weight: "400",
  preload: false,
});

const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin", "latin-ext"],
  preload: false,
});

const cinzel = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin", "latin-ext"],
  preload: false,
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin", "latin-ext"],
  preload: false,
});

export const LOOK_FONT_VARIABLES = [bodoni, cormorant, pinyon, fredoka, cinzel, spaceGrotesk]
  .map((font) => font.variable)
  .join(" ");
