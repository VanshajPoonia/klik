import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { events } from "@/lib/schema";
import { requireEventCapability } from "@/lib/roles";
import { eventLicenseState, eventPlan } from "@/lib/license";
import { canCustomizeGallery, canCustomizeQr, removesKlikBranding } from "@/lib/plans";
import { getAppUrl } from "@/lib/env";
import { eventColors, eventTemplate, matchColorway } from "@/lib/gallery-templates";
import { StudioHolding } from "@/components/print/studio-holding";
import { SignDesigner } from "@/components/qr-sign/sign-designer";

export const metadata: Metadata = { title: "Print your QR sign", robots: { index: false } };

/**
 * QR-5: the printable sign, for whoever may hand out the event's QR code
 * (`event.qr`), on every plan, once the event is live. Premium adds what it
 * adds everywhere: styled codes, its own colours, and no Klik mark.
 */
export default async function QrSignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  const [event] = await db.select().from(events).where(and(eq(events.id, id), isNull(events.deletedAt))).limit(1);
  if (!event) notFound();
  const actor = await requireEventCapability(event.id, event.ownerId, "event.qr");
  if (!actor) notFound();
  const backHref = `/dashboard/events/${event.id}`;

  // ACT-3: no code exists for a draft, so neither does a sign with one on it.
  if (eventLicenseState(event) === "draft") {
    return (
      <StudioHolding
        backHref={backHref}
        title="Your QR code is made when the event goes live"
        detail="It is permanent once printed, so it is not created for a draft."
      />
    );
  }

  const plan = eventPlan(event);
  const caps = {
    qrStyles: canCustomizeQr(plan.key),
    hideLogo: removesKlikBranding(plan.key),
    galleryColors: canCustomizeGallery(plan.key),
  };
  const colors = eventColors(event, caps.galleryColors);
  const look = eventTemplate(event);
  const match = matchColorway(colors.accent, colors.background);

  return (
    <SignDesigner
      eventId={event.id}
      eventName={event.name}
      url={`${getAppUrl()}/e/${event.slug}`}
      eventDate={event.eventDate ? event.eventDate.toISOString() : null}
      galleryLook={look.key}
      galleryColorway={match && match.template.key === look.key ? match.colorway.key : null}
      galleryColors={colors}
      fields={event.templateFields ?? null}
      language={event.guestLanguage === "es" ? "es" : "en"}
      caps={caps}
      backHref={backHref}
    />
  );
}
