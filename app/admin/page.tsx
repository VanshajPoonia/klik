import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { auth, signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, events } from "@/lib/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CtaLink } from "@/components/marketing/cta-link";
import { ResetPasswordControl } from "@/components/admin/reset-password-control";
import { PlanAssignmentControl } from "@/components/admin/plan-assignment-control";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false },
};

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "superadmin") redirect("/dashboard");

  const rows = await db
    .select({
      userId: users.id,
      username: users.username,
      contactName: users.name,
      planKey: users.planKey,
      eventId: events.id,
      eventName: events.name,
      eventClientName: events.clientName,
      eventSlug: events.slug,
      visibility: events.visibility,
      expiresAt: events.expiresAt,
      createdAt: events.createdAt,
    })
    .from(users)
    .leftJoin(events, eq(events.ownerId, users.id))
    .where(eq(users.role, "organizer"))
    .orderBy(desc(events.createdAt));

  const clients = rows.reduce<
    Array<{
      userId: string;
      username: string | null;
      contactName: string | null;
      planKey: (typeof rows)[number]["planKey"];
      events: Array<{
        id: string;
        name: string;
        slug: string;
        clientName: string | null;
        visibility: (typeof rows)[number]["visibility"];
      }>;
    }>
  >((grouped, row) => {
    const existing = grouped.find((client) => client.userId === row.userId);
    if (existing) {
      if (row.eventId && row.eventName && row.eventSlug && row.visibility) {
        existing.events.push({
          id: row.eventId,
          name: row.eventName,
          slug: row.eventSlug,
          clientName: row.eventClientName,
          visibility: row.visibility,
        });
      }
    } else {
      grouped.push({
        userId: row.userId,
        username: row.username,
        contactName: row.contactName,
        planKey: row.planKey,
        events:
          row.eventId && row.eventName && row.eventSlug && row.visibility
            ? [
                {
                  id: row.eventId,
                  name: row.eventName,
                  slug: row.eventSlug,
                  clientName: row.eventClientName,
                  visibility: row.visibility,
                },
              ]
            : [],
      });
    }
    return grouped;
  }, []);

  return (
    <div className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Image src="/klik-mark.png" alt="" width={32} height={32} className="rounded-[8px]" />
            <span className="text-lg font-semibold tracking-tight text-paper">
              klik <span className="font-normal text-muted">admin</span>
            </span>
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

        <div className="mb-8 flex items-center justify-between">
          <h1 className="font-display text-2xl text-paper">Provisioned clients</h1>
          <CtaLink href="/admin/new">New client</CtaLink>
        </div>

        <div className="space-y-3">
          {clients.length === 0 && (
            <Card className="text-center text-sm text-muted">
              No clients yet. Provision your first venue to hand off a QR code and login.
            </Card>
          )}
          {clients.map((client) => (
            <Card key={client.userId} className="space-y-5">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div className="min-w-0">
                  <p className="truncate font-medium text-paper">{client.contactName}</p>
                  <p className="truncate text-xs text-muted">@{client.username}</p>
                </div>
                <p className="text-xs text-muted">
                  {client.events.length} {client.events.length === 1 ? "event" : "events"}
                </p>
              </div>

              <PlanAssignmentControl
                userId={client.userId}
                initialPlanKey={client.planKey}
              />

              {client.events.length > 0 ? (
                <div className="divide-y divide-canvas-line rounded-xl border border-canvas-line">
                  {client.events.map((event) => (
                    <Link
                      key={event.id}
                      href={`/dashboard/events/${event.id}`}
                      className="flex min-h-14 items-center justify-between gap-4 px-4 py-3 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-paper/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-volt"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-paper">{event.name}</p>
                        {event.clientName && (
                          <p className="truncate text-xs text-paper/70">{event.clientName}</p>
                        )}
                        <p className="truncate text-xs text-muted">/e/{event.slug}</p>
                      </div>
                      <Badge tone={event.visibility === "public" ? "volt" : "neutral"}>
                        {event.visibility}
                      </Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-canvas-line px-4 py-3 text-sm text-muted">
                  No events currently assigned.
                </p>
              )}

              {client.username && (
                <ResetPasswordControl userId={client.userId} username={client.username} />
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
