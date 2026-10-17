import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listAllEvents, type AdminEventFilter } from "@/lib/admin-events";
import { AdminNav } from "@/components/admin/admin-nav";
import { Badge } from "@/components/ui/badge";
import { inputClass } from "@/components/ui/field";
import { RestoreEventButton } from "@/components/admin/restore-event-button";

export const metadata: Metadata = { title: "All events", robots: { index: false } };

const FILTERS: Array<{ key: AdminEventFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "draft", label: "Drafts" },
  { key: "lapsed", label: "Lapsed" },
  { key: "deleted", label: "In the trash" },
];

/**
 * ADM-7: every event on the platform, whoever owns it. Opening one is the
 * event's own dashboard, where a superadmin acts with the owner's powers: every
 * photo and video, folders, moving, hiding, deleting, the trash and the QR.
 */
export default async function AdminEventsPage({ searchParams }: { searchParams: Promise<{ q?: string; state?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "superadmin") redirect("/dashboard");

  const { q = "", state } = await searchParams;
  const filter: AdminEventFilter = FILTERS.some((option) => option.key === state) ? (state as AdminEventFilter) : "all";
  const rows = await listAllEvents(q, filter);
  const hrefFor = (next: AdminEventFilter) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (next !== "all") params.set("state", next);
    const query = params.toString();
    return `/admin/events${query ? `?${query}` : ""}`;
  };

  return (
    <div className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-4xl">
        <AdminNav current="/admin/events" />
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl text-paper">All events</h1>
            <p className="mt-1 text-sm text-muted">
              Open one to see every photo and video in it, sort them into folders, hide or delete them. To make one for
              somebody, use New event for them on their page.
            </p>
          </div>
        </div>
        <form className="mb-4">
          {filter !== "all" && <input type="hidden" name="state" value={filter} />}
          <label htmlFor="admin-events-q" className="sr-only">
            Find an event
          </label>
          <input
            id="admin-events-q"
            name="q"
            defaultValue={q}
            placeholder="An event's name or address, or its owner's name, email or @handle"
            className={inputClass}
          />
        </form>
        <nav className="mb-5 flex flex-wrap gap-2" aria-label="Show">
          {FILTERS.map((option) => (
            <Link
              key={option.key}
              href={hrefFor(option.key)}
              aria-current={filter === option.key ? "page" : undefined}
              className="inline-flex min-h-9 items-center rounded-full border border-canvas-line px-3.5 text-sm text-muted transition-colors hover:text-paper aria-[current=page]:border-transparent aria-[current=page]:bg-paper aria-[current=page]:text-canvas"
            >
              {option.label}
            </Link>
          ))}
        </nav>

        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-canvas-line px-4 py-6 text-center text-sm text-muted">
            {q ? "No event matches that." : "No events here."}
          </p>
        ) : (
          <ul className="divide-y divide-canvas-line rounded-xl border border-canvas-line">
            {rows.map((event) => (
              <li key={event.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-paper">{event.name}</p>
                  <p className="truncate text-xs text-muted">
                    <Link href={`/admin/clients/${event.ownerId}`} className="hover:text-paper">
                      {event.ownerName || event.ownerEmail || "Unnamed account"}
                    </Link>
                    {event.eventDate ? ` · ${event.eventDate}` : ` · made ${event.createdAt}`}
                    {` · ${event.mediaCount} ${event.mediaCount === 1 ? "item" : "items"}`}
                    {` · /e/${event.slug}`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {event.deleted ? (
                    <Badge tone="danger">in the trash</Badge>
                  ) : event.license === "draft" ? (
                    <Badge tone="warning">draft</Badge>
                  ) : event.license === "lapsed" ? (
                    <Badge tone="danger">lapsed</Badge>
                  ) : (
                    <Badge tone="volt">{event.planName ?? "live"}</Badge>
                  )}
                  {event.suspended && <Badge tone="danger">paused</Badge>}
                  <Badge tone="neutral">{event.visibility}</Badge>
                  {event.deleted ? (
                    <RestoreEventButton eventId={event.id} />
                  ) : (
                    <Link
                      href={`/dashboard/events/${event.id}`}
                      className="rounded-full px-2.5 py-1 text-xs text-muted hover:bg-paper/5 hover:text-paper"
                    >
                      Open
                    </Link>
                  )}
                  {!event.deleted && (
                    <a
                      href={`/e/${event.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full px-2.5 py-1 text-xs text-muted hover:bg-paper/5 hover:text-paper"
                    >
                      Gallery
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {rows.length === 300 && <p className="mt-3 text-xs text-muted">Showing the newest 300. Search to narrow it.</p>}
      </div>
    </div>
  );
}
