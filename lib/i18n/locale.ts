/**
 * TRS-3: the languages the guest-facing screens speak, and how one is chosen.
 *
 * English is the source. Spanish is the second language of Klik's US market.
 * Adding a language is a dictionary in lib/i18n/guest.ts (whose type makes a
 * missing line a compile error) and a translated consent in lib/consent.ts.
 */

export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** What a host can set per event: a language, or the guest's own. */
export const GUEST_LANGUAGES = ["auto", ...LOCALES] as const;
export type GuestLanguage = (typeof GUEST_LANGUAGES)[number];

/** The guest's own choice, from the switch at the bottom of a gallery. */
export const LOCALE_COOKIE = "klik_lang";

export const LOCALE_NAMES: Record<Locale, string> = { en: "English", es: "Español" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** The best supported language from an Accept-Language header, or null. */
export function fromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { tag: tag.toLowerCase(), q: q ? Number(q.slice(2)) || 0 : 1 };
    })
    .filter((entry) => entry.tag && entry.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return null;
}

/**
 * The guest's choice wins, then the host's, then the browser's. A host who
 * sets Spanish for a family wedding still lets one cousin read it in English.
 */
export function chooseLocale({
  cookie,
  eventLanguage,
  acceptLanguage,
}: {
  cookie?: string | null;
  eventLanguage?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (isLocale(cookie)) return cookie;
  if (isLocale(eventLanguage)) return eventLanguage;
  return fromAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}
