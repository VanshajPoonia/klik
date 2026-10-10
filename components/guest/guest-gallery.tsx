"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { nanoid } from "nanoid";
import { Camera, CheckCircle2, Circle, Heart, ImagePlus, Layers, MessageCircle, Play, Stamp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PublicEvent } from "@/lib/events";
import { ensureContrast, galleryPalette, readableOn } from "@/lib/color";
import { LanguageSwitch, useGuestCopy } from "@/components/guest/guest-copy";
import { formatDuration } from "@/lib/video-poster";
import { uploadToGallery } from "@/lib/upload-client";
import { UploadTray } from "@/components/upload/upload-tray";
import { useUploadQueue } from "@/components/upload/use-upload-queue";
import type { AddedEvent } from "@/lib/upload-queue/page-queue";
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
import { childrenOf, flattenFolders, folderPath, inFolder } from "@/lib/folder-tree";
import type { ChallengeBoard } from "@/lib/challenges";

/** MED-4: a folder as the gallery holds it. See `galleryFolderPayload`. */
interface GalleryFolder {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  createdAt: string;
  /** Something a guest can see is in it. Only filled folders get a tab. */
  filled: boolean;
}

/** AI-1: a stretch of the event, worked out from when photos were taken. */
interface GalleryMoment {
  id: string;
  name: string;
  count: number;
}

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
  /** MED-9. Absent on payloads from before it shipped. */
  reactionCount?: number;
  commentCount?: number;
  reacted?: boolean;
  /** AI-1. The moment it was taken in, and the burst it stacks under. */
  momentId?: string | null;
  burstId?: string | null;
  /** GRW-3. The challenge it was taken for. */
  challengeId?: string | null;
  /** MED-10. A watermarked proof. */
  proof?: boolean;
}

interface PendingUpload {
  file: File;
  /** Set when the file is already at final size and quality (camera captures),
   * letting the uploader skip a redundant decode/re-encode. */
  prepared?: { width: number; height: number };
  /** GRW-3: taken from a challenge card. */
  challengeId?: string | null;
  /** CAM-1: when the in-app camera took it. */
  capturedAt?: string;
}

const MAX_FILES_PER_PICK = 20;
const DEFAULT_BACKGROUND = "#050505";
const PAGE_SIZE = 60;

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

