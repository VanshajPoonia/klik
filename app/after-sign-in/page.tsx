import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { eventCoHosts, events, users } from "@/lib/schema";

/**
 * Where a sign-in with no destination lands. One account is a guest at some
 * events and an organizer at others (ACC-1), so "the dashboard" is wrong for a
 * guest who signed in to keep a gallery and has nothing to run. Anyone who
 * came to run events, or runs one, goes to the dashboard; everyone else to
 * their galleries.
 */
export default async function AfterSignIn() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role === "superadmin") redirect("/admin");
  const userId = session.user.id;

  const [row] = await db
    .select({
      organizer: sql<boolean>`(
        ${users.organizerIntentAt} IS NOT NULL
        OR ${users.activatedAt} IS NOT NULL
        OR EXISTS (SELECT 1 FROM ${events} WHERE ${events.ownerId} = ${userId} AND ${events.deletedAt} IS NULL)
        OR EXISTS (SELECT 1 FROM ${eventCoHosts} WHERE ${eventCoHosts.userId} = ${userId} AND ${eventCoHosts.deletedAt} IS NULL)
      )`,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  redirect(row?.organizer ? "/dashboard" : "/me");
}
