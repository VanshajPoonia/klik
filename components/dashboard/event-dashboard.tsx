"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Download, X, MonitorPlay } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MediaGrid, type DashboardMedia } from "@/components/dashboard/media-grid";
import { EventSettingsForm } from "@/components/dashboard/event-settings-form";
import { QrPanel } from "@/components/dashboard/qr-panel";
import { LicenseBanner, type EventLicenseSummary } from "@/components/dashboard/license-banner";
import {
  FolderBrowser,
  viewedMoment,
  type DashboardFolder,
  type DashboardMoment,
  type FolderView,
} from "@/components/dashboard/folder-browser";
import { flattenFolders, inFolder } from "@/lib/folder-tree";
import { CoHostManager, type CoHost, type PendingInvite } from "@/components/dashboard/co-host-manager";
import { TeamActivity } from "@/components/dashboard/team-activity";
import { TransferOffer } from "@/components/dashboard/transfer-offer";
import type { ActivityEntry } from "@/lib/activity";
import { ShareSheet } from "@/components/dashboard/share-sheet";
import { ShareLinksPanel } from "@/components/dashboard/share-links-panel";
import { Lightbox } from "@/components/guest/lightbox";
import type { OrganizerEvent } from "@/lib/events";
import type { Album, VenueClient } from "@/lib/schema";
import type { MediaStatus, MediaVisibility } from "@/lib/schema";
import { formatFileSize } from "@/lib/plans";
import { INLINE_ZIP_LIMIT_BYTES, buildDownloadBatches } from "@/lib/download-batches";
import { ExportsPanel } from "@/components/dashboard/exports-panel";
import { TrashPanel } from "@/components/dashboard/trash-panel";
import { InsightsPanel } from "@/components/dashboard/insights-panel";
import { UsageMeter, type UsageSummary } from "@/components/dashboard/usage-meter";
import { ReportedComments, type ReportedCommentRow } from "@/components/dashboard/reported-comments";
import { KioskPanel } from "@/components/dashboard/kiosk-panel";
import { ChallengesPanel } from "@/components/dashboard/challenges-panel";

