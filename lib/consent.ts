/**
 * The one place guest consent is defined.
 *
 * It used to live as a hard-coded string in `entry-sheet.tsx`, paraphrased
 * separately on the marketing page, and recorded in the database as a bare
 * `consented_at` timestamp. That combination cannot answer the only question
 * that matters when someone objects: **what exactly did this person agree to?**
 * A timestamp proves when they ticked a box, not what the box said, and the
 * copy could change underneath every guest who had already agreed.
 *
 * So the text is versioned here and the version is stored on the guest row.
 * Change the wording, bump the version, and old records keep pointing at the
 * terms they were actually shown.
 */

import { DEFAULT_LOCALE, isLocale, type Locale } from "./i18n/locale";

export interface ConsentVersion {
  /** Stored on `guests.consent_version`. Date-stamped so ordering is obvious. */
  id: string;
  /** The checkbox label. This is the operative text a guest agrees to. */
  statement: string;
  /** Plain-language expansion shown beneath it. Not a substitute for LAW-1. */
  detail: string;
  effectiveFrom: string;
  /**
   * TRS-3: the same agreement in other languages. A guest shown one of these
   * is recorded as `<id>:<locale>`, so the record still says exactly which
   * words they agreed to. English is the statement and detail above.
   */
  translations?: Partial<Record<Locale, { statement: string; detail: string }>>;
}

/**
 * Bump this whenever the statement changes in substance. Fixing a typo does not
 * need a new version; changing what someone is agreeing to always does.
 *
 * Kept deliberately narrow: it covers this one gallery and nothing else. It
 * does NOT cover promotional use on a venue's public page, which is why LAW-4
 * is being solved by organizer curation rather than by widening this text.
 */
export const CONSENT_VERSIONS: ConsentVersion[] = [
  {
    id: "2026-09-30",
    statement:
      "I understand that photos and videos I upload may be visible to everyone with access to this event gallery, and I have the right to share them.",
    detail:
      "Your uploads stay with this one event. You can delete anything you upload, and the host can remove it too. We do not use your photos anywhere else.",
    effectiveFrom: "2026-09-30",
    translations: {
      es: {
        statement:
          "Entiendo que las fotos y videos que suba pueden ser visibles para todas las personas con acceso a la galería de este evento, y que tengo derecho a compartirlos.",
        detail:
          "Lo que subes se queda en este evento. Puedes borrar todo lo que subas, y el anfitrión también puede quitarlo. No usamos tus fotos en ningún otro lugar.",
      },
    },
  },
];

export const CURRENT_CONSENT = CONSENT_VERSIONS[CONSENT_VERSIONS.length - 1];

/** The words of a version in a language, falling back to English. */
export function consentText(version: ConsentVersion, locale: Locale): { statement: string; detail: string } {
  return (locale !== DEFAULT_LOCALE && version.translations?.[locale]) || { statement: version.statement, detail: version.detail };
}

/** What is stored on the guest: the version, and the language when not English. */
export function consentRecordId(locale: Locale, version: ConsentVersion = CURRENT_CONSENT): string {
  return locale === DEFAULT_LOCALE || !version.translations?.[locale] ? version.id : `${version.id}:${locale}`;
}

/** Looks up the text a given guest actually agreed to, for support and disputes. */
export function consentVersionById(id: string | null | undefined): ConsentVersion | null {
  if (!id) return null;
  const [versionId] = id.split(":");
  return CONSENT_VERSIONS.find((version) => version.id === versionId) ?? null;
}

/** The exact words behind a stored consent id, in the language that was shown. */
export function consentShown(id: string | null | undefined): { statement: string; detail: string; locale: Locale } | null {
  const version = consentVersionById(id);
  if (!version || !id) return null;
  const suffix = id.split(":")[1];
  const locale = isLocale(suffix) ? suffix : DEFAULT_LOCALE;
  return { ...consentText(version, locale), locale };
}
