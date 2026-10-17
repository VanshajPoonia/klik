import type { CSSProperties } from "react";
import { galleryPalette } from "@/lib/color";
import { KLIK_COLORS } from "@/lib/gallery-templates";

/**
 * The design tokens a gallery's own colours replace, each held to WCAG AA
 * against the chosen background (lib/color.ts). Shared by the gallery and the
 * entry sheet in front of it, so a guest does not step from Klik's black into
 * the event's colours one tap after arriving.
 */
export function galleryContentTheme(accent: string, background: string): CSSProperties {
  const palette = galleryPalette(accent, background);
  const custom = background.toLowerCase() !== KLIK_COLORS.background;
  const blendToward = palette.light ? "black" : "white";
  return {
    // Native controls (a checkbox, a date picker) drawn for the background they
    // sit on: on a white gallery, an unticked dark box reads as ticked.
    colorScheme: palette.light ? "light" : "dark",
    ["--color-volt" as string]: palette.volt,
    ["--color-on-volt" as string]: palette.onVolt,
    ...(custom
      ? {
          ["--color-paper" as string]: palette.paper,
          ["--color-muted" as string]: palette.muted,
          ["--color-canvas-raised" as string]: `color-mix(in srgb, ${background} 94%, ${blendToward})`,
          ["--color-canvas-line" as string]: `color-mix(in srgb, ${background} 84%, ${blendToward})`,
        }
      : {}),
  };
}
