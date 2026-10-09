"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Flag,
  Heart,
  Pause,
  Play,
  Share2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { downloadFilename, enhancePhoto, saveBlob } from "@/lib/enhance-view";
import { CommentButton, CommentsSheet, HeartButton } from "@/components/guest/media-social";

export interface LightboxItem {
  id: string;
  kind: "photo" | "video";
  /** The authorized route. Plays video, and is the fallback for a photo whose
   *  signed URL has expired. */
  blobUrl: string;
  /** Signed, direct from R2, when the payload carried one. */
  src?: string | null;
  posterSrc?: string | null;
  posterUrl?: string | null;
  /** The guest's own upload, which they may delete (MED-6). */
  mine?: boolean;
  /** MED-9. Counts from the media row; `reacted` is this viewer's own heart. */
  reactionCount?: number;
  commentCount?: number;
  reacted?: boolean;
}

/** MED-9: what the viewer shows and allows of hearts and comments. */
export interface LightboxSocial {
  slug: string;
  reactions: boolean;
  comments: boolean;
  /** Hearting, as opposed to seeing the count. Absent in the dashboard. */
  onReact?: (id: string, on: boolean) => void;
  /** The team: sees hidden comments and can hide or show them. */
  canModerate: boolean;
  /** Where a guest signs in to comment; null for the team. */
  signInHref: string | null;
  /** The sheet's fresh count, before the next sync brings it. */
  onCommentCount?: (id: string, count: number) => void;
  /** After the team hides or shows a comment, for anything else on the page. */
  onModerated?: () => void;
}

const DOUBLE_TAP_MS = 300;

const SWIPE_THRESHOLD = 50;

type ReportReason =
  | "child_safety"
  | "nudity"
  | "violence"
  | "harassment"
  | "privacy"
  | "copyright"
  | "spam"
  | "other";

/** Mirrors REPORT_REASON_LABELS in lib/reports.ts, which is server-only. The
 *  most serious first, because that is the one that must not be missed. */
const REPORT_OPTIONS: Array<[ReportReason, string]> = [
  ["child_safety", "Involves a child in a sexual or abusive way"],
  ["nudity", "Nudity or sexual content"],
  ["violence", "Violence or something disturbing"],
  ["harassment", "Bullying, harassment or hate"],
  ["privacy", "It's me, and I don't want it here"],
  ["copyright", "It's my work and was shared without permission"],
  ["spam", "Spam or nothing to do with this event"],
  ["other", "Something else"],
];

/** Fullscreen viewer for the gallery. Deliberately dependency-free: the whole
 * surface is a photo, a counter, and two arrows. */
