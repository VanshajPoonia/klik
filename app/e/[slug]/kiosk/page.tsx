import type { Metadata } from "next";
import { after } from "next/server";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { findEventBySlug } from "@/lib/slugs";
import { resolveEventViewer } from "@/lib/event-viewer";
import { eventLicenseState, eventPlan } from "@/lib/license";
import { canCustomizeGallery, canUseKiosk } from "@/lib/plans";
import { canUpload } from "@/lib/access";
import { eventUsage } from "@/lib/usage";
import { readableOn } from "@/lib/color";
import { touchKiosk } from "@/lib/kiosks";
import { getAppUrl } from "@/lib/env";
import { CURRENT_CONSENT } from "@/lib/consent";
import { KioskStation } from "@/components/kiosk/kiosk-station";
import { KioskHold } from "@/components/kiosk/kiosk-hold";

export const metadata: Metadata = { title: "Kiosk", robots: { index: false } };

/**
 * VEN-2: the kiosk screen, for a device paired as one. Anything that stops a
 * kiosk taking photos gets a calm screen that checks again every minute, so a
 * host who reopens uploads does not have to walk back to the tablet.
 */
export default async function KioskPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = (await findEventBySlug(slug))?.event;
  if (!event) notFound();

  const viewer = await resolveEventViewer(event);
  const team = Boolean(viewer.ownerSession);
  if (!viewer.kioskId) {
    return (
      <KioskHold
        title="This device is not a kiosk."
        detail={
          team
            ? "Set one up from the event's QR code tab, then open its link on this device."
            : "Ask the host to set it up again from the event's QR code tab."
        }
        recheck={false}
      />
    );
  }
  after(() => touchKiosk(viewer.kioskId!).catch(() => {}));

  const plan = eventPlan(event);
  const hold =
    eventLicenseState(event) !== "live" || !canUseKiosk(plan.key)
      ? { title: "The kiosk is not available for this event.", detail: "The host can see why on the event page." }
      : !viewer.access.allowed
        ? { title: "This gallery is closed.", detail: "Thanks for coming." }
        : !canUpload(event)
          ? { title: "Photos are paused for now.", detail: "The host has closed uploads. This screen checks again every minute." }
          : eventUsage(event, plan).full
            ? { title: "The gallery is full.", detail: "The host has been told. This screen checks again every minute." }
            : null;
  if (hold) return <KioskHold {...hold} recheck />;

  const galleryUrl = `${getAppUrl()}/e/${event.slug}`;
  const qr = await QRCode.toDataURL(galleryUrl, { margin: 1, width: 448, color: { dark: "#050505", light: "#f3f1e9" } });
  const accent = canCustomizeGallery(plan.key) ? event.accentColor : null;

  return (
    <div
      style={
        accent
          ? { ["--color-volt" as string]: accent, ["--color-on-volt" as string]: readableOn(accent) }
          : undefined
      }
    >
      <KioskStation
        eventId={event.id}
        slug={event.slug}
        eventName={event.name}
        qrDataUrl={qr}
        shortUrl={galleryUrl.replace(/^https?:\/\//, "")}
        moderated={event.moderation}
        team={team}
        consent={CURRENT_CONSENT.statement}
      />
    </div>
  );
}
