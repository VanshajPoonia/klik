import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userPasskeys } from "@/lib/schema";
import { recordAccountEvent } from "@/lib/timeline";
import { cleanPasskeyName } from "@/lib/passkeys";

const renameSchema = z.object({ name: z.string().max(120) });

/** ACC-6: renames one of the signed-in account's passkeys. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const parsed = renameSchema.safeParse(await request.json().catch(() => null));
  const name = parsed.success ? cleanPasskeyName(parsed.data.name) : null;
  if (!name) return NextResponse.json({ error: "Give it a name." }, { status: 400 });

  const [row] = await db
    .update(userPasskeys)
    .set({ name })
    .where(and(eq(userPasskeys.id, id), eq(userPasskeys.userId, session.user.id)))
    .returning({ id: userPasskeys.id });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, name });
}

/**
 * ACC-6: removes a passkey. The phone keeps its copy until told otherwise,
 * which the page does with a WebAuthn signal where the browser supports one;
 * either way it can no longer sign in, because the key it signs with is gone.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [row] = await db
    .delete(userPasskeys)
    .where(and(eq(userPasskeys.id, id), eq(userPasskeys.userId, session.user.id)))
    .returning({ name: userPasskeys.name });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await recordAccountEvent({ userId: session.user.id, kind: "passkey_removed", detail: row.name });
  return NextResponse.json({ ok: true });
}
