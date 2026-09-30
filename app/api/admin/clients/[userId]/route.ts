import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { requireSuperadmin } from "@/lib/roles";
import { eraseUser } from "@/lib/erasure";

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

  const result = await eraseUser(account.id, session.user.id, parsed.data.reason);
  return NextResponse.json({ ok: true, ...result });
}
