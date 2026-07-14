import { auth } from "./auth";
import type { Session } from "next-auth";

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
