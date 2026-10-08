import { eq } from "drizzle-orm";
import { db } from "./db";
import { users } from "./schema";
import { sendEmail } from "./email";
import { activationEmail } from "./emails/activation";
import { eventLiveEmail } from "./emails/event-live";
import { getAppUrl } from "./env";
import { getPlan } from "./plans";
import type { PlanKey } from "./plans";
import { log, reportError } from "./observability";
import { recordAccountEvent } from "./timeline";

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

export async function sendActivationNotice(
  account: {
    id: string;
    name: string | null;
    email: string | null;
    username: string | null;
    planKey: PlanKey;
    /** A draft this grant just put live, named in place of "create your event". */
    liveEventName?: string | null;
  },
  /**
   * Who triggered it, recorded against the history entry. Omitted when nobody
   * did it by hand, which today never happens: both callers are a superadmin.
   */
  actor?: { id: string; label: string | null } | null,
): Promise<ActivationNoticeResult> {
  if (!account.email) {
    // Not an error, and not silent either. A venue set up by hand at /admin/new
    // may genuinely have no address, and the superadmin needs to see that this
    // is the reason nothing was sent rather than assuming it worked.
    log.warn("activation.no_email", { userId: account.id });
    await recordAccountEvent({
      userId: account.id,
      kind: "activation_email_failed",
      detail: "No email address on file, so nothing was sent.",
      actor,
    });
    return { sent: false, reason: "no_email" };
  }

  try {
    const message = activationEmail({
      name: account.name,
      planName: getPlan(account.planKey).name,
      username: account.username,
      appUrl: getAppUrl(),
      liveEventName: account.liveEventName ?? null,
    });
    const result = await sendEmail({ ...message, to: account.email });

    if (!result.sent) {
      // A failure is the entry most worth having. The success leaves a column
      // behind it; a refusal at 2am currently leaves nothing at all, and that is
      // the case somebody rings up about.
      await recordAccountEvent({
        userId: account.id,
        kind: "activation_email_failed",
        detail:
          result.reason === "not_configured"
            ? "Email is not configured on this deployment."
            : `The provider refused the send to ${account.email}.`,
        actor,
      });
      return { sent: false, reason: result.reason };
    }

    // Stamped only on a send the provider accepted. A timestamp written
    // optimistically would answer "did we tell them" with a yes that is worth
    // nothing, which is worse than the null it replaced.
    await db
      .update(users)
      .set({ activationEmailSentAt: new Date() })
      .where(eq(users.id, account.id));

    await recordAccountEvent({
      userId: account.id,
      kind: "activation_email_sent",
      detail: `Sent to ${account.email}.`,
      actor,
    });

    log.info("activation.email_sent", { userId: account.id, planKey: account.planKey });
    return { sent: true };
  } catch (error) {
    reportError("activation.email_failed", error, { userId: account.id });
    await recordAccountEvent({
      userId: account.id,
      kind: "activation_email_failed",
      detail: "Sending failed unexpectedly.",
      actor,
    });
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

/**
 * Tells an organizer that one specific event went live, when the account was
 * already active and so gets no access email (ACT-3). Never throws, like the
 * access email: a grant that happened must not be undone by a failed send, and
 * the outcome lands in the account history either way.
 */
export async function sendEventLiveNotice(
  account: { id: string; name: string | null; email: string | null },
  event: { id: string; name: string; planKey: PlanKey },
  actor?: { id: string; label: string | null } | null,
): Promise<{ sent: boolean }> {
  if (!account.email) return { sent: false };
  try {
    const appUrl = getAppUrl();
    const message = eventLiveEmail({
      name: account.name,
      eventName: event.name,
      planName: getPlan(event.planKey).name,
      eventUrl: `${appUrl}/dashboard/events/${event.id}`,
      appUrl,
    });
    const result = await sendEmail({ ...message, to: account.email });
    await recordAccountEvent({
      userId: account.id,
      kind: result.sent ? "activation_email_sent" : "activation_email_failed",
      detail: result.sent
        ? `Told them "${event.name}" is live.`
        : `Could not tell them "${event.name}" is live: ${result.reason}.`,
      actor,
    });
    return { sent: result.sent };
  } catch (error) {
    reportError("activation.event_live_email_failed", error, { userId: account.id });
    return { sent: false };
  }
}
