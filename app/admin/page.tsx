import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { auth, signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, events, entitlements, accountCredits, referrals } from "@/lib/schema";
import { alias } from "drizzle-orm/pg-core";
import { CreditControl } from "@/components/admin/credit-control";
import { EraseClientControl } from "@/components/admin/erase-client-control";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CtaLink } from "@/components/marketing/cta-link";
import { ResetPasswordControl } from "@/components/admin/reset-password-control";
import { GrantControl } from "@/components/admin/grant-control";
import { AdminNav } from "@/components/admin/admin-nav";
import { ActivationRequests } from "@/components/admin/activation-requests";
import { ReportsQueue } from "@/components/admin/reports-queue";
import { REPORT_REASON_LABELS, listOpenReports } from "@/lib/reports";
import { COMMENT_REPORT_LABELS, listOpenCommentReports, type CommentReportReason } from "@/lib/comments";
import { CommentReportsQueue } from "@/components/admin/comment-reports-queue";
import { EntitlementList, type EntitlementRow } from "@/components/admin/entitlement-list";
import { eventLicenseState, type LicenseState } from "@/lib/license";
import { ActivationEmailControl } from "@/components/admin/activation-email-control";
import { PendingActivations } from "@/components/admin/pending-activations";
import { PendingSignups } from "@/components/admin/pending-signups";
import { getPendingActivations, getPendingSignups } from "@/lib/billing-admin";
import { AccountChain } from "@/components/admin/account-chain";
import { getAccountChains } from "@/lib/timeline";
import { getPlan } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false },
};

