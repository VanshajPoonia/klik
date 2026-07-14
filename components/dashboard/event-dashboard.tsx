"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MediaGrid } from "@/components/dashboard/media-grid";
import { EventSettingsForm } from "@/components/dashboard/event-settings-form";
import { QrPanel } from "@/components/dashboard/qr-panel";
import type { PublicEvent } from "@/lib/events";
import type { Media, MediaStatus } from "@/lib/schema";

type Tab = "gallery" | "settings" | "qr";

export function EventDashboard({
  event,
  initialMedia,
  guestUrl,
  backHref = "/dashboard",
}: {
  event: PublicEvent;
  initialMedia: Media[];
  guestUrl: string;
  backHref?: string;
}) {
  const [tab, setTab] = useState<Tab>("gallery");
  const [mediaItems, setMediaItems] = useState(initialMedia);

  const pending = mediaItems.filter((item) => item.status === "pending");
  const approved = mediaItems.filter((item) => item.status === "approved");

  function setStatus(mediaId: string, status: MediaStatus) {
    setMediaItems((items) => items.map((item) => (item.id === mediaId ? { ...item, status } : item)));
    fetch(`/api/events/${event.id}/media/${mediaId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  function deleteMedia(mediaId: string) {
    setMediaItems((items) => items.filter((item) => item.id !== mediaId));
    fetch(`/api/events/${event.id}/media/${mediaId}`, { method: "DELETE" });
  }

  return (
    <div className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <Link href={backHref} className="text-sm text-muted hover:text-paper">
            ← All events
          </Link>
        </div>

        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl text-paper">{event.name}</h1>
            <p className="mt-1 text-sm text-muted">/e/{event.slug}</p>
          </div>
          <div className="flex gap-2">
            <Badge tone={event.visibility === "public" ? "volt" : "neutral"}>{event.visibility}</Badge>
            {event.moderation && <Badge tone="warning">moderated</Badge>}
            {!event.uploadsEnabled && <Badge tone="danger">uploads closed</Badge>}
          </div>
        </header>

        <nav className="mb-8 flex gap-1 border-b border-canvas-line">
          {(["gallery", "settings", "qr"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`border-b-2 px-4 py-2.5 text-sm font-medium capitalize transition-colors ${
                tab === t ? "border-volt text-paper" : "border-transparent text-muted hover:text-paper"
              }`}
            >
              {t === "qr" ? "QR code" : t}
            </button>
          ))}
        </nav>

        {tab === "gallery" && (
          <div className="space-y-10">
            {pending.length > 0 && (
              <section>
                <h2 className="mb-4 text-xs font-medium tracking-wide text-muted uppercase">
                  Pending approval ({pending.length})
                </h2>
                <MediaGrid
                  items={pending}
                  onApprove={(id) => setStatus(id, "approved")}
                  onReject={(id) => setStatus(id, "rejected")}
                  onDelete={deleteMedia}
                />
              </section>
            )}
            <section>
              <h2 className="mb-4 text-xs font-medium tracking-wide text-muted uppercase">
                Gallery ({approved.length})
              </h2>
              {approved.length === 0 ? (
                <Card className="text-center text-sm text-muted">
                  No photos yet - share the QR code to get started.
                </Card>
              ) : (
                <MediaGrid items={approved} onDelete={deleteMedia} />
              )}
            </section>
          </div>
        )}

        {tab === "settings" && <EventSettingsForm event={event} />}
        {tab === "qr" && <QrPanel eventId={event.id} slug={event.slug} guestUrl={guestUrl} />}
      </div>
    </div>
  );
}
