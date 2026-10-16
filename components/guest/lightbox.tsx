"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import Image from "next/image";
import dynamic from "next/dynamic";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Flag,
  Heart,
  Pause,
  Pencil,
  Play,
  Printer,
  Share2,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { downloadFilename, enhancePhoto, saveBlob } from "@/lib/enhance-view";
import { CommentButton, CommentsSheet, HeartButton } from "@/components/guest/media-social";
import { MediaSharePanel } from "@/components/guest/media-share-panel";
import { fetchMediaBlob } from "@/lib/media-share";
import { ProofNote } from "@/components/guest/proof-note";
import { useGuestCopy } from "@/components/guest/guest-copy";
import { StreamVideo } from "@/components/media/stream-video";
import { PRINT_PRODUCTS, printDpi, printQuality } from "@/lib/print-catalog";

// CAM-2. A few hundred kilobytes that only someone editing should download,
// and it reaches for `window` the moment it loads.
const ImageEditor = dynamic(() => import("@/components/media/image-editor"), { ssr: false });

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
  /** CAM-3: a link to it only helps when others in the gallery can see it. */
  status?: "pending" | "approved" | "rejected";
  visibility?: "gallery" | "private" | "link";
  /** MED-10: a watermarked proof. The dashboard says whose; guests get a boolean. */
  proof?: boolean | "mine" | "locked" | null;
  /** OPS-1: the video has a Stream copy to play from. */
  stream?: boolean;
  /** GRW-6: for how sharp a print will be. */
  width?: number | null;
  height?: number | null;
}

/** CAM-2: editing a photo, which saves an edited copy and leaves the original. */
export interface LightboxEdit {
  canEdit: (item: LightboxItem) => boolean;
  /** Uploads the edited copy. Resolves to its id; throws to say why not. */
  save: (item: LightboxItem, edited: Blob) => Promise<string | null>;
  /** Guest side: takes the original down once the copy is saved. Resolves to
   *  an error message, or null when it worked. */
  removeOriginal?: (originalId: string) => Promise<string | null>;
  accent?: string;
}

/** AI-5: the team's "sharpen and enlarge", which Klik runs in the background. */
export interface LightboxSharpen {
  canSharpen: (item: LightboxItem) => boolean;
  /** What is left of the event's allowance. */
  left: number;
  /** Starts it. Resolves to an error message, or null when it started. */
  start: (item: LightboxItem) => Promise<string | null>;
}

/** GRW-6: ordering prints of a photo, into the gallery's cart. */
export interface LightboxPrint {
  canPrint: (item: LightboxItem) => boolean;
  /** Adds copies to the cart and answers how many prints it now holds. */
  add: (item: LightboxItem, product: string, copies: number) => number;
  checkout: () => void;
}

