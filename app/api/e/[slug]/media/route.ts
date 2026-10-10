import { after, NextResponse } from "next/server";
import { z } from "zod";
import { uploadMediaId } from "@/lib/media-id";
import { and, eq, isNull } from "drizzle-orm";
import heicConvert from "heic-convert";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { db } from "@/lib/db";
import { findEventBySlug } from "@/lib/slugs";
import { albums, events, media } from "@/lib/schema";
import { canUpload } from "@/lib/access";
import { eventPlan } from "@/lib/license";
import { fetchGalleryMedia } from "@/lib/media";
import { resolveEventViewer } from "@/lib/event-viewer";
import {
  blobPathnameFor,
  deleteBlobs,
  extensionForMime,
  isAllowedMime,
  isVideoMime,
  maxBytesForMime,
  posterPathnameFor,
  r2,
  thumbPathnameFor,
} from "@/lib/storage";
import { acceptDerivedObject } from "@/lib/derived-objects";
import { MAX_POSTER_BYTES, MAX_THUMB_BYTES } from "@/lib/thumbnail-size";
import { renderThumbnail } from "@/lib/thumbnail";
import { enqueue, enqueueAnalysis, enqueueMomentsRefresh, enqueueThumbnail, enqueueVideoScrub, kickJobRunner } from "@/lib/jobs";
import { claimUsageWarning } from "@/lib/notices";
import { spendShot } from "@/lib/disposable";
import { liveChallengeId } from "@/lib/challenges";
import { EDIT_REFUSAL_MESSAGES, editableOriginal } from "@/lib/media-edits";
import { COMPRESS_MAX_DIMENSION, COMPRESS_QUALITY } from "@/lib/media-constants";
import {
  SIGNATURE_BYTES,
  detectMediaSignature,
  type SignatureMatch,
} from "@/lib/file-signature";
import { encodeMediaCursor } from "@/lib/media-cursor";
import { isPlausibleCaptureTime, readCaptureTime } from "@/lib/exif";
import { log, reportError } from "@/lib/observability";
import { mediaContentPath } from "@/lib/media-delivery";
import { toGalleryMedia } from "@/lib/gallery-media";
import { reactorFor, withViewerReactions } from "@/lib/reactions";
import { canUseAlbums, canUseProofs } from "@/lib/plans";
import { stripJpegLocation } from "@/lib/exif-scrub";
import { getWatermark, isLockedProof, type Watermark } from "@/lib/proofs";
import { makeProof, readStoredObject } from "@/lib/proof-stamp";

// sharp/heic-convert need native/WASM Node bindings, never the edge runtime.
export const runtime = "nodejs";
export const maxDuration = 60;

const registerSchema = z.object({
  mediaId: uploadMediaId,
  pathname: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationS: z.number().positive().optional(),
  posterPathname: z.string().min(1).optional(),
  thumbPathname: z.string().min(1).optional(),
  contentHash: z.string().optional(),
  albumId: z.string().min(10).max(64).nullable().optional(),
  // GRW-3: the challenge card it was taken from.
  challengeId: z.string().min(1).max(64).nullable().optional(),
  // CAM-2: an edited copy of this photo, which stays as it was.
  derivedFromId: z.string().min(1).max(64).nullable().optional(),
  // True when the browser already resized/re-encoded the photo before
  // upload, which skips redundant server-side recompression of the same file.
  clientCompressed: z.boolean().optional(),
  // The camera's wall clock, read off the original before the browser's
  // compression pass destroyed it. Zone-less by nature, so it is carried as a
  // plain string and range-checked rather than parsed into an instant here.
  capturedAt: z.string().max(19).optional(),
  // MED-10: a photographer on the team asking for this to be a watermarked proof.
  proof: z.boolean().optional(),
});

