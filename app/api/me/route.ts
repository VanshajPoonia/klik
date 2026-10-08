import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eraseUser, LegalHoldError } from "@/lib/erasure";
import { changeUsername } from "@/lib/account";
import { recordAccountEvent } from "@/lib/timeline";

const patchSchema = z
  .object({
    name: z.string().trim().min(1, "Tell us your name").max(120).optional(),
    username: z.string().max(40).optional(),
  })
  .refine((value) => value.name !== undefined || value.username !== undefined, "Nothing to change");

/**
 * ID-2: the account's own name and handle. A handle changes at most once per
 * 30 days and the old one is parked for as long; both rules are enforced in
 * lib/account.ts and the database, not here.
 */
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  let username: string | undefined;
  if (parsed.data.username !== undefined) {
    const [before] = await db.select({ username: users.username }).from(users).where(eq(users.id, session.user.id)).limit(1);
    const changed = await changeUsername(session.user.id, parsed.data.username);
    if (!changed.ok) {
      return NextResponse.json(
        { error: changed.reason, nextChangeAt: changed.nextChangeAt ?? null },
        { status: changed.status },
      );
    }
    username = changed.username;
    if (before?.username !== changed.username) {
      await recordAccountEvent({
        userId: session.user.id,
        kind: "username_changed",
        detail: `From @${before?.username ?? "nothing"} to @${changed.username}.`,
      });
    }
  }
  if (parsed.data.name !== undefined) {
    await db.update(users).set({ name: parsed.data.name }).where(eq(users.id, session.user.id));
  }

  const [account] = await db
    .select({ name: users.name, username: users.username, usernameChangedAt: users.usernameChangedAt })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  return NextResponse.json({ account: { ...account, username: username ?? account?.username ?? null } });
}

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

  let result;
  try {
    result = await eraseUser(account.id, account.id, "account_self_erasure");
  } catch (error) {
    // TRS-1: something in scope is under a legal hold, which an erasure
    // request does not override. Klik resolves these by hand.
    if (error instanceof LegalHoldError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
  return NextResponse.json({ ok: true, ...result });
}
