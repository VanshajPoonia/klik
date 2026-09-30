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

export interface ConsentVersion {
  /** Stored on `guests.consent_version`. Date-stamped so ordering is obvious. */
  id: string;
  /** The checkbox label. This is the operative text a guest agrees to. */
  statement: string;
  /** Plain-language expansion shown beneath it. Not a substitute for LAW-1. */
  detail: string;
  effectiveFrom: string;
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
  },
];

export const CURRENT_CONSENT = CONSENT_VERSIONS[CONSENT_VERSIONS.length - 1];

/** Looks up the text a given guest actually agreed to, for support and disputes. */
export function consentVersionById(id: string | null | undefined): ConsentVersion | null {
  if (!id) return null;
  return CONSENT_VERSIONS.find((version) => version.id === id) ?? null;
}
