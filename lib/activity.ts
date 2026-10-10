import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "./db";
import { auditLog, eventCoHosts, events, users } from "./schema";
import type { AuditAction } from "./audit";

/**
 * ORG-4: what the team has done to an event, for the team.
 *
 * Read from the same audit log ADM-4 keeps, through an allowlist. The log also
 * holds what Klik did, with Klik's reasons: a grant's note, a report's
 * resolution. Those are not the organizer's to read, so they are left out here
 * rather than filtered by whoever renders the list.
 */

const TEAM_VISIBLE = [
  "event.went_live",
  "event.address_changed",
  "event.deleted",
  "event.restored",
  "media.deleted",
  "media.bulk",
  "team.changed",
  "event.transfer_offered",
  "event.transfer_withdrawn",
  "event.transferred",
  "comment.hidden",
  "comment.shown",
  "kiosk.created",
  "kiosk.revoked",
  "proofs.released",
] as const satisfies readonly AuditAction[];

export interface ActivityEntry {
  id: string;
  at: string;
  who: string;
  what: string;
}

const BULK_VERBS: Record<string, string> = {
  approve: "approved",
  reject: "rejected",
  delete: "deleted",
  restore: "restored",
  move: "moved",
};

function plural(count: number) {
  return count === 1 ? "1 photo or video" : `${count} photos and videos`;
}

/**
 * One line of the feed. Pure, so the wording can be tested without a database.
 * `targetName` is the person a team change was about, when there was one.
 */
export function describeActivity(
  entry: { action: string; detail: string | null },
  targetName: string | null,
): string {
  const detail = entry.detail ?? "";
  switch (entry.action) {
    case "event.went_live":
      return "put the event live";
    case "event.address_changed":
      return `changed the gallery address. ${detail}`.trim();
    case "event.deleted":
      return "deleted the event";
    case "event.restored":
      return "restored the event";
    case "media.deleted":
      return "deleted a photo or video";
    case "media.bulk": {
      const match = /^(\w+)(?: to (\w+))? on (\d+) items\.$/.exec(detail);
      if (!match) return "changed several photos and videos";
      const [, verb, visibility, count] = match;
      if (verb === "visibility") {
        const items = plural(Number(count));
        if (visibility === "private") return `hid ${items}`;
        if (visibility === "link") return `made ${items} link-only`;
        return `showed ${items} in the gallery`;
      }
      return `${BULK_VERBS[verb] ?? "changed"} ${plural(Number(count))}`;
    }
    case "team.changed": {
      const who = targetName ?? "someone";
      if (detail.startsWith("Added as ")) return `added ${who} as ${detail.slice(9).replace(/\.$/, "")}`;
      if (detail.startsWith("Role changed to ")) return `made ${who} a ${detail.slice(16).replace(/\.$/, "")}`;
      if (detail === "Removed.") return `removed ${who} from the team`;
      if (detail === "Joined from an invitation.") return "joined the team from an invitation";
      if (detail === "Withdrew an invitation.") return "withdrew an invitation";
      if (detail.startsWith("Invited a new address as ")) {
        return `invited someone new as ${detail.slice(25).replace(/\.$/, "")}`;
      }
      return "changed the team";
    }
    case "event.transfer_offered":
      return `offered the event to ${targetName ?? "a manager"}`;
    case "event.transfer_withdrawn":
      return detail.startsWith("Declined") ? "declined the offer of the event" : "withdrew the offer of the event";
    case "event.transferred":
      return "took over the event";
    case "comment.hidden":
      return "hid a comment";
    case "comment.shown":
      return detail.startsWith("Kept") ? "kept a reported comment up" : "showed a hidden comment again";
    case "kiosk.created":
      return detail ? `set up a kiosk, ${detail}` : "set up a kiosk";
    case "kiosk.revoked":
      return detail ? `switched off a kiosk, ${detail}` : "switched off a kiosk";
    case "proofs.released":
      return detail ? `released ${detail} without the watermark` : "released proofs without the watermark";
    default:
      return "made a change";
  }
}

export async function eventActivity(eventId: string, limit = 40): Promise<ActivityEntry[]> {
  const target = alias(users, "target");
  const [rows, [event], members] = await Promise.all([
    db
      .select({ entry: auditLog, targetName: target.name, targetUsername: target.username })
      .from(auditLog)
      .leftJoin(target, and(eq(auditLog.targetType, "user"), eq(target.id, auditLog.targetId)))
      .where(and(eq(auditLog.eventId, eventId), inArray(auditLog.action, [...TEAM_VISIBLE])))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit),
    db.select({ ownerId: events.ownerId }).from(events).where(eq(events.id, eventId)).limit(1),
    // Removed members too: what they did while on the team is still theirs.
    db.select({ userId: eventCoHosts.userId }).from(eventCoHosts).where(eq(eventCoHosts.eventId, eventId)),
  ]);
  const team = new Set([event?.ownerId, ...members.map((member) => member.userId)]);

  return rows.map(({ entry, targetName, targetUsername }) => ({
    id: entry.id,
    at: entry.createdAt.toISOString(),
    // Somebody acting from outside the team is Klik support, and the team is
    // told that rather than the name of whoever at Klik it was.
    who: entry.actorUserId && team.has(entry.actorUserId) ? (entry.actorLabel ?? "A teammate") : "Klik",
    what: describeActivity(entry, targetName ?? (targetUsername ? `@${targetUsername}` : null)),
  }));
}
