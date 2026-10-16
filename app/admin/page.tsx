import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { auth, signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, events } from "@/lib/schema";
import { CtaLink } from "@/components/marketing/cta-link";
import { AdminNav } from "@/components/admin/admin-nav";
import { ActivationRequests } from "@/components/admin/activation-requests";
import { ReportsQueue } from "@/components/admin/reports-queue";
import { PausedGalleries } from "@/components/admin/paused-galleries";
import { PrintOrders, type PrintOrderRow } from "@/components/admin/print-orders";
import { isPrintsAvailable, listPrintOrders, printDpi, printQuality, productByKey } from "@/lib/prints";
import { prodigiIsLive } from "@/lib/prodigi";
import { signObjectUrl } from "@/lib/media-urls";
import type { PrintOrder } from "@/lib/schema";
import { REPORT_REASON_LABELS, listOpenReports } from "@/lib/reports";
import { COMMENT_REPORT_LABELS, listOpenCommentReports, type CommentReportReason } from "@/lib/comments";
import { CommentReportsQueue } from "@/components/admin/comment-reports-queue";
import { PendingActivations } from "@/components/admin/pending-activations";
import { PendingSignups } from "@/components/admin/pending-signups";
import { getPendingActivations, getPendingSignups } from "@/lib/billing-admin";
import { ClientTable } from "@/components/admin/client-table";
import { listClientSummaries, listWaitingToGoLive } from "@/lib/admin-clients";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false },
};

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "superadmin") redirect("/dashboard");

  // GRW-6: the print queue, once prints are switched on. Photos are signed
  // here so the person deciding sees exactly what will be printed.
  const prints = isPrintsAvailable() ? await printQueue() : null;
  const [pending, signups, requests, reports, commentReports, paused, clients] = await Promise.all([
    getPendingActivations(),
    getPendingSignups(),
    // ACT-4: drafts their organizer asked to have activated, soonest event first.
    listWaitingToGoLive(),
    listOpenReports(),
    listOpenCommentReports(),
    // ADM-5: galleries Klik has paused, longest first.
    db
      .select({
        eventId: events.id,
        eventName: events.name,
        eventSlug: events.slug,
        ownerEmail: users.email,
        since: events.suspendedAt,
        reason: events.suspendedReason,
      })
      .from(events)
      .innerJoin(users, eq(users.id, events.ownerId))
      .where(and(isNotNull(events.suspendedAt), isNull(events.deletedAt)))
      .orderBy(asc(events.suspendedAt)),
    listClientSummaries(),
  ]);
  const shortDate = (date: Date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

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
          <div className="flex items-center gap-5">
            <Link href="/dashboard/account" className="text-sm text-muted hover:text-paper">
              Account
            </Link>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button className="text-sm text-muted hover:text-paper">Sign out</button>
            </form>
          </div>
        </header>

        {/* Above the paid-and-waiting panel because it is the one with rows in
            it. That panel reads `purchases`, which only the webhook writes, and
            the hosted Payment Links the site sells through reach no webhook. */}
        {/* First on the page: a held report may be evidence of a crime, and
            every other queue here is about money. */}
        <AdminNav current="/admin" />
        <ReportsQueue
          rows={reports.map((row) => ({
            mediaId: row.mediaId,
            eventId: row.eventId,
            eventSuspended: row.eventSuspended,
            organizerNotified: row.organizerNotifiedAt ? shortDate(row.organizerNotifiedAt) : null,
            screened: row.screened,
            eventName: row.eventName,
            eventSlug: row.eventSlug,
            held: row.held,
            reasons: row.reasons.map((reason) => REPORT_REASON_LABELS[reason]),
            notes: row.notes,
            count: row.count,
            latest: shortDate(row.latest),
          }))}
        />
        <CommentReportsQueue
          rows={commentReports.map((row) => ({
            commentId: row.commentId,
            eventName: row.eventName,
            eventSlug: row.eventSlug,
            mediaId: row.mediaId,
            body: row.body,
            authorName: row.authorName,
            hidden: row.hidden,
            safetyHold: row.safetyHold,
            reasons: row.reasons.map((reason) => COMMENT_REPORT_LABELS[reason as CommentReportReason] ?? reason),
            notes: row.notes,
            count: row.count,
            latest: shortDate(row.latest),
          }))}
        />
        {prints && <PrintOrders waiting={prints.waiting} recent={prints.recent} live={prodigiIsLive()} />}
        <PausedGalleries
          rows={paused.map((row) => ({
            eventId: row.eventId,
            eventName: row.eventName,
            eventSlug: row.eventSlug,
            ownerEmail: row.ownerEmail,
            since: row.since ? shortDate(row.since) : "",
            reason: row.reason ?? "",
          }))}
        />
        <ActivationRequests
          rows={requests.map((row) => ({
            eventId: row.eventId,
            eventName: row.eventName,
            userId: row.userId,
            ownerName: row.ownerName,
            ownerEmail: row.ownerEmail,
            eventDate: row.eventDate ? shortDate(row.eventDate) : null,
            requestedAt: row.requestedAt ? shortDate(row.requestedAt) : "",
            urgent: Boolean(row.urgent),
          }))}
        />
        <PendingSignups signups={signups} />
        <PendingActivations pending={pending} />

        <div className="mb-5 flex items-center justify-between gap-4">
          <h1 className="font-display text-2xl text-paper">Clients</h1>
          <CtaLink href="/admin/new">New client</CtaLink>
        </div>
        <ClientTable clients={clients} />
      </div>
    </div>
  );
}

async function printQueue(): Promise<{ waiting: PrintOrderRow[]; recent: PrintOrderRow[] }> {
  const { waiting, recent, photos, events: eventRows } = await listPrintOrders();
  const photoById = new Map(photos.map((photo) => [photo.id, photo]));
  const eventName = new Map(eventRows.map((event) => [event.id, event.name]));
  const toRow = async (order: PrintOrder): Promise<PrintOrderRow> => ({
    id: order.id,
    status: order.status,
    eventName: order.eventId ? (eventName.get(order.eventId) ?? null) : null,
    email: order.email,
    address: order.recipient
      ? [order.recipient.name, order.recipient.line1, order.recipient.line2, `${order.recipient.city} ${order.recipient.state} ${order.recipient.postalCode}`, order.recipient.country]
          .filter(Boolean)
          .join(", ")
      : null,
    totalCents: order.totalCents,
    paid: order.paidAt ? order.paidAt.toISOString().slice(0, 16).replace("T", " ") : null,
    stage: order.prodigiStage,
    error: order.error,
    lines: await Promise.all(
      order.items.map(async (item) => {
        const photo = photoById.get(item.mediaId);
        const product = productByKey(item.product);
        const missing = !photo || Boolean(photo.deletedAt) || Boolean(photo.legalHoldAt);
        return {
          thumb: photo && !missing ? await signObjectUrl(photo.thumbPathname ?? photo.blobPathname, "image/jpeg", Date.now()) : null,
          label: product?.label ?? item.product,
          copies: item.copies,
          quality: product && photo ? printQuality(printDpi(photo.width, photo.height, product)) : "unknown",
          missing,
        };
      }),
    ),
  });
  return { waiting: await Promise.all(waiting.map(toRow)), recent: await Promise.all(recent.map(toRow)) };
}
