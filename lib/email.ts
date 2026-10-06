import { Resend } from "resend";
import { env } from "./env";
import { log, reportError } from "./observability";

/**
 * Transactional email, through the Resend account that already backs sign-in
 * links.
 *
 * Reuses `AUTH_RESEND_KEY` and `AUTH_EMAIL_FROM` rather than adding a second
 * pair of variables for the same account and the same verified domain. A
 * separate key would be one more thing to set, one more thing to rotate, and a
 * new way for sign-in email to work while onboarding email quietly does not.
 *
 * **Absent configuration is a normal state, not an error.** Neither variable is
 * set today, which is why `send` reports what it did instead of throwing: the
 * only caller is signup, and an account must still be created when the welcome
 * email cannot go out. Losing the email is a bad morning. Losing the account
 * someone just paid to create is a refund.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  /**
   * Required, not optional. A mail with no text part scores worse in every spam
   * filter that looks, and an HTML-only welcome mail is an invisible welcome
   * mail.
   */
  text: string;
};

export type SendResult =
  | { sent: true; id: string | null }
  | { sent: false; reason: "not_configured" | "rejected" };

/**
 * A single client, built on first use.
 *
 * Not at module load: `lib/email.ts` is imported by a route that renders fine
 * without mail configured, and constructing a client with no key at import time
 * would move a missing-variable failure into the module graph of pages that do
 * not send anything.
 */
let client: Resend | null = null;
function getClient(apiKey: string): Resend {
  client ??= new Resend(apiKey);
  return client;
}

/**
 * The sender address, or null when email is not configured.
 *
 * Resend refuses any domain not verified in the account, so this deliberately
 * has no default. A fallback would turn "nobody set the sender" into "every send
 * is rejected by the provider", and the second failure is much harder to read
 * than the first.
 */
function sender(): string | null {
  return env.AUTH_EMAIL_FROM ?? null;
}

export function isEmailConfigured(): boolean {
  return Boolean(env.AUTH_RESEND_KEY && sender());
}

export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  const apiKey = env.AUTH_RESEND_KEY;
  const from = sender();
  if (!apiKey || !from) {
    // Named rather than silent. Without this line, the first report that the
    // welcome email never arrived begins with half an hour of wondering whether
    // the code runs at all.
    log.warn("email.not_configured", { subject: message.subject });
    return { sent: false, reason: "not_configured" };
  }

  try {
    const response = await getClient(apiKey).emails.send({
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    // Resend answers with `{ data, error }` rather than throwing on a rejected
    // send, so an unverified domain or a suppressed address arrives here as a
    // perfectly resolved promise carrying a failure.
    if (response.error) {
      reportError("email.rejected", response.error, { subject: message.subject });
      return { sent: false, reason: "rejected" };
    }

    log.info("email.sent", { subject: message.subject, id: response.data?.id });
    return { sent: true, id: response.data?.id ?? null };
  } catch (error) {
    reportError("email.send_failed", error, { subject: message.subject });
    return { sent: false, reason: "rejected" };
  }
}
