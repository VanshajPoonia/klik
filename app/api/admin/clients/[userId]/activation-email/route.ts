import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { requireSuperadmin } from "@/lib/roles";
import { consume } from "@/lib/ratelimit";
import { describeActivationNotice, sendActivationNotice } from "@/lib/activation-notice";
import { getAccountEntitlements } from "@/lib/entitlements";

/**
 * Send the access email again.
 *
 * Activation sends it once, automatically. This exists for the call that
 * follows: "I paid days ago and never heard anything." The answer to that is
 * either "it went at 14:32, look in your spam" or "it never went", and both end
 * with somebody wanting to press a button.
 *
 * Deliberately not a way to activate anybody. It refuses an account that is not
 * already active, because the mail it sends says their access is open, and
 * sending that to somebody who still cannot create an event is worse than
 * sending nothing.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await requireSuperadmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId } = await params;

  // Keyed on the recipient, not the sender. The thing being protected is one
  // person's inbox, and the realistic cause is a double-click or a support call
  // handled twice, not an attack: this route already requires a superadmin.
  const limit = await consume(`activation-email:${userId}`, 5, 60 * 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "That address has had several of these in the last hour. Try again later." },
      { status: 429 },
    );
  }

  const [account] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      username: users.username,
      activatedAt: users.activatedAt,
    })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.role, "organizer")))
    .limit(1);
  if (!account) {
    return NextResponse.json({ error: "Organizer not found" }, { status: 404 });
  }

  if (!account.activatedAt) {
    return NextResponse.json(
      { error: "This account is not active yet. Assign a plan, which sends this email itself." },
      { status: 409 },
    );
  }

  if (!account.email) {
    return NextResponse.json(
      { error: "No email address on file for this account." },
      { status: 409 },
    );
  }

  // Named after what they actually hold, newest grant first, since the email
  // says which plan their access is on.
  const { all } = await getAccountEntitlements(account.id);
  const current = all.find((grant) => grant.status === "active");
  const notice = await sendActivationNotice({ ...account, planKey: current?.planKey ?? "event" }, {
    id: session.user.id,
    label: session.user.username ?? session.user.name ?? null,
  });
  if (!notice.sent) {
    return NextResponse.json({ error: describeActivationNotice(notice) }, { status: 502 });
  }

  return NextResponse.json({ notice: { sent: true, message: "Access email sent." } });
}
