import { auth } from "./auth";
import type { Session } from "next-auth";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { eventCoHosts, users } from "./schema";

/** Superadmin-only routes/pages. Returns the session, or null if not a superadmin. */
export async function requireSuperadmin(): Promise<Session | null> {
  const session = await auth();
  if (!session?.user || session.user.role !== "superadmin") return null;
  return session;
}

/** Event owner OR superadmin (admins can view/manage any provisioned event). */
export async function requireOwnerSession(eventOwnerId: string): Promise<Session | null> {
  const session = await auth();
  if (!session?.user) return null;
  if (session.user.role === "superadmin") return session;
  if (session.user.id !== eventOwnerId) return null;
  return session;
}

/** Event owner, assigned co-host, or superadmin. */
export async function requireEventManagerSession(
  eventId: string,
  eventOwnerId: string,
): Promise<Session | null> {
  const session = await auth();
  if (!session?.user) return null;
  if (session.user.role === "superadmin" || session.user.id === eventOwnerId) {
    return session;
  }

  const [membership] = await db
    .select({ eventId: eventCoHosts.eventId })
    .from(eventCoHosts)
    .innerJoin(users, eq(users.id, eventOwnerId))
    .where(
      and(
        eq(eventCoHosts.eventId, eventId),
        eq(eventCoHosts.userId, session.user.id),
        eq(users.planKey, "premium"),
      ),
    )
    .limit(1);

  return membership ? session : null;
}