/** CAM-3: what the share sheet needs to know about the event and the viewer. */
export interface LightboxShare {
  eventName: string;
  accent: string;
  /** Whether this viewer may send, save or post this item as a file. */
  canTakeFile: (item: LightboxItem) => boolean;
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
/** Past this share of the screen, or this flick speed in px/ms, a drag commits. */
const COMMIT_SHARE = 0.18;
const COMMIT_SPEED = 0.45;
/** A downward drag this far, or this fast, closes the viewer. */
const DISMISS_DISTANCE = 110;
const DISMISS_SPEED = 0.6;
const SETTLE = "transform 260ms cubic-bezier(0.16, 1, 0.3, 1), opacity 260ms ease-out";
const LEAVE_MS = 170;

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type Gesture = { x: number; y: number; t: number; axis: "x" | "y" | null; dx: number; dy: number };

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
 *  most serious first, because that is the one that must not be missed. The
 *  words are in lib/i18n/guest.ts (TRS-3). */
const REPORT_OPTIONS: ReportReason[] = ["child_safety", "nudity", "violence", "harassment", "privacy", "copyright", "spam", "other"];

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
  share,
  edit,
  sharpen,
  print,
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
  /** Organizer-only: opens MED-2's share-link sheet for the photo on screen.
   *  Absent on the guest side, where nobody may create links. */
  onShare?: (id: string) => void;
  /** Guest side: deletes one of their own uploads. Resolves to an error
   *  message, or null when it worked. Offered only on items marked `mine`. */
  onDeleteOwn?: (id: string) => Promise<string | null>;
  /** Guest side: reports something they did not upload (TRS-1). Resolves to an
   *  error message, or null when the report was taken. */
  onReport?: (id: string, reason: ReportReason, note: string) => Promise<string | null>;
  social?: LightboxSocial;
  /** CAM-3: the Share button opens a sheet of ways to send it on. */
  share?: LightboxShare;
  edit?: LightboxEdit;
  sharpen?: LightboxSharpen;
  print?: LightboxPrint;
}) {
  // TRS-3: the guest's language; the dashboard, outside any provider, gets English.
  const { t } = useGuestCopy();
  const touchStartX = useRef<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [slideshowPlaying, setSlideshowPlaying] = useState(false);
  // Keyed by media id rather than reset on change, so nothing has to call
  // setState from an effect body just to clear a stale result.
  const [enhancedFor, setEnhancedFor] = useState<{ id: string; url: string; blob: Blob } | null>(null);
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
  const [sharingFor, setSharingFor] = useState<string | null>(null);
  // CAM-2. The photo being edited, with its bytes as a local URL so the
  // editor's canvas is never tainted by a cross-origin image.
  const [editing, setEditing] = useState<{ item: LightboxItem; url: string } | null>(null);
  const [editLoading, setEditLoading] = useState<string | null>(null);
  const [editNote, setEditNote] = useState<{ originalId: string; message: string; canRemove: boolean } | null>(null);
  // AI-5: the confirm panel for "sharpen and enlarge", and what came of it.
  const [sharpenFor, setSharpenFor] = useState<string | null>(null);
  const [sharpenBusy, setSharpenBusy] = useState(false);
  const [sharpenMessage, setSharpenMessage] = useState<string | null>(null);
  // GRW-6: the "order a print" panel.
  const [printFor, setPrintFor] = useState<string | null>(null);
  const [printSize, setPrintSize] = useState<string>(PRINT_PRODUCTS[0].key);
  const [printCopies, setPrintCopies] = useState(1);
  const [printAdded, setPrintAdded] = useState<number | null>(null);
  const sharingOpen = Boolean(item && sharingFor === item.id);
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
      setEnhancedFor({ id: item.id, url: objectUrl, blob });
    });

    return () => {
      controller.abort();
      enhancedBlob.current = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [enhanced, item, photoUrl]);

  // How the photo on screen arrived, which decides how it animates in: the
  // first one opens, the rest slide in from the side they came from.
  const [enter, setEnter] = useState<"open" | "next" | "prev" | "fade">("open");
  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next < 0 || next >= items.length) return;
      setEnter(delta > 0 ? "next" : "prev");
      onIndexChange(next);
    },
    [index, items.length, onIndexChange],
  );

  // A short fade on the way out, so closing reads as putting the photo down.
  const [closing, setClosing] = useState(false);
  const requestClose = useCallback(() => {
    if (prefersReducedMotion()) return onClose();
    setClosing(true);
    window.setTimeout(onClose, LEAVE_MS);
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The editor has its own keys, and Escape there is not "close the viewer".
      if (editing) return;
      // Escape closes the comments first, then the viewer.
      if (e.key === "Escape") {
        if (sharingOpen) setSharingFor(null);
        else if (commentsOpen) setCommentsFor(null);
        else requestClose();
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
  }, [canSlideshow, commentsOpen, editing, go, items.length, requestClose, sharingOpen]);

  useEffect(() => {
    if (!slideshowPlaying || commentsOpen || sharingOpen || items.length < 2 || !item) return;
    const delay = item.kind === "video" ? 12_000 : 6_000;
    const timer = window.setTimeout(() => {
      // A slideshow crossfades; sliding every six seconds would be restless.
      setEnter("fade");
      onIndexChange((index + 1) % items.length);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [commentsOpen, index, item, items.length, onIndexChange, sharingOpen, slideshowPlaying]);

  // Move focus into the viewer, keep it there, and hand it back to the tile
  // that opened it (TRS-3).
  const viewerRef = useRef<HTMLDivElement>(null);
  useDialogFocus(viewerRef, { initial: closeRef });

  // Keep the page behind from scrolling under the viewer.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!item) return null;

  const canEdit = Boolean(edit && item.kind === "photo" && edit.canEdit(item));
  const canSharpen = Boolean(sharpen && item.kind === "photo" && sharpen.canSharpen(item));
  const canPrint = Boolean(print && item.kind === "photo" && print.canPrint(item));
  /** Fetches the photo's bytes, then opens the editor on them. */
  const openEditor = async () => {
    if (!edit || editLoading) return;
    setSlideshowPlaying(false);
    setSharingFor(null);
    setCommentsFor(null);
    setEditNote(null);
    setEditLoading(item.id);
    try {
      const blob = await fetchMediaBlob(item);
      setEditing({ item, url: URL.createObjectURL(blob) });
    } catch {
      setEditNote({ originalId: item.id, message: t.viewer.editOpenFailed, canRemove: false });
    } finally {
      setEditLoading(null);
    }
  };
  const closeEditor = () => {
    if (editing) URL.revokeObjectURL(editing.url);
    setEditing(null);
  };

  const canHeart = Boolean(social?.reactions && social.onReact);
  /** Double-tap or double-click on a photo hearts it, and never un-hearts. */
  const heartFromPhoto = () => {
    if (!canHeart || item.kind !== "photo") return;
    setBurst({ id: item.id, key: Date.now() });
    if (!item.reacted) social?.onReact?.(item.id, true);
  };
  const showSocialBar = Boolean(social && (social.reactions || social.comments));

  // The photo follows the finger. Sideways it is pulled along and either
  // carried off to the next one or let go back to centre; downwards it shrinks
  // away and the viewer closes. Styles are written straight to the stage, so a
  // drag never re-renders the viewer. Panels over the photo take their own
  // touches, so none of this runs while one is open.
  const panelOpen =
    commentsOpen ||
    sharingOpen ||
    Boolean(editing) ||
    confirmingDelete === item.id ||
    reportingId === item.id ||
    sharpenFor === item.id ||
    printFor === item.id;
  const settleStage = (animate: boolean) => {
    const stage = stageRef.current;
    const root = viewerRef.current;
    if (stage) {
      stage.style.transition = animate ? SETTLE : "none";
      stage.style.transform = "";
      stage.style.opacity = "";
    }
    if (root) {
      root.style.transition = animate ? "background-color 260ms ease-out" : "none";
      root.style.backgroundColor = "";
    }
  };
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    gesture.current =
      e.touches.length === 1 && !panelOpen
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: e.timeStamp, axis: null, dx: 0, dy: 0 }
        : null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current;
    const stage = stageRef.current;
    if (!g || !stage || e.touches.length !== 1) return;
    g.dx = e.touches[0].clientX - g.x;
    g.dy = e.touches[0].clientY - g.y;
    if (!g.axis) {
      if (Math.max(Math.abs(g.dx), Math.abs(g.dy)) < 10) return;
      g.axis = Math.abs(g.dx) > Math.abs(g.dy) ? "x" : g.dy > 0 ? "y" : null;
      if (!g.axis) {
        gesture.current = null;
        return;
      }
    }
    stage.style.transition = "none";
    if (g.axis === "x") {
      // Resists past the first and last photo, so the end is felt, not hit.
      const atEdge = (g.dx > 0 && index === 0) || (g.dx < 0 && index === items.length - 1);
      stage.style.transform = `translate3d(${atEdge ? g.dx * 0.3 : g.dx}px, 0, 0)`;
    } else {
      const dy = Math.max(0, g.dy);
      stage.style.transform = `translate3d(0, ${dy}px, 0) scale(${1 - Math.min(dy / 1600, 0.12)})`;
      const root = viewerRef.current;
      if (root) {
        root.style.transition = "none";
        root.style.backgroundColor = `rgba(0, 0, 0, ${1 - Math.min(dy / 450, 0.75)})`;
      }
    }
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const g = gesture.current;
    gesture.current = null;
    const stage = stageRef.current;
    if (!g?.axis || !stage) return;
    const reduce = prefersReducedMotion();
    const speed = (g.axis === "x" ? Math.abs(g.dx) : g.dy) / Math.max(1, e.timeStamp - g.t);
    if (g.axis === "x") {
      const delta = g.dx < 0 ? 1 : -1;
      const target = index + delta;
      const far = Math.abs(g.dx) > Math.max(SWIPE_THRESHOLD, window.innerWidth * COMMIT_SHARE);
      if (target < 0 || target >= items.length || !(far || speed > COMMIT_SPEED)) return settleStage(!reduce);
      if (reduce) {
        settleStage(false);
        return go(delta);
      }
      stage.style.transition = `transform ${LEAVE_MS}ms cubic-bezier(0.4, 0, 1, 1), opacity ${LEAVE_MS}ms ease-in`;
      stage.style.transform = `translate3d(${delta > 0 ? "-100%" : "100%"}, 0, 0)`;
      stage.style.opacity = "0.3";
      window.setTimeout(() => go(delta), LEAVE_MS);
      return;
    }
    if (g.dy > DISMISS_DISTANCE || speed > DISMISS_SPEED) {
      if (reduce) return onClose();
      stage.style.transition = `transform ${LEAVE_MS}ms ease-in, opacity ${LEAVE_MS}ms ease-in`;
      stage.style.transform = `translate3d(0, ${Math.max(g.dy, 0) + 160}px, 0) scale(0.9)`;
      stage.style.opacity = "0";
      return requestClose();
    }
    settleStage(!reduce);
  };

  return (
    <div
      ref={viewerRef}
      role="dialog"
      aria-modal="true"
      aria-label={t.viewer.label}
      className={`fixed inset-0 z-[110] flex flex-col bg-black ${closing ? "klik-viewer-out" : "klik-viewer-in"}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => {
        gesture.current = null;
        settleStage(true);
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
              aria-label={slideshowPlaying ? t.viewer.pauseSlideshow : t.viewer.startSlideshow}
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
              aria-label={enhanced ? t.viewer.showOriginal : t.viewer.enhance}
              aria-pressed={enhanced}
              title={enhanced ? t.viewer.enhancedTitle : t.viewer.enhanceTitle}
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
                setSharingFor(null);
                setReportingId(item.id);
                setReportReason(null);
                setReportNote("");
                setReportState("idle");
                setReportError(null);
              }}
              aria-label={t.viewer.report(item.kind)}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-paper transition-transform active:scale-90"
            >
              <Flag className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          {onDeleteOwn && item.mine && (
            <button
              type="button"
              onClick={() => {
                setSharingFor(null);
                setDeleteError(null);
                setConfirmingDelete(item.id);
              }}
              aria-label={t.viewer.deleteYours(item.kind)}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-paper transition-transform active:scale-90"
            >
              <Trash2 className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => void openEditor()}
              disabled={editLoading !== null}
              aria-label={t.viewer.edit}
              title={t.viewer.editTitle}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-paper transition-transform active:scale-90 disabled:opacity-50"
            >
              {editLoading === item.id ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-paper" aria-hidden="true" />
              ) : (
                <Pencil className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
          )}
          {canPrint && (
            <button
              type="button"
              onClick={() => {
                setPrintAdded(null);
                setPrintCopies(1);
                setPrintFor(printFor === item.id ? null : item.id);
              }}
              aria-expanded={printFor === item.id}
              aria-label={t.prints.order}
              title={t.prints.order}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-paper transition-transform active:scale-90"
            >
              <Printer className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          {canSharpen && (
            <button
              type="button"
              onClick={() => {
                setSharpenMessage(null);
                setSharpenFor(sharpenFor === item.id ? null : item.id);
              }}
              aria-expanded={sharpenFor === item.id}
              aria-label={t.viewer.sharpen}
              title={t.viewer.sharpen}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-paper transition-transform active:scale-90"
            >
              <WandSparkles className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          {(share || onShare) && (
            <button
              type="button"
              onClick={() => {
                if (!share) {
                  onShare?.(item.id);
                  return;
                }
                setSlideshowPlaying(false);
                setCommentsFor(null);
                setReportingId(null);
                setConfirmingDelete(null);
                setSharingFor(sharingOpen ? null : item.id);
              }}
              aria-expanded={share ? sharingOpen : undefined}
              aria-label={t.viewer.share(item.kind)}
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
            // On a phone, saving lives in the share sheet, which keeps the
            // top bar to what fits beside the counter.
            <a
              href={`${downloadBaseUrl}/${item.id}/download`}
              aria-label={t.viewer.download(item.kind)}
              onClick={(event) => {
                const blob = enhancedBlob.current;
                if (!blob || !slug) return;
                event.preventDefault();
                saveBlob(blob, downloadFilename(slug, item.id));
              }}
              className={`${share ? "hidden sm:flex" : "flex"} h-11 w-11 items-center justify-center rounded-full bg-white/10 text-paper transition-transform active:scale-90`}
            >
              <Download className="h-5 w-5" aria-hidden="true" />
            </a>
          )}
          <button
            ref={closeRef}
            onClick={requestClose}
            aria-label={t.common.close}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-paper transition-transform active:scale-90"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {/* The stage carries the photo through a drag, and is keyed by it so
            each new photo mounts fresh and plays its way in. */}
        <div
          ref={stageRef}
          key={`stage-${item.id}`}
          className={`absolute inset-0 ${
            enter === "open"
              ? "klik-photo-open"
              : enter === "next"
                ? "klik-photo-next"
                : enter === "prev"
                  ? "klik-photo-prev"
                  : "klik-fade-in"
          }`}
        >
          {item.kind === "video" ? (
            <StreamVideo
              key={`media-${item.id}`}
              src={item.blobUrl}
              stream={Boolean(item.stream)}
              poster={item.posterSrc ?? item.posterUrl ?? undefined}
              label={t.viewer.position("video", index + 1, items.length)}
              className="h-full w-full object-contain"
              autoPlay
            />
          ) : (
            // Keyed apart from the sheets below, which share this parent: one key
            // for all of them made React remount the photo when a sheet opened.
            <Image
              key={`media-${item.id}`}
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
              alt={t.viewer.position("photo", index + 1, items.length)}
              fill
              unoptimized
              sizes="100vw"
              className="touch-manipulation object-contain"
              priority
            />
          )}
        </div>

        {/* MED-10. Not for the photographer looking at their own, clean. */}
        {item.kind === "photo" && slug && (item.proof === true || item.proof === "locked") && !commentsOpen && !sharingOpen && reportingId !== item.id && (
          <ProofNote key={`proof-${item.id}`} slug={slug} mediaId={item.id} />
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
            key={`comments-${item.id}`}
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

        {share && sharingOpen && (
          <MediaSharePanel
            key={`share-${item.id}`}
            item={item}
            slug={slug ?? ""}
            eventName={share.eventName}
            accent={share.accent}
            canTakeFile={share.canTakeFile(item)}
            linkable={(item.status ?? "approved") === "approved" && (item.visibility ?? "gallery") === "gallery"}
            downloadHref={downloadBaseUrl ? `${downloadBaseUrl}/${item.id}/download` : null}
            enhanced={item && enhancedFor?.id === item.id ? enhancedFor.blob : null}
            onShareLink={
              onShare
                ? () => {
                    setSharingFor(null);
                    onShare(item.id);
                  }
                : undefined
            }
            onClose={() => setSharingFor(null)}
          />
        )}

        {onReport && reportingId === item.id && (
          <div
            role="dialog"
            aria-label={t.viewer.reportDialog}
            className="klik-sheet-up absolute inset-x-3 bottom-3 z-10 mx-auto max-h-[80%] max-w-md space-y-3 overflow-y-auto rounded-2xl border border-white/10 bg-black/85 p-4 backdrop-blur"
          >
            {reportState === "sent" ? (
              <>
                <p className="text-sm text-paper">{t.viewer.reportThanks}</p>
                {reportReason === "copyright" && (
                  <p className="text-xs leading-relaxed text-muted">
                    {t.viewer.dmcaBefore}{" "}
                    <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline">
                      {t.viewer.terms}
                    </a>
                    {t.viewer.dmcaAfter}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setReportingId(null)}
                  className="min-h-11 rounded-full border border-white/15 px-4 text-sm text-paper"
                >
                  {t.common.close}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-paper">{t.viewer.whatIsWrong}</p>
                <div className="space-y-1.5">
                  {REPORT_OPTIONS.map((value) => (
                    <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 text-sm text-paper hover:bg-white/5">
                      <input
                        type="radio"
                        name="report-reason"
                        value={value}
                        checked={reportReason === value}
                        onChange={() => setReportReason(value)}
                        className="accent-volt"
                      />
                      {t.viewer.reportReasons[value]}
                    </label>
                  ))}
                </div>
                <textarea
                  aria-label={t.viewer.reportNote}
                  placeholder={t.viewer.reportNote}
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
                    {reportState === "sending" ? t.viewer.sendingReport : t.viewer.sendReport}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportingId(null)}
                    className="min-h-11 rounded-full border border-white/15 px-4 text-sm text-paper"
                  >
                    {t.common.cancel}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {onDeleteOwn && confirmingDelete === item.id && (
          <div
            role="alertdialog"
            aria-label={t.viewer.deleteDialog}
            className="klik-sheet-up absolute inset-x-3 bottom-3 z-10 mx-auto max-w-md space-y-3 rounded-2xl border border-white/10 bg-black/85 p-4 backdrop-blur"
          >
            <p className="text-sm text-paper">
              {t.viewer.deleteConfirm(item.kind)}
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
                {deleting ? t.viewer.deleting : t.viewer.delete}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(null)}
                className="min-h-11 rounded-full border border-white/15 px-4 text-sm text-paper"
              >
                {t.viewer.keep}
              </button>
            </div>
          </div>
        )}

        {print && printFor === item.id && (
          <div
            role="dialog"
            aria-label={t.prints.order}
            className="klik-sheet-up absolute inset-x-3 bottom-3 z-10 mx-auto max-w-md space-y-3 rounded-2xl border border-white/10 bg-black/85 p-4 backdrop-blur"
          >
            {printAdded !== null ? (
              <p className="text-sm text-paper" role="status">
                {t.prints.added(printAdded)}
              </p>
            ) : (
              <>
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm text-paper">{t.prints.chooseSize}</legend>
                  {PRINT_PRODUCTS.map((product) => {
                    const quality = printQuality(printDpi(item.width ?? null, item.height ?? null, product));
                    return (
                      <label
                        key={product.key}
                        className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 text-sm ${
                          printSize === product.key ? "border-volt text-paper" : "border-white/15 text-paper/80"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="print-size"
                            value={product.key}
                            checked={printSize === product.key}
                            onChange={() => setPrintSize(product.key)}
                            className="accent-volt"
                          />
                          {product.label}
                          {t.prints.quality[quality] && (
                            <span className={`text-xs ${quality === "soft" ? "text-red-300" : "text-muted"}`}>{t.prints.quality[quality]}</span>
                          )}
                        </span>
                        <span className="tabular-nums">${(product.priceCents / 100).toFixed(2)}</span>
                      </label>
                    );
                  })}
                </fieldset>
                <div className="flex items-center gap-2 text-sm text-paper">
                  <span className="mr-auto text-muted">{t.prints.copies}</span>
                  <button type="button" aria-label={t.prints.fewer} disabled={printCopies <= 1} onClick={() => setPrintCopies((n) => Math.max(1, n - 1))} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 disabled:opacity-40">
                    −
                  </button>
                  <span className="w-6 text-center tabular-nums">{printCopies}</span>
                  <button type="button" aria-label={t.prints.more} disabled={printCopies >= 20} onClick={() => setPrintCopies((n) => Math.min(20, n + 1))} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 disabled:opacity-40">
                    +
                  </button>
                </div>
              </>
            )}
            <div className="flex flex-wrap gap-2">
              {printAdded === null ? (
                <button
                  type="button"
                  onClick={() => setPrintAdded(print.add(item, printSize, printCopies))}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-volt px-4 text-sm font-medium text-on-volt"
                >
                  <Printer className="h-4 w-4" aria-hidden="true" />
                  {t.prints.add}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setPrintFor(null);
                    print.checkout();
                  }}
                  className="min-h-11 rounded-full bg-volt px-4 text-sm font-medium text-on-volt"
                >
                  {t.prints.checkout}
                </button>
              )}
              <button type="button" onClick={() => setPrintFor(null)} className="min-h-11 rounded-full border border-white/15 px-4 text-sm text-paper">
                {printAdded === null ? t.common.cancel : t.viewer.ok}
              </button>
            </div>
          </div>
        )}

        {sharpen && sharpenFor === item.id && (
          <div
            role="dialog"
            aria-label={t.viewer.sharpen}
            className="klik-sheet-up absolute inset-x-3 bottom-3 z-10 mx-auto max-w-md space-y-3 rounded-2xl border border-white/10 bg-black/85 p-4 backdrop-blur"
          >
            <p className="text-sm text-paper" role="status">
              {sharpenMessage ?? (sharpen.left > 0 ? t.viewer.sharpenBody(sharpen.left) : t.viewer.sharpenNoneLeft)}
            </p>
            <div className="flex flex-wrap gap-2">
              {!sharpenMessage && sharpen.left > 0 && (
                <button
                  type="button"
                  disabled={sharpenBusy}
                  onClick={async () => {
                    setSharpenBusy(true);
                    const error = await sharpen.start(item);
                    setSharpenBusy(false);
                    setSharpenMessage(error ?? t.viewer.sharpenStarted);
                  }}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-volt px-4 text-sm font-medium text-on-volt disabled:opacity-50"
                >
                  <WandSparkles className="h-4 w-4" aria-hidden="true" />
                  {t.viewer.sharpen}
                </button>
              )}
              <button
                type="button"
                onClick={() => setSharpenFor(null)}
                className="min-h-11 rounded-full border border-white/15 px-4 text-sm text-paper"
              >
                {sharpenMessage ? t.viewer.ok : t.common.cancel}
              </button>
            </div>
          </div>
        )}

        {editNote && (
          <div
            role="status"
            className="klik-sheet-up absolute inset-x-3 bottom-3 z-10 mx-auto max-w-md space-y-3 rounded-2xl border border-white/10 bg-black/85 p-4 backdrop-blur"
          >
            <p className="text-sm text-paper">{editNote.message}</p>
            <div className="flex flex-wrap gap-2">
              {editNote.canRemove && edit?.removeOriginal && (
                <button
                  type="button"
                  onClick={async () => {
                    const error = await edit.removeOriginal!(editNote.originalId);
                    setEditNote(
                      error
                        ? { ...editNote, message: error }
                        : { originalId: editNote.originalId, message: t.viewer.originalGone, canRemove: false },
                    );
                  }}
                  className="min-h-11 rounded-full border border-white/15 px-4 text-sm text-paper"
                >
                  {t.viewer.removeOriginal}
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditNote(null)}
                className="min-h-11 rounded-full bg-volt px-4 text-sm font-medium text-on-volt"
              >
                {t.viewer.ok}
              </button>
            </div>
          </div>
        )}

        {index > 0 && (
          <button
            onClick={() => go(-1)}
            aria-label={t.viewer.previous}
            className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-paper backdrop-blur transition-transform active:scale-90"
          >
            <ChevronLeft className="h-6 w-6" aria-hidden="true" />
          </button>
        )}
        {index < items.length - 1 && (
          <button
            onClick={() => go(1)}
            aria-label={t.viewer.next}
            className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-paper backdrop-blur transition-transform active:scale-90"
          >
            <ChevronRight className="h-6 w-6" aria-hidden="true" />
          </button>
        )}
      </div>

      {editing && edit && (
        <ImageEditor
          source={editing.url}
          accent={edit.accent}
          onSave={async (edited) => {
            const original = editing.item;
            await edit.save(original, edited);
            closeEditor();
            setEditNote({
              originalId: original.id,
              message: edit.removeOriginal
                ? t.viewer.savedCopyMine
                : t.viewer.savedCopy,
              canRemove: Boolean(edit.removeOriginal),
            });
          }}
          onClose={closeEditor}
        />
      )}

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
                setSharingFor(null);
                setCommentsFor(commentsOpen ? null : item.id);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
