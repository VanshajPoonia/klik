import { z } from "zod";
import { WATERMARK_POSITIONS } from "./schema";

/**
 * MED-10: what a photographer can set about their watermark, checked the same
 * way by the account page and the route that saves it.
 */

export const WATERMARK_LIMITS = {
  label: 80,
  buyNote: 240,
  buyUrl: 300,
  stampBytes: 2 * 1024 * 1024,
  logoBytes: 4 * 1024 * 1024,
  stampMaxSide: 2400,
  logoMaxSide: 800,
} as const;

const EMAIL = /^[^@\s/:]+@[^@\s/]+\.[^@\s/]+$/;

/**
 * Where "get the clean photo" leads: a web page, or an email address. A bare
 * address becomes a mailto link. Anything else, including plain http, is
 * refused, because the link is shown on a stranger's photo and must not be a
 * way to send people somewhere unsafe.
 */
export function normalizeBuyUrl(raw: string | null | undefined): { ok: true; url: string | null } | { ok: false } {
  const value = raw?.trim() ?? "";
  if (!value) return { ok: true, url: null };
  if (value.length > WATERMARK_LIMITS.buyUrl) return { ok: false };
  if (EMAIL.test(value)) return { ok: true, url: `mailto:${value}` };
  if (value.startsWith("mailto:")) return EMAIL.test(value.slice(7)) ? { ok: true, url: value } : { ok: false };
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.includes(".") ? { ok: true, url: url.toString() } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export const watermarkSettingsSchema = z.object({
  label: z.string().trim().min(1, "Write the words for your watermark.").max(WATERMARK_LIMITS.label),
  font: z.enum(["sans", "serif"]).default("sans"),
  position: z.enum(WATERMARK_POSITIONS),
  opacity: z.number().min(0.1).max(0.9),
  scale: z.number().min(0.1).max(0.6),
  buyNote: z.string().trim().max(WATERMARK_LIMITS.buyNote).nullable().optional(),
  buyUrl: z.string().trim().max(WATERMARK_LIMITS.buyUrl).nullable().optional(),
  /** What to do with the logo kept from last time. */
  logo: z.enum(["keep", "replace", "remove"]).default("keep"),
});

export type WatermarkSettings = z.infer<typeof watermarkSettingsSchema>;

/** The account page's view of a saved watermark. */
export type WatermarkProfile = {
  label: string;
  font: "sans" | "serif";
  position: (typeof WATERMARK_POSITIONS)[number];
  opacity: number;
  scale: number;
  buyNote: string | null;
  buyUrl: string | null;
  stampUrl: string;
  stampWidth: number;
  stampHeight: number;
  /** Same-origin, so the account page can draw it into a canvas again. */
  logoUrl: string | null;
};