/** The size a photo is shown at, turned upright, without decoding it. */
async function displayedSize(buffer: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(buffer, { failOn: "none" }).metadata();
    if (!meta.width || !meta.height) return null;
    return (meta.orientation ?? 1) >= 5 ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

/**
 * Re-encodes a photo into the bytes we are willing to store, or returns null
 * if it cannot.
 *
 * Two attempts, because they fail for different reasons. The first is the
 * normal path. The second drops mozjpeg and tells sharp to tolerate a
 * truncated or slightly malformed file rather than refuse it, which is the
 * common shape of a photo that arrived over patchy venue wifi. A file that
 * fails both is one we cannot decode at all.
 *
 * Re-encoding is also what removes EXIF. sharp strips metadata unless
 * `.withMetadata()` is called, and it is deliberately never called here, so
 * the returned buffer carries no GPS, no serial number and no owner name.
 */
async function sanitizePhoto(
  buffer: Buffer<ArrayBufferLike>,
): Promise<{ data: Buffer; info: { width: number; height: number } } | null> {
  // Imported here rather than at module scope, deliberately.
  //
  // sharp is a native module, and when its binary fails to load the import
  // throws. At module scope that throw took down **every** handler in this
  // file, including the GET that lists a gallery and never touches an image
  // library. That is exactly what happened in production: a missing libvips
  // meant guests could neither poll for new photos nor upload, when only the
  // server-side compression path had any business failing.
  //
  // Most photos never reach here anyway, because the browser compresses them
  // first. Keeping the dependency inside the one function that needs it means a
  // broken install degrades to "this photo could not be processed" instead of
  // taking the gallery down with it.
  let sharp: typeof import("sharp").default;
  try {
    sharp = (await import("sharp")).default;
  } catch (error) {
    reportError("upload.sharp_unavailable", error);
    return null;
  }

  const resize = {
    width: COMPRESS_MAX_DIMENSION,
    height: COMPRESS_MAX_DIMENSION,
    fit: "inside" as const,
    withoutEnlargement: true,
  };

  try {
    return await sharp(buffer)
      .rotate()
      .resize(resize)
      .jpeg({ quality: COMPRESS_QUALITY, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    log.warn("upload.compression_retry", { error });
  }

  try {
    return await sharp(buffer, { failOn: "none" })
      .rotate()
      .resize(resize)
      .jpeg({ quality: COMPRESS_QUALITY })
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    reportError("upload.photo_undecodable", error);
    return null;
  }
}

async function loadEvent(slug: string) {
  const event = (await findEventBySlug(slug))?.event;
  return event ?? null;
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await loadEvent(slug);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const viewer = await resolveEventViewer(event);
  if (!viewer.access.allowed) {
    return NextResponse.json({ error: viewer.access.reason }, { status: 403 });
  }

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 100);
  const cursor = url.searchParams.get("cursor");
  const since = url.searchParams.get("since");

  const rows = await fetchGalleryMedia(event.id, {
    isOwner: Boolean(viewer.ownerSession),
    guestId: viewer.guestId,
    event,
    cursor,
    since,
    limit,
  });

  return NextResponse.json({
    media: await withViewerReactions(
      await toGalleryMedia(rows, event.slug),
      event,
      reactorFor({ guestId: viewer.guestId, userId: viewer.ownerSession?.user?.id ?? null }),
    ),
    // Meaningless in since-mode (the client only reads `media` there); it
    // already knows to keep polling since* regardless of what this says.
    nextCursor: !since && rows.length === limit ? encodeMediaCursor(rows[rows.length - 1]) : null,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await loadEvent(slug);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const plan = eventPlan(event);
  if (!canUpload(event)) {
    return NextResponse.json({ error: "Uploads are closed for this event", code: "uploads_closed" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const input = parsed.data;
  if (!isAllowedMime(input.mimeType)) {
    return NextResponse.json({ error: "Unsupported file type", code: "unsupported_type" }, { status: 400 });
  }
  const expectedPathname = blobPathnameFor(
    event.id,
    input.mediaId,
    extensionForMime(input.mimeType),
  );
  if (input.pathname !== expectedPathname) {
    return NextResponse.json({ error: "Invalid upload path" }, { status: 400 });
  }

  const viewer = await resolveEventViewer(event);
  if (!viewer.access.allowed) {
    return NextResponse.json({ error: "Gallery access is required to upload", code: "access_required" }, { status: 403 });
  }
  if (!viewer.ownerSession && !viewer.guestId) {
    return NextResponse.json({ error: "Not authorized", code: "not_authorized" }, { status: 401 });
  }

  // Deliberately does NOT filter deleted_at. A soft-deleted row still owns its
  // R2 pathname for 30 days, so letting an id be reused would overwrite an
  // object sitting in the trash and silently destroy the thing the recovery
  // window exists to protect.
  //
  // OPS-3: but the same person sending the same id again is not a reuse. It
  // is the upload queue retrying a registration whose answer the wifi lost,
  // so it is told the upload is in, with the item, rather than that it failed.
  // Checked before anything else about the request, which may no longer hold
  // (a folder trashed since) for an upload that is already in.
  const [existingMedia] = await db.select().from(media).where(eq(media.id, input.mediaId)).limit(1);
  if (existingMedia) {
    const sameUploader = viewer.ownerSession ? existingMedia.guestId === null : existingMedia.guestId === viewer.guestId;
    if (existingMedia.eventId === event.id && !existingMedia.deletedAt && sameUploader) {
      const [published] = await toGalleryMedia(
        [{ ...existingMedia, mine: !viewer.ownerSession && existingMedia.guestId === viewer.guestId }],
        event.slug,
      );
      return NextResponse.json({ media: published, alreadyAdded: true });
    }
    return NextResponse.json({ error: "Upload identifier is already in use" }, { status: 409 });
  }
  // VEN-2: a kiosk's photos go where the host said, whatever the tablet sends,
  // and to no folder when that one has gone, rather than failing at the door.
  if (viewer.kioskId) {
    const [folder] =
      viewer.kioskAlbumId && canUseAlbums(plan.key)
        ? await db
            .select({ id: albums.id })
            .from(albums)
            .where(and(eq(albums.id, viewer.kioskAlbumId), eq(albums.eventId, event.id), isNull(albums.deletedAt)))
            .limit(1)
        : [];
    input.albumId = folder?.id ?? null;
  }
  // CAM-2: an edit is a new photo made from one this person may edit: the
  // team, any photo in the event; a guest, their own. It takes the original's
  // time, folder, visibility and challenge, so it sits where the original did.
  let derivedFrom: typeof media.$inferSelect | null = null;
  if (input.derivedFromId) {
    const editable = await editableOriginal(event, input.derivedFromId, {
      userId: viewer.ownerSession?.user?.id ?? null,
      isManager: Boolean(viewer.ownerSession),
      guestId: viewer.guestId,
      kioskId: viewer.kioskId,
    });
    if ("refused" in editable) {
      return NextResponse.json(
        { error: EDIT_REFUSAL_MESSAGES[editable.refused] },
        { status: editable.refused === "not_found" ? 404 : 403 },
      );
    }
    derivedFrom = editable.original;
    input.challengeId = input.challengeId ?? derivedFrom.challengeId;
    if (!input.albumId && derivedFrom.albumId && canUseAlbums(plan.key)) {
      // The original's folder, while it is live; a copy of a photo whose folder
      // went to the trash goes unfiled rather than failing.
      const [live] = await db
        .select({ id: albums.id })
        .from(albums)
        .where(and(eq(albums.id, derivedFrom.albumId), eq(albums.eventId, event.id), isNull(albums.deletedAt)))
        .limit(1);
      input.albumId = live?.id ?? null;
    }
  }
  // MED-10: is this a proof, and whose? A copy edited from a locked proof is
  // one too, by the same photographer, or the editor would be a way round the
  // watermark. Otherwise only someone on the team asks for one.
  let proofOwner: string | null = null;
  if (derivedFrom && isLockedProof(derivedFrom)) {
    proofOwner = derivedFrom.proofBy;
  } else if (input.proof) {
    const userId = viewer.ownerSession?.user?.id;
    if (!userId) {
      await deleteBlobs([input.pathname]).catch(() => {});
      return NextResponse.json({ error: "Only the event's team can upload proofs." }, { status: 403 });
    }
    if (!canUseProofs(plan.key)) {
      await deleteBlobs([input.pathname]).catch(() => {});
      return NextResponse.json({ error: "Watermarked proofs are part of Klik Premium and Venue." }, { status: 403 });
    }
    proofOwner = userId;
  }
  let watermark: Watermark | null = null;
  if (proofOwner || (derivedFrom && isLockedProof(derivedFrom))) {
    watermark = proofOwner ? await getWatermark(proofOwner) : null;
    if (!watermark) {
      await deleteBlobs([input.pathname]).catch(() => {});
      return NextResponse.json(
        { error: "Set up your watermark on your account page before uploading proofs." },
        { status: 422 },
      );
    }
  }

  if (input.albumId) {
    if (!canUseAlbums(plan.key)) {
      return NextResponse.json({ error: "Folders are part of Klik Premium" }, { status: 403 });
    }
    // Live folders only: one in the trash would take the photo with it, out of
    // sight, the moment it landed.
    const [album] = await db
      .select({ id: albums.id })
      .from(albums)
      .where(and(eq(albums.id, input.albumId), eq(albums.eventId, event.id), isNull(albums.deletedAt)))
      .limit(1);
    if (!album) {
      return NextResponse.json({ error: "That folder is not in this event any more", code: "folder_gone" }, { status: 404 });
    }
  }

  const maxBytes = maxBytesForMime(input.mimeType, plan);
  let actualSizeBytes: number;
  try {
    const uploadedObject = await r2.send(
      new HeadObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: input.pathname,
      }),
    );
    actualSizeBytes = uploadedObject.ContentLength ?? 0;
  } catch {
    return NextResponse.json({ error: "Uploaded file could not be verified" }, { status: 400 });
  }

  if (!actualSizeBytes || actualSizeBytes !== input.sizeBytes) {
    await deleteBlobs([input.pathname]).catch((error) => {
      reportError("upload.orphan_cleanup_failed", error, { reason: "size_mismatch" });
    });
    return NextResponse.json({ error: "Uploaded file size did not match" }, { status: 400 });
  }

  if (actualSizeBytes > maxBytes) {
    await deleteBlobs([input.pathname]).catch((error) => {
      reportError("upload.orphan_cleanup_failed", error, { reason: "too_large" });
    });
    return NextResponse.json(
      { error: `File is too large for the ${plan.name} plan`, maxBytes, code: "too_large", values: { maxMb: Math.round(maxBytes / (1024 * 1024)) } },
      { status: 413 },
    );
  }

  const kind = isVideoMime(input.mimeType) ? "video" : "photo";
  if (watermark && kind === "video") {
    await deleteBlobs([input.pathname]).catch(() => {});
    return NextResponse.json(
      { error: "Videos cannot be watermarked yet. Add videos with proofs turned off.", code: "proof_video" },
      { status: 422 },
    );
  }

  // Read the actual leading bytes. The mime allowlist upstream only checks what
  // the client *claimed*, and R2 signs Content-Type without enforcing it (SEC-9,
  // verified against the live bucket), so until this point a URL presigned for
  // a JPEG would accept any bytes at all. One ranged read of 32 bytes settles
  // what the file really is.
  let signature: SignatureMatch | null = null;
  try {
    const head = await r2.send(
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: input.pathname,
        Range: `bytes=0-${SIGNATURE_BYTES - 1}`,
      }),
    );
    const bytes = await head.Body!.transformToByteArray();
    signature = detectMediaSignature(bytes);
  } catch {
    await deleteBlobs([input.pathname]).catch(() => {});
    return NextResponse.json({ error: "Uploaded file could not be verified" }, { status: 400 });
  }

  // Unrecognised bytes, or an image uploaded as a video (or the reverse), both
  // mean the declared type cannot be trusted. Delete rather than store: an
  // object with no media row is invisible to the purge cron and would sit in
  // the bucket forever.
  if (!signature || signature.family !== (kind === "video" ? "video" : "image")) {
    await deleteBlobs([input.pathname]).catch(() => {});
    return NextResponse.json(
      { error: "Only photos and videos can be uploaded to a gallery.", code: "not_media" },
      { status: 415 },
    );
  }

  // Duration is reported by the client, so treat it as advisory: it is a cap on
  // honest uploads, not a security boundary. Real enforcement needs probing the
  // container server-side, which arrives with OPS-1's transcode job. Rejecting
  // the obvious case is still worth doing, because the alternative is a
  // ten-minute 4K recording streamed to every guest's phone.
  if (kind === "video" && input.durationS && input.durationS > plan.maxVideoSeconds) {
    await deleteBlobs([input.pathname]).catch(() => {});
    return NextResponse.json(
      {
        error: `Videos are limited to ${Math.round(plan.maxVideoSeconds / 60)} ${
          plan.maxVideoSeconds >= 120 ? "minutes" : "minute"
        } on ${plan.name}.`,
        maxVideoSeconds: plan.maxVideoSeconds,
        code: "video_too_long",
        values: { seconds: plan.maxVideoSeconds },
      },
      { status: 413 },
    );
  }
  const blobUrl = mediaContentPath(event.slug, input.mediaId);
  // Client-supplied for anything the browser compressed, because that pass
  // strips EXIF before we ever see the file. Advisory metadata rather than a
  // security boundary, but it still lands in a timestamp column, so it is
  // range-checked before it is trusted.
  let capturedAt: string | null =
    input.capturedAt && isPlausibleCaptureTime(input.capturedAt) ? input.capturedAt : (derivedFrom?.capturedAt ?? null);
  let sizeBytes = actualSizeBytes;
  let storedMimeType = input.mimeType;
  let width = input.width;
  let height = input.height;
  // Set when the server re-encodes the photo below, which is also the cheapest
  // moment to make its thumbnail: the decoded pixels are already in memory.
  let serverThumbnail: Buffer | null = null;
  // The stored photo's bytes, when this request already has them.
  let storedPhoto: Buffer | null = null;

  if (kind === "photo" && !input.clientCompressed) {
    let original: Buffer<ArrayBufferLike>;
    try {
      const storedObject = await r2.send(
        new GetObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: input.pathname,
        }),
      );
      if (!storedObject.Body) throw new Error("Uploaded photo did not return a readable body");
      original = Buffer.from(await storedObject.Body.transformToByteArray());
    } catch (error) {
      reportError("upload.readback_failed", error);
      await deleteBlobs([input.pathname]).catch(() => {});
      return NextResponse.json({ error: "Uploaded file could not be verified" }, { status: 400 });
    }

    // Before anything re-encodes the file. Every pass below strips EXIF, which
    // is exactly what it should do, so this is the only moment at which the
    // capture time still exists on the server. See lib/exif.ts.
    capturedAt = capturedAt ?? readCaptureTime(original);

    // MED-8: a host who keeps camera details keeps them on the team's JPEGs.
    // The location is removed in place and nothing else changes; a file the
    // scrubber cannot walk is re-encoded below, like every other photo.
    const kept =
      viewer.ownerSession && event.keepPhotoDetails && canUseProofs(plan.key) && !watermark && input.mimeType === "image/jpeg"
        ? stripJpegLocation(original)
        : null;
    if (kept) {
      const dimensions = await displayedSize(kept.data);
      try {
        await r2.send(
          new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: input.pathname, Body: kept.data, ContentType: "image/jpeg" }),
        );
      } catch (error) {
        reportError("upload.store_failed", error);
        await deleteBlobs([input.pathname]).catch(() => {});
        return NextResponse.json({ error: "Upload could not be completed", code: "upload_failed" }, { status: 500 });
      }
      sizeBytes = kept.data.byteLength;
      storedPhoto = kept.data;
      serverThumbnail = await renderThumbnail(kept.data);
      storedMimeType = "image/jpeg";
      width = dimensions?.width ?? width;
      height = dimensions?.height ?? height;
    } else {
      let decoded = original;
      // sharp's bundled libheif can decode AVIF but not HEIC/HEIF (the format
      // iPhones shoot by default), so those need converting to JPEG first.
      if (input.mimeType === "image/heic" || input.mimeType === "image/heif") {
        try {
          decoded = await heicConvert({ buffer: original, format: "JPEG", quality: 1 });
        } catch (error) {
          reportError("upload.heic_convert_failed", error);
          await deleteBlobs([input.pathname]).catch(() => {});
          return NextResponse.json(
            { error: "That photo could not be processed. Try saving it as a JPEG first.", code: "photo_unprocessable" },
            { status: 422 },
          );
        }
      }

      const sanitized = await sanitizePhoto(decoded);

      // This used to fall through to "store the original untouched", which was
      // the wrong default in a way that only showed up when something broke: the
      // bytes a camera produces carry GPS coordinates, a device serial and often
      // the owner's name, and a gallery link is shareable. Rejecting a photo we
      // cannot sanitise is a worse upload experience and a much better privacy
      // guarantee, and it keeps one rule true everywhere: we store only bytes we
      // produced ourselves.
      if (!sanitized) {
        await deleteBlobs([input.pathname]).catch(() => {});
        return NextResponse.json(
          { error: "That photo could not be processed. Try saving it as a JPEG first.", code: "photo_unprocessable" },
          { status: 422 },
        );
      }

      try {
        await r2.send(
          new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: input.pathname,
            Body: sanitized.data,
            ContentType: "image/jpeg",
          }),
        );
      } catch (error) {
        // The original is still sitting at this key, so there is no version of
        // this that ends with a usable row. Remove it rather than record a
        // pointer to bytes we decided not to keep.
        reportError("upload.store_failed", error);
        await deleteBlobs([input.pathname]).catch(() => {});
        return NextResponse.json({ error: "Upload could not be completed", code: "upload_failed" }, { status: 500 });
      }

      sizeBytes = sanitized.data.byteLength;
      storedPhoto = sanitized.data;
      // A proof's tile is made from the watermarked copy below, never from these.
      serverThumbnail = watermark ? null : await renderThumbnail(sanitized.data);
      storedMimeType = "image/jpeg";
      width = sanitized.info.width;
      height = sanitized.info.height;
    }
  }

  // CAM-4: spend one shot from the guest's roll, or refuse. Conditional, so two
  // uploads racing for the last frame cannot both have it. Spent here, after
  // every other check, so a rejected file never costs a shot.
  // A kiosk is the venue's camera, shared by the whole queue, so it has no roll.
  if (event.disposableMode && !viewer.ownerSession && viewer.guestId && !viewer.kioskId) {
    const spent = kind === "photo" && (await spendShot(viewer.guestId, event.shotsPerGuest));
    if (!spent) {
      await deleteBlobs([input.pathname]).catch(() => {});
      return NextResponse.json({ error: "Your roll is finished. Every shot has been taken.", code: "roll_finished" }, { status: 403 });
    }
  }

  // Stills the client made. Each is checked against the key this media id would
  // have been given and held to the same standard as any upload. See
  // lib/derived-objects.ts for why the key check matters.
  const posterPathname =
    kind === "video"
      ? await acceptDerivedObject({
          claimed: input.posterPathname,
          expected: posterPathnameFor(event.id, input.mediaId),
          maxBytes: MAX_POSTER_BYTES,
          label: "poster",
        })
      : null;
  let thumbPathname = await acceptDerivedObject({
    claimed: input.thumbPathname,
    expected: thumbPathnameFor(event.id, input.mediaId),
    maxBytes: MAX_THUMB_BYTES,
    label: "thumbnail",
  });
  if (!thumbPathname && serverThumbnail) {
    try {
      const key = thumbPathnameFor(event.id, input.mediaId);
      await r2.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
          Body: serverThumbnail,
          ContentType: "image/jpeg",
        }),
      );
      thumbPathname = key;
    } catch (error) {
      // The job below makes it instead. Never worth failing an upload over.
      log.warn("upload.thumbnail_store_failed", { error });
    }
  }

  // MED-10: stamped before the row exists, so there is never a moment when a
  // proof's row names its clean original. The original stays where it was
  // uploaded and is recorded only in `proof_original_pathname`.
  let proof: Awaited<ReturnType<typeof makeProof>> | null = null;
  if (watermark && kind === "photo") {
    try {
      proof = await makeProof({
        eventId: event.id,
        mediaId: input.mediaId,
        photo: storedPhoto ?? (await readStoredObject(input.pathname)),
        watermark,
      });
    } catch (error) {
      // Kept, not deleted: the queue retries with the same file.
      reportError("upload.proof_failed", error, { mediaId: input.mediaId });
      return NextResponse.json({ error: "The watermark could not be added. Trying again." }, { status: 503 });
    }
    thumbPathname = proof.thumbPathname;
    width = proof.width;
    height = proof.height;
  }

  // GRW-3: a challenge the host removed while this was uploading is dropped,
  // not fatal. A kiosk takes no part: it is not a guest who can win one.
  const challengeId = viewer.kioskId ? null : await liveChallengeId(event.id, input.challengeId);

  const [row] = await db
    .insert(media)
    .values({
      id: input.mediaId,
      eventId: event.id,
      guestId: viewer.ownerSession ? null : viewer.guestId,
      albumId: input.albumId ?? null,
      challengeId,
      derivedFromId: derivedFrom?.id ?? null,
      ...(derivedFrom ? { visibility: derivedFrom.visibility } : {}),
      kind,
      status: event.moderation && !viewer.ownerSession ? "pending" : "approved",
      blobUrl,
      blobPathname: proof?.blobPathname ?? input.pathname,
      proofBy: proof ? proofOwner : null,
      proofOriginalPathname: proof ? input.pathname : null,
      contentHash: input.contentHash ?? null,
      mimeType: storedMimeType,
      sizeBytes,
      width: width ?? null,
      height: height ?? null,
      durationS: input.durationS ?? null,
      posterPathname,
      thumbPathname,
      capturedAt,
      // MED-8: played to its uploader alone until its location is removed.
      metadataState: kind === "video" ? "pending" : null,
    })
    .returning();

  // PAY-7: did this upload carry the event past 75%, 90% or full? Claimed here
  // so it is once-only, sent from the queue so the guest is not kept waiting.
  const warning = await claimUsageWarning(event.id).catch(() => null);
  if (warning) {
    await enqueue("notify.usage", { eventId: event.id, level: warning }).catch(() => {});
  }

  // No thumbnail yet and something to make one from: queue it now, so it is on
  // record even if this function stops here, and start the queue after the
  // response so the guest is not kept waiting for it.
  if (!row.thumbPathname && (row.kind === "photo" || row.posterPathname)) {
    await enqueueThumbnail(row.id).catch((error) => reportError("upload.thumbnail_enqueue_failed", error));
  }

  if (row.kind === "video") {
    await enqueueVideoScrub(row.id).catch((error) => reportError("upload.video_scrub_enqueue_failed", error));
  }

  // AI-7, AI-8: measured once, after the response, for tidying and highlights.
  if (row.kind === "photo") {
    await enqueueAnalysis(row.id).catch((error) => reportError("upload.analysis_enqueue_failed", error));
  }

  // AI-1: every photo can move the event's moments. Collapsed while a refresh
  // is pending, so a busy hour is a handful of runs rather than one per photo.
  await enqueueMomentsRefresh(event.id).catch((error) => reportError("upload.moments_enqueue_failed", error));

  // One kick drains everything queued above.
  after(kickJobRunner);

  const [published] = await toGalleryMedia(
    [{ ...row, mine: !viewer.ownerSession && row.guestId === viewer.guestId }],
    event.slug,
  );
  return NextResponse.json({ media: published }, { status: 201 });
}
