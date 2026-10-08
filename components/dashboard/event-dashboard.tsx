"use client";

import type { AssignableRole } from "@/lib/permissions";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Download, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MediaGrid, type DashboardMedia } from "@/components/dashboard/media-grid";
import { EventSettingsForm } from "@/components/dashboard/event-settings-form";
import { QrPanel } from "@/components/dashboard/qr-panel";
import { LicenseBanner, type EventLicenseSummary } from "@/components/dashboard/license-banner";
import { AlbumManager } from "@/components/dashboard/album-manager";
import { CoHostManager } from "@/components/dashboard/co-host-manager";
import { ShareSheet } from "@/components/dashboard/share-sheet";
import { ShareLinksPanel } from "@/components/dashboard/share-links-panel";
import { Lightbox } from "@/components/guest/lightbox";
import type { OrganizerEvent } from "@/lib/events";
import type { Album, VenueClient } from "@/lib/schema";
import type { MediaStatus, MediaVisibility } from "@/lib/schema";
import { formatFileSize } from "@/lib/plans";
import { buildDownloadBatches } from "@/lib/download-batches";

type Tab = "gallery" | "links" | "settings" | "qr";

export function EventDashboard({
  event,
  initialMedia,
  guestUrl,
  backHref = "/dashboard",
  canManageClients = false,
  canSlideshow = false,
  canManageAlbums = false,
  canManageCoHosts = false,
  canManageShares = false,
  canCustomizeGallery = false,
  canCustomizeQr = false,
  canDownloadQrSign = false,
  canUseVenueHub = false,
  canDeleteEvent = false,
  license = { state: "live", canGoLive: false, requestedAt: null },
  albums = [],
  coHosts = [],
  clients = [],
}: {
  event: OrganizerEvent;
  initialMedia: DashboardMedia[];
  guestUrl: string;
  backHref?: string;
  canManageClients?: boolean;
  canSlideshow?: boolean;
  canManageAlbums?: boolean;
  canManageCoHosts?: boolean;
  canManageShares?: boolean;
  canCustomizeGallery?: boolean;
  canCustomizeQr?: boolean;
  canDownloadQrSign?: boolean;
  canUseVenueHub?: boolean;
  canDeleteEvent?: boolean;
  license?: EventLicenseSummary;
  albums?: Album[];
  coHosts?: Array<{
    id: string;
    name: string | null;
    email: string | null;
    username: string | null;
    role: AssignableRole;
  }>;
  clients?: VenueClient[];
}) {
  const [tab, setTab] = useState<Tab>("gallery");
  const [mediaItems, setMediaItems] = useState(initialMedia);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  // The photo whose share sheet is open. Held as an id rather than the row so it
  // cannot go stale when the list behind it changes.
  const [shareMediaId, setShareMediaId] = useState<string | null>(null);

  const pending = mediaItems.filter((item) => item.status === "pending");
  const approved = mediaItems.filter((item) => item.status === "approved");
  const rejected = mediaItems.filter((item) => item.status === "rejected");
  const selectedItems = approved.filter((item) => selectedIds.has(item.id));
  const selectedDownloadParts = buildDownloadBatches(selectedItems);
  const downloadParts = buildDownloadBatches(approved).map((items) => ({
    itemCount: items.length,
    sizeBytes: items.reduce((total, item) => total + item.sizeBytes, 0),
  }));
  const lightboxIndex = lightboxId
    ? mediaItems.findIndex((item) => item.id === lightboxId)
    : -1;
  const downloadBaseUrl = `/api/e/${event.slug}/media`;

  function toggleSelection(mediaId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(mediaId)) next.delete(mediaId);
      else next.add(mediaId);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function stopSelecting() {
    clearSelection();
    setSelectionMode(false);
  }

  function setBusy(mediaId: string, busy: boolean) {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(mediaId);
      else next.delete(mediaId);
      return next;
    });
  }

  /**
   * Visibility is changed the same optimistic way as status, and separately,
   * because the two are orthogonal: hiding a photo must not send it back to the
   * moderation queue, and approving one must not un-hide it.
   */
  async function setVisibility(mediaId: string, visibility: MediaVisibility) {
    const previous = mediaItems.find((item) => item.id === mediaId)?.visibility;
    if (!previous || previous === visibility) return;

    setMediaError(null);
    setBusy(mediaId, true);
    setMediaItems((items) =>
      items.map((item) => (item.id === mediaId ? { ...item, visibility } : item)),
    );

    try {
      const response = await fetch(`/api/events/${event.id}/media/${mediaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Could not change who can see this.");
      }
    } catch (error) {
      // Roll back rather than leave the grid claiming a photo is hidden when
      // the server still has it in the gallery. Getting this wrong is worse
      // than a failed request: the organizer believes it is private.
      setMediaItems((items) =>
        items.map((item) => (item.id === mediaId ? { ...item, visibility: previous } : item)),
      );
      setMediaError(
        error instanceof Error ? error.message : "Could not change who can see this.",
      );
    } finally {
      setBusy(mediaId, false);
    }
  }

  async function setStatus(mediaId: string, status: MediaStatus) {
    const previousStatus = mediaItems.find((item) => item.id === mediaId)?.status;
    if (!previousStatus) return;

    setMediaError(null);
    setBusy(mediaId, true);
    setMediaItems((items) =>
      items.map((item) => (item.id === mediaId ? { ...item, status } : item)),
    );
    if (status !== "approved") {
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(mediaId);
        return next;
      });
    }

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
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(mediaId);
        return next;
      });
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
    <div
      className={`min-h-screen px-6 pt-10 md:px-10 ${
        tab === "gallery" && selectionMode && selectedItems.length > 0 ? "pb-32" : "pb-10"
      }`}
    >
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <Link
            href={backHref}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted transition-colors hover:text-paper"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            All events
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

        <LicenseBanner eventId={event.id} license={license} />

        <nav className="mb-8 flex gap-1 border-b border-canvas-line" aria-label="Event sections">
          {(
            canManageShares
              ? (["gallery", "links", "settings", "qr"] as Tab[])
              : (["gallery", "settings", "qr"] as Tab[])
          ).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-current={tab === t ? "page" : undefined}
              className={`min-h-11 border-b-2 px-4 text-sm font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-volt ${
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
                  onVisibilityChange={setVisibility}
                  onShare={canManageShares ? setShareMediaId : undefined}
                />
              </section>
            )}
            <section>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xs font-medium tracking-wide text-muted uppercase">
                  Gallery ({approved.length})
                </h2>
                {approved.length > 0 && (
                  <div className="flex items-center gap-2">
                    {selectionMode && (
                      <button
                        type="button"
                        onClick={() =>
                          selectedIds.size === approved.length
                            ? clearSelection()
                            : setSelectedIds(new Set(approved.map((item) => item.id)))
                        }
                        className="min-h-10 rounded-full px-3 text-sm text-volt transition-colors hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
                      >
                        {selectedIds.size === approved.length ? "Deselect all" : "Select all"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (selectionMode) stopSelecting();
                        else setSelectionMode(true);
                      }}
                      className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt ${
                        selectionMode
                          ? "border-volt text-volt"
                          : "border-canvas-line text-paper hover:border-volt/50 hover:text-volt"
                      }`}
                    >
                      {selectionMode ? (
                        <X className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      )}
                      {selectionMode ? "Cancel" : "Select items"}
                    </button>
                  </div>
                )}
              </div>
              {approved.length === 0 ? (
                <Card className="text-center text-sm text-muted">
                  No approved photos or videos yet. Share the QR code to get started.
                </Card>
              ) : (
                <MediaGrid
                  items={approved}
                  onDelete={deleteMedia}
                  onOpen={setLightboxId}
                  selectionMode={selectionMode}
                  selectedIds={selectedIds}
                  onSelectionToggle={toggleSelection}
                  downloadBaseUrl={downloadBaseUrl}
                  busyIds={busyIds}
                  albums={canManageAlbums ? albums : undefined}
                  onAlbumChange={canManageAlbums ? setAlbum : undefined}
                  onVisibilityChange={setVisibility}
                  onShare={canManageShares ? setShareMediaId : undefined}
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
                  onVisibilityChange={setVisibility}
                  onShare={canManageShares ? setShareMediaId : undefined}
                />
              </section>
            )}
          </div>
        )}

        {tab === "links" && canManageShares && (
          <ShareLinksPanel eventId={event.id} slug={event.slug} />
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
        {tab === "qr" &&
          (license.state === "draft" ? (
            // ACT-3: no QR code before the event is live. One printed now
            // would either fail for every guest or start working unannounced.
            <div className="max-w-md rounded-2xl border border-dashed border-canvas-line px-6 py-10 text-center">
              <p className="font-medium text-paper">Your QR code is made when the event goes live</p>
              <p className="mt-2 text-sm text-muted">
                It is permanent once printed, so it is not created for a draft.
              </p>
            </div>
          ) : (
            <QrPanel
              eventId={event.id}
              slug={event.slug}
              guestUrl={guestUrl}
              canDownloadSign={canDownloadQrSign}
            />
          ))}
      </div>

      {tab === "gallery" && selectionMode && selectedItems.length > 0 && (
        <aside
          className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-2xl bg-paper/95 p-3 pl-4 text-canvas backdrop-blur sm:rounded-full"
          aria-label="Selected media download"
        >
          <div className="mr-auto min-w-0">
            <p className="text-sm font-semibold">
              {selectedItems.length} {selectedItems.length === 1 ? "item" : "items"} selected
            </p>
            <p className="text-xs text-canvas/65">
              {formatFileSize(
                selectedItems.reduce((total, item) => total + item.sizeBytes, 0),
              )}
              {selectedDownloadParts.length > 1
                ? ` in ${selectedDownloadParts.length} ZIP files`
                : " in one ZIP file"}
            </p>
          </div>
          <button
            type="button"
            onClick={clearSelection}
            className="min-h-10 rounded-full px-3 text-sm text-canvas/80 transition-colors hover:bg-canvas/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-canvas"
          >
            Clear
          </button>
          {selectedDownloadParts.map((part, index) => (
            <form
              key={part.map((item) => item.id).join("-")}
              action={`/api/events/${event.id}/download`}
              method="post"
            >
              {part.map((item) => (
                <input key={item.id} type="hidden" name="mediaId" value={item.id} />
              ))}
              <button
                type="submit"
                className="inline-flex min-h-10 items-center gap-2 rounded-full bg-canvas px-4 text-sm font-medium text-paper transition-colors hover:bg-canvas-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-canvas focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                {selectedDownloadParts.length === 1
                  ? `Download ${selectedItems.length}`
                  : `ZIP ${index + 1} of ${selectedDownloadParts.length}`}
              </button>
            </form>
          ))}
        </aside>
      )}

      {lightboxIndex >= 0 && (
        <Lightbox
          items={mediaItems}
          index={lightboxIndex}
          onIndexChange={(next) => setLightboxId(mediaItems[next]?.id ?? null)}
          onClose={() => setLightboxId(null)}
          canDownload
          canSlideshow={canSlideshow}
          downloadBaseUrl={downloadBaseUrl}
          onShare={canManageShares ? setShareMediaId : undefined}
        />
      )}

      {shareMediaId && (
        <ShareSheet
          eventId={event.id}
          mediaId={shareMediaId}
          mediaKind={
            mediaItems.find((item) => item.id === shareMediaId)?.kind ?? "photo"
          }
          onClose={() => setShareMediaId(null)}
        />
      )}
    </div>
  );
}
