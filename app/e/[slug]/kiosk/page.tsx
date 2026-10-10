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
import { CURRENT_CONSENT, consentRecordId, consentText } from "@/lib/consent";
import { GuestCopyProvider } from "@/components/guest/guest-copy";
import { GUEST_COPY } from "@/lib/i18n/guest";
import { chooseLocale } from "@/lib/i18n/locale";
import { headers } from "next/headers";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { guests } from "@/lib/schema";
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

  // TRS-3: a kiosk is shared by everyone in the room, so no one guest's
  // choice applies: the host's language, else the tablet's own.
  const locale = chooseLocale({ eventLanguage: event.guestLanguage, acceptLanguage: (await headers()).get("accept-language") });
  const t = GUEST_COPY[locale];
  const speak = (node: React.ReactNode) => (
    <GuestCopyProvider locale={locale}>
      <div lang={locale}>{node}</div>
    </GuestCopyProvider>
  );

  const viewer = await resolveEventViewer(event);
  const team = Boolean(viewer.ownerSession);
  if (!viewer.kioskId) {
    return speak(
      <KioskHold title={t.kiosk.notKiosk} detail={team ? t.kiosk.notKioskTeam : t.kiosk.notKioskGuest} recheck={false} />,
    );
  }
  after(() => touchKiosk(viewer.kioskId!).catch(() => {}));

  const plan = eventPlan(event);
  const hold =
    eventLicenseState(event) !== "live" || !canUseKiosk(plan.key)
      ? { title: t.kiosk.unavailable, detail: t.kiosk.unavailableDetail }
      : !viewer.access.allowed
        ? { title: t.kiosk.closed, detail: t.kiosk.closedDetail }
        : !canUpload(event)
          ? { title: t.kiosk.paused, detail: t.kiosk.pausedDetail }
          : eventUsage(event, plan).full
            ? { title: t.kiosk.full, detail: t.kiosk.fullDetail }
            : null;
  if (hold) return speak(<KioskHold {...hold} recheck />);

  // The kiosk's guest row records the consent its start screen shows, now in
  // this language. After the response, and only when it changed.
  const consentId = consentRecordId(locale);
  const kioskGuestId = viewer.guestId;
  if (kioskGuestId) {
    after(() =>
      db
        .update(guests)
        .set({ consentVersion: consentId })
        .where(and(eq(guests.id, kioskGuestId), ne(guests.consentVersion, consentId)))
        .then(() => undefined)
        .catch(() => undefined),
    );
  }

  const galleryUrl = `${getAppUrl()}/e/${event.slug}`;
  const qr = await QRCode.toDataURL(galleryUrl, { margin: 1, width: 448, color: { dark: "#050505", light: "#f3f1e9" } });
  const accent = canCustomizeGallery(plan.key) ? event.accentColor : null;

  return speak(
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
        consent={consentText(CURRENT_CONSENT, locale).statement}
      />
    </div>,
  );
}
