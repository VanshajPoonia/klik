"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { nanoid } from "nanoid";
import { Camera, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PublicEvent } from "@/lib/events";
import { compressImageForUpload } from "@/lib/image-compress";
import { Lightbox } from "@/components/guest/lightbox";
import type { CapturedItem } from "@/components/guest/camera-capture";

// The camera carries the looks engine and its pixel passes. Most guests never
// open it, so it stays out of the initial bundle until they do.
const CameraCapture = dynamic(
  () => import("@/components/guest/camera-capture").then((m) => m.CameraCapture),
  { ssr: false },
);

interface MediaItem {
  id: string;
  kind: "photo" | "video";
  status: "pending" | "approved" | "rejected";
  blobUrl: string;
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

const fetcher = (url: string) => fetch(url).then((res) => res.json());
const UPLOAD_CONCURRENCY = 3;
const PAGE_SIZE = 60;
const RETRY_DELAYS = [600, 1800];

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
}: {
  event: PublicEvent;
  isOwner: boolean;
  initialMedia: MediaItem[];
}) {
  // A single accumulating, always-sorted list: new arrivals are prepended via
  // a `since` cursor (never re-polls a fixed window, so nothing can be pushed
  // out of it by new uploads), older history is appended via loadMore below.
  // Growing both ends independently this way means there's no seam between a
  // "live head" and a "frozen tail" for an upload to fall through.
  const [items, setItems] = useState<MediaItem[]>(initialMedia);
  const [cursor, setCursor] = useState<string | null>(
    initialMedia.length === PAGE_SIZE
      ? new Date(initialMedia[PAGE_SIZE - 1].createdAt).toISOString()
      : null,
  );
  const [hasMore, setHasMore] = useState(initialMedia.length === PAGE_SIZE);

  const [uploading, setUploading] = useState<UploadProgress[]>([]);
  const [failed, setFailed] = useState<FailedUpload[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  // Tracked by id, not position: new photos stream in at the head every poll,
  // which would otherwise shift the open item out from under the viewer.
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Before anything has loaded, there's no "newest" cursor to poll since - fall
  // back to the plain first page so a brand new, empty event still notices its
  // first upload.
  const newestLoadedAt = items[0] ? new Date(items[0].createdAt).toISOString() : null;
  const pollUrl = newestLoadedAt
    ? `/api/e/${event.slug}/media?since=${encodeURIComponent(newestLoadedAt)}`
    : `/api/e/${event.slug}/media?limit=${PAGE_SIZE}`;

  const { data: polled, mutate } = useSWR<{ media: MediaItem[]; nextCursor: string | null }>(
    pollUrl,
    fetcher,
    { refreshInterval: 8000 },
  );

  // Folding each poll into the accumulating `items` list is exactly the
  // "sync local state from an external store" case effects are for - SWR's
  // own cache is keyed per-URL and has no concept of an accumulator growing
  // across many different since= keys over time.
  useEffect(() => {
    if (!polled?.media) return;
    // Bootstrap case (no items loaded yet): this was the plain first-page
    // fetch, not a since-poll, so it also carries real pagination info.
    if (newestLoadedAt === null) {
      if (polled.media.length === 0) return;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems(polled.media);
      setCursor(polled.nextCursor ?? null);
      setHasMore(Boolean(polled.nextCursor));
      return;
    }
    if (polled.media.length === 0) return;
    setItems((current) => {
      const seen = new Set(current.map((item) => item.id));
      const arrivals = polled.media.filter((item) => !seen.has(item.id));
      return arrivals.length ? [...arrivals, ...current] : current;
    });
  }, [polled, newestLoadedAt]);

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
        const compressed = isPhoto && !prepared ? await compressImageForUpload(file) : null;

        const uploadBody = compressed?.blob ?? file;
        const mimeType = compressed ? "image/jpeg" : file.type;

        const signRes = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId: event.id,
            mediaId,
            mimeType,
            sizeBytes: uploadBody.size,
          }),
        });
        const signed = await signRes.json().catch(() => ({}));
        if (!signRes.ok) throw new Error(signed.error ?? "Failed to get upload URL");
        const { uploadUrl, pathname } = signed;

        await putWithRetry(uploadUrl, uploadBody, mimeType, (percentage) =>
          setUploading((current) =>
            current.map((item) => (item.id === mediaId ? { ...item, progress: percentage } : item)),
          ),
        );

        const registerRes = await fetch(`/api/e/${event.slug}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mediaId,
            pathname,
            mimeType,
            sizeBytes: uploadBody.size,
            width: compressed?.width ?? prepared?.width,
            height: compressed?.height ?? prepared?.height,
            clientCompressed: Boolean(compressed) || Boolean(prepared),
          }),
        });
        if (!registerRes.ok) {
          const registered = await registerRes.json().catch(() => ({}));
          throw new Error(registered.error ?? "Could not add media to the gallery");
        }

        mutate();
      } catch {
        // One file failing shouldn't block the rest of the batch, but it should
        // never disappear silently either.
        setFailed((current) => [...current, { id: mediaId, file, prepared }]);
      } finally {
        setUploading((current) => current.filter((item) => item.id !== mediaId));
      }
    },
    [event.id, event.slug, mutate],
  );

  const uploadFiles = useCallback(
    (uploads: PendingUpload[]) => {
      if (uploads.length === 0) return;
      void processInBatches(uploads.slice(0, 20), UPLOAD_CONCURRENCY, uploadOne);
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

  return (
    <div className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl text-paper">{event.name}</h1>
            <p className="mt-1 text-sm text-muted">
              {items.length} {items.length === 1 ? "item" : "items"} shared
              {isOwner && " · viewing as organizer"}
            </p>
          </div>
          {event.uploadsEnabled && (
            <div className="flex items-center gap-2">
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

        {uploading.length > 0 && (
          <div className="mb-6 space-y-2">
            {uploading.map((item) => (
              <div key={item.id} className="h-1.5 w-full overflow-hidden rounded-full bg-canvas-line">
                <div
                  className="h-full bg-volt transition-[width] duration-300"
                  style={{ width: `${item.progress}%` }}
                />
              </div>
            ))}
          </div>
        )}

        {failed.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
            <span className="text-sm text-red-300">
              {failed.length} {failed.length === 1 ? "upload" : "uploads"} didn&apos;t go through.
            </span>
            <Button variant="ghost" size="sm" onClick={retryFailed}>
              Retry
            </Button>
          </div>
        )}

        {items.length === 0 ? (
          <div className="rounded-2xl border border-canvas-line bg-canvas-raised px-6 py-16 text-center text-sm text-muted">
            No photos or videos yet. Be the first to add one.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => setLightboxId(item.id)}
                className="klik-frame relative aspect-square overflow-hidden rounded-xl border border-canvas-line bg-canvas-raised"
              >
                {item.kind === "video" ? (
                  <>
                    <video
                      src={item.blobUrl}
                      className="pointer-events-none h-full w-full object-cover"
                      muted
                      preload="metadata"
                    />
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 backdrop-blur">
                        <Play className="h-4 w-4 text-paper" />
                      </span>
                    </span>
                  </>
                ) : (
                  <Image
                    src={item.blobUrl}
                    alt=""
                    fill
                    sizes="(min-width: 768px) 25vw, 50vw"
                    className="object-cover"
                  />
                )}
                {item.status === "pending" && item.mine && (
                  <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-paper">
                    Awaiting approval
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {hasMore && (
          <div ref={sentinelRef} className="py-8 text-center text-sm text-muted">
            {loadingMore ? "Loading more..." : ""}
          </div>
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
          downloadBaseUrl={`/api/e/${event.slug}/media`}
        />
      )}
    </div>
  );
}
