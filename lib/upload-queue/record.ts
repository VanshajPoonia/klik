/**
 * OPS-3: one upload waiting on this device, as it is kept in IndexedDB.
 *
 * Client-safe and DOM-free: the page and the service worker both read these.
 *
 * The media id is chosen once, when the file is picked, and never again. Every
 * retry is therefore the same upload: the object lands at the same key, and a
 * registration whose answer was lost to the wifi is recognised by the server
 * as already done rather than added twice.
 */

export const QUEUE_DATABASE = "klik-uploads";
export const QUEUE_STORE = "uploads";
/** The Background Sync tag, and the BroadcastChannel name. */
export const QUEUE_TAG = "klik-uploads";
export const QUEUE_WORKER_URL = "/upload-sw.js";
/** No page lives here, so the worker controls nothing: it only drains. */
export const QUEUE_WORKER_SCOPE = "/upload-sw/";

/** How long a sender's hold on an item lasts without being renewed. A page the
 *  phone froze mid-upload stops renewing, and another sender takes over. */
export const CLAIM_MS = 90_000;
export const CLAIM_RENEW_MS = 30_000;

/** Server errors in a row before an item stops and asks the person. Lost
 *  connections never count: venue wifi can be gone for an hour. */
export const MAX_SERVER_FAILURES = 6;

/** Anything still here after this is from another evening and is dropped. */
export const QUEUE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface QueuedUpload {
  /** The media id: fixed for life, so every retry is the same upload. */
  id: string;
  eventId: string;
  slug: string;
  addedAt: number;
  /** The file's own name, so the person can tell which one this is. */
  name: string;
  kind: "photo" | "video";

  /** What is sent: the file as picked, then its prepared copy once `ready`. */
  file: Blob;
  mimeType: string;
  /** Prepared on this device: compressed, stills made, metadata read. */
  ready: boolean;
  /** Set for a camera capture, which is already at its final size. */
  preparedSize: { width: number; height: number } | null;
  thumb: Blob | null;
  poster: Blob | null;
  width: number | null;
  height: number | null;
  durationS: number | null;
  capturedAt: string | null;
  clientCompressed: boolean;
  maxVideoSeconds: number;

  albumId: string | null;
  challengeId: string | null;
  /** MED-10: a photographer's upload, to be stored as a watermarked proof. Photos only. */
  proof?: boolean;

  /** Progress that survives the page closing. */
  sent: SentProgress;

  /** Tries in a row that ended unsent, which sets how long the next wait is. */
  tries: number;
  /** Server errors in a row: past `MAX_SERVER_FAILURES` the item asks the person. */
  serverFailures: number;
  retryAt: number;
  /** The server said no, or a file could not be read: waits for the person. */
  refused: { message: string; status: number } | null;
  claim: { by: string; until: number } | null;
}

export interface SentProgress {
  /** The object's key, once the server has given one. */
  pathname: string | null;
  /** A large file's multipart upload, so a reload resumes it part by part. */
  multipart: { uploadId: string; partSize: number } | null;
  /** The stills the server accepted slots for and that arrived. */
  posterPathname: string | null;
  thumbPathname: string | null;
  /** The file itself is in storage; only registration is left. */
  stored: boolean;
  /** One fresh start has been spent on a registration that could not find the file. */
  restarted: boolean;
}

export const EMPTY_PROGRESS: SentProgress = {
  pathname: null,
  multipart: null,
  posterPathname: null,
  thumbPathname: null,
  stored: false,
  restarted: false,
};

export interface NewUpload {
  file: File;
  /** A camera capture, already at its final size. */
  prepared?: { width: number; height: number };
  challengeId?: string | null;
  capturedAt?: string | null;
}

export function newQueuedUpload(
  id: string,
  upload: NewUpload,
  context: { eventId: string; slug: string; albumId: string | null; maxVideoSeconds: number; proof?: boolean },
  now = Date.now(),
): QueuedUpload {
  const kind = upload.file.type.startsWith("video/") ? "video" : "photo";
  return {
    id,
    eventId: context.eventId,
    slug: context.slug,
    addedAt: now,
    name: upload.file.name || "Photo",
    kind,
    file: upload.file,
    mimeType: upload.file.type,
    ready: false,
    preparedSize: upload.prepared ?? null,
    thumb: null,
    poster: null,
    width: null,
    height: null,
    durationS: null,
    capturedAt: upload.capturedAt ?? null,
    clientCompressed: false,
    maxVideoSeconds: context.maxVideoSeconds,
    albumId: context.albumId,
    challengeId: upload.challengeId ?? null,
    proof: Boolean(context.proof) && kind === "photo",
    sent: { ...EMPTY_PROGRESS },
    tries: 0,
    serverFailures: 0,
    retryAt: 0,
    refused: null,
    claim: null,
  };
}

/** Worth trying again by itself: no connection, a timeout, a throttle, the server. */
export function isTransient(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

/** Waits between attempts after a lost connection or a server error. */
const BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000, 120_000, 300_000];

export function backoffMs(attempt: number): number {
  return BACKOFF_MS[Math.min(Math.max(0, attempt), BACKOFF_MS.length - 1)];
}

/** Can a sender take this item now? Not while anyone, itself included, holds it. */
export function isClaimable(item: QueuedUpload, now: number): boolean {
  if (!item.ready || item.refused) return false;
  if (item.retryAt > now) return false;
  return !item.claim || item.claim.until <= now;
}

/** The order items go in: oldest first, so a queue drains as it was filled. */
export function nextClaimable(items: QueuedUpload[], now: number): QueuedUpload | null {
  let best: QueuedUpload | null = null;
  for (const item of items) {
    if (!isClaimable(item, now)) continue;
    if (!best || item.addedAt < best.addedAt || (item.addedAt === best.addedAt && item.id < best.id)) best = item;
  }
  return best;
}

/** When something in the queue next becomes worth looking at, if ever. */
export function nextWakeAt(items: QueuedUpload[], now: number): number | null {
  let soonest: number | null = null;
  for (const item of items) {
    if (!item.ready || item.refused) continue;
    const at = Math.max(item.retryAt, item.claim && item.claim.until > now ? item.claim.until : 0);
    if (at > now && (soonest === null || at < soonest)) soonest = at;
  }
  return soonest;
}

/** Waiting to be sent by someone, now or later: everything but a refusal. */
export function isOutstanding(item: QueuedUpload): boolean {
  return !item.refused;
}
