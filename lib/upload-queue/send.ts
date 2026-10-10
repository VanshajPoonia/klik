import { partSizes } from "../upload-parts";
import type { QueuedUpload, SentProgress } from "./record";
import { isTransient } from "./record";
import { isAbort, putWithRetry, sendParts, type PutFn } from "./transport";

/**
 * OPS-3: the network half of an upload (ARCHITECTURE.md section 6), as one
 * function the page and the service worker both run: sign, send the stills
 * and the file straight to storage, join the parts of a large one, register.
 *
 * Every step that has happened is written down as it happens (`save`), so an
 * upload stopped at any point resumes from there: a video that had sent 20 of
 * its 25 parts sends 5 more after a reload, not 25.
 */

export class SendFailure extends Error {
  readonly transient: boolean;
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs: number | null = null,
    readonly detail: Record<string, unknown> = {},
    transient?: boolean,
  ) {
    super(message);
    this.transient = transient ?? isTransient(status);
  }
}

interface SignAnswer {
  uploadUrl: string | null;
  multipart: { uploadId: string; partSize: number; urls: string[] } | null;
  pathname: string;
  posterUploadUrl: string | null;
  posterPathname: string | null;
  thumbUploadUrl: string | null;
  thumbPathname: string | null;
}

interface ResumeAnswer {
  partSize: number;
  parts: Array<{ number: number; url: string }>;
  posterUploadUrl: string | null;
  posterPathname: string | null;
  thumbUploadUrl: string | null;
  thumbPathname: string | null;
}

/** A single-PUT signature lives five minutes; this leaves room to use it. */
const SIGNATURE_REUSE_MS = 4 * 60 * 1000;

export interface SendContext {
  fetch: typeof fetch;
  put: PutFn;
  /** Writes progress down, so a reload resumes from it. */
  save(progress: Partial<SentProgress>): Promise<void>;
  /** The share of the file sent so far, 0 to 1. */
  onProgress(fraction: number): void;
  /** How long a part waits for a lost connection to come back. */
  patienceMs: number;
  signal?: AbortSignal;
  /** Signatures still fresh enough to reuse, so a blip does not spend a new one
   *  against the per-guest upload limit. Kept by whoever sends. */
  signatures?: Map<string, { at: number; answer: SignAnswer }>;
  /** More for the registration: an edited copy's original (CAM-2). Never queued. */
  extra?: Record<string, unknown>;
  /** Asked just before registering: false when the person removed it meanwhile. */
  stillWanted?(): Promise<boolean>;
  now?: () => number;
}

export interface SendResult {
  /** The gallery item, when this send registered it and the server said what it is. */
  media: unknown | null;
}

