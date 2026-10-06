/**
 * How someone reaches a human, in one place.
 *
 * This number appears on the pricing dialog before anyone pays, in the
 * onboarding email, and on every organizer dashboard. Three copies of a phone
 * number in three files is three chances for one of them to still be the old
 * number a year from now, and the one that is wrong will be the one a customer
 * actually dials.
 */
export const SUPPORT_PHONE = "+1 314 756 1100";

/** `tel:` wants no spaces. Splitting these means the display form can be made readable. */
export const SUPPORT_PHONE_HREF = "tel:+13147561100";

/**
 * The outer bound on how long someone waits between paying and their kit being
 * ready, in hours.
 *
 * Said out loud before they pay, not after. The gap is real, because a plan is
 * granted by a person rather than by the webhook (BILLING.md, "The grant is
 * manual"), and somebody who was not told reads a blank dashboard as a failed
 * payment and asks for their money back.
 *
 * **Phrase this as "within", never "about".** It is a ceiling a human has to
 * beat, not an estimate to land on: most grants will take minutes, and the
 * number exists so that the slowest one is still a promise kept. Was 5 minutes
 * until 2026-10-06, which left no room for the grant to be manual at all.
 */
export const KIT_WAIT_HOURS = 24;
