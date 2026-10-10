import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, users } from "@/lib/schema";
import { isEventActive } from "@/lib/access";
import { hasVenueGrant } from "@/lib/entitlements";
import { eventLicenseState } from "@/lib/license";

export const metadata: Metadata = {
  robots: { index: false },
};

export default async function VenueHubPage({
  params,
}: {
  params: Promise<{ venueSlug: string }>;
}) {
  const { venueSlug } = await params;
  const [venue] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.venueSlug, venueSlug))
    .limit(1);
  // The account's Venue grant, from the ledger, rather than users.plan_key.
  if (!venue || !(await hasVenueGrant(venue.id))) notFound();

  const venueEvents = await db
    .select()
    .from(events)
    .where(
      and(eq(events.ownerId, venue.id), ne(events.visibility, "private"), isNull(events.deletedAt), isNull(events.suspendedAt)),
    )
    .orderBy(desc(events.createdAt));
  // Never a draft: the reusable venue QR must not lead anyone into a gallery
  // that has not gone live.
  const eligible = venueEvents.filter(
    (event) => isEventActive(event) && eventLicenseState(event) === "live",
  );
  const target = eligible.find((event) => event.venueFeatured) ?? eligible[0];
  if (target) redirect(`/e/${target.slug}`);

  return (
    <main className="flex min-h-screen items-center justify-center px-6 text-center">
      <div className="max-w-md">
        <h1 className="font-display text-3xl text-paper">
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
