import { eq } from "drizzle-orm";
import { db } from "./db";
import { users } from "./schema";
import { sendEmail } from "./email";
import { activationEmail } from "./emails/activation";
import { getAppUrl } from "./env";
import { getPlan } from "./plans";
import type { PlanKey } from "./plans";
import { log, reportError } from "./observability";

/**
 * Telling somebody their access is open, and recording that we did.
 *
 * One function for both callers on purpose. Activation sends this
 * automatically, and /admin can send it again when somebody says it never
 * arrived; those two must produce the same email and write the same column, or
 * the resend becomes a slightly different mail that cannot be compared with the
 * one that went missing.
 *
 * Reports its outcome rather than throwing, like `sendEmail` and for the same
 * reason: the grant is the valuable part and must survive a mail provider having
 * a bad afternoon. Nothing here is allowed to roll back an activation.
 */

export type ActivationNoticeResult =
  | { sent: true }
  /** No address on file. An /admin/new account can have a username and no email. */
  | { sent: false; reason: "no_email" }
  /** Email is not configured, or the provider refused it. See `sendEmail`. */
  | { sent: false; reason: "not_configured" | "rejected" }
  /** An unexpected throw, already reported. */
  | { sent: false; reason: "failed" };

export async function sendActivationNotice(account: {
  id: string;
  name: string | null;
  email: string | null;
  username: string | null;
  planKey: PlanKey;
}): Promise<ActivationNoticeResult> {
  if (!account.email) {
    // Not an error, and not silent either. A venue set up by hand at /admin/new
    // may genuinely have no address, and the superadmin needs to see that this
    // is the reason nothing was sent rather than assuming it worked.
    log.warn("activation.no_email", { userId: account.id });
    return { sent: false, reason: "no_email" };
  }

  try {
    const message = activationEmail({
      name: account.name,
      planName: getPlan(account.planKey).name,
      username: account.username,
      appUrl: getAppUrl(),
    });
    const result = await sendEmail({ ...message, to: account.email });

    if (!result.sent) return { sent: false, reason: result.reason };

    // Stamped only on a send the provider accepted. A timestamp written
    // optimistically would answer "did we tell them" with a yes that is worth
    // nothing, which is worse than the null it replaced.
    await db
      .update(users)
      .set({ activationEmailSentAt: new Date() })
      .where(eq(users.id, account.id));

    log.info("activation.email_sent", { userId: account.id, planKey: account.planKey });
    return { sent: true };
  } catch (error) {
    reportError("activation.email_failed", error, { userId: account.id });
    return { sent: false, reason: "failed" };
  }
}

/** One sentence per outcome, written for the superadmin reading it on /admin. */
export function describeActivationNotice(result: ActivationNoticeResult): string {
  if (result.sent) return "Access email sent.";
  switch (result.reason) {
    case "no_email":
      return "Activated, but no email on file to notify. Call them instead.";
    case "not_configured":
      return "Activated. Email is not configured on this deployment, so nothing was sent.";
    case "rejected":
      return "Activated, but the email was refused. Check the address and send it again.";
    case "failed":
      return "Activated, but sending the email failed. Try sending it again.";
  }
}
