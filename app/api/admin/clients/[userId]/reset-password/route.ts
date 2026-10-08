import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { requireSuperadmin } from "@/lib/roles";
import { generatePassword, hashPassword } from "@/lib/credentials";

export async function POST(
  _request: Request,
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

  const password = generatePassword();
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
