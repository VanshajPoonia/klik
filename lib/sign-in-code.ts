import { randomInt } from "node:crypto";
import { sendEmail } from "./email";
import { noticeEmail } from "./emails/notice";

/**
 * ACC-2: sign in with a code typed into the tab you are already in.
 *
 * A guest at a wedding who wants to keep the gallery should not have to invent
 * a password, and a magic link opens in whatever browser the mail app chooses,
 * which on a phone is often not the one holding their gallery. So the email
 * carries six digits, and the link as well for anyone who prefers it.
 *
 * Six digits is a small space, which is why the minutes are few and the
 * guesses are counted: see `SIGN_IN_CODE_ATTEMPTS` and the wrapper in
 * app/api/auth/[...nextauth]/route.ts.
 */

export const SIGN_IN_CODE_MINUTES = 10;
/** Wrong codes allowed per address per window, across every code sent to it. */
export const SIGN_IN_CODE_ATTEMPTS = 5;
export const SIGN_IN_CODE_WINDOW_SECONDS = 15 * 60;

export function generateSignInCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * The address the way Auth.js stores it, so a limit keyed on it cannot be
 * stepped around by changing case or adding a trailing comma.
 */
export function normalizeSignInEmail(value: string): string {
  // The same steps as Auth.js's default normalizer, NFKC first.
  const [local = "", domain = ""] = value.normalize("NFKC").toLowerCase().trim().split("@");
  return `${local}@${domain.split(",")[0]}`;
}

export async function sendSignInCode({ to, code, url }: { to: string; code: string; url: string }) {
  const message = noticeEmail({
    subject: `${code} is your Klik code`,
    heading: "Your sign-in code",
    paragraphs: [`Type this code where you asked for it. It works for ${SIGN_IN_CODE_MINUTES} minutes, once.`],
    code,
    cta: { label: "Or sign in with this link", url },
    footer: "Sent because someone asked to sign in to Klik with this address. If it was not you, ignore it: nobody can sign in without the code.",
  });
  const result = await sendEmail({ ...message, to });
  // Auth.js reports a throw as "could not send", which is the truth; returning
  // quietly would tell the person to check an inbox nothing is arriving in.
  if (!result.sent) throw new Error("sign-in code email was not sent");
}
