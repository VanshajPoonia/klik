"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Sparkles } from "lucide-react";
import {
  enhancePhoto,
  getEnhancePreference,
  getEnhancePreferenceOnServer,
  saveBlob,
  setEnhancePreference,
  subscribeEnhancePreference,
} from "@/lib/enhance-view";

/**
 * The photo behind a share link.
 *
 * Everything on this page is one step: look at the picture. The person here was
 * sent a link by someone they know and has very likely never heard of Klik, so
 * the chrome is a caption, a download button when the host allowed it, and one
 * way into the gallery when there is one to go to.
 */
export function ShareView({
  token,
  eventName,
  kind,
  contentUrl,
  posterUrl,
  downloadUrl,
  downloadName,
  galleryUrl,
}: {
  token: string;
  eventName: string;
  kind: "photo" | "video";
  contentUrl: string;
  posterUrl: string | null;
  downloadUrl: string | null;
  downloadName: string;
  galleryUrl: string | null;
}) {
  const router = useRouter();
  const [enhancedUrl, setEnhancedUrl] = useState<string | null>(null);
  const enhancedBlob = useRef<Blob | null>(null);

  /**
   * Same per-browser preference as the gallery, subscribed to rather than copied
   * into state so there is never a render with the wrong value that an effect
   * then corrects.
   */
  const enhanced = useSyncExternalStore(
    subscribeEnhancePreference,
    getEnhancePreference,
    getEnhancePreferenceOnServer,
  );

  /**
   * Counts the view, once, after the page has loaded.
   *
   * The ref guard is not about React running effects twice in development. It is
   * that this must be one request per visit no matter how the component
   * remounts, because the thing on the other end spends a view.
   */
  const counted = useRef(false);
  useEffect(() => {
    if (counted.current) return;
    counted.current = true;

    void fetch(`/api/s/${token}/view`, { method: "POST" }).then((response) => {
      // The link died between the server rendering this page and the browser
      // reaching here: revoked, or someone else took the last view. Re-render so
      // the viewer gets the real reason rather than a photo that should be gone.
      if (response.status === 410) router.refresh();
    });
  }, [router, token]);

  /**
   * Auto-levels the photo on this device, never on the server. The original is
   * shown straight away and the enhanced version swapped in when it is ready, so
   * nobody waits on a blank frame for a nicety.
   */
  useEffect(() => {
    if (!enhanced || kind !== "photo") return;

    const controller = new AbortController();
    let objectUrl: string | null = null;

    void enhancePhoto(contentUrl, controller.signal).then((blob) => {
      if (controller.signal.aborted || !blob) return;
      enhancedBlob.current = blob;
      objectUrl = URL.createObjectURL(blob);
      setEnhancedUrl(objectUrl);
    });

    return () => {
      controller.abort();
      enhancedBlob.current = null;
      setEnhancedUrl(null);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [contentUrl, enhanced, kind]);

  return (
    <main className="flex min-h-screen flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-paper">{eventName}</p>
          <p className="text-xs text-muted">Shared with you</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {kind === "photo" && (
            <button
              type="button"
              onClick={() => setEnhancePreference(!enhanced)}
              aria-label={enhanced ? "Show the original" : "Enhance this photo"}
              aria-pressed={enhanced}
              className={`flex h-11 w-11 items-center justify-center rounded-full transition-transform active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
                enhanced ? "bg-volt text-on-volt" : "border border-canvas-line text-paper"
              }`}
            >
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          {downloadUrl && (
            <a
              href={downloadUrl}
              aria-label={`Download this ${kind}`}
              // When an enhanced version exists, save those bytes instead of
              // following the link, so what lands in the camera roll is what was
              // on screen. Falls back to the server for video and whenever
              // enhancement produced nothing.
              onClick={(event) => {
                const blob = enhancedBlob.current;
                if (!blob) return;
                event.preventDefault();
                saveBlob(blob, downloadName);
              }}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-canvas-line text-paper transition-transform active:scale-[0.96] hover:border-volt/50 hover:text-volt"
            >
              <Download className="h-5 w-5" aria-hidden="true" />
            </a>
          )}
        </div>
      </header>

      <div className="relative min-h-0 flex-1 px-5">
        {kind === "video" ? (
          <video
            src={contentUrl}
            poster={posterUrl ?? undefined}
            className="h-full max-h-[75vh] w-full rounded-2xl object-contain"
            controls
            playsInline
            preload="metadata"
          />
        ) : (
          <div className="relative h-full max-h-[75vh] min-h-[60vh] w-full overflow-hidden rounded-2xl">
            <Image
              src={enhancedUrl ?? contentUrl}
              alt={`Shared from ${eventName}`}
              fill
              unoptimized
              sizes="100vw"
              className="object-contain"
              priority
            />
          </div>
        )}
      </div>

      <footer className="shrink-0 px-5 py-6 text-center">
        {galleryUrl ? (
          <Link
            href={galleryUrl}
            className="inline-flex min-h-11 items-center rounded-full bg-volt px-5 text-sm font-medium text-on-volt transition-transform active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            See the full gallery
          </Link>
        ) : (
          <Link href="/" className="text-xs text-muted transition-colors hover:text-paper">
            Shared with Klik
          </Link>
        )}
      </footer>
    </main>
  );
}
