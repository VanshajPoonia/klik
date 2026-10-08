"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { nanoid } from "nanoid";
import { Camera, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PublicEvent } from "@/lib/events";
import { isLightColor, readableOn } from "@/lib/color";
import { compressImageForUpload } from "@/lib/image-compress";
import { makeThumbnail } from "@/lib/image-thumbnail";
import { formatDuration, probeVideo } from "@/lib/video-poster";
import { readCaptureTimeFromFile } from "@/lib/exif";
import {
  VIEW_ENHANCE_FILTER,
  getEnhancePreference,
  getEnhancePreferenceOnServer,
  setEnhancePreference,
  subscribeEnhancePreference,
} from "@/lib/enhance-view";
import { Lightbox } from "@/components/guest/lightbox";
import type { CapturedItem } from "@/components/guest/camera-capture";
import { encodeMediaCursor } from "@/lib/media-cursor";
import { mergeGalleryChanges } from "@/lib/gallery-sync";

// The camera carries the looks engine and its pixel passes. Most guests never
// open it, so it stays out of the initial bundle until they do.
const CameraCapture = dynamic(
  () => import("@/components/guest/camera-capture").then((m) => m.CameraCapture),
  { ssr: false },
);

interface MediaItem {
  id: string;
  /** Signed, direct from R2. See lib/media-urls.ts. Absent on items from an
   *  older deployment's payload, which is why every use falls back. */
  src?: string | null;
  thumbSrc?: string | null;
  posterSrc?: string | null;
  posterUrl?: string | null;
  durationS?: number | null;
  kind: "photo" | "video";
  status: "pending" | "approved" | "rejected";
  visibility: "gallery" | "private" | "link";
  blobUrl: string;
  albumId: string | null;
  mine: boolean;
  /** Date over RSC, ISO string over JSON - normalize before using. */
  createdAt: string | Date;
}

interface UploadProgress {
  id: string;
  progress: number;
}

interface PendingUpload {
  file: File;
  /** Set when the file is already at final size and quality (camera captures),
   * letting the uploader skip a redundant decode/re-encode. */
  prepared?: { width: number; height: number };
}

interface FailedUpload extends PendingUpload {
  id: string;
}

const UPLOAD_CONCURRENCY = 3;
const MAX_FILES_PER_PICK = 20;
const DEFAULT_BACKGROUND = "#050505";
const PAGE_SIZE = 60;
const RETRY_DELAYS = [600, 1800];

// Polling backs off while nothing happens and snaps back the moment something
// does. Two hundred phones at a fixed 8 seconds is 1,500 requests a minute
// against a gallery where, most of the evening, nothing new has arrived.
const POLL_FAST_MS = 8_000;
const POLL_SLOW_MS = 60_000;

/**
 * An image that falls back to the authorized route when its signed URL fails,
 * which is what happens to a gallery left open past the signing window. Keyed
 * on the primary URL by its caller, so a new URL starts a fresh attempt.
 */
function FallbackImage({
  primary,
  fallback,
  ...props
}: Omit<React.ComponentProps<typeof Image>, "src"> & { primary: string; fallback: string }) {
  const [src, setSrc] = useState(primary);
  return (
    <Image
      {...props}
      src={src}
      alt={props.alt}
      onError={() => {
        if (src !== fallback) setSrc(fallback);
      }}
    />
  );
}

async function processInBatches<T>(items: T[], batchSize: number, run: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += batchSize) {
    await Promise.all(items.slice(i, i + batchSize).map(run));
  }
}

function putObject(
  url: string,
  body: Blob,
  mimeType: string,
  onProgress: (percentage: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", mimeType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
    };
    xhr.onload = () =>
      xhr.status < 300
        ? resolve()
        : reject(Object.assign(new Error(`Upload failed: ${xhr.status}`), { status: xhr.status }));
    xhr.onerror = () => reject(Object.assign(new Error("Network error"), { status: 0 }));
    xhr.send(body);
  });
}

/** Venue wifi drops constantly, so a transient failure retries with backoff
 * before it counts as lost. PUT to a fixed key is idempotent, so replaying it
 * is safe. Client errors (too large, rejected) fail immediately. */
