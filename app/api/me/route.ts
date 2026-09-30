import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eraseUser } from "@/lib/erasure";

const eraseSchema = z.object({
  /** The account's own username or email, typed back. */
  confirm: z.string().trim().min(1).max(254),
});

/**
 * Account erasure. Unlike DELETE on an event, nothing here is recoverable and
 * nothing waits 30 days: this is the "remove me" path, and a trash folder is
 * not removal.
 */
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A superadmin erasing themselves would leave the platform with no way back
  // in, and the seed script is the only thing that can mint another one.
  if (session.user.role === "superadmin") {
    return NextResponse.json(
      { error: "Superadmin accounts cannot be erased from here" },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = eraseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Confirmation required" }, { status: 400 });
  }

  const [account] = await db
    .select({ id: users.id, username: users.username, email: users.email })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Typing the identifier back is the only guard between a stray request and
  // every photo from someone's wedding. Compared case-insensitively because the
  // person is retyping their own handle, not proving they can match casing.
  const confirmation = parsed.data.confirm.toLowerCase();
  const matches =
    confirmation === account.username?.toLowerCase() ||
    confirmation === account.email?.toLowerCase();
  if (!matches) {
    return NextResponse.json(
      { error: "Confirmation did not match your username or email" },
      { status: 400 },
    );
  }

  const result = await eraseUser(account.id, account.id, "account_self_erasure");
  return NextResponse.json({ ok: true, ...result });
}