export function GuestGallery({
  event,
  isOwner,
  initialMedia,
  syncedAt,
  folders: initialFolders = [],
  moments: initialMoments = [],
  coverUrl = null,
  canSlideshow = false,
  showBranding = true,
  referralHref = null,
  maxVideoSeconds,
  galleryFull = false,
  disposable = null,
  signedIn = false,
  canModerateComments = false,
  linked = null,
  linkedMissing = false,
  board: initialBoard = null,
  proofs = null,
  keepPhotoDetails = false,
}: {
  event: PublicEvent;
  isOwner: boolean;
  initialMedia: MediaItem[];
  /** When the server read `initialMedia`. The first poll asks what changed since. */
  syncedAt: string;
  folders?: GalleryFolder[];
  moments?: GalleryMoment[];
  coverUrl?: string | null;
  canSlideshow?: boolean;
  showBranding?: boolean;
  /** GRW-5: the host's referral link, behind the "made with Klik" line. */
  referralHref?: string | null;
  maxVideoSeconds: number;
  /** PAY-7: storage is used up, so uploads are off and the guest is told why. */
  galleryFull?: boolean;
  /** CAM-4: this event is a disposable camera, and this is the guest's roll. */
  disposable?: { shotsPerGuest: number; shotsLeft: number; developsAt: string | null; developed: boolean } | null;
  /** ACC-4: whether this guest is signed in, which only changes one line of copy. */
  signedIn?: boolean;
  /** MED-9: a team member whose role may hide comments. */
  canModerateComments?: boolean;
  /** CAM-3: the photo a shared link points at, opened on arrival. */
  linked?: MediaItem | null;
  /** The link pointed at something this viewer cannot see, or that is gone. */
  linkedMissing?: boolean;
  /** GRW-3: the host's photo challenges, their counts, and the leaderboard. */
  board?: ChallengeBoard | null;
  /**
   * MED-10: this team member may upload watermarked proofs. `label` is their
   * watermark's words, or null when they have not made one yet.
   */
  proofs?: { label: string | null } | null;
  /** MED-8: the team's JPEGs go up as shot, for the host's "keep camera details". */
  keepPhotoDetails?: boolean;
}) {
  // TRS-3: the guest's language, chosen by the page.
  const { t, locale } = useGuestCopy();
  // The server's count. What the guest sees also takes off shots still in the
  // upload queue on this phone, which the server has not heard of yet.
  const [shotsOnServer, setShotsOnServer] = useState(disposable?.shotsLeft ?? 0);
  // MED-9. Held as state because the host can switch either on while phones
  // are open; the change sync brings the new values with its resync.
  const [features, setFeatures] = useState({
    reactions: event.reactionsEnabled,
    comments: event.commentsEnabled,
  });
  // A disposable is shot in the moment, so guests use the camera and not their
  // camera roll. The host can still add from anywhere.
  const cameraOnly = Boolean(disposable) && !isOwner;
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

  const [notice, setNotice] = useState<string | null>(
    linkedMissing ? t.gallery.linkedMissing : null,
  );
  const [cameraOpen, setCameraOpen] = useState(false);
  // Tracked by id, not position: new photos stream in at the head every poll,
  // which would otherwise shift the open item out from under the viewer.
  const [lightboxId, setLightboxId] = useState<string | null>(linked?.id ?? null);
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
  // MED-4. Kept fresh by the sync, which sends folders whenever they or what
  // is in them may have changed.
  const [folders, setFolders] = useState<GalleryFolder[]>(initialFolders);
  const [chosenFolderId, setChosenFolderId] = useState<string | null>(null);
  const [moments, setMoments] = useState<GalleryMoment[]>(initialMoments);
  const [chosenMomentId, setChosenMomentId] = useState<string | null>(null);
  const [uploadAlbumId, setUploadAlbumId] = useState<string>("");
  // GRW-3. Kept fresh by the sync, which sends it with any change to photos.
  const [board, setBoard] = useState<ChallengeBoard>(initialBoard ?? { challenges: [], done: [], leaderboard: null });
  // Ticks earned on this phone since the board was last sent.
  const [doneHere, setDoneHere] = useState<ReadonlySet<string>>(() => new Set());
  const [chosenChallengeId, setChosenChallengeId] = useState<string | null>(null);
  // The card a camera or file picker was opened from. A ref, not state: it is
  // read once, when the files come back, and must not tag the next upload.
  const challengeRef = useRef<string | null>(null);
  const challengeInputRef = useRef<HTMLInputElement>(null);
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
    // MED-4: a photo everyone can see, landing in a folder whose tab is hidden
    // for being empty, fills it and every folder above it.
    const landed = upserts
      .filter((item) => item.albumId && item.status === "approved" && item.visibility === "gallery")
      .map((item) => item.albumId as string);
    if (landed.length > 0) {
      setFolders((current) => {
        const fill = new Set(landed.flatMap((id) => folderPath(current, id).map((folder) => folder.id)));
        return current.some((folder) => fill.has(folder.id) && !folder.filled)
          ? current.map((folder) => (fill.has(folder.id) ? { ...folder, filled: true } : folder))
          : current;
      });
    }
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
        const data: {
          at: string;
          resync?: boolean;
          upserts?: MediaItem[];
          removed?: string[];
          features?: { reactions: boolean; comments: boolean };
          folders?: GalleryFolder[];
          moments?: GalleryMoment[];
          board?: ChallengeBoard;
        } = await res.json();
        if (data.folders) setFolders(data.folders);
        if (data.board) setBoard(data.board);
        if (data.moments) setMoments(data.moments);
        if (data.resync) {
          if (data.features) setFeatures(data.features);
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

  /**
   * OPS-3: every pick goes into the upload queue, which keeps the files on this
   * phone until they are in the gallery and survives the wifi dropping, the
   * screen locking and the tab closing. This hears each one land, from this
   * page or from whatever else on the phone sent it.
   */
  const onUploaded = useCallback(
    ({ media: landed }: AddedEvent) => {
      // Shown straight away from the registration response rather than
      // waiting for the next poll, so the uploader sees their own photo land.
      if (landed) applyChanges([landed as MediaItem], []);
      // The tick shows now, not at the next sync. Only if the server kept the
      // challenge, which it drops when the host removed it meanwhile.
      const kept = (landed as MediaItem | null)?.challengeId;
      if (kept) setDoneHere((current) => (current.has(kept) ? current : new Set(current).add(kept)));
      if (disposable && !isOwner) setShotsOnServer((left) => Math.max(0, left - 1));
      syncNow.current();
    },
    [applyChanges, disposable, isOwner],
  );
  // MED-10: remembered per event on this device, off until switched on.
  const proofKey = `klik_proofs_${event.id}`;
  const [proofMode, setProofMode] = useState(false);
  useEffect(() => {
    if (!proofs?.label) return;
    let saved = false;
    try {
      saved = window.localStorage.getItem(proofKey) === "1";
    } catch {
      // Storage blocked: it starts off each visit.
    }
    if (saved) {
      const timer = window.setTimeout(() => setProofMode(true), 0);
      return () => window.clearTimeout(timer);
    }
  }, [proofKey, proofs?.label]);
  const sendingProofs = Boolean(proofs?.label) && proofMode;
  const uploads = useUploadQueue(
    {
      eventId: event.id,
      slug: event.slug,
      albumId: uploadAlbumId || null,
      maxVideoSeconds,
      proof: sendingProofs,
      keepDetails: keepPhotoDetails && isOwner,
    },
    onUploaded,
  );
  const { enqueue, clear: clearUploads } = uploads;
  const shotsLeft = Math.max(0, shotsOnServer - uploads.items.filter((item) => item.status !== "refused").length);

  const uploadFiles = useCallback(
    (chosen: PendingUpload[]) => {
      // MED-10: a video cannot carry a watermark yet, so it is not sent
      // unmarked while proofs are on. Said, so it is not a silent drop.
      const picked = sendingProofs ? chosen.filter((upload) => !upload.file.type.startsWith("video/")) : chosen;
      const skippedVideos = chosen.length - picked.length;
      if (picked.length === 0) {
        if (skippedVideos > 0) setNotice(t.gallery.videosNotWatermarked);
        return;
      }
      const batch = picked.slice(0, MAX_FILES_PER_PICK);
      setNotice(
        picked.length > batch.length
          ? t.gallery.addedFirst(batch.length, picked.length)
          : skippedVideos > 0
            ? t.gallery.leftOutVideos(skippedVideos)
            : null,
      );
      void enqueue(batch).catch(() => setNotice(t.gallery.couldNotAdd));
    },
    [enqueue, sendingProofs, t],
  );

  const handleFiles = useCallback(
    (files: FileList | null, challengeId: string | null = null) => {
      if (!files) return;
      uploadFiles(Array.from(files).map((file) => ({ file, challengeId })));
    },
    [uploadFiles],
  );

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
        return body.error ?? t.gallery.deleteFailed;
      }
      setItems((current) => current.filter((item) => item.id !== mediaId));
      setLightboxId(null);
      return null;
    },
    [event.slug, t],
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
      if (!res.ok) return body.error ?? t.gallery.reportFailed;
      return null;
    },
    [event.slug, t],
  );

  /**
   * MED-9: hearts or un-hearts, on screen at once and on the server after. The
   * server's count wins when it answers, since others are hearting too; a
   * failure puts the heart back where it was.
   */
  const react = useCallback(
    async (mediaId: string, on: boolean) => {
      const patch = (fields: (item: MediaItem) => Partial<MediaItem>) =>
        setItems((current) => current.map((item) => (item.id === mediaId ? { ...item, ...fields(item) } : item)));
      patch((item) => ({
        reacted: on,
        reactionCount: Math.max(0, (item.reactionCount ?? 0) + (on ? 1 : -1) * (item.reacted === on ? 0 : 1)),
      }));
      const res = await fetch(`/api/e/${event.slug}/media/${mediaId}/reaction`, { method: on ? "PUT" : "DELETE" }).catch(
        () => null,
      );
      if (res?.ok) {
        const body: { reacted: boolean; count: number } = await res.json();
        patch(() => ({ reacted: body.reacted, reactionCount: body.count }));
      } else {
        // Only undoes what the optimistic step did, if it is still showing.
        patch((item) =>
          item.reacted === on
            ? { reacted: !on, reactionCount: Math.max(0, (item.reactionCount ?? 0) + (on ? -1 : 1)) }
            : {},
        );
      }
    },
    [event.slug],
  );

  const setCommentCount = useCallback((mediaId: string, count: number) => {
    setItems((current) =>
      current.map((item) => (item.id === mediaId && item.commentCount !== count ? { ...item, commentCount: count } : item)),
    );
  }, []);

  /**
   * CAM-2: an edited copy goes up through the ordinary upload path as a new
   * photo that points at the original, so compression, quotas and moderation
   * all apply, and it is opened in the viewer once it lands. The moment tabs
   * go back to "any time" first: the copy is placed in its moment by a job a
   * moment later, and must not vanish from the viewer meanwhile.
   */
  const saveEdit = useCallback(
    async (original: { id: string }, edited: Blob): Promise<string | null> => {
      const source = items.find((item) => item.id === original.id);
      const registered = await uploadToGallery({
        eventId: event.id,
        slug: event.slug,
        mediaId: nanoid(),
        file: new File([edited], `edited-${original.id}.jpg`, { type: edited.type || "image/jpeg" }),
        albumId: source?.albumId ?? null,
        challengeId: source?.challengeId ?? null,
        derivedFromId: original.id,
        maxVideoSeconds,
      });
      const added = registered.media as MediaItem | undefined;
      if (!added) return null;
      applyChanges([added], []);
      setChosenMomentId(null);
      setLightboxId(added.id);
      syncNow.current();
      return added.id;
    },
    [applyChanges, event.id, event.slug, items, maxVideoSeconds],
  );

  /** CAM-2: the original, taken down after an edit, without leaving the viewer. */
  const removeOriginal = useCallback(
    async (mediaId: string): Promise<string | null> => {
      const res = await fetch(`/api/e/${event.slug}/media/${mediaId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return body.error ?? t.gallery.removeFailed;
      }
      setItems((current) => current.filter((item) => item.id !== mediaId));
      return null;
    },
    [event.slug, t],
  );

  /** GRW-3: opens the camera or the picker for one challenge card. */
  const startChallenge = useCallback((challengeId: string, from: "camera" | "library") => {
    challengeRef.current = challengeId;
    if (from === "camera") setCameraOpen(true);
    else challengeInputRef.current?.click();
  }, []);

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
      setLeaveError(body.error ?? t.gallery.removeAllFailed);
      setLeaving("confirm");
      return;
    }
    // Nothing still waiting on this phone goes up after they asked for everything to go.
    await clearUploads().catch(() => {});
    window.location.reload();
  }, [clearUploads, event.slug, t]);

  // Tabs are for folders with something in them; a folder that empties or
  // goes away under someone browsing it drops them back to everything.
  const tabFolders = folders.filter((folder) => folder.filled);
  const activeFolderId = chosenFolderId && tabFolders.some((folder) => folder.id === chosenFolderId) ? chosenFolderId : null;
  const activePath = folderPath(tabFolders, activeFolderId);
  const activeMomentId =
    chosenMomentId && moments.some((moment) => moment.id === chosenMomentId) ? chosenMomentId : null;
  const inFolderItems = activeFolderId ? inFolder(items, tabFolders, activeFolderId) : items;
  const inMomentItems = activeMomentId
    ? inFolderItems.filter((item) => item.momentId === activeMomentId)
    : inFolderItems;
  // GRW-3: a challenge card, pressed, shows the photos taken for it.
  const activeChallengeId =
    chosenChallengeId && board.challenges.some((challenge) => challenge.id === chosenChallengeId) ? chosenChallengeId : null;
  const visibleItems = activeChallengeId
    ? inMomentItems.filter((item) => item.challengeId === activeChallengeId)
    : inMomentItems;
  const doneChallenges = new Set([...board.done, ...doneHere]);
  const canTakeChallenge = event.uploadsEnabled && !(cameraOnly && shotsLeft === 0);

  // AI-1: a burst shows as its first photo with a count. Only when that photo
  // is itself on screen; otherwise the rest show as they are.
  const shownIds = new Set(visibleItems.map((item) => item.id));
  const burstSizes = new Map<string, number>();
  for (const item of visibleItems) {
    if (item.burstId && shownIds.has(item.burstId)) {
      burstSizes.set(item.burstId, (burstSizes.get(item.burstId) ?? 0) + 1);
    }
  }
  const gridItems = visibleItems.filter(
    (item) => !item.burstId || item.burstId === item.id || !shownIds.has(item.burstId),
  );
  // Resolves to -1 if the open item was removed (moderated away), which closes.
  const lightboxIndex = lightboxId ? visibleItems.findIndex((item) => item.id === lightboxId) : -1;
  // CAM-3: a linked photo older than the first page opens on its own until
  // it is closed. The copy in `items`, once it loads, carries fresher counts.
  const linkedAlone =
    lightboxIndex < 0 && linked && lightboxId === linked.id
      ? (items.find((item) => item.id === linked.id) ?? linked)
      : null;
  const viewerItems = linkedAlone ? [linkedAlone] : visibleItems;
  const viewerIndex = linkedAlone ? 0 : lightboxIndex;
  const closeViewer = useCallback(() => {
    setLightboxId(null);
    // Back to the gallery's own address, so a reload does not reopen it.
    const url = new URL(window.location.href);
    if (url.searchParams.has("m")) {
      url.searchParams.delete("m");
      window.history.replaceState(window.history.state, "", url);
    }
  }, []);
  // One row of tabs per level, down to the folder being browsed and one below.
  const tabRows: Array<{ parentId: string | null; selected: string | null }> = [{ parentId: null, selected: activePath[0]?.id ?? null }];
  for (let level = 0; level < activePath.length; level += 1) {
    const parent = activePath[level];
    if (childrenOf(tabFolders, parent.id).length === 0) break;
    tabRows.push({ parentId: parent.id, selected: activePath[level + 1]?.id ?? null });
  }

  // Premium galleries pick their own colors. Keep text, borders, and buttons
  // readable whatever was chosen. The camera and viewer sit outside the content
  // wrapper on purpose: they are always dark, so they only take the accent.
  // TRS-3: every colour held to WCAG AA against the chosen background, the
  // accent included where it is a link, an icon or a button (lib/color.ts).
  const customBackground = event.backgroundColor.toLowerCase() !== DEFAULT_BACKGROUND;
  const palette = galleryPalette(event.accentColor, event.backgroundColor);
  const blendToward = palette.light ? "black" : "white";
  const contentTheme = {
    ["--color-volt" as string]: palette.volt,
    ["--color-on-volt" as string]: palette.onVolt,
    ...(customBackground
      ? {
          ["--color-paper" as string]: palette.paper,
          ["--color-muted" as string]: palette.muted,
          ["--color-canvas-raised" as string]: `color-mix(in srgb, ${event.backgroundColor} 94%, ${blendToward})`,
          ["--color-canvas-line" as string]: `color-mix(in srgb, ${event.backgroundColor} 84%, ${blendToward})`,
        }
      : {}),
  };
  // The camera and the viewer are always near black, outside the content.
  const darkVolt = ensureContrast(event.accentColor, "#050505", 3);

  return (
    <div
      className="min-h-screen px-6 py-10 md:px-10"
      style={{
        backgroundColor: event.backgroundColor,
        // The viewer and camera are always dark, so out here the accent is
        // held to that; the content wrapper holds it to the chosen background.
        ["--event-accent" as string]: event.accentColor,
        ["--color-volt" as string]: darkVolt,
        ["--color-on-volt" as string]: readableOn(darkVolt),
        ["--color-canvas" as string]: event.backgroundColor,
      }}
    >
      <div className="mx-auto max-w-5xl" style={contentTheme}>
        {coverUrl && (
          <div className="relative mb-8 aspect-[16/6] overflow-hidden rounded-2xl border border-white/10">
            <Image
              src={coverUrl}
              alt={t.gallery.coverAlt(event.name)}
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
              {t.gallery.itemsShared(items.length, hasMore)}
              {isOwner && t.gallery.viewingAsOrganizer}
            </p>
          </div>
          {event.uploadsEnabled && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {/* MED-10: for a photographer on the team. */}
              {proofs &&
                (proofs.label ? (
                  <button
                    type="button"
                    aria-pressed={proofMode}
                    onClick={() => {
                      const next = !proofMode;
                      setProofMode(next);
                      try {
                        window.localStorage.setItem(proofKey, next ? "1" : "0");
                      } catch {
                        // Lasts this visit only.
                      }
                    }}
                    title={
                      proofMode
                        ? t.gallery.proofsOnTitle
                        : t.gallery.proofsOffTitle
                    }
                    className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm transition-colors ${
                      proofMode ? "border-volt bg-volt text-on-volt" : "border-canvas-line text-paper hover:border-paper/40"
                    }`}
                  >
                    <Stamp className="h-4 w-4" aria-hidden="true" />
                    {proofMode ? t.gallery.proofsOn : t.gallery.proofsOff}
                  </button>
                ) : (
                  <a
                    href="/dashboard/account#watermark"
                    className="inline-flex min-h-11 items-center gap-2 rounded-full border border-canvas-line px-4 text-sm text-muted hover:text-paper"
                  >
                    <Stamp className="h-4 w-4" aria-hidden="true" />
                    {t.gallery.setUpProofs}
                  </a>
                ))}
              {folders.length > 0 && (
                <select
                  aria-label={t.gallery.addToFolder}
                  value={folders.some((folder) => folder.id === uploadAlbumId) ? uploadAlbumId : ""}
                  onChange={(event) => setUploadAlbumId(event.target.value)}
                  className="min-h-11 rounded-full border border-canvas-line bg-canvas px-4 text-sm text-paper"
                >
                  <option value="">{t.gallery.noFolder}</option>
                  {flattenFolders(folders).map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {"\u00a0\u00a0\u00a0".repeat(folder.depth - 1)}
                      {folder.name}
                    </option>
                  ))}
                </select>
              )}
              <Button
                onClick={() => {
                  challengeRef.current = null;
                  setCameraOpen(true);
                }}
                className="gap-2"
                disabled={cameraOnly && shotsLeft === 0}
              >
                <Camera className="h-4 w-4" />
                {cameraOnly ? (shotsLeft === 0 ? t.gallery.rollFinished : t.gallery.shotsLeft(shotsLeft)) : t.gallery.camera}
              </Button>
              {!cameraOnly && (
                <Button variant="ghost" onClick={() => inputRef.current?.click()}>
                  {t.gallery.addMedia}
                </Button>
              )}
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
              {/* GRW-3: the same picker, for a challenge card, so a photo
                  chosen here is tagged and one from "Add media" never is. */}
              <input
                ref={challengeInputRef}
                type="file"
                accept="image/*,video/mp4,video/quicktime,video/webm"
                multiple
                className="hidden"
                onChange={(event) => {
                  handleFiles(event.target.files, challengeRef.current);
                  challengeRef.current = null;
                  event.target.value = "";
                }}
              />
            </div>
          )}
        </header>

        {disposable && !isOwner && !disposable.developed && (
          <div className="mb-6 rounded-2xl border border-volt/30 bg-volt/10 px-4 py-4" role="status">
            <p className="text-sm font-semibold text-paper">{t.gallery.disposableTitle}</p>
            {/* The time is the phone's own, so it may differ from the server's render. */}
            <p className="mt-1 text-sm text-muted" suppressHydrationWarning>
              {t.gallery.disposableNote(
                shotsLeft,
                disposable.shotsPerGuest,
                disposable.developsAt
                  ? new Date(disposable.developsAt).toLocaleString(locale === "es" ? "es-US" : "en-US", {
                      weekday: "long",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : null,
              )}
            </p>
          </div>
        )}

        {galleryFull && (
          <p className="mb-6 rounded-xl border border-canvas-line bg-canvas-raised px-4 py-3 text-sm text-muted" role="status">
            {/* Never the plan's name: what a guest can do about it is ask. */}
            {t.gallery.galleryFull}
          </p>
        )}

        {notice && (
          <p className="mb-6 text-sm text-muted" role="status">
            {notice}
          </p>
        )}

        <UploadTray
          items={uploads.items}
          online={uploads.online}
          durable={uploads.durable}
          onRetry={(id) => void uploads.retry(id)}
          onRetryNow={() => void uploads.retryNow()}
          onRemove={(id) => void uploads.remove(id)}
        />

        {board.challenges.length > 0 && (
          <section className="mb-6" aria-labelledby="challenges-heading">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 id="challenges-heading" className="text-sm font-semibold text-paper">
                {t.gallery.challenges}
              </h2>
              {!isOwner && (
                <span className="text-xs tabular-nums text-muted">
                  {t.gallery.challengesDone(
                    board.challenges.filter((challenge) => doneChallenges.has(challenge.id)).length,
                    board.challenges.length,
                  )}
                </span>
              )}
            </div>
            <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
              {board.challenges.map((challenge) => {
                const done = doneChallenges.has(challenge.id);
                const pressed = activeChallengeId === challenge.id;
                return (
                  <div
                    key={challenge.id}
                    className={`flex w-60 shrink-0 flex-col justify-between gap-3 rounded-2xl border bg-canvas-raised p-3 ${
                      pressed ? "border-volt" : "border-canvas-line"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setChosenChallengeId(pressed ? null : challenge.id)}
                      aria-pressed={pressed}
                      className="text-left"
                    >
                      <span className="flex items-start gap-2">
                        {done ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-volt" aria-label={t.gallery.done} />
                        ) : (
                          <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                        )}
                        <span className="text-sm leading-snug text-paper">{challenge.prompt}</span>
                      </span>
                      <span className="mt-1.5 block pl-6 text-xs text-muted">
                        {t.gallery.challengeCount(challenge.count, pressed)}
                      </span>
                    </button>
                    {canTakeChallenge && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => startChallenge(challenge.id, "camera")}
                          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-volt px-3 text-sm font-medium text-on-volt transition-transform active:scale-95"
                        >
                          <Camera className="h-4 w-4" aria-hidden="true" />
                          {done ? t.gallery.takeAnother : t.gallery.takeIt}
                        </button>
                        {!cameraOnly && (
                          <button
                            type="button"
                            onClick={() => startChallenge(challenge.id, "library")}
                            aria-label={t.gallery.chooseFor(challenge.prompt)}
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-canvas-line text-paper"
                          >
                            <ImagePlus className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {board.leaderboard && board.leaderboard.length > 0 && (
          <section
            className="mb-6 max-w-sm rounded-2xl border border-canvas-line bg-canvas-raised p-4"
            aria-labelledby="leaderboard-heading"
          >
            <h2 id="leaderboard-heading" className="text-sm font-semibold text-paper">
              {t.gallery.mostShared}
            </h2>
            <ol className="mt-2 space-y-1.5">
              {board.leaderboard.map((row, index) => (
                <li key={`${index}:${row.name}`} className="flex items-center gap-3 text-sm">
                  <span className={`w-5 tabular-nums ${index === 0 ? "text-volt" : "text-muted"}`}>{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-paper">{row.name}</span>
                  <span className="tabular-nums text-muted">{row.count}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {moments.length > 1 && (
          <nav className="mb-3 flex gap-2 overflow-x-auto pb-1" aria-label={t.gallery.moments}>
            {[{ id: null, name: t.gallery.anyTime }, ...moments].map((moment) => {
              const pressed = activeMomentId === moment.id;
              return (
                <button
                  key={moment.id ?? "any"}
                  onClick={() => setChosenMomentId(moment.id)}
                  aria-pressed={pressed}
                  className={`min-h-11 shrink-0 rounded-full border px-4 text-sm transition-colors ${
                    pressed
                      ? "border-transparent bg-paper text-canvas"
                      : "border-canvas-line text-muted hover:text-paper"
                  }`}
                >
                  {moment.name}
                </button>
              );
            })}
          </nav>
        )}

        {tabFolders.length > 0 && (
          <nav className="mb-6 space-y-2" aria-label={t.gallery.folders}>
            {tabRows.map((row, level) => {
              const options = childrenOf(tabFolders, row.parentId);
              const parentName = row.parentId ? tabFolders.find((folder) => folder.id === row.parentId)?.name : null;
              const tab = (key: string, label: string, pressed: boolean, onSelect: () => void) => (
                <button
                  key={key}
                  onClick={onSelect}
                  aria-pressed={pressed}
                  className={`min-h-11 shrink-0 rounded-full border px-4 text-sm transition-colors ${
                    pressed
                      ? "border-transparent bg-volt text-on-volt"
                      : "border-canvas-line text-muted hover:text-paper"
                  }`}
                >
                  {label}
                </button>
              );
              return (
                <div
                  key={row.parentId ?? "top"}
                  className={`flex gap-2 overflow-x-auto pb-1 ${level > 0 ? "border-l-2 border-canvas-line pl-3" : ""}`}
                  role="group"
                  aria-label={parentName ? t.gallery.inside(parentName) : t.gallery.folders}
                >
                  {/* The first tab of a lower row is the whole of its parent. */}
                  {tab(
                    `${row.parentId ?? "top"}:all`,
                    parentName ? t.gallery.allOf(parentName) : t.gallery.everything,
                    row.selected === null && activeFolderId === row.parentId,
                    () => setChosenFolderId(row.parentId),
                  )}
                  {options.map((folder) =>
                    tab(folder.id, folder.name, row.selected === folder.id, () => setChosenFolderId(folder.id)),
                  )}
                </div>
              );
            })}
          </nav>
        )}

        {visibleItems.length === 0 ? (
          <div className="rounded-2xl border border-canvas-line bg-canvas-raised px-6 py-16 text-center text-sm text-muted">
            {items.length === 0
              ? disposable && !isOwner && !disposable.developed
                ? t.gallery.emptyRoll
                : t.gallery.emptyGallery
              : activeChallengeId
                ? t.gallery.emptyChallenge
                : t.gallery.emptyFolder}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {gridItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setLightboxId(item.id)}
                aria-label={item.kind === "video" ? t.gallery.openVideo : t.gallery.openPhoto}
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
                    {t.gallery.awaitingApproval}
                  </span>
                )}
                {/* Only ever reaches a guest for their own upload, since that
                    is the only non-gallery media the access rule lets through.
                    Without it their photo is simply there, with no hint the
                    host took it out of the gallery. */}
                {item.visibility === "private" && item.mine && (
                  <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-paper">
                    {t.gallery.onlyYou}
                  </span>
                )}
                {/* MED-9. Only when there is something to count, so a quiet
                    gallery is not a grid of zeros. */}
                {((features.reactions && (item.reactionCount ?? 0) > 0) ||
                  (features.comments && (item.commentCount ?? 0) > 0)) && (
                  <span className="absolute bottom-1.5 left-1.5 flex items-center gap-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium tabular-nums text-paper backdrop-blur">
                    {features.reactions && (item.reactionCount ?? 0) > 0 && (
                      <span className="flex items-center gap-1">
                        <Heart className={`h-3 w-3 ${item.reacted ? "fill-volt text-volt" : ""}`} aria-hidden="true" />
                        {item.reactionCount}
                        <span className="sr-only">{t.gallery.hearts(item.reactionCount ?? 0)}</span>
                      </span>
                    )}
                    {features.comments && (item.commentCount ?? 0) > 0 && (
                      <span className="flex items-center gap-1">
                        <MessageCircle className="h-3 w-3" aria-hidden="true" />
                        {item.commentCount}
                        <span className="sr-only">{t.gallery.comments(item.commentCount ?? 0)}</span>
                      </span>
                    )}
                  </span>
                )}
                {/* AI-1: the rest of the burst is a swipe away in the viewer. */}
                {(burstSizes.get(item.id) ?? 0) > 1 && (
                  <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium tabular-nums text-paper backdrop-blur">
                    <Layers className="h-3 w-3" aria-hidden="true" />
                    {burstSizes.get(item.id)}
                    <span className="sr-only">{t.gallery.takenTogether}</span>
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {hasMore && (
          <div ref={sentinelRef} className="py-8 text-center text-sm text-muted">
            {loadingMore ? t.gallery.loadingMore : ""}
          </div>
        )}

        {!isOwner && (
          <p className="mt-12 text-center text-xs text-muted">
            {/* ACC-4. Optional, and said once, at the bottom: nobody needs an
                account to be here, and the upload button never asks for one. */}
            {signedIn ? (
              <>
                {t.gallery.savedToAccount}{" "}
                <a href="/me" className="underline underline-offset-2 transition-colors hover:text-paper">
                  {t.gallery.yourGalleries}
                </a>
              </>
            ) : (
              <>
                {t.gallery.findAgain}{" "}
                <a
                  href={`/login?next=${encodeURIComponent(`/e/${event.slug}`)}`}
                  className="underline underline-offset-2 transition-colors hover:text-paper"
                >
                  {t.gallery.signInWithEmail}
                </a>
              </>
            )}
          </p>
        )}

        {!isOwner && (
          <div className="mt-4 text-center text-xs text-muted">
            {leaving === "idle" ? (
              <span className="inline-flex flex-wrap items-center justify-center gap-x-3">
                {/* TRS-2: a copy of everything this guest added, and what Klik holds about them here. */}
                <a
                  href={`/api/e/${encodeURIComponent(event.slug)}/me/export`}
                  download
                  className="inline-flex min-h-11 items-center underline underline-offset-2 transition-colors hover:text-paper"
                >
                  {t.gallery.downloadMine}
                </a>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => setLeaving("confirm")}
                  className="inline-flex min-h-11 items-center underline underline-offset-2 transition-colors hover:text-paper"
                >
                  {t.gallery.removeMine}
                </button>
              </span>
            ) : (
              <div className="mx-auto max-w-sm space-y-3 rounded-2xl border border-canvas-line bg-canvas-raised p-4 text-left">
                <p className="text-sm text-paper">
                  {t.gallery.removeMineConfirm}
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
                    {leaving === "working" ? t.gallery.removing : t.gallery.removeEverything}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setLeaving("idle")}>
                    {t.common.cancel}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TRS-3: the guest's own language, whatever the host or the browser chose. */}
        <LanguageSwitch className="mt-6" />

        {showBranding && (
          <p className="mt-12 text-center text-xs text-muted">
            {t.gallery.sharedWith} <span className="font-medium text-paper">klik</span>
            {referralHref && (
              <>
                {" · "}
                <a href={referralHref} className="inline-flex min-h-11 items-center text-paper underline-offset-2 hover:underline">
                  {t.gallery.makeYourOwn}
                </a>
              </>
            )}
          </p>
        )}
      </div>

      {cameraOpen && (
        <CameraCapture
          disposable={cameraOnly ? { shotsLeft } : undefined}
          onComplete={(captured: CapturedItem[]) =>
            uploadFiles(
              captured.map(({ file, width, height, capturedAt }) => ({
                file,
                prepared: width && height ? { width, height } : undefined,
                challengeId: challengeRef.current,
                capturedAt,
              })),
            )
          }
          onClose={() => {
            challengeRef.current = null;
            setCameraOpen(false);
          }}
        />
      )}

      {viewerIndex >= 0 && (
        <Lightbox
          items={viewerItems}
          index={viewerIndex}
          onIndexChange={(next) => setLightboxId(viewerItems[next]?.id ?? null)}
          onClose={closeViewer}
          canDownload={event.downloadsEnabled || isOwner}
          canSlideshow={canSlideshow}
          downloadBaseUrl={`/api/e/${event.slug}/media`}
          slug={event.slug}
          enhanced={enhanced}
          onEnhancedChange={setEnhancePreference}
          onDeleteOwn={isOwner ? undefined : deleteOwn}
          onReport={isOwner ? undefined : reportItem}
          edit={
            // Guests edit their own photos, the team any. Not on a disposable
            // camera, where looking back at a shot is not part of the deal.
            disposable && !isOwner
              ? undefined
              : {
                  // MED-10: a proof is edited from the dashboard, where its
                  // photographer sees it clean, never from the watermark.
                  canEdit: (item) => !item.proof && (isOwner || Boolean(item.mine)),
                  save: saveEdit,
                  removeOriginal: isOwner ? undefined : removeOriginal,
                  accent: event.accentColor,
                }
          }
          share={{
            eventName: event.name,
            accent: event.accentColor,
            // A guest's own upload is theirs to send on, whatever the setting.
            canTakeFile: (item) => event.downloadsEnabled || isOwner || Boolean(item.mine),
          }}
          social={
            features.reactions || features.comments
              ? {
                  slug: event.slug,
                  reactions: features.reactions,
                  comments: features.comments,
                  onReact: (id, on) => void react(id, on),
                  canModerate: canModerateComments,
                  signInHref: isOwner ? null : `/login?next=${encodeURIComponent(`/e/${event.slug}`)}`,
                  onCommentCount: setCommentCount,
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
