import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { requireSuperadmin } from "@/lib/roles";
import { consume } from "@/lib/ratelimit";
import { recordAudit } from "@/lib/audit";
import { recordAccountEvent } from "@/lib/timeline";
import { createPasswordLink, sendPasswordLink } from "@/lib/password-links";

/**
 * ACC-8: emails an account a link to choose its own password. The password it
 * has keeps working until they choose one, so sending this never locks
 * anybody out; the newest link is the only one that works.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const session = await requireSuperadmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { userId } = await params;

  const [account] = await db
    .select({ id: users.id, email: users.email, username: users.username, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!account || account.role === "superadmin") return NextResponse.json({ error: "Account not found" }, { status: 404 });
  if (!account.email) {
    return NextResponse.json({ error: "No email address on file. Add one to the account first." }, { status: 409 });
  }

  // Keyed on the recipient: what is protected is one person's inbox.
  const limit = await consume(`password-link:${userId}`, 5, 60 * 60);
  if (!limit.allowed) {
    return NextResponse.json({ error: "That address has had several of these in the last hour. Try again later." }, { status: 429 });
  }

  const { token, expiresAt } = await createPasswordLink(account.id, session.user.id);
  const result = await sendPasswordLink({ email: account.email, username: account.username, name: account.name }, token);
  if (!result.sent) {
    return NextResponse.json(
      {
        error:
          result.reason === "daily_limit"
            ? "Klik has sent all its email for today. Try again tomorrow, or set a password here and send it yourself."
            : "The email could not be sent. Set a password here and send it yourself.",
      },
      { status: 503 },
    );
  }
  await recordAudit({
    actor: session,
    action: "account.password_link_sent",
    targetType: "user",
    targetId: account.id,
    detail: `Emailed a link to choose a password to ${account.email}.`,
  });
  await recordAccountEvent({ userId: account.id, kind: "password_link_sent", detail: `Emailed a link to choose a password to ${account.email}.` });
  return NextResponse.json({ sent: true, to: account.email, expiresAt: expiresAt.toISOString() });
}
