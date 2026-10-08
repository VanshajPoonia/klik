import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { consume } from "@/lib/ratelimit";
import { cancelTransfer, createInvite, emailAddedToTeam, emailInvite, normalizeEmail, openInvites } from "@/lib/team";
import { z } from "zod";
import { and, eq, isNull, or, sql } from "drizzle-orm";
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

  const { role } = parsed.data;
  // "@anita" is how a handle is shown everywhere, so it is how people type it.
  const identifier = parsed.data.identifier.replace(/^@/, "");
  const [account] = await db
    .select({ id: users.id, name: users.name, email: users.email, username: users.username })
    .from(users)
    .where(
      and(
        eq(users.role, "organizer"),
        // Emails are compared without case, as sign-in does, or "Ana@x.com"
        // misses the account "ana@x.com" and gets sent an invitation instead.
        or(
          sql`lower(${users.username}) = ${identifier.toLowerCase()}`,
          sql`lower(${users.email}) = ${identifier.toLowerCase()}`,
        ),
      ),
    )
    .limit(1);
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
  if (!account && !looksLikeEmail) {
    return NextResponse.json(
      { error: "No account has that username. To invite someone new, enter their email address." },
      { status: 404 },
    );
  }

  // Members and open invitations both count against the plan's limit, or a
  // host could invite past it and have the invitations fail one by one later.
  const [members, invitations] = await Promise.all([
    db
      .select({ userId: eventCoHosts.userId })
      .from(eventCoHosts)
      .where(and(eq(eventCoHosts.eventId, id), isNull(eventCoHosts.deletedAt))),
    openInvites(id),
  ]);

  if (!account) {
    // ORG-3: nobody has this address yet, so it gets an invitation that
    // survives them signing up.
    const address = normalizeEmail(identifier);
    const reinvite = invitations.some((invite) => invite.email === address);
    if (!reinvite && members.length + invitations.length >= plan.maxCoHosts) {
      return NextResponse.json(
        { error: `An event on ${plan.name} can have up to ${plan.maxCoHosts} co-hosts, invitations included` },
        { status: 409 },
      );
    }
    // Every invitation is an email from our domain to an address the sender
    // chose. Resending replaces the old one, so without a limit this is a way
    // to mail somebody over and over.
    const limit = await consume(`invite:send:${actor.session.user.id}`, 30, 60 * 60);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "That is a lot of invitations in an hour. Try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
    }
    const { invite, token } = await createInvite({
      eventId: id,
      email: address,
      role,
      invitedByUserId: actor.session.user.id,
    });
    await emailInvite(address, token, event.name, actor.session.user.name ?? null);
    await recordAudit({
      actor: actor.session,
      action: "team.changed",
      targetType: "event",
      targetId: event.id,
      eventId: event.id,
      detail: `Invited a new address as ${role}.`,
    });
    return NextResponse.json(
      { invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt } },
      { status: 201 },
    );
  }
  if (account.id === event.ownerId) {
    return NextResponse.json({ error: "The event owner already has access" }, { status: 409 });
  }

  const existing = members;
  const alreadyMember = existing.some((row) => row.userId === account.id);
  // Was a literal 5. Reading it from the plan is what lets Venue have more
  // without a second comparison appearing somewhere else. See ORG-2.
  if (!alreadyMember && existing.length + invitations.length >= plan.maxCoHosts) {
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
  // ORG-4: an event is only offered to a manager, so a demotion withdraws it.
  if (role !== "manager") await cancelTransfer(event.id, account.id);
  await recordAudit({
    actor: actor.session,
    action: "team.changed",
    targetType: "user",
    targetId: account.id,
    eventId: event.id,
    detail: alreadyMember ? `Role changed to ${role}.` : `Added as ${role}.`,
  });
  if (!alreadyMember) await emailAddedToTeam(account.email, event.id, event.name);
  return NextResponse.json({ coHost: { ...account, role } }, { status: 201 });
}