function toEventSummary(row: {
  eventId: string | null;
  eventName: string | null;
  eventSlug: string | null;
  eventClientName: string | null;
  visibility: "public" | "password" | "private" | null;
  eventEntitlementId: string | null;
  eventLicensedAt: Date | null;
  eventPlanKey: Parameters<typeof getPlan>[0];
  eventDeletedAt: Date | null;
}) {
  return {
    id: row.eventId!,
    name: row.eventName!,
    slug: row.eventSlug!,
    clientName: row.eventClientName,
    visibility: row.visibility!,
    license: eventLicenseState({ entitlementId: row.eventEntitlementId, licensedAt: row.eventLicensedAt }),
    planName: row.eventPlanKey ? getPlan(row.eventPlanKey).name : null,
    deleted: Boolean(row.eventDeletedAt),
  };
}

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "superadmin") redirect("/dashboard");

  const [pending, signups, requests, reports, commentReports] = await Promise.all([
    getPendingActivations(),
    getPendingSignups(),
    // ACT-4: drafts their organizer asked to have activated, soonest event first.
    db
      .select({
        eventId: events.id,
        eventName: events.name,
        eventDate: events.eventDate,
        requestedAt: events.activationRequestedAt,
        // Within three days or already past: the ones to do first. Asked of
        // the database clock rather than read off Date.now() during render.
        urgent: sql<boolean>`${events.eventDate} < now() + interval '3 days'`,
        userId: users.id,
        ownerName: users.name,
        ownerEmail: users.email,
      })
      .from(events)
      .innerJoin(users, eq(users.id, events.ownerId))
      .where(
        and(
          isNotNull(events.activationRequestedAt),
          isNull(events.licensedAt),
          isNull(events.deletedAt),
        ),
      )
      .orderBy(sql`${events.eventDate} ASC NULLS LAST`, asc(events.activationRequestedAt)),
    listOpenReports(),
    listOpenCommentReports(),
  ]);
  const shortDate = (date: Date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const rows = await db
    .select({
      userId: users.id,
      username: users.username,
      contactName: users.name,
      email: users.email,
      activatedAt: users.activatedAt,
      activationEmailSentAt: users.activationEmailSentAt,
      accountCreatedAt: users.createdAt,
      eventId: events.id,
      eventEntitlementId: events.entitlementId,
      eventLicensedAt: events.licensedAt,
      eventPlanKey: events.planKey,
      eventDeletedAt: events.deletedAt,
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
      email: string | null;
      activatedAt: Date | null;
      activationEmailSentAt: Date | null;
      accountCreatedAt: Date;
      events: Array<{
        id: string;
        name: string;
        slug: string;
        clientName: string | null;
        visibility: (typeof rows)[number]["visibility"];
        license: LicenseState;
        planName: string | null;
        deleted: boolean;
      }>;
    }>
  >((grouped, row) => {
    const existing = grouped.find((client) => client.userId === row.userId);
    if (existing) {
      if (row.eventId && row.eventName && row.eventSlug && row.visibility) {
        existing.events.push(toEventSummary(row));
      }
    } else {
      grouped.push({
        userId: row.userId,
        username: row.username,
        contactName: row.contactName,
        email: row.email,
        activatedAt: row.activatedAt,
        activationEmailSentAt: row.activationEmailSentAt,
        accountCreatedAt: row.accountCreatedAt,
        events:
          row.eventId && row.eventName && row.eventSlug && row.visibility ? [toEventSummary(row)] : [],
      });
    }
    return grouped;
  }, []);

  // The ledger for every account on the page, in one query.
  const grants = clients.length
    ? await db
        .select()
        .from(entitlements)
        .where(inArray(entitlements.userId, clients.map((client) => client.userId)))
        .orderBy(desc(entitlements.createdAt))
    : [];
  const eventNames = new Map(rows.map((row) => [row.eventId, row.eventName]));
  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const grantsByUser = new Map<string, EntitlementRow[]>();
  for (const grant of grants) {
    const list = grantsByUser.get(grant.userId) ?? [];
    list.push({
      id: grant.id,
      planName: getPlan(grant.planKey).name,
      scope: grant.scope,
      status: grant.status,
      spent: Boolean(grant.appliedAt),
      spentOn: grant.appliedEventId ? (eventNames.get(grant.appliedEventId) ?? "a removed event") : grant.appliedAt ? "a removed event" : null,
      reason: grant.reason,
      grantedBy: grant.grantedByLabel,
      createdAt: formatDate(grant.createdAt),
      endsAt: grant.endsAt ? formatDate(grant.endsAt) : null,
      revokeReason: grant.revokeReason,
      paid: grant.amountCents === null ? null : grant.amountCents === 0 ? "Comp" : `Paid $${(grant.amountCents / 100).toFixed(grant.amountCents % 100 ? 2 : 0)}`,
      inGrace: Boolean(grant.graceStartedAt),
    });
    grantsByUser.set(grant.userId, list);
  }
  // GRW-5: credit balances and who referred whom, for every card, in two queries.
  const clientIds = clients.map((client) => client.userId);
  const referrer = alias(users, "referrer");
  const [creditRows, referredRows] = clientIds.length
    ? await Promise.all([
        db
          .select({ userId: accountCredits.userId, total: sql<number>`sum(${accountCredits.amountCents})::int` })
          .from(accountCredits)
          .where(inArray(accountCredits.userId, clientIds))
          .groupBy(accountCredits.userId),
        db
          .select({
            referredId: referrals.referredId,
            name: referrer.name,
            username: referrer.username,
            qualifiedAt: referrals.qualifiedAt,
          })
          .from(referrals)
          .innerJoin(referrer, eq(referrer.id, referrals.referrerId))
          .where(inArray(referrals.referredId, clientIds)),
      ])
    : [[], []];
  const creditByUser = new Map(creditRows.map((row) => [row.userId, row.total]));
  const referredBy = new Map(
    referredRows.map((row) => [
      row.referredId,
      { name: row.name?.trim() || (row.username ? `@${row.username}` : "an account"), qualified: Boolean(row.qualifiedAt) },
    ]),
  );

  /** What the chain says they are on: the newest grant still in force. */
  const planSummary = (userId: string) => {
    const current = grants.find((grant) => grant.userId === userId && grant.status === "active");
    if (!current) return "No active plan";
    return current.scope === "account" ? getPlan(current.planKey).name : `${getPlan(current.planKey).name} pass`;
  };

  // One batched pass rather than a query per card. The rows above already carry
  // everything about the account itself; this adds the counts and the history
  // the chain is derived from.
  const chains = await getAccountChains(
    clients.map((client) => ({
      userId: client.userId,
      email: client.email,
      createdAt: client.accountCreatedAt,
      activatedAt: client.activatedAt,
      activationEmailSentAt: client.activationEmailSentAt,
      planName: planSummary(client.userId),
    })),
  );

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
            <Card key={client.userId} id={`client-${client.userId}`} className="scroll-mt-6 space-y-5">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div className="min-w-0">
                  <p className="truncate font-medium text-paper">{client.contactName}</p>
                  <p className="truncate text-xs text-muted">@{client.username}</p>
                  {/* Shown because this is what a Stripe payment carries. An
                      account provisioned at /admin/new has none, which is why
                      this is conditional rather than always present. */}
                  {client.email && (
                    <p className="truncate text-xs text-muted">{client.email}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
                  <p className="text-xs text-muted">
                    {client.events.length} {client.events.length === 1 ? "event" : "events"}
                  </p>
                  {!client.activatedAt && <Badge tone="warning">not activated</Badge>}
                </div>
              </div>

              <GrantControl
                userId={client.userId}
                events={client.events
                  .filter((event) => !event.deleted)
                  .map((event) => ({ id: event.id, name: event.name, state: event.license }))}
              />
              <EntitlementList rows={grantsByUser.get(client.userId) ?? []} />
              <CreditControl
                userId={client.userId}
                balanceCents={creditByUser.get(client.userId) ?? 0}
                referredBy={referredBy.get(client.userId) ?? null}
              />
              {/* TRS-2. Closed until asked for. */}
              <EraseClientControl userId={client.userId} confirmWith={client.username ?? client.email ?? ""} />

              <ActivationEmailControl
                userId={client.userId}
                email={client.email}
                activated={Boolean(client.activatedAt)}
                // Formatted here rather than in the client component, so the
                // date does not render one way on the server and another in the
                // browser and trip hydration.
                sentAt={
                  client.activationEmailSentAt
                    ? client.activationEmailSentAt.toLocaleString("en-GB", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : null
                }
              />

              {(() => {
                const steps = chains.get(client.userId);
                return steps ? <AccountChain steps={steps} /> : null;
              })()}

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
                      <div className="flex shrink-0 items-center gap-1.5">
                        {event.deleted ? (
                          <Badge tone="danger">deleted</Badge>
                        ) : event.license === "draft" ? (
                          <Badge tone="warning">draft</Badge>
                        ) : event.license === "lapsed" ? (
                          <Badge tone="danger">lapsed</Badge>
                        ) : (
                          <Badge tone="volt">{event.planName ?? "live"}</Badge>
                        )}
                        <Badge tone="neutral">{event.visibility}</Badge>
                      </div>
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