async function call(context: SendContext, url: string, body: unknown) {
  let response: Response;
  try {
    response = await context.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      signal: context.signal,
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new SendFailure("No connection", 0);
  }
  const data = ((await response.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  return { response, data };
}

function failure(response: Response, data: Record<string, unknown>, fallback: string): SendFailure {
  const retryAfter = Number(response.headers.get("Retry-After"));
  return new SendFailure(
    typeof data.error === "string" ? data.error : fallback,
    response.status,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null,
    { ...data, status: response.status },
  );
}

/** Best effort: a missing still costs the grid a tile image, never the upload. */
async function sendStill(context: SendContext, url: string | null, body: Blob | null): Promise<boolean> {
  if (!url || !body) return false;
  try {
    await context.put(url, body, "image/jpeg", () => {}, context.signal);
    return true;
  } catch (error) {
    if (isAbort(error)) throw error;
    return false;
  }
}

export async function sendUpload(item: QueuedUpload, context: SendContext): Promise<SendResult> {
  const now = context.now ?? Date.now;
  const progress: SentProgress = { ...item.sent };
  const save = async (patch: Partial<SentProgress>) => {
    Object.assign(progress, patch);
    await context.save(patch);
  };
  const size = item.file.size;
  const wantPoster = Boolean(item.poster) && !progress.posterPathname;
  const wantThumb = Boolean(item.thumb) && !progress.thumbPathname;
  const stillSizes = {
    posterBytes: wantPoster ? item.poster!.size : undefined,
    thumbBytes: wantThumb ? item.thumb!.size : undefined,
  };

  /** Signed slots for the file and its stills, or null when it turns out to be in already. */
  async function sign(): Promise<SignAnswer | null> {
    const cached = context.signatures?.get(item.id);
    if (cached && now() - cached.at < SIGNATURE_REUSE_MS) return cached.answer;
    const { response, data } = await call(context, "/api/upload", {
      eventId: item.eventId,
      mediaId: item.id,
      mimeType: item.mimeType,
      sizeBytes: size,
      ...stillSizes,
    });
    if (response.status === 409 && progress.pathname) {
      // Registered already: the answer to an earlier try was what got lost.
      await save({ stored: true });
      return null;
    }
    if (!response.ok) throw failure(response, data, "Failed to get upload URL");
    const answer = data as unknown as SignAnswer;
    if (!answer.multipart) context.signatures?.set(item.id, { at: now(), answer });
    return answer;
  }

  if (!progress.stored) {
    let single: string | null = null;
    let parts: Array<{ number: number; url: string }> | null = null;
    let partSize = 0;
    let stills: Pick<SignAnswer, "posterUploadUrl" | "posterPathname" | "thumbUploadUrl" | "thumbPathname"> | null = null;

    // A large file already part-way up: ask which parts arrived, and send the rest.
    if (progress.multipart) {
      const { response, data } = await call(context, "/api/upload/parts", {
        eventId: item.eventId,
        mediaId: item.id,
        mimeType: item.mimeType,
        sizeBytes: size,
        uploadId: progress.multipart.uploadId,
        ...stillSizes,
      });
      if (response.ok) {
        const resumed = data as unknown as ResumeAnswer;
        parts = resumed.parts;
        partSize = resumed.partSize;
        stills = resumed;
      } else if (response.status === 404) {
        // Storage forgot it (a week passed, or joining it failed): start the file again.
        await save({ multipart: null });
      } else if (response.status === 409 && progress.pathname) {
        await save({ stored: true });
      } else {
        throw failure(response, data, "The upload could not be resumed");
      }
    }

    if (!progress.stored && !parts) {
      const answer = await sign();
      if (answer) {
        await save({
          pathname: answer.pathname,
          multipart: answer.multipart ? { uploadId: answer.multipart.uploadId, partSize: answer.multipart.partSize } : null,
        });
        stills = answer;
        if (answer.multipart) {
          partSize = answer.multipart.partSize;
          parts = answer.multipart.urls.map((url, index) => ({ number: index + 1, url }));
        } else {
          single = answer.uploadUrl;
        }
      }
    }

    if (!progress.stored) {
      // The stills first: they are small, and on a failing connection the
      // grid tile is worth more than the second half of a video.
      if (stills) {
        const posterSent = wantPoster && (await sendStill(context, stills.posterUploadUrl, item.poster));
        const thumbSent = wantThumb && (await sendStill(context, stills.thumbUploadUrl, item.thumb));
        if (posterSent || thumbSent) {
          await save({
            ...(posterSent ? { posterPathname: stills.posterPathname } : {}),
            ...(thumbSent ? { thumbPathname: stills.thumbPathname } : {}),
          });
        }
      }

      if (single) {
        try {
          await putWithRetry(context.put, single, item.file, item.mimeType, (loaded) => context.onProgress(loaded / size), context.signal);
        } catch (error) {
          if (isAbort(error)) throw error;
          const status = (error as { status?: number }).status ?? 0;
          // A refused PUT is most often a signature that expired while waiting:
          // sign afresh next time. A lost connection leaves it good to reuse.
          if (status >= 400) context.signatures?.delete(item.id);
          throw new SendFailure(status ? "Storage refused the file" : "No connection", status, null, {}, status === 403 || isTransient(status));
        }
      } else if (parts) {
        const lengths = partSizes(size, partSize);
        const remaining = parts.reduce((sum, part) => sum + (lengths[part.number - 1] ?? 0), 0);
        const already = size - remaining;
        context.onProgress(already / size);
        try {
          await sendParts(item.file, {
            parts,
            partSize,
            put: context.put,
            patienceMs: context.patienceMs,
            signal: context.signal,
            onProgress: (loaded) => context.onProgress((already + loaded) / size),
          });
        } catch (error) {
          if (isAbort(error)) throw error;
          const status = (error as { status?: number }).status ?? 0;
          // The parts that did arrive are kept; the next try sends the rest.
          throw new SendFailure(status ? "Storage refused part of the file" : "No connection", status, null, {}, true);
        }
        const { response, data } = await call(context, "/api/upload/complete", {
          eventId: item.eventId,
          mediaId: item.id,
          mimeType: item.mimeType,
          sizeBytes: size,
          uploadId: progress.multipart!.uploadId,
        });
        if (!response.ok) {
          if (response.status >= 500 || response.status === 400 || response.status === 404) {
            // The server gives up the parts when joining fails, so start again.
            await save({ multipart: null });
            throw new SendFailure(
              typeof data.error === "string" ? data.error : "The upload could not be finished",
              response.status,
              null,
              data,
              true,
            );
          }
          throw failure(response, data, "The upload could not be finished");
        }
      }
      await save({ stored: true });
      context.signatures?.delete(item.id);
    }
  }

  if (context.stillWanted && !(await context.stillWanted())) {
    throw Object.assign(new Error("Removed"), { name: "AbortError" });
  }
  const { response, data } = await call(context, `/api/e/${encodeURIComponent(item.slug)}/media`, {
    mediaId: item.id,
    pathname: progress.pathname,
    mimeType: item.mimeType,
    sizeBytes: size,
    width: item.width ?? undefined,
    height: item.height ?? undefined,
    durationS: item.durationS ?? undefined,
    posterPathname: progress.posterPathname ?? undefined,
    thumbPathname: progress.thumbPathname ?? undefined,
    clientCompressed: item.clientCompressed,
    capturedAt: item.capturedAt ?? undefined,
    albumId: item.albumId || null,
    challengeId: item.challengeId || null,
    ...(item.proof ? { proof: true } : {}),
    ...context.extra,
  });
  if (response.ok) return { media: data.media ?? null };
  // Taken already, and not by this person: the id is spent either way, and the
  // file it named is in the gallery or deliberately not. Nothing more to send.
  if (response.status === 409) return { media: null };
  if (response.status === 400 && !progress.restarted) {
    // The file the server looked for was not there or not whole: send it once more.
    await save({ stored: false, multipart: null, restarted: true });
    throw new SendFailure(typeof data.error === "string" ? data.error : "The upload did not arrive whole", 400, null, data, true);
  }
  throw failure(response, data, "Could not add it to the gallery");
}
