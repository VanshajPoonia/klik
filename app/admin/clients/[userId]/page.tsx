import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdminNav } from "@/components/admin/admin-nav";
import { ClientDetailsForm } from "@/components/admin/client-details-form";
import { GrantControl } from "@/components/admin/grant-control";
import { EntitlementList } from "@/components/admin/entitlement-list";
import { CreditControl } from "@/components/admin/credit-control";
import { ActivationEmailControl } from "@/components/admin/activation-email-control";
import { ResetPasswordControl } from "@/components/admin/reset-password-control";
import { EraseClientControl } from "@/components/admin/erase-client-control";
import { AccountChain } from "@/components/admin/account-chain";
import { NewEventForAccount } from "@/components/admin/new-event-for-account";
import { MoveEventControl } from "@/components/admin/move-event-control";
import { getClientDetail } from "@/lib/admin-clients";
import { getAccountChains } from "@/lib/timeline";

export const metadata: Metadata = { title: "Client", robots: { index: false } };

const sectionTitle = "font-display text-lg text-paper";

/**
 * One account, everything a superadmin does to it: correct their details,
 * grant, renew or revoke a plan, put an event live, add credit, resend the
 * access email, reset a password, erase on request. The list on /admin is for
 * finding them; this is for acting.
 */
export default async function ClientPage({ params }: { params: Promise<{ userId: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "superadmin") redirect("/dashboard");

  const { userId } = await params;
  const detail = await getClientDetail(userId);
  if (!detail) notFound();
  const { account, events, grants, plan, creditCents, referredBy, history, requests } = detail;
  const isKlik = account.role === "superadmin";
  // How far they have got and whose turn it is, the same chain the old cards showed.
  const chain = (
    await getAccountChains([
      {
        userId: account.id,
        email: account.email,
        createdAt: account.createdAt,
        activatedAt: account.activatedAt,
        activationEmailSentAt: account.activationEmailSentAt,
        planName: plan,
      },
    ])
  ).get(account.id);
  const liveEvents = events.filter((event) => !event.deleted);
  const sentAt = account.activationEmailSentAt
    ? account.activationEmailSentAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-4xl">
        <AdminNav current="/admin" />
        <Link href="/admin" className="text-sm text-muted hover:text-paper">
          All clients
        </Link>

        <header className="mb-8 mt-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0">
            <h1 className="truncate font-display text-3xl text-paper">
              {account.name || (account.username ? `@${account.username}` : "Unnamed account")}
            </h1>
            <p className="mt-1 truncate text-sm text-muted">
              {[account.email, account.username ? `@${account.username}` : null].filter(Boolean).join(" · ")}
              {` · joined ${account.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            {isKlik && <Badge tone="neutral">Klik admin</Badge>}
            <Badge tone={account.activatedAt ? "volt" : "warning"}>
              {account.activatedAt ? "activated" : "not activated"}
            </Badge>
          </div>
        </header>

        <div className="space-y-6">
          {chain && <AccountChain steps={chain} />}

          <Card className="space-y-4">
            <h2 className={sectionTitle}>Details</h2>
            <ClientDetailsForm
              userId={account.id}
              initial={{ name: account.name, email: account.email, username: account.username }}
            />
          </Card>

          <Card className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className={sectionTitle}>Plan</h2>
              <p className="text-sm text-muted">{plan}</p>
            </div>
            {/* ADM-6: what they asked for, before deciding what to grant. */}
            {requests.length > 0 && (
              <ul className="space-y-1.5 rounded-xl border border-canvas-line px-4 py-3 text-sm">
                {requests.map((request) => (
                  <li key={request.id} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                    <span className="text-paper">Asked for {request.summary}</span>
                    <span className="shrink-0 text-xs text-muted">
                      {request.at}
                      {request.source === "signup" ? " · at signup" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <GrantControl
              userId={account.id}
              events={liveEvents.map((event) => ({ id: event.id, name: event.name, state: event.license }))}
            />
            <EntitlementList rows={grants} />
          </Card>

          <Card className="space-y-4">
            <h2 className={sectionTitle}>Events</h2>
            {events.length === 0 ? (
              <p className="rounded-xl border border-dashed border-canvas-line px-4 py-3 text-sm text-muted">
                No events yet. A pass granted now waits for their first one.
              </p>
            ) : (
              <ul className="divide-y divide-canvas-line rounded-xl border border-canvas-line">
                {events.map((event) => (
                  <li key={event.id} className="px-4 py-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-paper">{event.name}</p>
                        <p className="truncate text-xs text-muted">
                          /e/{event.slug}
                          {event.eventDate ? ` · ${event.eventDate}` : ""}
                          {event.clientName ? ` · for ${event.clientName}` : ""}
                          {event.requestedAt ? ` · asked to go live ${event.requestedAt}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
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
                        <Link
                          href={`/dashboard/events/${event.id}`}
                          className="rounded-full px-2.5 py-1 text-xs text-muted hover:bg-paper/5 hover:text-paper"
                        >
                          Open
                        </Link>
                      </div>
                    </div>
                    {!event.deleted && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <details className="group open:basis-full">
                          <summary className="inline-flex min-h-9 cursor-pointer list-none items-center rounded-full border border-canvas-line px-3 text-xs text-paper transition-colors hover:border-paper/40 group-open:border-volt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt [&::-webkit-details-marker]:hidden">
                            {event.license === "live" ? "Upgrade this event" : "Put this event live"}
                          </summary>
                          <div className="mt-3">
                            <GrantControl
                              userId={account.id}
                              events={[]}
                              target={{ id: event.id, name: event.name, state: event.license }}
                            />
                          </div>
                        </details>
                        {/* ADM-7: put it on someone else's account. */}
                        <details className="group open:basis-full">
                          <summary className="inline-flex min-h-9 cursor-pointer list-none items-center rounded-full border border-canvas-line px-3 text-xs text-paper transition-colors hover:border-paper/40 group-open:border-volt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt [&::-webkit-details-marker]:hidden">
                            Move to another account
                          </summary>
                          <div className="mt-3">
                            <MoveEventControl eventId={event.id} eventName={event.name} ownerIsKlik={isKlik} />
                          </div>
                        </details>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* ADM-7: an event made by Klik on their account, as a draft. */}
          <Card>
            <details className="group">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                <h2 className={sectionTitle}>New event for them</h2>
                <span className="rounded-full border border-canvas-line px-3 py-1 text-xs text-paper group-open:hidden">Open</span>
              </summary>
              <div className="mt-4">
                <NewEventForAccount userId={account.id} />
              </div>
            </details>
          </Card>

          <Card className="space-y-5">
            <h2 className={sectionTitle}>Account</h2>
            <ActivationEmailControl
              userId={account.id}
              email={account.email}
              activated={Boolean(account.activatedAt)}
              sentAt={sentAt}
            />
            <CreditControl userId={account.id} balanceCents={creditCents} referredBy={referredBy} />
            {!isKlik && account.username && <ResetPasswordControl userId={account.id} username={account.username} />}
            {!isKlik && <EraseClientControl userId={account.id} confirmWith={account.username ?? account.email ?? ""} />}
          </Card>

          <Card className="space-y-4">
            <h2 className={sectionTitle}>History</h2>
            {history.length === 0 ? (
              <p className="text-sm text-muted">Nothing recorded yet.</p>
            ) : (
              <ol className="space-y-3">
                {history.map((entry) => (
                  <li key={entry.id} className="border-l border-canvas-line pl-3">
                    <p className="text-sm text-paper">{entry.detail ?? entry.kind.replaceAll("_", " ")}</p>
                    <p className="text-xs text-muted">
                      {entry.at}
                      {entry.actor ? ` · by ${entry.actor}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