async function putWithRetry(
  url: string,
  body: Blob,
  mimeType: string,
  onProgress: (percentage: number) => void,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await putObject(url, body, mimeType, onProgress);
      return;
    } catch (error) {
      const status = (error as { status?: number }).status ?? 0;
      const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
      if (!retryable || attempt >= RETRY_DELAYS.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
    }
  }
}

export function GuestGallery({
  event,
  isOwner,
  initialMedia,
  syncedAt,
  albums = [],
  coverUrl = null,
  canSlideshow = false,
  showBranding = true,
  maxVideoSeconds,
}: {
  event: PublicEvent;
  isOwner: boolean;
  initialMedia: MediaItem[];
  /** When the server read `initialMedia`. The first poll asks what changed since. */
  syncedAt: string;
  albums?: Array<{ id: string; name: string }>;
  coverUrl?: string | null;
  canSlideshow?: boolean;
  showBranding?: boolean;
  maxVideoSeconds: number;
}) {
  // A single accumulating, always-sorted list: new arrivals are prepended via
  // a `since` cursor (never re-polls a fixed window, so nothing can be pushed
  // out of it by new uploads), older history is appended via loadMore below.
  // Growing both ends independently this way means there's no seam between a
  // "live head" and a "frozen tail" for an upload to fall through.
  const [items, setItems] = useState<MediaItem[]>(initialMedia);
  const [cursor, setCursor] = useState<string | null>(
    initialMedia.length === PAGE_SIZE
      ? encodeMediaCursor(initialMedia[PAGE_SIZE - 1])
      : null,
  );
  const [hasMore, setHasMore] = useState(initialMedia.length === PAGE_SIZE);

  // Items that were already in the gallery when it loaded (or arrived as older
  // history). Only genuinely new arrivals get the camera-flash entrance.
  const [settledIds, setSettledIds] = useState(
    () => new Set(initialMedia.map((item) => item.id)),
  );

  const [uploading, setUploading] = useState<UploadProgress[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState<FailedUpload[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  // Tracked by id, not position: new photos stream in at the head every poll,
  // which would otherwise shift the open item out from under the viewer.
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  /**
   * Viewer-side enhancement, on by default, stored per browser. Subscribed to
   * rather than read into state, so there is no render with the wrong value
   * before an effect corrects it.
   */
  const enhanced = useSyncExternalStore(
    subscribeEnhancePreference,
    getEnhancePreference,
    getEnhancePreferenceOnServer,
  );
  // Grid tiles get the cheap GPU approximation. A hundred of them are on screen
  // at once, so the per-image histogram pass belongs in the lightbox, not here.
  const gridFilter = enhanced ? VIEW_ENHANCE_FILTER : undefined;
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeAlbumId, setActiveAlbumId] = useState<string>("all");
  const [uploadAlbumId, setUploadAlbumId] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Read inside async callbacks, which must see the latest values without
  // being re-created on every change.
  const hasMoreRef = useRef(hasMore);
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);
  const syncNow = useRef<() => void>(() => {});

  const applyChanges = useCallback((upserts: MediaItem[], removed: string[]) => {
    setItems((current) => mergeGalleryChanges(current, upserts, removed, hasMoreRef.current));
  }, []);

  /** Starts over from the first page, for when a delta would not be honest:
   *  the host changed a setting, or too much changed at once. */
  const reloadFirstPage = useCallback(async () => {
    const res = await fetch(`/api/e/${event.slug}/media?limit=${PAGE_SIZE}`, { cache: "no-store" });
    if (!res.ok) return;
    const json: { media: MediaItem[]; nextCursor: string | null } = await res.json();
    setItems(json.media);
    setSettledIds((current) => new Set([...current, ...json.media.map((item) => item.id)]));
    setCursor(json.nextCursor ?? null);
    setHasMore(Boolean(json.nextCursor));
  }, [event.slug]);

  // Asks the server what changed since the last answer. The quiet case costs
  // the server one event read, so the expensive part only runs when something
  // actually moved. Paused while the tab is hidden, and run at once on return,
  // which is when someone glancing back at their phone expects it to be fresh.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let delay = POLL_FAST_MS;
    let since = syncedAt;

    const schedule = () => {
      if (cancelled) return;
      clearTimeout(timer);
      timer = setTimeout(poll, delay);
    };

    async function poll() {
      if (cancelled || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const res = await fetch(
          `/api/e/${event.slug}/media/changes?since=${encodeURIComponent(since)}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          // Access ended or the event is gone. Keep what is on screen and ask
          // rarely, rather than hammering a door that is now closed.
          delay = POLL_SLOW_MS;
          return;
        }
        const data: { at: string; resync?: boolean; upserts?: MediaItem[]; removed?: string[] } =
          await res.json();
        if (data.resync) {
          await reloadFirstPage();
          delay = POLL_FAST_MS;
        } else {
          const upserts = data.upserts ?? [];
          const removed = data.removed ?? [];
          if (upserts.length > 0 || removed.length > 0) {
            applyChanges(upserts, removed);
            delay = POLL_FAST_MS;
          } else {
            delay = Math.min(POLL_SLOW_MS, Math.round(delay * 1.5));
          }
        }
        since = data.at;
      } catch {
        delay = Math.min(POLL_SLOW_MS, delay * 2);
      } finally {
        inFlight = false;
        schedule();
      }
    }

    syncNow.current = () => {
      delay = POLL_FAST_MS;
      clearTimeout(timer);
      void poll();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") syncNow.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    schedule();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [applyChanges, event.slug, reloadFirstPage, syncedAt]);

  // Resolves to -1 if the open item was removed (moderated away), which closes.
  const lightboxIndex = lightboxId ? items.findIndex((item) => item.id === lightboxId) : -1;

  const uploadOne = useCallback(
    async ({ file, prepared }: PendingUpload) => {
      const mediaId = nanoid();

      setUploading((current) => [...current, { id: mediaId, progress: 0 }]);
      try {
        // Compress+sharpen on the uploader's own device so this cost is
        // spread across every guest's hardware instead of running once per
        // upload on the server. Falls back to the original file (and the
        // server's own compression) if the browser can't decode it, e.g.
        // HEIC outside Safari. Camera captures arrive already prepared.
        const isPhoto = !file.type.startsWith("video/");

        // Read when the photo was taken BEFORE compressing it. The compression
        // pass draws to a canvas, and a canvas cannot carry metadata across, so
        // this is the last moment the camera's timestamp exists. Camera
        // captures arrive already prepared and never had EXIF to begin with.
        const capturedAt =
          isPhoto && !prepared ? await readCaptureTimeFromFile(file) : null;

        const compressed = isPhoto && !prepared ? await compressImageForUpload(file) : null;

        // Pull a still and the duration out of the video here, on the
        // uploader's device. The still lets every viewer's grid load an image
        // instead of reaching into a 200 MB file for its moov atom, and the
        // duration lets the server reject a clip nobody wants to stream.
        const probe = isPhoto ? null : await probeVideo(file);
        if (probe?.duration && probe.duration > maxVideoSeconds) {
          throw new Error(
            `Videos are limited to ${formatDuration(maxVideoSeconds)}. This one is ${formatDuration(probe.duration)}.`,
          );
        }

        const uploadBody = compressed?.blob ?? file;
        const mimeType = compressed ? "image/jpeg" : file.type;

        // The grid tile, made here from pixels this device has already decoded.
        // A photo the browser could not decode (HEIC outside Safari) has no
        // source, and the server makes its thumbnail instead.
        const thumbSource = isPhoto ? (compressed?.blob ?? (prepared ? file : null)) : (probe?.poster ?? null);
        const thumbnail = thumbSource ? await makeThumbnail(thumbSource) : null;

        const signRes = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId: event.id,
            mediaId,
            mimeType,
            sizeBytes: uploadBody.size,
            posterBytes: probe?.poster?.size,
            thumbBytes: thumbnail?.size,
          }),
        });
        const signed = await signRes.json().catch(() => ({}));
        if (!signRes.ok) throw new Error(signed.error ?? "Failed to get upload URL");
        const { uploadUrl, pathname, posterUploadUrl, posterPathname, thumbUploadUrl, thumbPathname } =
          signed;

        await putWithRetry(uploadUrl, uploadBody, mimeType, (percentage) =>
          setUploading((current) =>
            current.map((item) => (item.id === mediaId ? { ...item, progress: percentage } : item)),
          ),
        );

        // Best effort: a gallery with a missing poster falls back to the old
        // behaviour, which is far better than failing a guest's upload because
        // a thumbnail would not send.
        let uploadedPoster: string | null = null;
        if (posterUploadUrl && posterPathname && probe?.poster) {
          try {
            await putObject(posterUploadUrl, probe.poster, "image/jpeg", () => {});
            uploadedPoster = posterPathname;
          } catch {
            uploadedPoster = null;
          }
        }

        let uploadedThumb: string | null = null;
        if (thumbUploadUrl && thumbPathname && thumbnail) {
          try {
            await putObject(thumbUploadUrl, thumbnail, "image/jpeg", () => {});
            uploadedThumb = thumbPathname;
          } catch {
            uploadedThumb = null;
          }
        }

        const registerRes = await fetch(`/api/e/${event.slug}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mediaId,
            pathname,
            mimeType,
            sizeBytes: uploadBody.size,
            width: compressed?.width ?? prepared?.width ?? (probe?.width || undefined),
            height: compressed?.height ?? prepared?.height ?? (probe?.height || undefined),
            durationS: probe?.duration ?? undefined,
            posterPathname: uploadedPoster ?? undefined,
            thumbPathname: uploadedThumb ?? undefined,
            clientCompressed: Boolean(compressed) || Boolean(prepared),
            capturedAt: capturedAt ?? undefined,
            albumId: uploadAlbumId || null,
          }),
        });
        const registered = await registerRes.json().catch(() => ({}));
        if (!registerRes.ok) {
          throw new Error(registered.error ?? "Could not add media to the gallery");
        }

        // Shown straight away from the registration response rather than
        // waiting for the next poll, so the uploader sees their own photo land.
        if (registered.media) applyChanges([registered.media], []);
        syncNow.current();
      } catch {
        // One file failing shouldn't block the rest of the batch, but it should
        // never disappear silently either.
        setFailed((current) => [...current, { id: mediaId, file, prepared }]);
      } finally {
        setUploading((current) => current.filter((item) => item.id !== mediaId));
        setRemaining((count) => Math.max(0, count - 1));
      }
    },
    [applyChanges, event.id, event.slug, maxVideoSeconds, uploadAlbumId],
  );

  const uploadFiles = useCallback(
    (uploads: PendingUpload[]) => {
      if (uploads.length === 0) return;
      const batch = uploads.slice(0, MAX_FILES_PER_PICK);
      setNotice(
        uploads.length > batch.length
          ? `Added the first ${batch.length} of ${uploads.length}. Pick the rest again once these finish.`
          : null,
      );
      setRemaining((count) => count + batch.length);
      void processInBatches(batch, UPLOAD_CONCURRENCY, uploadOne);
    },
    [uploadOne],
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      uploadFiles(Array.from(files).map((file) => ({ file })));
    },
    [uploadFiles],
  );

  const retryFailed = useCallback(() => {
    // Kept out of the state updater: those must stay pure, or StrictMode's
    // double-invoke would queue every retry twice.
    const pending = failed.map(({ file, prepared }) => ({ file, prepared }));
    setFailed([]);
    uploadFiles(pending);
  }, [failed, uploadFiles]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !cursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/e/${event.slug}/media?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`,
      );
      if (!res.ok) throw new Error("Failed to load more");
      const json: { media: MediaItem[]; nextCursor: string | null } = await res.json();
      setSettledIds((current) => {
        const next = new Set(current);
        for (const item of json.media ?? []) next.add(item.id);
        return next;
      });
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        const older = (json.media ?? []).filter((item) => !seen.has(item.id));
        return [...current, ...older];
      });
      setCursor(json.nextCursor ?? null);
      setHasMore(Boolean(json.nextCursor));
    } catch {
      // Leave the cursor untouched so the next scroll retries this page.
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, event.slug, loadingMore]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) void loadMore();
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  /** MED-6: a guest deletes one of their own uploads. Erased on the server,
   *  so it is gone from every phone at the next poll as well as this one. */
  const deleteOwn = useCallback(
    async (mediaId: string): Promise<string | null> => {
      const res = await fetch(`/api/e/${event.slug}/media/${mediaId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return body.error ?? "Could not delete it. Try again.";
      }
      setItems((current) => current.filter((item) => item.id !== mediaId));
      setLightboxId(null);
      return null;
    },
    [event.slug],
  );

  /** TRS-1: reports one photo. If the report hid it, the next poll takes it off
   *  this phone like every other, after the reporter has seen the thank-you. */
  const reportItem = useCallback(
    async (mediaId: string, reason: string, note: string): Promise<string | null> => {
      const res = await fetch(`/api/e/${event.slug}/media/${mediaId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, note: note || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return body.error ?? "Could not send the report. Try again.";
      return null;
    },
    [event.slug],
  );

  const [leaving, setLeaving] = useState<"idle" | "confirm" | "working">("idle");
  const [leaveError, setLeaveError] = useState<string | null>(null);
  /** Everything this guest added, and their name, erased in one go. The Privacy
   *  Policy promises it; the cookie is cleared, so the page returns to the
   *  entry sheet as a stranger would see it. */
  const removeEverythingMine = useCallback(async () => {
    setLeaving("working");
    setLeaveError(null);
    const res = await fetch(`/api/e/${event.slug}/me`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setLeaveError(body.error ?? "Could not remove them. Try again.");
      setLeaving("confirm");
      return;
    }
    window.location.reload();
  }, [event.slug]);

  const visibleItems =
    activeAlbumId === "all"
      ? items
      : items.filter((item) => item.albumId === activeAlbumId);

  // Premium galleries pick their own colors. Keep text, borders, and buttons
  // readable whatever was chosen. The camera and viewer sit outside the content
  // wrapper on purpose: they are always dark, so they only take the accent.
  const customBackground = event.backgroundColor.toLowerCase() !== DEFAULT_BACKGROUND;
  const lightBackground = isLightColor(event.backgroundColor);
  const blendToward = lightBackground ? "black" : "white";
  const contentTheme = customBackground
    ? {
        ["--color-paper" as string]: lightBackground ? "#141412" : "#f3f1e9",
        ["--color-muted" as string]: lightBackground ? "#5c5a52" : "#a3a196",
        ["--color-canvas-raised" as string]: `color-mix(in srgb, ${event.backgroundColor} 94%, ${blendToward})`,
        ["--color-canvas-line" as string]: `color-mix(in srgb, ${event.backgroundColor} 84%, ${blendToward})`,
      }
    : undefined;

  return (
    <div
      className="min-h-screen px-6 py-10 md:px-10"
      style={{
        backgroundColor: event.backgroundColor,
        ["--event-accent" as string]: event.accentColor,
        ["--color-volt" as string]: event.accentColor,
        ["--color-on-volt" as string]: readableOn(event.accentColor),
        ["--color-canvas" as string]: event.backgroundColor,
      }}
    >
      <div className="mx-auto max-w-5xl" style={contentTheme}>
        {coverUrl && (
          <div className="relative mb-8 aspect-[16/6] overflow-hidden rounded-2xl border border-white/10">
            <Image
              src={coverUrl}
              alt={`${event.name} gallery cover`}
              fill
              unoptimized
              priority
              sizes="(min-width: 1024px) 960px, 100vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
          </div>
        )}
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl text-paper">{event.name}</h1>
            <p className="mt-1 text-sm text-muted">
              {items.length}
              {hasMore ? "+" : ""} {items.length === 1 && !hasMore ? "item" : "items"} shared
              {isOwner && " · viewing as organizer"}
            </p>
          </div>
          {event.uploadsEnabled && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {albums.length > 0 && (
                <select
                  aria-label="Upload to album"
                  value={uploadAlbumId}
                  onChange={(event) => setUploadAlbumId(event.target.value)}
                  className="min-h-11 rounded-full border border-canvas-line bg-canvas px-4 text-sm text-paper"
                >
                  <option value="">Main gallery</option>
                  {albums.map((album) => (
                    <option key={album.id} value={album.id}>
                      {album.name}
                    </option>
                  ))}
                </select>
              )}
              <Button onClick={() => setCameraOpen(true)} className="gap-2">
                <Camera className="h-4 w-4" />
                Camera
              </Button>
              <Button variant="ghost" onClick={() => inputRef.current?.click()}>
                Add media
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept="image/*,video/mp4,video/quicktime,video/webm"
                multiple
                className="hidden"
                onChange={(event) => {
                  handleFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </div>
          )}
        </header>

        {(remaining > 0 || notice) && (
          <div className="mb-6 space-y-2" role="status" aria-live="polite">
            {remaining > 0 && (
              <p className="text-sm text-muted">
                Uploading {remaining} {remaining === 1 ? "item" : "items"}…
              </p>
            )}
            {uploading.map((item) => (
              <div
                key={item.id}
                role="progressbar"
                aria-label="Upload progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(item.progress)}
                className="h-1.5 w-full overflow-hidden rounded-full bg-canvas-line"
              >
                <div
                  className="h-full bg-volt transition-[width] duration-300"
                  style={{ width: `${item.progress}%` }}
                />
              </div>
            ))}
            {notice && <p className="text-sm text-muted">{notice}</p>}
          </div>
        )}

        {failed.length > 0 && (
          <div
            className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3"
            role="alert"
          >
            <span className="text-sm text-red-300">
              {failed.length} {failed.length === 1 ? "upload" : "uploads"} didn&apos;t go through.
            </span>
            <Button variant="ghost" size="sm" onClick={retryFailed}>
              Retry
            </Button>
          </div>
        )}

        {albums.length > 0 && (
          <nav className="mb-6 flex gap-2 overflow-x-auto pb-1" aria-label="Gallery albums">
            <button
              onClick={() => setActiveAlbumId("all")}
              aria-pressed={activeAlbumId === "all"}
              className={`min-h-11 shrink-0 rounded-full border px-4 text-sm transition-colors ${
                activeAlbumId === "all"
                  ? "border-transparent bg-volt text-on-volt"
                  : "border-canvas-line text-muted hover:text-paper"
              }`}
            >
              All media
            </button>
            {albums.map((album) => (
              <button
                key={album.id}
                onClick={() => setActiveAlbumId(album.id)}
                aria-pressed={activeAlbumId === album.id}
                className={`min-h-11 shrink-0 rounded-full border px-4 text-sm transition-colors ${
                  activeAlbumId === album.id
                    ? "border-transparent bg-volt text-on-volt"
                    : "border-canvas-line text-muted hover:text-paper"
                }`}
              >
                {album.name}
              </button>
            ))}
          </nav>
        )}

        {visibleItems.length === 0 ? (
          <div className="rounded-2xl border border-canvas-line bg-canvas-raised px-6 py-16 text-center text-sm text-muted">
            {items.length === 0
              ? "No photos or videos yet. Be the first to add one."
              : "No media has been added to this album yet."}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {visibleItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setLightboxId(item.id)}
                aria-label={item.kind === "video" ? "Open video" : "Open photo"}
                className={`relative aspect-square overflow-hidden rounded-xl border border-canvas-line bg-canvas-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt ${
                  settledIds.has(item.id) ? "" : "klik-frame"
                }`}
              >
                {item.kind === "video" ? (
                  <>
                    {/* A poster image where we have one. The old path rendered
                        <video preload="metadata"> per tile, and on iPhone .mov
                        files "metadata" means reaching to the end of the file
                        for the moov atom, once per visible video. Clips that
                        predate poster extraction still fall back to that. */}
                    {item.thumbSrc || item.posterUrl ? (
                      <FallbackImage
                        key={item.thumbSrc ?? item.posterUrl!}
                        primary={item.thumbSrc ?? item.posterUrl!}
                        fallback={item.posterUrl ?? `${item.blobUrl}?thumb=1`}
                        alt=""
                        fill
                        unoptimized
                        loading="lazy"
                        sizes="(min-width: 768px) 25vw, 50vw"
                        className="pointer-events-none object-cover"
                        style={{ filter: gridFilter }}
                      />
                    ) : (
                      <video
                        src={item.blobUrl}
                        className="pointer-events-none h-full w-full object-cover"
                        muted
                        preload="metadata"
                      />
                    )}
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 backdrop-blur">
                        <Play className="h-4 w-4 text-paper" />
                      </span>
                    </span>
                    {item.durationS ? (
                      <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-paper backdrop-blur">
                        {formatDuration(item.durationS)}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <FallbackImage
                    key={item.thumbSrc ?? item.blobUrl}
                    primary={item.thumbSrc ?? `${item.blobUrl}?thumb=1`}
                    fallback={`${item.blobUrl}?thumb=1`}
                    alt=""
                    fill
                    unoptimized
                    loading="lazy"
                    sizes="(min-width: 768px) 25vw, 50vw"
                    className="object-cover"
                    style={{ filter: gridFilter }}
                  />
                )}
                {item.status === "pending" && item.mine && (
                  <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-paper">
                    Awaiting approval
                  </span>
                )}
                {/* Only ever reaches a guest for their own upload, since that
                    is the only non-gallery media the access rule lets through.
                    Without it their photo is simply there, with no hint the
                    host took it out of the gallery. */}
                {item.visibility === "private" && item.mine && (
                  <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-paper">
                    Only you can see this
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {hasMore && (
          <div ref={sentinelRef} className="py-8 text-center text-sm text-muted">
            {loadingMore ? "Loading more…" : ""}
          </div>
        )}

        {!isOwner && (
          <div className="mt-12 text-center text-xs text-muted">
            {leaving === "idle" ? (
              <button
                type="button"
                onClick={() => setLeaving("confirm")}
                className="underline underline-offset-2 transition-colors hover:text-paper"
              >
                Remove everything I added
              </button>
            ) : (
              <div className="mx-auto max-w-sm space-y-3 rounded-2xl border border-canvas-line bg-canvas-raised p-4 text-left">
                <p className="text-sm text-paper">
                  Remove every photo and video you added, and your name, from this gallery? This is
                  permanent and cannot be undone by you or the host.
                </p>
                {leaveError && (
                  <p className="text-xs text-red-400" role="alert">
                    {leaveError}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={leaving === "working"}
                    onClick={() => void removeEverythingMine()}
                  >
                    {leaving === "working" ? "Removing…" : "Remove everything"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setLeaving("idle")}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {showBranding && (
          <p className="mt-12 text-center text-xs text-muted">
            Shared with <span className="font-medium text-paper">klik</span>
          </p>
        )}
      </div>

      {cameraOpen && (
        <CameraCapture
          onComplete={(captured: CapturedItem[]) =>
            uploadFiles(
              captured.map(({ file, width, height }) => ({
                file,
                prepared: width && height ? { width, height } : undefined,
              })),
            )
          }
          onClose={() => setCameraOpen(false)}
        />
      )}

      {lightboxIndex >= 0 && (
        <Lightbox
          items={items}
          index={lightboxIndex}
          onIndexChange={(next) => setLightboxId(items[next]?.id ?? null)}
          onClose={() => setLightboxId(null)}
          canDownload={event.downloadsEnabled || isOwner}
          canSlideshow={canSlideshow}
          downloadBaseUrl={`/api/e/${event.slug}/media`}
          slug={event.slug}
          enhanced={enhanced}
          onEnhancedChange={setEnhancePreference}
          onDeleteOwn={isOwner ? undefined : deleteOwn}
          onReport={isOwner ? undefined : reportItem}
        />
      )}
    </div>
  );
}
