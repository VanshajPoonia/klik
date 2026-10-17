import { NextResponse, after } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireSuperadmin } from "@/lib/roles";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { MESSAGE_MAX, markRead, notifyOtherSide, postMessage, threadMessages } from "@/lib/messages";
import { recordAudit } from "@/lib/audit";

/** MSG-1: one account's conversation, as Klik. Reading it marks it read for every superadmin. */

const postSchema = z.object({ body: z.string().trim().min(1, "Write something first").max(MESSAGE_MAX) });

export async function GET(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  if (!(await requireSuperadmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { accountId } = await params;
  const afterParam = new URL(request.url).searchParams.get("after");
  const after_ = afterParam ? new Date(afterParam) : null;
  const messages = await threadMessages(accountId, after_ && !Number.isNaN(after_.getTime()) ? after_ : null);
  await markRead(accountId, "klik");
  return NextResponse.json({ messages });
}

export async function POST(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  const session = await requireSuperadmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { accountId } = await params;
  const [account] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, accountId)).limit(1);
  if (!account || account.role === "superadmin") return NextResponse.json({ error: "No such account" }, { status: 404 });

  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the message" }, { status: 400 });
  }
  const message = await postMessage({
    accountId,
    authorId: session.user.id ?? null,
    fromKlik: true,
    body: parsed.data.body,
  });
  await recordAudit({
    actor: session,
    action: "message.sent",
    targetType: "user",
    targetId: accountId,
    detail: "Replied in the account's messages.",
  });
  after(() => notifyOtherSide(accountId, true, parsed.data.body));
  return NextResponse.json({ message }, { status: 201 });
}
