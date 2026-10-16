import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { requireSuperadmin } from "@/lib/roles";
import { eraseUser, LegalHoldError } from "@/lib/erasure";
import { changeUsername } from "@/lib/account";
import { recordAudit } from "@/lib/audit";
import { isUniqueViolation } from "@/lib/db-errors";
import { recordAccountEvent } from "@/lib/timeline";

const editSchema = z
  .object({
    name: z.string().trim().min(1, "A name is needed").max(120).optional(),
    // Empty clears it: an account made at /admin/new can have no address.
    email: z.union([z.literal(""), z.string().trim().toLowerCase().email("That email does not look right").max(254)]).optional(),
    username: z.string().trim().max(40).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), "Nothing to change");

/**
 * A superadmin corrects an account's name, email or handle: a typo at signup,
 * a client who changed address, a handle somebody asked to have changed.
 * Each change is written to the account's history and the audit log, with the
 * value it replaced, so a correction can itself be corrected.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const session = await requireSuperadmin();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = editSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { userId } = await params;
  const [before] = await db
    .select({ name: users.name, email: users.email, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!before) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const changes: string[] = [];
  const { name, email, username } = parsed.data;

  if (username !== undefined && username.toLowerCase() !== (before.username ?? "")) {
    const changed = await changeUsername(userId, username, { bySuperadmin: true });
    if (!changed.ok) return NextResponse.json({ error: changed.reason }, { status: changed.status });
    changes.push(`handle @${before.username ?? "none"} to @${changed.username}`);
  }

  const columns: Partial<typeof users.$inferInsert> = {};
  if (name !== undefined && name !== (before.name ?? "")) {
    columns.name = name;
    changes.push(`name "${before.name ?? ""}" to "${name}"`);
  }
  if (email !== undefined && email !== (before.email ?? "")) {
    columns.email = email || null;
    // The new address has not been proven by a sign-in yet.
    columns.emailVerified = null;
    changes.push(`email ${before.email ?? "none"} to ${email || "none"}`);
  }
  if (Object.keys(columns).length > 0) {
    try {
      await db.update(users).set(columns).where(eq(users.id, userId));
    } catch (error) {
      if (isUniqueViolation(error)) {
        return NextResponse.json({ error: "Another account already uses that email." }, { status: 409 });
      }
      throw error;
    }
  }

  if (changes.length > 0) {
    const detail = `Changed ${changes.join(", ")}.`;
    const actor = { id: session.user.id, label: session.user.username ?? session.user.name ?? null };
    await recordAccountEvent({ userId, kind: "details_changed", detail, actor });
    await recordAudit({ actor: session, action: "account.details_changed", targetType: "user", targetId: userId, detail });
  }

  const [account] = await db
    .select({ name: users.name, email: users.email, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return NextResponse.json({ account, changed: changes.length });
}

const eraseSchema = z.object({
  /** The target account's username, typed back by the admin. */
  confirm: z.string().trim().min(1).max(254),
  reason: z.string().trim().min(1).max(500),
});

/**
 * Superadmin erasure of a client account, for acting on a deletion request the
 * person made out of band. Irreversible and immediate, so it asks for the
 * username and a reason, both of which end up in the erasure log.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const session = await requireSuperadmin();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = eraseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Confirmation and reason required" }, { status: 400 });
  }

  const { userId } = await params;
  const [account] = await db
    .select({ id: users.id, username: users.username, email: users.email })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.role, "organizer")))
    .limit(1);
  if (!account) return NextResponse.json({ error: "Organizer not found" }, { status: 404 });

  const confirmation = parsed.data.confirm.toLowerCase();
  const matches =
    confirmation === account.username?.toLowerCase() ||
    confirmation === account.email?.toLowerCase();
  if (!matches) {
    return NextResponse.json(
      { error: "Confirmation did not match this organizer's username or email" },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await eraseUser(account.id, session.user.id, parsed.data.reason);
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
