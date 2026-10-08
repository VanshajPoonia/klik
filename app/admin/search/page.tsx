import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq, ilike, or } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { eventSlugs, events, users, venueClients } from "@/lib/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { inputClass } from "@/components/ui/field";
import { AdminNav } from "@/components/admin/admin-nav";
import { eventLicenseState } from "@/lib/license";

export const metadata: Metadata = { title: "Admin search", robots: { index: false } };

/**
 * ADM-1: one box for accounts, events and venue clients. A support call starts
 * with a name, an email or a link read off a sign, and any of those should
 * find the right row in one search. Former event addresses count, because the
 * link on an old sign is exactly what somebody reads out.
 */
export default async function AdminSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "superadmin") redirect("/dashboard");

  const raw = ((await searchParams).q ?? "").trim().slice(0, 100);
  // Pasted links search by their address part.
  const q = raw.replace(/^https?:\/\/[^/]+\/(e|v)\//, "").replace(/[%_\\]/g, "");
  const like = `%${q}%`;
  const [accountRows, eventRows, aliasRows, clientRows] = q.length < 2
    ? [[], [], [], []]
    : await Promise.all([
        db
          .select({ id: users.id, name: users.name, email: users.email, username: users.username, role: users.role })
          .from(users)
          .where(or(ilike(users.name, like), ilike(users.email, like), ilike(users.username, like)))
          .orderBy(desc(users.createdAt))
          .limit(20),
        db
          .select()
          .from(events)
          .where(or(ilike(events.name, like), ilike(events.slug, like), ilike(events.clientName, like), ilike(events.clientEmail, like)))
          .orderBy(desc(events.createdAt))
          .limit(20),
        db
          .select({ event: events, former: eventSlugs.slug })
          .from(eventSlugs)
          .innerJoin(events, eq(events.id, eventSlugs.eventId))
          .where(ilike(eventSlugs.slug, like))
          .limit(10),
        db
          .select({ client: venueClients, ownerName: users.name })
          .from(venueClients)
          .innerJoin(users, eq(users.id, venueClients.ownerId))
          .where(or(ilike(venueClients.name, like), ilike(venueClients.email, like), ilike(venueClients.phone, like)))
          .limit(20),
      ]);
  const eventsFound = [
    ...eventRows.map((event) => ({ event, former: null as string | null })),
    ...aliasRows.filter((row) => !eventRows.some((event) => event.id === row.event.id)),
  ];

  return (
    <div className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-4xl">
        <AdminNav current="/admin/search" />
        <form className="mb-8">
          <label htmlFor="admin-q" className="sr-only">
            Search accounts, events and clients
          </label>
          <input
            id="admin-q"
            name="q"
            defaultValue={raw}
            placeholder="A name, an email, a username, or a gallery link"
            className={inputClass}
            autoFocus
          />
        </form>

        {q.length >= 2 && (
          <div className="space-y-6">
            <Section title="Accounts" empty={accountRows.length === 0}>
              {accountRows.map((account) => (
                <Link key={account.id} href={`/admin#client-${account.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-paper/5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-paper">{account.name ?? "Unnamed"}</p>
                    <p className="truncate text-xs text-muted">
                      {[account.email, account.username && `@${account.username}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {account.role === "superadmin" && <Badge>superadmin</Badge>}
                </Link>
              ))}
            </Section>
            <Section title="Events" empty={eventsFound.length === 0}>
              {eventsFound.map(({ event, former }) => (
                <Link key={event.id} href={`/dashboard/events/${event.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-paper/5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-paper">{event.name}</p>
                    <p className="truncate text-xs text-muted">
                      /e/{event.slug}
                      {former ? ` · was /e/${former}` : ""}
                      {event.clientName ? ` · ${event.clientName}` : ""}
                    </p>
                  </div>
                  <Badge tone={event.deletedAt ? "danger" : eventLicenseState(event) === "live" ? "volt" : "warning"}>
                    {event.deletedAt ? "deleted" : eventLicenseState(event)}
                  </Badge>
                </Link>
              ))}
            </Section>
            <Section title="Venue clients" empty={clientRows.length === 0}>
              {clientRows.map(({ client, ownerName }) => (
                <div key={client.id} className="px-4 py-3">
                  <p className="text-sm text-paper">{client.name}</p>
                  <p className="text-xs text-muted">
                    Client of {ownerName ?? "a venue"}
                    {client.email ? ` · ${client.email}` : ""}
                    {client.phone ? ` · ${client.phone}` : ""}
                  </p>
                </div>
              ))}
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">{title}</h2>
      {empty ? (
        <p className="text-sm text-muted">None.</p>
      ) : (
        <Card className="divide-y divide-canvas-line p-0">{children}</Card>
      )}
    </section>
  );
}
