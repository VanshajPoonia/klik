import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { eventCoHosts, events, users } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { eventPlan } from "@/lib/license";
import { canUseCoHosts } from "@/lib/plans";
import { ASSIGNABLE_ROLES, DEFAULT_CO_HOST_ROLE } from "@/lib/permissions";

const addCoHostSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  // Defaults to manager, which is what every co-host implicitly was before
  // roles existed, so an unchanged client keeps working exactly as it did.
  role: z.enum(ASSIGNABLE_ROLES).default(DEFAULT_CO_HOST_ROLE),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Managers may now manage the team too, which is the point of having roles.
  // Moderators and contributors cannot, so nobody can widen their own access.
  const actor = await requireEventCapability(event.id, event.ownerId, "cohosts.manage");
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = eventPlan(event);
  if (!canUseCoHosts(plan.key)) {
    return NextResponse.json(
      { error: "Co-hosts are not included in this plan" },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = addCoHostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a username or email" }, { status: 400 });
  }

  const { identifier, role } = parsed.data;
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
  // Was a literal 5. Reading it from the plan is what lets Venue have more
  // without a second comparison appearing somewhere else. See ORG-2.
  if (existing.length >= plan.maxCoHosts) {
    return NextResponse.json(
      {
        error: `An event on ${plan.name} can have up to ${plan.maxCoHosts} co-hosts`,
        maxCoHosts: plan.maxCoHosts,
      },
      { status: 409 },
    );
  }

  // Re-adding someone who was removed has to revive their row rather than
  // insert a second one: (event_id, user_id) is the composite primary key, so a
  // plain insert would fail with a unique violation and surface as a 500 on a
  // perfectly reasonable action.
  await db
    .insert(eventCoHosts)
    .values({ eventId: id, userId: account.id, role })
    .onConflictDoUpdate({
      target: [eventCoHosts.eventId, eventCoHosts.userId],
      // Re-adding an existing co-host is also how their role is changed, so the
      // role has to be part of the update and not only the insert.
      set: { deletedAt: null, createdAt: new Date(), role },
    });
  return NextResponse.json({ coHost: { ...account, role } }, { status: 201 });
}
