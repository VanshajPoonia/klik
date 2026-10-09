import { Bebas_Neue, Caveat, Cormorant_Garamond, Great_Vibes, Montserrat, Playfair_Display } from "next/font/google";

/**
 * QR-4c: the print studio's extra typefaces, served from this site by
 * `next/font` and loaded only on the studio's pages. Fraunces and Geist come
 * from the root layout. The variables match `lib/print/fonts.ts`.
 */
const playfair = Playfair_Display({ subsets: ["latin"], variable: "--font-print-playfair", style: ["normal", "italic"] });
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-print-cormorant",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});
const montserrat = Montserrat({ subsets: ["latin"], variable: "--font-print-montserrat" });
const bebas = Bebas_Neue({ subsets: ["latin"], variable: "--font-print-bebas", weight: "400" });
const greatVibes = Great_Vibes({ subsets: ["latin"], variable: "--font-print-greatvibes", weight: "400" });
const caveat = Caveat({ subsets: ["latin"], variable: "--font-print-caveat" });

export const printFontVariables = [playfair, cormorant, montserrat, bebas, greatVibes, caveat]
  .map((font) => font.variable)
  .join(" ");
