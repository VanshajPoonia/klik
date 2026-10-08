import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { recordAudit } from "@/lib/audit";
import { consume } from "@/lib/ratelimit";
import { acceptInvite } from "@/lib/team";

/**
 * ORG-3: accepts an invitation as the signed-in account.
 *
 * The address is read from the account row rather than the session, because a
 * session is a snapshot from sign-in and the row is what the account is now.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in to accept this invitation" }, { status: 401 });
  }
  // Tokens are 192 random bits, so this is not a guessing defence. It stops a
  // stuck client hammering the accept path.
  const limit = await consume(`invite:accept:${session.user.id}`, 20, 60 * 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const [account] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!account) return NextResponse.json({ error: "Sign in to accept this invitation" }, { status: 401 });

  const result = await acceptInvite(token, account);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });

  await recordAudit({
    actor: session,
    action: "team.changed",
    targetType: "user",
    targetId: account.id,
    eventId: result.eventId,
    detail: "Joined from an invitation.",
  });
  return NextResponse.json({ ok: true, eventId: result.eventId });
}
