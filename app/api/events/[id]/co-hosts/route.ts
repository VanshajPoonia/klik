import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { eventCoHosts, events, users } from "@/lib/schema";
import { requireOwnerSession } from "@/lib/roles";
import { getAccountPlan } from "@/lib/account-plans";
import { canUseCoHosts } from "@/lib/plans";

const addCoHostSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const session = await requireOwnerSession(event.ownerId);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await getAccountPlan(event.ownerId);
  if (!canUseCoHosts(plan.key)) {
    return NextResponse.json(
      { error: "Co-hosts are available on the Klik Premium plan" },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = addCoHostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a username or email" }, { status: 400 });
  }

  const identifier = parsed.data.identifier;
  const [account] = await db
    .select({ id: users.id, name: users.name, email: users.email, username: users.username })
    .from(users)
    .where(
      and(
        eq(users.role, "organizer"),
        or(eq(users.username, identifier), eq(users.email, identifier)),
      ),
    )
    .limit(1);
  if (!account) {
    return NextResponse.json(
      { error: "No organizer account matches that username or email" },
      { status: 404 },
    );
  }
  if (account.id === event.ownerId) {
    return NextResponse.json({ error: "The event owner already has access" }, { status: 409 });
  }

  const existing = await db
    .select({ userId: eventCoHosts.userId })
    .from(eventCoHosts)
    .where(and(eq(eventCoHosts.eventId, id), isNull(eventCoHosts.deletedAt)));
  if (existing.some((row) => row.userId === account.id)) {
    return NextResponse.json({ error: "This organizer is already a co-host" }, { status: 409 });
  }
  if (existing.length >= 5) {
    return NextResponse.json({ error: "An event can have up to 5 co-hosts" }, { status: 409 });
  }

  // Re-adding someone who was removed has to revive their row rather than
  // insert a second one: (event_id, user_id) is the composite primary key, so a
  // plain insert would fail with a unique violation and surface as a 500 on a
  // perfectly reasonable action.
  await db
    .insert(eventCoHosts)
    .values({ eventId: id, userId: account.id })
    .onConflictDoUpdate({
      target: [eventCoHosts.eventId, eventCoHosts.userId],
      set: { deletedAt: null, createdAt: new Date() },
    });
  return NextResponse.json({ coHost: account }, { status: 201 });
}
