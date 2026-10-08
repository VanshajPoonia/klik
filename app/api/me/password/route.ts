import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { consume } from "@/lib/ratelimit";
import { hashPassword, verifyPassword } from "@/lib/credentials";
import { PASSWORD_MAX, PASSWORD_MIN, passwordRestatesEmail } from "@/lib/signup";
import { recordAccountEvent } from "@/lib/timeline";

const schema = z.object({
  current: z.string().min(1).max(PASSWORD_MAX),
  next: z.string().min(PASSWORD_MIN, `At least ${PASSWORD_MIN} characters.`).max(PASSWORD_MAX),
});

/**
 * Changes the signed-in account's password. The current one is required, so a
 * session left open on a borrowed laptop cannot be turned into a takeover.
 *
 * Bumps `credential_version`, which ends every other session on its next
 * request (constraint 2 in ARCHITECTURE.md: JWTs cannot be revoked any other
 * way). It ends this one too; the page signs straight back in with the new
 * password.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await consume(`password:change:${session.user.id}`, 5, 15 * 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const [account] = await db
    .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!account?.passwordHash) {
    return NextResponse.json({ error: "This account signs in without a password." }, { status: 400 });
  }
  if (!(await verifyPassword(parsed.data.current, account.passwordHash))) {
    return NextResponse.json({ error: "Your current password is not right." }, { status: 400 });
  }
  if (account.email && passwordRestatesEmail(parsed.data.next, account.email)) {
    return NextResponse.json({ error: "Choose a password that does not contain your email." }, { status: 400 });
  }

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(parsed.data.next),
      credentialVersion: sql`${users.credentialVersion} + 1`,
    })
    .where(eq(users.id, account.id));
  await recordAccountEvent({ userId: account.id, kind: "password_changed", detail: "Changed by the account holder." });
  return NextResponse.json({ ok: true });
}
