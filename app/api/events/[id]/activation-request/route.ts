import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, users } from "@/lib/schema";
import { requireOwnerSession } from "@/lib/roles";
import { eventLicenseState } from "@/lib/license";
import { consume } from "@/lib/ratelimit";
import { recordAccountEvent } from "@/lib/timeline";
import { sendEmail } from "@/lib/email";
import { getAppUrl } from "@/lib/env";
import { log } from "@/lib/observability";
import { escapeHtml } from "@/lib/emails/theme";

/**
 * ACT-4: the organizer asks for a draft to be activated.
 *
 * Without this the request is a WhatsApp message, and the failure mode is an
 * event going live an hour late because the message was read late. Now it is a
 * row in a queue on /admin, sorted by when the event happens, plus an email to
 * the operations address so nobody has to be watching the page.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), isNull(events.deletedAt)))
    .limit(1);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = await requireOwnerSession(event.ownerId);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (eventLicenseState(event) !== "draft") {
    return NextResponse.json({ error: "Only an event waiting to go live can be requested." }, { status: 409 });
  }

  // A second press is not a second request: it is the same one, and the queue
  // already has it. Limited so a nervous organizer cannot fill the ops inbox.
  const limit = await consume(`activation-request:${event.id}`, 3, 24 * 60 * 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Already requested. The Klik team has it and will be in touch." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const [updated] = await db
    .update(events)
    .set({ activationRequestedAt: new Date() })
    .where(eq(events.id, event.id))
    .returning({ activationRequestedAt: events.activationRequestedAt });

  const [owner] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, event.ownerId))
    .limit(1);
  const when = event.eventDate
    ? event.eventDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : "no date set";

  await recordAccountEvent({
    userId: event.ownerId,
    kind: "activation_requested",
    detail: `Asked for "${event.name}" to go live. Event date: ${when}.`,
    actor: { id: session.user.id, label: session.user.username ?? session.user.name ?? null },
  });

  const opsAddress = process.env.ALERT_EMAIL;
  if (opsAddress) {
    const adminUrl = `${getAppUrl()}/admin`;
    const result = await sendEmail({
      to: opsAddress,
      subject: `Activation requested: ${event.name} (${when})`,
      text: [
        `${owner?.name ?? "An organizer"} (${owner?.email ?? "no email"}) asked for an event to go live.`,
        "",
        `Event: ${event.name}`,
        `Date: ${when}`,
        "",
        `Grant a plan on ${adminUrl}. It is at the top, under "Waiting to go live".`,
      ].join("\n"),
      html: `<p>${escapeHtml(owner?.name ?? "An organizer")} (${escapeHtml(owner?.email ?? "no email")}) asked for an event to go live.</p><p><strong>${escapeHtml(event.name)}</strong><br>${escapeHtml(when)}</p><p><a href="${adminUrl}">Grant a plan on /admin</a>. It is at the top, under "Waiting to go live".</p>`,
    }).catch((error) => {
      log.warn("activation_request.email_failed", { error });
      return { sent: false };
    });
    if (!result.sent) log.warn("activation_request.email_not_sent", { eventId: event.id });
  }

  return NextResponse.json({ ok: true, requestedAt: updated?.activationRequestedAt ?? null });
}
