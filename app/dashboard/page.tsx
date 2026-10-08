import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { auth, signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { eventCoHosts, events, users, venueClients } from "@/lib/schema";
import { CreateEventForm } from "@/components/dashboard/create-event-form";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { isEventActive } from "@/lib/access";
import { getPlan } from "@/lib/plans";
import { getUtcMonthStart } from "@/lib/plan-limits";
import { getAccountEntitlements } from "@/lib/entitlements";
import { eventLicenseState } from "@/lib/license";
import { VenueClientsPanel } from "@/components/dashboard/venue-clients-panel";
import { VenueQrPanel } from "@/components/dashboard/venue-qr-panel";
import { SupportCard } from "@/components/dashboard/support-card";
import { AwaitingActivation } from "@/components/dashboard/awaiting-activation";
import { DeletedEvents } from "@/components/dashboard/deleted-events";
import { getAppUrl } from "@/lib/env";

export const metadata: Metadata = {
  title: "Your events",
  robots: { index: false },
};

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [ownedRows, coHostedRows, held, account, clientRows, deletedRows] = await Promise.all([
    db
      .select()
      .from(events)
      .where(and(eq(events.ownerId, session.user.id), isNull(events.deletedAt)))
      .orderBy(events.createdAt),
    db
      .select({ event: events })
      .from(eventCoHosts)
      .innerJoin(events, eq(events.id, eventCoHosts.eventId))
      // Both filters matter: without the first a removed co-host keeps seeing
      // the event, without the second a soft-deleted event keeps appearing in
      // their dashboard after the owner deleted it.
      .where(
        and(
          eq(eventCoHosts.userId, session.user.id),
          isNull(eventCoHosts.deletedAt),
          isNull(events.deletedAt),
        ),
      )
      .orderBy(events.createdAt)
      .then((rows) => rows.map((row) => row.event)),
    getAccountEntitlements(session.user.id),
    db
      .select({ venueSlug: users.venueSlug, activatedAt: users.activatedAt })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select()
      .from(venueClients)
      .where(and(eq(venueClients.ownerId, session.user.id), isNull(venueClients.deletedAt)))
      .orderBy(venueClients.name),
    // Still in their 30-day trash: the purge removes the row when it is over.
    db
      .select({ id: events.id, name: events.name, deletedAt: events.deletedAt })
      .from(events)
      .where(and(eq(events.ownerId, session.user.id), isNotNull(events.deletedAt)))
      .orderBy(desc(events.deletedAt)),
  ]);
  const rows = [
    ...ownedRows,
    ...coHostedRows.filter(
      (coHosted) => !ownedRows.some((owned) => owned.id === coHosted.id),
    ),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  // ACT-1: what this account holds, from the ledger. `users.plan_key` is no
  // longer read anywhere; it defaulted to 'event' and so described a plan nobody
  // had granted.
  const venue = held.accountGrants.find((grant) => grant.planKey === "venue") ?? null;
  const venueEvents = venue ? ownedRows.filter((event) => event.entitlementId === venue.id) : [];
  const venueLive = venueEvents.filter((event) => isEventActive(event)).length;
  const monthStart = getUtcMonthStart();
  const venueThisMonth = venueEvents.filter(
    (event) => event.licensedAt && event.licensedAt >= monthStart,
  ).length;
  const drafts = ownedRows.filter((event) => eventLicenseState(event) === "draft").length;
  const hasSomethingToSpend = Boolean(venue) || held.unusedPasses.length > 0;
  const activated = Boolean(account?.activatedAt);
  // Drafts are always allowed, up to the cap the API enforces. Has to agree
  // with app/api/events/route.ts, or the form becomes a button that 409s.
  const canCreateEvent = drafts < 5;

  return (
    <div className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Image src="/klik-mark.png" alt="" width={32} height={32} className="rounded-[8px]" />
            <span className="text-lg font-semibold tracking-tight">klik</span>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button className="text-sm text-muted hover:text-paper">Sign out</button>
          </form>
        </header>

        <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <h1 className="font-display text-2xl text-paper">Your events</h1>
            <p className="mt-2 text-sm text-muted">
              View, moderate, download, and manage every event from here.
            </p>
          </div>
          <div className="rounded-xl border border-volt/30 bg-volt/10 px-4 py-3 sm:text-right">
            {venue ? (
              <>
                <p className="text-xs font-medium text-volt">Klik Venue</p>
                <p className="mt-1 text-sm text-paper">
                  {venueLive} of {venue.maxActiveEvents} live events
                </p>
                <p className="mt-1 text-xs text-muted">
                  {venueThisMonth} of {venue.maxEventsPerMonth} started this month
                </p>
              </>
            ) : held.unusedPasses.length > 0 ? (
              <>
                <p className="text-xs font-medium text-volt">
                  {held.unusedPasses.length} unused {held.unusedPasses.length === 1 ? "pass" : "passes"}
                </p>
                <p className="mt-1 text-sm text-paper">
                  {[...new Set(held.unusedPasses.map((pass) => getPlan(pass.planKey).name))].join(", ")}
                </p>
                <p className="mt-1 text-xs text-muted">Your next event goes live straight away</p>
              </>
            ) : activated ? (
              <>
                <p className="text-xs font-medium text-volt">Every pass is in use</p>
                <p className="mt-1 text-sm text-paper">A new event saves as a draft</p>
                <p className="mt-1 text-xs text-muted">It goes live once a pass is added</p>
              </>
            ) : (
              // Naming a plan here would be a lie with a number attached.
              <>
                <p className="text-xs font-medium text-volt">No plan yet</p>
                <p className="mt-1 text-sm text-paper">Set up your event while you wait</p>
              </>
            )}
          </div>
        </div>

        <div className="mb-10">
          {account?.venueSlug && (
            <VenueQrPanel
              venueSlug={account.venueSlug}
              venueUrl={`${getAppUrl()}/v/${account.venueSlug}`}
            />
          )}
          {venue && <VenueClientsPanel initialClients={clientRows} />}
          {/* The form, or the reason it is absent. Rendering it disabled was the
              other option, and a dead control reads as a broken page rather
              than as a step that has not happened yet. */}
          {/* The waiting card explains a draft before anyone makes one, so a
              new event that does not go live straight away is expected rather
              than a surprise. Shown whenever there is nothing to spend. */}
          {!hasSomethingToSpend && (
            <div className="mb-5">
              <AwaitingActivation activated={activated} />
            </div>
          )}
          <CreateEventForm
            canCreate={canCreateEvent}
            canManageClients={Boolean(venue)}
            clients={clientRows}
            limitMessage={
              canCreateEvent
                ? undefined
                : "You have 5 events waiting to go live. Delete one, or call us and we will activate them."
            }
          />
        </div>

        <div className="space-y-3">
          {rows.length === 0 && (
            <Card className="text-center text-sm text-muted">
              No events yet. Create your first one above.
            </Card>
          )}
          {rows.map((event) => (
            <Link
              key={event.id}
              href={`/dashboard/events/${event.id}`}
              className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
            >
              <Card className="flex items-center justify-between gap-4 transition-colors hover:border-paper/30">
                <div className="min-w-0">
                  <p className="truncate font-medium text-paper">{event.name}</p>
                  {event.clientName && (
                    <p className="mt-0.5 text-xs text-paper/70">{event.clientName}</p>
                  )}
                  <p className="text-xs text-muted">/e/{event.slug}</p>
                  {event.ownerId !== session.user.id && (
                    <p className="mt-1 text-xs text-volt">Co-hosted event</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  {eventLicenseState(event) === "draft" ? (
                    <Badge tone="warning">draft</Badge>
                  ) : eventLicenseState(event) === "lapsed" ? (
                    <Badge tone="danger">lapsed</Badge>
                  ) : (
                    !isEventActive(event) && <Badge>ended</Badge>
                  )}
                  <Badge tone={event.visibility === "public" ? "volt" : "neutral"}>
                    {event.visibility}
                  </Badge>
                </div>
              </Card>
            </Link>
          ))}
        </div>

        <DeletedEvents
          events={deletedRows.map((row) => ({
            id: row.id,
            name: row.name,
            purgesOn: new Date(row.deletedAt!.getTime() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString(
              "en-US",
              { month: "short", day: "numeric" },
            ),
          }))}
        />

        <div className="mt-10">
          <SupportCard />
        </div>
      </div>
    </div>
  );
}
