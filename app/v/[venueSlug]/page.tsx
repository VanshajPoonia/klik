import { notFound, redirect } from "next/navigation";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, users } from "@/lib/schema";
import { isEventActive } from "@/lib/access";

export default async function VenueHubPage({
  params,
}: {
  params: Promise<{ venueSlug: string }>;
}) {
  const { venueSlug } = await params;
  const [venue] = await db
    .select({ id: users.id, name: users.name, planKey: users.planKey })
    .from(users)
    .where(eq(users.venueSlug, venueSlug))
    .limit(1);
  if (!venue || venue.planKey !== "venue") notFound();

  const venueEvents = await db
    .select()
    .from(events)
    .where(and(eq(events.ownerId, venue.id), ne(events.visibility, "private")))
    .orderBy(desc(events.createdAt));
  const eligible = venueEvents.filter(
    (event) => isEventActive(event),
  );
  const target = eligible.find((event) => event.venueFeatured) ?? eligible[0];
  if (target) redirect(`/e/${target.slug}`);

  return (
    <main className="flex min-h-screen items-center justify-center px-6 text-center">
      <div className="max-w-md">
        <p className="text-xs font-medium tracking-wide text-volt uppercase">Klik Venue</p>
        <h1 className="mt-3 font-display text-3xl text-paper">
          {venue.name || "This venue"} has no live gallery right now.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Keep this QR code. It will open the next featured event as soon as the organizer makes
          one available.
        </p>
      </div>
    </main>
  );
}
