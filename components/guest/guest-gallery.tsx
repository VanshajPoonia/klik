"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import useSWR from "swr";
import { nanoid } from "nanoid";
import { Button } from "@/components/ui/button";
import type { PublicEvent } from "@/lib/events";

interface MediaItem {
  id: string;
  kind: "photo" | "video";
  status: "pending" | "approved" | "rejected";
  blobUrl: string;
  mine: boolean;
}

interface UploadProgress {
  id: string;
  progress: number;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());
const UPLOAD_CONCURRENCY = 3;

async function processInBatches<T>(items: T[], batchSize: number, run: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += batchSize) {
    await Promise.all(items.slice(i, i + batchSize).map(run));
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
  const { data, mutate } = useSWR<{ media: MediaItem[] }>(
    `/api/e/${event.slug}/media?limit=60`,
    fetcher,
    { refreshInterval: 8000, fallbackData: { media: initialMedia } },
  );
  const [uploading, setUploading] = useState<UploadProgress[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = data?.media ?? initialMedia;

  const uploadOne = useCallback(
    async (file: File) => {
      const mediaId = nanoid();
      const extension = file.name.split(".").pop() || "bin";
      const pathname = `events/${event.id}/${mediaId}.${extension}`;

      setUploading((current) => [...current, { id: mediaId, progress: 0 }]);
      try {
        const signRes = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId: event.id, mimeType: file.type, pathname }),
        });
        if (!signRes.ok) throw new Error("Failed to get upload URL");
        const { uploadUrl, publicUrl, maxBytes } = await signRes.json();
        if (file.size > maxBytes) throw new Error("File too large");

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", uploadUrl);
          xhr.setRequestHeader("Content-Type", file.type);
          xhr.upload.onprogress = (progressEvent) => {
            if (!progressEvent.lengthComputable) return;
            const percentage = (progressEvent.loaded / progressEvent.total) * 100;
            setUploading((current) =>
              current.map((item) => (item.id === mediaId ? { ...item, progress: percentage } : item)),
            );
          };
          xhr.onload = () =>
            xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`));
          xhr.onerror = () => reject(new Error("Upload failed"));
          xhr.send(file);
        });

        await fetch(`/api/e/${event.slug}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mediaId,
            pathname,
            blobUrl: publicUrl,
            mimeType: file.type,
            sizeBytes: file.size,
          }),
        });

        mutate();
      } catch {
        // One file failing shouldn't block the rest of the batch.
      } finally {
        setUploading((current) => current.filter((item) => item.id !== mediaId));
      }
    },
    [event.id, event.slug, mutate],
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      void processInBatches(Array.from(files).slice(0, 20), UPLOAD_CONCURRENCY, uploadOne);
    },
    [uploadOne],
  );

  return (
    <div className="min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl text-paper">{event.name}</h1>
            <p className="mt-1 text-sm text-muted">
              {items.length} {items.length === 1 ? "photo" : "photos"} shared
              {isOwner && " · viewing as organizer"}
            </p>
          </div>
          {event.uploadsEnabled && (
            <>
              <Button onClick={() => inputRef.current?.click()}>Add photos</Button>
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
            </>
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

        {items.length === 0 ? (
          <div className="rounded-2xl border border-canvas-line bg-canvas-raised px-6 py-16 text-center text-sm text-muted">
            No photos yet - be the first to add one.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {items.map((item) => (
              <div
                key={item.id}
                className="klik-frame relative aspect-square overflow-hidden rounded-xl border border-canvas-line bg-canvas-raised"
              >
                {item.kind === "video" ? (
                  <video
                    src={item.blobUrl}
                    className="h-full w-full object-cover"
                    muted
                    preload="metadata"
                    controls
                  />
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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