export function Lightbox({
  items,
  index,
  onIndexChange,
  onClose,
  downloadBaseUrl,
  canDownload = false,
  canSlideshow = false,
  slug,
  enhanced = false,
  onEnhancedChange,
  onShare,
  onDeleteOwn,
  onReport,
  social,
}: {
  items: LightboxItem[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
  downloadBaseUrl?: string;
  canDownload?: boolean;
  canSlideshow?: boolean;
  slug?: string;
  enhanced?: boolean;
  onEnhancedChange?: (next: boolean) => void;
  /** Organizer-only: opens the share sheet for the photo on screen. Absent on
   *  the guest side, where nobody may create links. */
  onShare?: (id: string) => void;
  /** Guest side: deletes one of their own uploads. Resolves to an error
   *  message, or null when it worked. Offered only on items marked `mine`. */
  onDeleteOwn?: (id: string) => Promise<string | null>;
  /** Guest side: reports something they did not upload (TRS-1). Resolves to an
   *  error message, or null when the report was taken. */
  onReport?: (id: string, reason: ReportReason, note: string) => Promise<string | null>;
  social?: LightboxSocial;
}) {
  const touchStartX = useRef<number | null>(null);
  const lastTap = useRef(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [slideshowPlaying, setSlideshowPlaying] = useState(false);
  // Keyed by media id rather than reset on change, so nothing has to call
  // setState from an effect body just to clear a stale result.
  const [enhancedFor, setEnhancedFor] = useState<{ id: string; url: string } | null>(null);
  const enhancedBlob = useRef<Blob | null>(null);
  const item = items[index];
  const enhancedUrl = item && enhancedFor?.id === item.id ? enhancedFor.url : null;
  // Ids whose signed URL failed, so the viewer falls back to the route that
  // re-authorizes. Keyed by id like the enhancement above.
  const [expiredIds, setExpiredIds] = useState<ReadonlySet<string>>(() => new Set());
  // Which item the delete confirmation is open for. Keyed by id so swiping to
  // another photo closes it rather than aiming it at the wrong one.
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState<ReportReason | null>(null);
  const [reportNote, setReportNote] = useState("");
  const [reportState, setReportState] = useState<"idle" | "sending" | "sent">("idle");
  const [reportError, setReportError] = useState<string | null>(null);
  // MED-9. Keyed by id like the panels above, so a swipe closes the thread
  // rather than leaving the last photo's comments over the next one.
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  const [burst, setBurst] = useState<{ id: string; key: number } | null>(null);
  const commentsOpen = Boolean(item && commentsFor === item.id);
  const photoUrl = item
    ? item.src && !expiredIds.has(item.id)
      ? item.src
      : item.blobUrl
    : null;

  /**
   * Auto-levels the photo on this device. The original is shown immediately and
   * the enhanced version swapped in when it is ready, so the viewer never waits
   * on a blank frame. Aborting on change matters more than it looks: swiping
   * quickly through a gallery starts one of these per photo, and without the
   * abort they all finish and fight over the same state.
   */
  useEffect(() => {
    if (!enhanced || !item || item.kind !== "photo") return;

    const controller = new AbortController();
    let objectUrl: string | null = null;

    enhancePhoto(photoUrl ?? item.blobUrl, controller.signal).then((blob) => {
      if (controller.signal.aborted || !blob) return;
      enhancedBlob.current = blob;
      objectUrl = URL.createObjectURL(blob);
      setEnhancedFor({ id: item.id, url: objectUrl });
    });

    return () => {
      controller.abort();
      enhancedBlob.current = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [enhanced, item, photoUrl]);

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next >= 0 && next < items.length) onIndexChange(next);
    },
    [index, items.length, onIndexChange],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape closes the comments first, then the viewer.
      if (e.key === "Escape") {
        if (commentsOpen) setCommentsFor(null);
        else onClose();
        return;
      }
      // Typing a comment or a report note must not change the photo.
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
      else if (e.code === "Space" && canSlideshow && items.length > 1) {
        e.preventDefault();
        setSlideshowPlaying((playing) => !playing);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSlideshow, commentsOpen, go, items.length, onClose]);

  useEffect(() => {
    if (!slideshowPlaying || commentsOpen || items.length < 2 || !item) return;
    const delay = item.kind === "video" ? 12_000 : 6_000;
    const timer = window.setTimeout(() => {
      onIndexChange((index + 1) % items.length);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [commentsOpen, index, item, items.length, onIndexChange, slideshowPlaying]);

  // Move focus into the viewer, and hand it back to the tile that opened it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  // Keep the page behind from scrolling under the viewer.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!item) return null;

  const canHeart = Boolean(social?.reactions && social.onReact);
  /** Double-tap or double-click on a photo hearts it, and never un-hearts. */
  const heartFromPhoto = () => {
    if (!canHeart || item.kind !== "photo") return;
    setBurst({ id: item.id, key: Date.now() });
    if (!item.reacted) social?.onReact?.(item.id, true);
  };
  const showSocialBar = Boolean(social && (social.reactions || social.comments));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
      className="fixed inset-0 z-[110] flex flex-col bg-black/95"
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touchStartX.current === null) return;
        const delta = e.changedTouches[0].clientX - touchStartX.current;
        if (Math.abs(delta) > SWIPE_THRESHOLD) go(delta > 0 ? -1 : 1);
        touchStartX.current = null;
      }}
    >
      <div className="flex shrink-0 items-center justify-between px-4 py-4">
        <span className="text-sm tabular-nums text-muted">
          {index + 1} / {items.length}
        </span>
        <div className="flex items-center gap-2">
          {canSlideshow && items.length > 1 && (
            <button
              type="button"
              onClick={() => setSlideshowPlaying((playing) => !playing)}
              aria-label={slideshowPlaying ? "Pause slideshow" : "Start slideshow"}
              aria-pressed={slideshowPlaying}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-paper transition-transform active:scale-90"
            >
              {slideshowPlaying ? (
                <Pause className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Play className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
          )}
          {onEnhancedChange && (
            <button
              type="button"
              onClick={() => onEnhancedChange(!enhanced)}
              aria-label={enhanced ? "Show the original photo" : "Enhance photos"}
              aria-pressed={enhanced}
              title={enhanced ? "Enhanced. Tap to see the original" : "Enhance"}
              className={`flex h-11 w-11 items-center justify-center rounded-full transition-transform active:scale-90 ${
                enhanced ? "bg-volt text-on-volt" : "bg-white/10 text-paper"
              }`}
            >
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          {onReport && !item.mine && (
            <button
              type="button"
              onClick={() => {
                setReportingId(item.id);
                setReportReason(null);
                setReportNote("");
                setReportState("idle");
                setReportError(null);
              }}
              aria-label={`Report this ${item.kind}`}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-paper transition-transform active:scale-90"
            >
              <Flag className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          {onDeleteOwn && item.mine && (
            <button
              type="button"
              onClick={() => {
                setDeleteError(null);
                setConfirmingDelete(item.id);
              }}
              aria-label={`Delete your ${item.kind}`}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-paper transition-transform active:scale-90"
            >
              <Trash2 className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          {onShare && (
            <button
              type="button"
              onClick={() => onShare(item.id)}
              aria-label={`Share this ${item.kind}`}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-paper transition-transform active:scale-90"
            >
              <Share2 className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          {canDownload && downloadBaseUrl && (
            // When an enhanced version exists, save those bytes rather than
            // following the link, so what you download is what you were
            // looking at. Falls back to the server route for videos, for
            // originals, and whenever enhancement did not produce anything.
            <a
              href={`${downloadBaseUrl}/${item.id}/download`}
              aria-label={`Download ${item.kind}`}
              onClick={(event) => {
                const blob = enhancedBlob.current;
                if (!blob || !slug) return;
                event.preventDefault();
                saveBlob(blob, downloadFilename(slug, item.id));
              }}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-paper transition-transform active:scale-90"
            >
              <Download className="h-5 w-5" aria-hidden="true" />
            </a>
          )}
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-paper transition-transform active:scale-90"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {item.kind === "video" ? (
          <video
            key={item.id}
            src={item.blobUrl}
            poster={item.posterSrc ?? item.posterUrl ?? undefined}
            aria-label={`Video ${index + 1} of ${items.length}`}
            className="h-full w-full object-contain"
            controls
            autoPlay
            playsInline
          />
        ) : (
          <Image
            key={item.id}
            onDoubleClick={heartFromPhoto}
            onTouchEnd={(e) => {
              // A second tap in the same spot, quickly. A swipe moves too far
              // to count, so changing photos never hearts one by accident.
              const start = touchStartX.current;
              const moved = start === null ? 0 : Math.abs(e.changedTouches[0].clientX - start);
              if (moved > 10) return;
              const now = e.timeStamp;
              if (now - lastTap.current < DOUBLE_TAP_MS) {
                lastTap.current = 0;
                heartFromPhoto();
              } else {
                lastTap.current = now;
              }
            }}
            src={enhancedUrl ?? photoUrl ?? item.blobUrl}
            onError={() => {
              if (item.src && !expiredIds.has(item.id)) {
                setExpiredIds((current) => new Set(current).add(item.id));
              }
            }}
            alt={`Photo ${index + 1} of ${items.length}`}
            fill
            unoptimized
            sizes="100vw"
            className="touch-manipulation object-contain"
            priority
          />
        )}

        {burst?.id === item.id && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <Heart
              key={burst.key}
              onAnimationEnd={() => setBurst(null)}
              className="klik-heart-burst h-28 w-28 fill-volt text-volt drop-shadow-lg"
            />
          </span>
        )}

        {social?.comments && commentsOpen && (
          <CommentsSheet
            key={item.id}
            slug={social.slug}
            mediaId={item.id}
            kind={item.kind}
            canModerate={social.canModerate}
            signInHref={social.signInHref}
            onClose={() => setCommentsFor(null)}
            onVisibleCountChange={(count) => social.onCommentCount?.(item.id, count)}
            onModerated={social.onModerated}
          />
        )}

        {onReport && reportingId === item.id && (
          <div
            role="dialog"
            aria-label="Report this"
            className="absolute inset-x-3 bottom-3 z-10 mx-auto max-h-[80%] max-w-md space-y-3 overflow-y-auto rounded-2xl border border-white/10 bg-black/85 p-4 backdrop-blur"
          >
            {reportState === "sent" ? (
              <>
                <p className="text-sm text-paper">Thanks. The host and the Klik team will look at it.</p>
                {reportReason === "copyright" && (
                  <p className="text-xs leading-relaxed text-muted">
                    To have your work taken down under the DMCA, send a notice as described in our{" "}
                    <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline">
                      Terms
                    </a>
                    . A report alone is not a legal notice.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setReportingId(null)}
                  className="min-h-11 rounded-full border border-white/15 px-4 text-sm text-paper"
                >
                  Close
                </button>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-paper">What is wrong with it?</p>
                <div className="space-y-1.5">
                  {REPORT_OPTIONS.map(([value, label]) => (
                    <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 text-sm text-paper hover:bg-white/5">
                      <input
                        type="radio"
                        name="report-reason"
                        value={value}
                        checked={reportReason === value}
                        onChange={() => setReportReason(value)}
                        className="accent-[var(--color-volt)]"
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <textarea
                  aria-label="Anything else we should know (optional)"
                  placeholder="Anything else we should know (optional)"
                  value={reportNote}
                  onChange={(change) => setReportNote(change.target.value)}
                  maxLength={500}
                  rows={2}
                  className="w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 text-sm text-paper placeholder:text-muted"
                />
                {reportError && (
                  <p className="text-xs text-red-400" role="alert">
                    {reportError}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!reportReason || reportState === "sending"}
                    onClick={async () => {
                      if (!reportReason) return;
                      setReportState("sending");
                      const error = await onReport(item.id, reportReason, reportNote);
                      if (error) {
                        setReportError(error);
                        setReportState("idle");
                      } else {
                        setReportState("sent");
                      }
                    }}
                    className="min-h-11 rounded-full bg-volt px-4 text-sm font-medium text-on-volt disabled:opacity-50"
                  >
                    {reportState === "sending" ? "Sending…" : "Report"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportingId(null)}
                    className="min-h-11 rounded-full border border-white/15 px-4 text-sm text-paper"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {onDeleteOwn && confirmingDelete === item.id && (
          <div
            role="alertdialog"
            aria-label="Delete your upload"
            className="absolute inset-x-3 bottom-3 z-10 mx-auto max-w-md space-y-3 rounded-2xl border border-white/10 bg-black/85 p-4 backdrop-blur"
          >
            <p className="text-sm text-paper">
              Delete this {item.kind}? It is removed for everyone, permanently, including from the
              host&apos;s copy.
            </p>
            {deleteError && (
              <p className="text-xs text-red-400" role="alert">
                {deleteError}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  const error = await onDeleteOwn(item.id);
                  setDeleting(false);
                  if (error) setDeleteError(error);
                  else setConfirmingDelete(null);
                }}
                className="min-h-11 rounded-full border border-red-500/30 bg-red-500/10 px-4 text-sm font-medium text-red-300 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(null)}
                className="min-h-11 rounded-full border border-white/15 px-4 text-sm text-paper"
              >
                Keep it
              </button>
            </div>
          </div>
        )}

        {index > 0 && (
          <button
            onClick={() => go(-1)}
            aria-label="Previous"
            className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-paper backdrop-blur transition-transform active:scale-90"
          >
            <ChevronLeft className="h-6 w-6" aria-hidden="true" />
          </button>
        )}
        {index < items.length - 1 && (
          <button
            onClick={() => go(1)}
            aria-label="Next"
            className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-paper backdrop-blur transition-transform active:scale-90"
          >
            <ChevronRight className="h-6 w-6" aria-hidden="true" />
          </button>
        )}
      </div>

      {showSocialBar && social && (
        <div className="flex shrink-0 items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          {social.reactions && (
            <HeartButton
              kind={item.kind}
              count={item.reactionCount ?? 0}
              reacted={Boolean(item.reacted)}
              onToggle={canHeart ? () => social.onReact?.(item.id, !item.reacted) : undefined}
            />
          )}
          {social.comments && (
            <CommentButton
              count={item.commentCount ?? 0}
              onOpen={() => {
                setSlideshowPlaying(false);
                setCommentsFor(commentsOpen ? null : item.id);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
