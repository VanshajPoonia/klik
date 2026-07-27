"use client";

import { useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MediaGrid } from "@/components/dashboard/media-grid";
import { EventSettingsForm } from "@/components/dashboard/event-settings-form";
import { QrPanel } from "@/components/dashboard/qr-panel";
import { AlbumManager } from "@/components/dashboard/album-manager";
import { CoHostManager } from "@/components/dashboard/co-host-manager";
import { Lightbox } from "@/components/guest/lightbox";
import type { OrganizerEvent } from "@/lib/events";
import type { Album, Media, VenueClient } from "@/lib/schema";
import type { MediaStatus } from "@/lib/schema";
import { formatFileSize } from "@/lib/plans";
import { buildDownloadBatches } from "@/lib/download-batches";

type Tab = "gallery" | "settings" | "qr";

export function EventDashboard({
  event,
  initialMedia,
  guestUrl,
  backHref = "/dashboard",
  canManageClients = false,
  canSlideshow = false,
  canManageAlbums = false,
  canManageCoHosts = false,
  canCustomizeGallery = false,
  canCustomizeQr = false,
  canDownloadQrSign = false,
  canUseVenueHub = false,
  canDeleteEvent = false,
  albums = [],
  coHosts = [],
  clients = [],
}: {
  event: OrganizerEvent;
  initialMedia: Media[];
  guestUrl: string;
  backHref?: string;
  canManageClients?: boolean;
  canSlideshow?: boolean;
  canManageAlbums?: boolean;
  canManageCoHosts?: boolean;
  canCustomizeGallery?: boolean;
  canCustomizeQr?: boolean;
  canDownloadQrSign?: boolean;
  canUseVenueHub?: boolean;
  canDeleteEvent?: boolean;
  albums?: Album[];
  coHosts?: Array<{
    id: string;
    name: string | null;
    email: string | null;
    username: string | null;
  }>;
  clients?: VenueClient[];
}) {
  const [tab, setTab] = useState<Tab>("gallery");
  const [mediaItems, setMediaItems] = useState(initialMedia);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const pending = mediaItems.filter((item) => item.status === "pending");
  const approved = mediaItems.filter((item) => item.status === "approved");
  const rejected = mediaItems.filter((item) => item.status === "rejected");
  const downloadParts = buildDownloadBatches(approved).map((items) => ({
    itemCount: items.length,
    sizeBytes: items.reduce((total, item) => total + item.sizeBytes, 0),
  }));
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

  async function setAlbum(mediaId: string, albumId: string | null) {
    const previousAlbumId = mediaItems.find((item) => item.id === mediaId)?.albumId ?? null;
    setMediaError(null);
    setBusy(mediaId, true);
    setMediaItems((items) =>
      items.map((item) => (item.id === mediaId ? { ...item, albumId } : item)),
    );
    try {
      const response = await fetch(`/api/events/${event.id}/media/${mediaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ albumId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Could not move this item.");
      }
    } catch (error) {
      setMediaItems((items) =>
        items.map((item) =>
          item.id === mediaId ? { ...item, albumId: previousAlbumId } : item,
        ),
      );
      setMediaError(error instanceof Error ? error.message : "Could not move this item.");
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
          <div className="flex flex-wrap items-center justify-end gap-2">
            {downloadParts.length === 1 && (
              <a
                href={`/api/events/${event.id}/download`}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-canvas-line px-4 text-sm font-medium text-paper transition-colors hover:border-volt/50 hover:text-volt"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download ZIP
              </a>
            )}
            <Badge tone={event.visibility === "public" ? "volt" : "neutral"}>
              {event.visibility}
            </Badge>
            {event.moderation && <Badge tone="warning">moderated</Badge>}
            {!event.isActive && <Badge tone="neutral">event ended</Badge>}
            {!event.uploadsEnabled && <Badge tone="danger">uploads closed</Badge>}
            {event.purgedAt && <Badge tone="danger">storage cleared</Badge>}
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
            {downloadParts.length > 1 && (
              <section className="flex flex-wrap items-center gap-3 border-b border-canvas-line pb-6">
                <p className="mr-auto max-w-md text-sm text-muted">
                  This gallery is split into {downloadParts.length} ZIP files for reliable
                  downloads.
                </p>
                {downloadParts.map((part, index) => (
                  <a
                    key={`part-${index + 1}`}
                    href={`/api/events/${event.id}/download?part=${index + 1}`}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full border border-canvas-line px-4 text-sm font-medium text-paper transition-colors hover:border-volt/50 hover:text-volt"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Part {index + 1}
                    <span className="text-xs text-muted">
                      {part.itemCount} items, {formatFileSize(part.sizeBytes)}
                    </span>
                  </a>
                ))}
              </section>
            )}
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
                  albums={canManageAlbums ? albums : undefined}
                  onAlbumChange={canManageAlbums ? setAlbum : undefined}
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
                  albums={canManageAlbums ? albums : undefined}
                  onAlbumChange={canManageAlbums ? setAlbum : undefined}
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
                  albums={canManageAlbums ? albums : undefined}
                  onAlbumChange={canManageAlbums ? setAlbum : undefined}
                />
              </section>
            )}
          </div>
        )}

        {tab === "settings" && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.75fr)]">
            <EventSettingsForm
              event={event}
              canManageClients={canManageClients}
              canCustomizeGallery={canCustomizeGallery}
              canCustomizeQr={canCustomizeQr}
              canUseVenueHub={canUseVenueHub}
              canDeleteEvent={canDeleteEvent}
              approvedMedia={approved}
              clients={clients}
            />
            {(canManageAlbums || canManageCoHosts) && (
              <div className="space-y-5">
                {canManageAlbums && (
                  <AlbumManager
                    eventId={event.id}
                    initialAlbums={albums}
                    onDeleted={(albumId) =>
                      setMediaItems((items) =>
                        items.map((item) =>
                          item.albumId === albumId ? { ...item, albumId: null } : item,
                        ),
                      )
                    }
                  />
                )}
                {canManageCoHosts && (
                  <CoHostManager eventId={event.id} initialCoHosts={coHosts} />
                )}
              </div>
            )}
          </div>
        )}
        {tab === "qr" && (
          <QrPanel
            eventId={event.id}
            slug={event.slug}
            guestUrl={guestUrl}
            canDownloadSign={canDownloadQrSign}
          />
        )}
      </div>

      {lightboxIndex >= 0 && (
        <Lightbox
          items={mediaItems}
          index={lightboxIndex}
          onIndexChange={(next) => setLightboxId(mediaItems[next]?.id ?? null)}
          onClose={() => setLightboxId(null)}
          canDownload
          canSlideshow={canSlideshow}
          downloadBaseUrl={downloadBaseUrl}
        />
      )}
    </div>
  );
}