type Tab = "gallery" | "insights" | "links" | "settings" | "qr" | "trash";

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
  canManageTrash = false,
  canModerateComments = false,
  canManageKiosks = false,
  canManageChallenges = false,
  reportedComments = [],
  usage = null,
  addressing = null,
  license = { state: "live", canGoLive: false, requestedAt: null },
  albums = [],
  moments: initialMoments = [],
  coHosts = [],
  team = null,
  activity = null,
  transferOffer = null,
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
  canManageTrash?: boolean;
  /** MED-9: hide and show comments, which is moderating like approving photos. */
  canModerateComments?: boolean;
  /** VEN-2: set up and switch off kiosks, on a plan that has them. */
  canManageKiosks?: boolean;
  /** GRW-3: set the photo challenges and the leaderboard switch. */
  canManageChallenges?: boolean;
  reportedComments?: ReportedCommentRow[];
  usage?: UsageSummary | null;
  addressing?: { origin: string; formerSlugs: string[] } | null;
  license?: EventLicenseSummary;
  albums?: Album[];
  /** AI-1: the event's moments, when there are at least two. */
  moments?: DashboardMoment[];
  coHosts?: CoHost[];
  /** ORG-3/4: what the team card needs beyond its members. */
  team?: { isOwner: boolean; invites: PendingInvite[]; transferTo: string | null } | null;
  activity?: ActivityEntry[] | null;
  /** ORG-4: set when this event has been offered to the person viewing it. */
  transferOffer?: { fromName: string } | null;
  clients?: VenueClient[];
}) {
  const [tab, setTab] = useState<Tab>("gallery");
  const router = useRouter();
  const [mediaItems, setMediaItems] = useState(initialMedia);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  // The photo whose share sheet is open. Held as an id rather than the row so it
  // cannot go stale when the list behind it changes.
  const [shareMediaId, setShareMediaId] = useState<string | null>(null);

  // MED-4. The folder tree is held here because the grid, the selection bar
  // and the browser all read it, and any of them can change what is in it.
  const [folders, setFolders] = useState<DashboardFolder[]>(() =>
    albums.map((album) => ({
      id: album.id,
      name: album.name,
      parentId: album.parentId,
      position: album.position,
      coverMediaId: album.coverMediaId,
      createdAt: album.createdAt,
    })),
  );
  const [chosenView, setChosenView] = useState<FolderView>("all");
  const [moments, setMoments] = useState<DashboardMoment[]>(initialMoments);

  const pending = mediaItems.filter((item) => item.status === "pending");
  const approved = mediaItems.filter((item) => item.status === "approved");
  // A folder deleted while open drops back to everything.
  const chosenMoment = viewedMoment(chosenView);
  const folderView: FolderView =
    chosenView === "all" ||
    chosenView === "unfiled" ||
    folders.some((folder) => folder.id === chosenView) ||
    (chosenMoment && moments.some((moment) => moment.id === chosenMoment))
      ? chosenView
      : "all";
  const viewMoment = viewedMoment(folderView);
  const currentFolder = folderView !== "all" && folderView !== "unfiled" && !viewMoment ? folderView : null;
  // Inside a folder, what is filed there itself; what is in folders beneath it
  // is a click away on their cards.
  const shownApproved =
    folderView === "all"
      ? approved
      : folderView === "unfiled"
        ? inFolder(approved, folders, null)
        : viewMoment
          ? approved.filter((item) => item.momentId === viewMoment)
          : inFolder(approved, folders, folderView, { deep: false });
  const showFolders = canManageAlbums || folders.length > 0 || moments.length > 1;
  const rejected = mediaItems.filter((item) => item.status === "rejected");
  const selectedItems = approved.filter((item) => selectedIds.has(item.id));
  const selectedDownloadParts = buildDownloadBatches(selectedItems);
  const approvedBytes = approved.reduce((total, item) => total + item.sizeBytes, 0);
  const selectedBytes = selectedItems.reduce((total, item) => total + item.sizeBytes, 0);
  // MED-7. Small enough streams straight to the browser as it always has; past
  // the limit it is packed in the background and downloaded from storage.
  const streamsInline = approvedBytes <= INLINE_ZIP_LIMIT_BYTES;
  const selectionStreamsInline = selectedBytes <= INLINE_ZIP_LIMIT_BYTES;
  const [exportVersion, setExportVersion] = useState(0);
  const [selectionExportState, setSelectionExportState] = useState<string | null>(null);

  async function exportSelection() {
    setSelectionExportState("Starting…");
    const response = await fetch(`/api/events/${event.id}/exports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaIds: selectedItems.map((item) => item.id) }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setSelectionExportState(body.error ?? "Could not start the download");
      return;
    }
    setSelectionExportState("Preparing. It appears above when ready, and we will email you.");
    setExportVersion((version) => version + 1);
  }
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
    // It goes to the trash, not away: say so, because "cannot be undone" was
    // false and made people afraid to tidy their own gallery.
    if (!window.confirm(`Move this ${item.kind} to the trash? You can restore it for 30 days.`)) return;

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

  // MED-5: actions on the whole selection. Deleted items are kept here so Undo
  // can put them back without a reload; the server keeps them in the trash.
  const [bulkBusy, setBulkBusy] = useState(false);
  const [undo, setUndo] = useState<{ items: DashboardMedia[]; label: string } | null>(null);

  type BulkRequest =
    | { action: "approve" | "reject" | "delete" | "restore" }
    | { action: "visibility"; visibility: MediaVisibility }
    | { action: "move"; albumId: string | null };

  async function runBulk(request: BulkRequest, ids: string[]) {
    if (ids.length === 0) return;
    setBulkBusy(true);
    setMediaError(null);
    try {
      const response = await fetch(`/api/events/${event.id}/media/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, ids }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? "Could not update the selection.");
      const changed = new Set<string>(data.changed ?? []);
      if (request.action === "delete") {
        const removed = mediaItems.filter((item) => changed.has(item.id));
        setMediaItems((items) => items.filter((item) => !changed.has(item.id)));
        setUndo({ items: removed, label: `Moved ${removed.length} to the trash` });
        clearSelection();
      } else if (request.action === "restore") {
        setMediaItems((items) => [...(undo?.items.filter((item) => changed.has(item.id)) ?? []), ...items]);
        setUndo(null);
      } else {
        setMediaItems((items) =>
          items.map((item) => {
            if (!changed.has(item.id)) return item;
            if (request.action === "approve") return { ...item, status: "approved" as MediaStatus };
            if (request.action === "reject") return { ...item, status: "rejected" as MediaStatus };
            if (request.action === "visibility") return { ...item, visibility: request.visibility };
            if (request.action === "move") return { ...item, albumId: request.albumId };
            return item;
          }),
        );
        if (request.action === "reject") clearSelection();
      }
      if (changed.size < ids.length && request.action !== "restore") {
        setMediaError(`${ids.length - changed.size} could not be changed. Anything Klik is reviewing stays as it is.`);
      }
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : "Could not update the selection.");
    } finally {
      setBulkBusy(false);
    }
  }

  /** MED-4: the host picks a folder's cover from what is in it. */
  async function setFolderCover(folderId: string, mediaId: string) {
    setMediaError(null);
    const response = await fetch(`/api/events/${event.id}/albums/${folderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coverMediaId: mediaId }),
    }).catch(() => null);
    if (!response?.ok) {
      const data = response ? await response.json().catch(() => null) : null;
      setMediaError(data?.error ?? "Could not set the cover.");
      return;
    }
    setFolders((current) =>
      current.map((folder) => (folder.id === folderId ? { ...folder, coverMediaId: mediaId } : folder)),
    );
  }

  /** TRS-1: the host looked at a reported photo and is keeping it. Reports on
   *  something they delete are closed by the delete itself being the answer. */
  async function clearReports(mediaId: string) {
    setMediaError(null);
    setBusy(mediaId, true);
    try {
      const response = await fetch(`/api/events/${event.id}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId, resolution: "dismissed" }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Could not clear the reports.");
      }
      setMediaItems((items) =>
        items.map((item) => (item.id === mediaId ? { ...item, openReports: 0 } : item)),
      );
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : "Could not clear the reports.");
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
            {canSlideshow && license.state === "live" && (
              // VEN-1. A new tab, because it goes on the laptop plugged into the
              // projector, and the dashboard should stay where it was.
              <a
                href={`/e/${event.slug}/live`}
                target="_blank"
                rel="noopener"
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-canvas-line px-4 text-sm font-medium text-paper transition-colors hover:border-volt/50 hover:text-volt"
              >
                <MonitorPlay className="h-4 w-4" aria-hidden="true" />
                Live display
              </a>
            )}
            {approved.length > 0 && streamsInline && (
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

        {transferOffer && <TransferOffer eventId={event.id} fromName={transferOffer.fromName} />}
        <LicenseBanner eventId={event.id} license={license} />
        {usage && license.state !== "draft" && <UsageMeter usage={usage} />}

        <nav className="mb-8 flex gap-1 border-b border-canvas-line" aria-label="Event sections">
          {(
            [
              "gallery",
              ...(license.state !== "draft" ? ["insights"] : []),
              ...(canManageShares ? ["links"] : []),
              "settings",
              "qr",
              ...(canManageTrash ? ["trash"] : []),
            ] as Tab[]
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
            {(!streamsInline || exportVersion > 0) && (
              <ExportsPanel
                eventId={event.id}
                approvedCount={approved.length}
                approvedBytes={approvedBytes}
                refreshKey={exportVersion}
              />
            )}
            {mediaError && (
              <div
                className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
                role="alert"
              >
                {mediaError}
              </div>
            )}
            {canModerateComments && (
              <ReportedComments slug={event.slug} rows={reportedComments} onOpenMedia={setLightboxId} />
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
                  onClearReports={clearReports}
                  onOpen={setLightboxId}
                  downloadBaseUrl={downloadBaseUrl}
                  busyIds={busyIds}
                  albums={canManageAlbums ? folders : undefined}
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
                          shownApproved.length > 0 && shownApproved.every((item) => selectedIds.has(item.id))
                            ? clearSelection()
                            : setSelectedIds(new Set(shownApproved.map((item) => item.id)))
                        }
                        className="min-h-10 rounded-full px-3 text-sm text-volt transition-colors hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt"
                      >
                        {shownApproved.length > 0 && shownApproved.every((item) => selectedIds.has(item.id))
                          ? "Deselect all"
                          : folderView === "all"
                            ? "Select all"
                            : "Select all here"}
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
              {showFolders && (
                <div className="mb-5">
                  <FolderBrowser
                    eventId={event.id}
                    folders={folders}
                    onFoldersChange={setFolders}
                    items={approved}
                    view={folderView}
                    onViewChange={setChosenView}
                    canManage={canManageAlbums}
                    onDropMedia={(ids, folderId) => void runBulk({ action: "move", albumId: folderId }, ids)}
                    moments={moments}
                    onMomentsChange={setMoments}
                  />
                </div>
              )}
              {approved.length === 0 ? (
                <Card className="text-center text-sm text-muted">
                  No approved photos or videos yet. Share the QR code to get started.
                </Card>
              ) : shownApproved.length === 0 ? (
                <Card className="text-center text-sm text-muted">
                  {folderView === "unfiled"
                    ? "Everything is in a folder."
                    : viewMoment
                      ? "Nothing from this moment is in the gallery."
                    : "Nothing is filed directly in this folder. Drag photos onto it, or select some and move them here."}
                </Card>
              ) : (
                <MediaGrid
                  items={shownApproved}
                  onDelete={deleteMedia}
                  onClearReports={clearReports}
                  onOpen={setLightboxId}
                  selectionMode={selectionMode}
                  selectedIds={selectedIds}
                  onSelectionToggle={toggleSelection}
                  downloadBaseUrl={downloadBaseUrl}
                  busyIds={busyIds}
                  albums={canManageAlbums ? folders : undefined}
                  onAlbumChange={canManageAlbums ? setAlbum : undefined}
                  onVisibilityChange={setVisibility}
                  onShare={canManageShares ? setShareMediaId : undefined}
                  // A selected tile drags the whole selection with it.
                  dragIds={
                    canManageAlbums && folders.length > 0
                      ? (id) => (selectionMode && selectedIds.has(id) ? [...selectedIds] : [id])
                      : undefined
                  }
                  coverId={currentFolder ? (folders.find((folder) => folder.id === currentFolder)?.coverMediaId ?? null) : null}
                  onSetCover={canManageAlbums && currentFolder ? (id) => void setFolderCover(currentFolder, id) : undefined}
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
                  onClearReports={clearReports}
                  onOpen={setLightboxId}
                  downloadBaseUrl={downloadBaseUrl}
                  busyIds={busyIds}
                  albums={canManageAlbums ? folders : undefined}
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
              addressing={addressing}
            />
            {(canManageCoHosts || activity || canManageChallenges) && (
              <div className="space-y-5">
                {canManageChallenges && <ChallengesPanel eventId={event.id} />}
                {canManageCoHosts && (
                  <CoHostManager
                    eventId={event.id}
                    isOwner={team?.isOwner ?? false}
                    initialCoHosts={coHosts}
                    initialInvites={team?.invites ?? []}
                    initialTransferTo={team?.transferTo ?? null}
                  />
                )}
                {activity && <TeamActivity entries={activity} />}
              </div>
            )}
          </div>
        )}
        {tab === "trash" && canManageTrash && <TrashPanel eventId={event.id} />}
        {tab === "insights" && <InsightsPanel eventId={event.id} slug={event.slug} />}
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
            <div className="flex flex-wrap items-start gap-6">
              <QrPanel
                eventId={event.id}
                slug={event.slug}
                guestUrl={guestUrl}
                eventName={event.name}
                accent={canCustomizeGallery ? event.accentColor : "#edee00"}
                template={canCustomizeQr ? event.qrTemplate : "classic"}
                canDownloadSign={canDownloadQrSign}
                canStyle={canCustomizeQr}
              />
              {canManageKiosks && <KioskPanel eventId={event.id} folders={canManageAlbums ? folders : []} />}
            </div>
          ))}
      </div>

      {tab === "gallery" && selectionMode && selectedItems.length > 0 && (
        <aside
          className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-2xl bg-paper/95 p-3 pl-4 text-canvas backdrop-blur sm:rounded-full"
          aria-label="Selected media"
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
          <label className="sr-only" htmlFor="bulk-action">
            Do something with the selection
          </label>
          <select
            id="bulk-action"
            value=""
            disabled={bulkBusy}
            onChange={(change) => {
              const value = change.target.value;
              const ids = selectedItems.map((item) => item.id);
              if (value === "delete") {
                if (window.confirm(`Move ${ids.length} to the trash? You can undo, and restore from the trash for 30 days.`)) {
                  void runBulk({ action: "delete" }, ids);
                }
              } else if (value === "reject") void runBulk({ action: "reject" }, ids);
              else if (value === "private" || value === "gallery" || value === "link") {
                void runBulk({ action: "visibility", visibility: value }, ids);
              } else if (value.startsWith("move:")) {
                const albumId = value.slice(5);
                void runBulk({ action: "move", albumId: albumId === "none" ? null : albumId }, ids);
              }
            }}
            className="min-h-10 rounded-full border border-canvas/20 bg-transparent px-3 text-sm text-canvas"
          >
            <option value="" disabled>
              {bulkBusy ? "Working…" : "Actions"}
            </option>
            <option value="private">Hide from guests</option>
            <option value="gallery">Show in the gallery</option>
            <option value="link">Link only</option>
            {canManageAlbums && folders.length > 0 && (
              <optgroup label="Move to folder">
                <option value="move:none">No folder</option>
                {flattenFolders(folders).map((folder) => (
                  <option key={folder.id} value={`move:${folder.id}`}>
                    {"\u00a0\u00a0\u00a0".repeat(folder.depth - 1)}
                    {folder.name}
                  </option>
                ))}
              </optgroup>
            )}
            <option value="reject">Reject</option>
            <option value="delete">Delete</option>
          </select>
          <button
            type="button"
            onClick={clearSelection}
            className="min-h-10 rounded-full px-3 text-sm text-canvas/80 transition-colors hover:bg-canvas/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-canvas"
          >
            Clear
          </button>
          {!selectionStreamsInline ? (
            <div className="flex flex-col items-end gap-1">
              <button
                type="button"
                onClick={() => void exportSelection()}
                className="inline-flex min-h-10 items-center gap-2 rounded-full bg-canvas px-4 text-sm font-medium text-paper transition-colors hover:bg-canvas-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-canvas focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Prepare download
              </button>
              {selectionExportState && (
                <p className="max-w-56 text-right text-xs text-canvas/80" aria-live="polite">
                  {selectionExportState}
                </p>
              )}
            </div>
          ) : selectedDownloadParts.map((part, index) => (
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

      {undo && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-full bg-paper/95 py-2 pl-5 pr-2 text-sm text-canvas backdrop-blur"
        >
          <span>{undo.label}</span>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => void runBulk({ action: "restore" }, undo.items.map((item) => item.id))}
              className="min-h-10 rounded-full bg-canvas px-4 font-medium text-paper"
            >
              Undo
            </button>
            <button type="button" onClick={() => setUndo(null)} className="min-h-10 rounded-full px-3 text-canvas/70">
              Dismiss
            </button>
          </div>
        </div>
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
          slug={event.slug}
          onShare={canManageShares ? setShareMediaId : undefined}
          share={{
            eventName: event.name,
            accent: canCustomizeGallery ? event.accentColor : "#edee00",
            canTakeFile: () => true,
          }}
          // MED-9. The count, not the button: hearting is for the gallery, and
          // this is where the host manages it. Comments open with moderation.
          social={
            event.reactionsEnabled || event.commentsEnabled
              ? {
                  slug: event.slug,
                  reactions: event.reactionsEnabled,
                  comments: event.commentsEnabled,
                  canModerate: canModerateComments,
                  signInHref: null,
                  // The reported-comments card above the grid reads the server.
                  onModerated: () => router.refresh(),
                  onCommentCount: (id, count) =>
                    setMediaItems((current) =>
                      current.map((item) =>
                        item.id === id && item.commentCount !== count ? { ...item, commentCount: count } : item,
                      ),
                    ),
                }
              : undefined
          }
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
