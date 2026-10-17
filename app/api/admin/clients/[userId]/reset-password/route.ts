import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { requireSuperadmin } from "@/lib/roles";
import { generatePassword, hashPassword } from "@/lib/credentials";
import { z } from "zod";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/signup";

/**
 * ADM-7: the password the superadmin typed, or a generated one when they typed
 * none. Either way it is shown once, and every signed-in session ends.
 */
const bodySchema = z.object({
  password: z
    .string()
    .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
    .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters`)
    .optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await requireSuperadmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId } = await params;
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.role, "organizer")))
    .limit(1);
  if (!user?.username) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // An empty body is the generated-password case, so it is not an error.
  const raw = await request.text().catch(() => "");
  let body: unknown = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ error: "Check the password" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the password" }, { status: 400 });
  }
  const password = parsed.data.password ?? generatePassword();
  const passwordHash = await hashPassword(password);
  await db
    .update(users)
    .set({
      passwordHash,
      credentialVersion: sql`${users.credentialVersion} + 1`,
    })
    .where(and(eq(users.id, userId), eq(users.role, "organizer")));
  await recordAudit({ actor: session, action: "account.password_reset", targetType: "user", targetId: userId });

  return NextResponse.json({ username: user.username, password });
}
