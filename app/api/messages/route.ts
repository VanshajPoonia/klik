import { NextResponse, after } from "next/server";
import { z } from "zod";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { eventCoHosts, events } from "@/lib/schema";
import { consume } from "@/lib/ratelimit";
import { MESSAGE_MAX, markRead, notifyOtherSide, postMessage, threadMessages } from "@/lib/messages";

/**
 * MSG-1: an account's own conversation with Klik. Any signed-in account may
 * write, organizer or not: a guest with a question about a gallery is a
 * question worth answering. Superadmins answer from /admin/messages instead.
 */

const postSchema = z.object({
  body: z.string().trim().min(1, "Write something first").max(MESSAGE_MAX),
  eventId: z.string().min(10).max(64).nullable().optional(),
});

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const afterParam = new URL(request.url).searchParams.get("after");
  const after_ = afterParam ? new Date(afterParam) : null;
  const messages = await threadMessages(session.user.id, after_ && !Number.isNaN(after_.getTime()) ? after_ : null);
  // Opening the conversation is reading it.
  await markRead(session.user.id, "account");
  return NextResponse.json({ messages });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (session.user.role === "superadmin") {
    return NextResponse.json({ error: "Reply to accounts from /admin/messages" }, { status: 403 });
  }
  const userId = session.user.id;

  const limit = await consume(`messages:${userId}`, 30, 60 * 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "That is a lot of messages in an hour. Call or text us if it is urgent." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the message" }, { status: 400 });
  }

  // An event is named only if it is one of theirs: owned, or on its team.
  let eventId: string | null = null;
  if (parsed.data.eventId) {
    const [event] = await db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.id, parsed.data.eventId),
          isNull(events.deletedAt),
          or(
            eq(events.ownerId, userId),
            sql`EXISTS (SELECT 1 FROM ${eventCoHosts} WHERE ${eventCoHosts.eventId} = ${events.id} AND ${eventCoHosts.userId} = ${userId} AND ${eventCoHosts.deletedAt} IS NULL)`,
          ),
        ),
      )
      .limit(1);
    if (!event) return NextResponse.json({ error: "That event is not one of yours" }, { status: 404 });
    eventId = event.id;
  }

  const message = await postMessage({ accountId: userId, authorId: userId, fromKlik: false, body: parsed.data.body, eventId });
  after(() => notifyOtherSide(userId, false, parsed.data.body));
  return NextResponse.json({ message }, { status: 201 });
}
