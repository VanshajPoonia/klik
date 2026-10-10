import { nanoid } from "nanoid";
import type { Session } from "next-auth";
import { db } from "./db";
import { auditLog } from "./schema";
import { reportError } from "./observability";

/**
 * ADM-4: records who did something that changed access, money or data.
 *
 * Never throws, for the same reason as `recordAccountEvent`: the action being
 * recorded already happened, and losing its log line is a worse history while
 * failing the action over it would be a broken product. A failure is reported,
 * so a log that has stopped writing does not go unnoticed.
 *
 * What it is for: answering "who deleted this?", "who comped that account?",
 * and, in a breach (LAW-5), what was touched and by whom.
 */
export type AuditAction =
  | "plan.granted"
  | "plan.revoked"
  | "report.resolved"
  | "account.erased"
  | "account.password_reset"
  | "event.deleted"
  | "event.restored"
  | "event.erased"
  | "event.address_changed"
  | "event.went_live"
  | "media.deleted"
  | "media.bulk"
  | "team.changed"
  | "event.transfer_offered"
  | "event.transfer_withdrawn"
  | "event.transferred"
  | "comment.hidden"
  | "comment.shown"
  | "kiosk.created"
  | "kiosk.revoked"
  | "proofs.released";

export async function recordAudit(entry: {
  actor: Pick<Session, "user"> | { user: { id: string; username?: string | null; name?: string | null } } | null;
  action: AuditAction;
  targetType: "user" | "event" | "media" | "entitlement" | "report" | "comment" | "kiosk";
  targetId?: string | null;
  eventId?: string | null;
  detail?: string | null;
}): Promise<void> {
  try {
    const user = entry.actor?.user as { id?: string; username?: string | null; name?: string | null } | undefined;
    await db.insert(auditLog).values({
      id: `aud_${nanoid()}`,
      actorUserId: user?.id ?? null,
      actorLabel: user?.username ?? user?.name ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      eventId: entry.eventId ?? null,
      detail: entry.detail?.slice(0, 500) ?? null,
    });
  } catch (error) {
    reportError("audit.write_failed", error, { action: entry.action });
  }
}
