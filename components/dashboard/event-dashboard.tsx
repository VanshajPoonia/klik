"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MediaGrid } from "@/components/dashboard/media-grid";
import { EventSettingsForm } from "@/components/dashboard/event-settings-form";
import { QrPanel } from "@/components/dashboard/qr-panel";
import { Lightbox } from "@/components/guest/lightbox";
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
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const pending = mediaItems.filter((item) => item.status === "pending");
  const approved = mediaItems.filter((item) => item.status === "approved");
  const rejected = mediaItems.filter((item) => item.status === "rejected");
  const lightboxIndex = lightboxId
    ? mediaItems.findIndex((item) => item.id === lightboxId)
    : -1;
  const downloadBaseUrl = `/api/e/${event.slug}/media`;

  function setBusy(mediaId: string, busy: boolean) {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(mediaId);
      else next.delete(mediaId);
      return next;
    });
  }

  async function setStatus(mediaId: string, status: MediaStatus) {
    const previousStatus = mediaItems.find((item) => item.id === mediaId)?.status;
    if (!previousStatus) return;

    setMediaError(null);
    setBusy(mediaId, true);
    setMediaItems((items) =>
      items.map((item) => (item.id === mediaId ? { ...item, status } : item)),
    );

    try {
      const response = await fetch(`/api/events/${event.id}/media/${mediaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Could not update this item.");
      }
    } catch (error) {
      setMediaItems((items) =>
        items.map((item) => (item.id === mediaId ? { ...item, status: previousStatus } : item)),
      );
      setMediaError(error instanceof Error ? error.message : "Could not update this item.");
    } finally {
      setBusy(mediaId, false);
    }
  }

  async function deleteMedia(mediaId: string) {
    const item = mediaItems.find((candidate) => candidate.id === mediaId);
    if (!item) return;
    if (!window.confirm(`Delete this ${item.kind}? This cannot be undone.`)) return;

    setMediaError(null);
    setBusy(mediaId, true);

    try {
      const response = await fetch(`/api/events/${event.id}/media/${mediaId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Could not delete this item.");
      }
      setMediaItems((items) => items.filter((candidate) => candidate.id !== mediaId));
      if (lightboxId === mediaId) setLightboxId(null);
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : "Could not delete this item.");
    } finally {
      setBusy(mediaId, false);
    }
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

        <nav className="mb-8 flex gap-1 border-b border-canvas-line" aria-label="Event sections">
          {(["gallery", "settings", "qr"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-current={tab === t ? "page" : undefined}
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
            {mediaError && (
              <div
                className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
                role="alert"
              >
                {mediaError}
              </div>
            )}
            {pending.length > 0 && (
              <section>
                <h2 className="mb-4 text-xs font-medium tracking-wide text-muted uppercase">
                  Pending approval ({pending.length})
                </h2>
                <MediaGrid
                  items={pending}
                  onApprove={(id) => void setStatus(id, "approved")}
                  onReject={(id) => void setStatus(id, "rejected")}
                  onDelete={deleteMedia}
                  onOpen={setLightboxId}
                  downloadBaseUrl={downloadBaseUrl}
                  busyIds={busyIds}
                />
              </section>
            )}
            <section>
              <h2 className="mb-4 text-xs font-medium tracking-wide text-muted uppercase">
                Gallery ({approved.length})
              </h2>
              {approved.length === 0 ? (
                <Card className="text-center text-sm text-muted">
                  No approved photos or videos yet. Share the QR code to get started.
                </Card>
              ) : (
                <MediaGrid
                  items={approved}
                  onDelete={deleteMedia}
                  onOpen={setLightboxId}
                  downloadBaseUrl={downloadBaseUrl}
                  busyIds={busyIds}
                />
              )}
            </section>
            {rejected.length > 0 && (
              <section>
                <h2 className="mb-4 text-xs font-medium tracking-wide text-muted uppercase">
                  Rejected ({rejected.length})
                </h2>
                <MediaGrid
                  items={rejected}
                  onApprove={(id) => void setStatus(id, "approved")}
                  onDelete={deleteMedia}
                  onOpen={setLightboxId}
                  downloadBaseUrl={downloadBaseUrl}
                  busyIds={busyIds}
                />
              </section>
            )}
          </div>
        )}

        {tab === "settings" && <EventSettingsForm event={event} />}
        {tab === "qr" && <QrPanel eventId={event.id} slug={event.slug} guestUrl={guestUrl} />}
      </div>

      {lightboxIndex >= 0 && (
        <Lightbox
          items={mediaItems}
          index={lightboxIndex}
          onIndexChange={(next) => setLightboxId(mediaItems[next]?.id ?? null)}
          onClose={() => setLightboxId(null)}
          canDownload
          downloadBaseUrl={downloadBaseUrl}
        />
      )}
    </div>
  );
}
