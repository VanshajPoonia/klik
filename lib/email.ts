import { sql } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "./db";
import { env } from "./env";
import { log, reportError } from "./observability";
import { consume } from "./ratelimit";
import { rateLimits } from "./schema";

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
  /** GRW-1: `List-Unsubscribe` and its one-click partner, for mail that offers one. */
  headers?: Record<string, string>;
};

export type SendResult =
  | { sent: true; id: string | null }
  | { sent: false; reason: "not_configured" | "rejected" | "daily_limit" };

/**
 * Klik's own cap on emails a day, counted in the database so every function
 * instance shares it.
 *
 * Resend's free plan stops at 100 a day and resets at midnight UTC, and what
 * happens past it is Resend's choice, not ours. Stopping at 80 keeps the
 * decision here and leaves 20 spare for anything Resend counts that Klik does
 * not see.
 */
export const EMAIL_DAILY_LIMIT = 80;
/**
 * Bulk mail (the morning-after recaps) stops here, so the last 20 of the day
 * are kept for sign-in codes and other one-to-one mail. A wedding's recaps
 * must never be the reason a guest cannot sign in.
 */
export const BULK_EMAIL_DAILY_LIMIT = 60;

/** The UTC day Resend counts in, as `YYYY-MM-DD`. */
function emailDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** How long until the daily count starts again, with a few minutes' margin. */
export function untilEmailDayResets(now = new Date()): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return midnight - now.getTime() + 5 * 60 * 1000;
}

/**
 * Counts one send against today, unless today has reached `limit`.
 *
 * One statement, so two sends racing for the last place cannot both get it:
 * the conditional update takes the row lock and only one increment passes the
 * `WHERE`. A refused increment returns no row. The key carries the date, so a
 * new day is a new row, and the purge cron's `pruneRateLimits` clears old ones.
 */
async function claimDailySend(limit: number): Promise<boolean> {
  const rows = await db
    .insert(rateLimits)
    .values({ key: `email:day:${emailDay()}`, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: { count: sql`${rateLimits.count} + 1` },
      setWhere: sql`${rateLimits.count} < ${limit}`,
    })
    .returning({ count: rateLimits.count });
  return rows.length > 0;
}

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

/**
 * `bulk` is for mail sent to many people at once (the recaps), which gives way
 * to one-to-one mail as the day's limit nears. See `BULK_EMAIL_DAILY_LIMIT`.
 */
export async function sendEmail(message: EmailMessage, options: { bulk?: boolean } = {}): Promise<SendResult> {
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
    const limit = options.bulk ? BULK_EMAIL_DAILY_LIMIT : EMAIL_DAILY_LIMIT;
    if (!(await claimDailySend(limit))) {
      log.warn("email.daily_limit", { limit, bulk: Boolean(options.bulk) });
      // Once a day per limit is enough to know; every refusal after it says the
      // same. Reaching the bulk limit still leaves room for the alert email.
      const first = await consume(`email:limit-reported:${emailDay()}:${limit}`, 1, 2 * 24 * 60 * 60);
      if (first.allowed) {
        reportError("email.daily_limit", new Error(`Klik's limit of ${limit} emails today was reached. The rest wait for midnight UTC.`), {
          limit,
        });
      }
      return { sent: false, reason: "daily_limit" };
    }

    const response = await getClient(apiKey).emails.send({
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.headers ? { headers: message.headers } : {}),
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
