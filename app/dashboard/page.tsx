import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth, signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { eventCoHosts, events, users, venueClients } from "@/lib/schema";
import { CreateEventForm } from "@/components/dashboard/create-event-form";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getAccountPlan } from "@/lib/account-plans";
import { isEventActive } from "@/lib/access";
import { canManageEventClients, formatFileSize } from "@/lib/plans";
import { wasCreatedThisUtcMonth } from "@/lib/plan-limits";
import { VenueClientsPanel } from "@/components/dashboard/venue-clients-panel";
import { VenueQrPanel } from "@/components/dashboard/venue-qr-panel";
import { getAppUrl } from "@/lib/env";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [ownedRows, coHostedRows, plan, account, clientRows] = await Promise.all([
    db
      .select()
      .from(events)
      .where(eq(events.ownerId, session.user.id))
      .orderBy(events.createdAt),
    db
      .select({ event: events })
      .from(eventCoHosts)
      .innerJoin(events, eq(events.id, eventCoHosts.eventId))
      .where(eq(eventCoHosts.userId, session.user.id))
      .orderBy(events.createdAt)
      .then((rows) => rows.map((row) => row.event)),
    getAccountPlan(session.user.id),
    db
      .select({ venueSlug: users.venueSlug })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select()
      .from(venueClients)
      .where(eq(venueClients.ownerId, session.user.id))
      .orderBy(venueClients.name),
  ]);
  const rows = [
    ...ownedRows,
    ...coHostedRows.filter(
      (coHosted) => !ownedRows.some((owned) => owned.id === coHosted.id),
    ),
  ];
  const activeEventCount = ownedRows.filter((event) => isEventActive(event)).length;
  const monthlyEventCount = ownedRows.filter((event) =>
    wasCreatedThisUtcMonth(event.createdAt),
  ).length;
  const canCreateEvent =
    activeEventCount < plan.maxActiveEvents && monthlyEventCount < plan.maxEventsPerMonth;

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
            <p className="text-xs font-medium text-volt">{plan.name}</p>
            <p className="mt-1 text-sm text-paper">
              {activeEventCount} of {plan.maxActiveEvents} active{" "}
              {plan.maxActiveEvents === 1 ? "event" : "events"}
            </p>
            <p className="mt-1 text-xs text-muted">
              {monthlyEventCount} of {plan.maxEventsPerMonth} created this month
            </p>
            <p className="mt-1 text-xs text-muted">
              {plan.uploadWindowDays}-day uploads · {formatFileSize(plan.maxVideoBytes)} videos
            </p>
          </div>
        </div>

        <div className="mb-10">
          {account?.venueSlug && (
            <VenueQrPanel
              venueSlug={account.venueSlug}
              venueUrl={`${getAppUrl()}/v/${account.venueSlug}`}
            />
          )}
          {canManageEventClients(plan.key) && (
            <VenueClientsPanel initialClients={clientRows} />
          )}
          <CreateEventForm
            canCreate={canCreateEvent}
            canManageClients={canManageEventClients(plan.key)}
            clients={clientRows}
            limitMessage={
              canCreateEvent
                ? undefined
                : monthlyEventCount >= plan.maxEventsPerMonth
                  ? `${plan.name} has reached its monthly event limit. The allowance resets on the first day of the next UTC month.`
                  : `${plan.name} has reached its active event limit. Ask an administrator to change the plan or wait for an event to end.`
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
            <Link key={event.id} href={`/dashboard/events/${event.id}`}>
              <Card className="flex items-center justify-between transition-colors hover:border-paper/30">
                <div>
                  <p className="font-medium text-paper">{event.name}</p>
                  {event.clientName && (
                    <p className="mt-0.5 text-xs text-paper/70">{event.clientName}</p>
                  )}
                  <p className="text-xs text-muted">/e/{event.slug}</p>
                  {event.ownerId !== session.user.id && (
                    <p className="mt-1 text-xs text-volt">Co-hosted event</p>
                  )}
                </div>
                <Badge tone={event.visibility === "public" ? "volt" : "neutral"}>
                  {event.visibility}
                </Badge>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
