import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import heicConvert from "heic-convert";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { db } from "@/lib/db";
import { albums, events, media } from "@/lib/schema";
import { canUpload } from "@/lib/access";
import { getAccountPlan } from "@/lib/account-plans";
import { fetchGalleryMedia } from "@/lib/media";
import { resolveEventViewer } from "@/lib/event-viewer";
import {
  blobPathnameFor,
  deleteBlobs,
  extensionForMime,
  isAllowedMime,
  isVideoMime,
  maxBytesForMime,
  r2,
} from "@/lib/storage";
import { COMPRESS_MAX_DIMENSION, COMPRESS_QUALITY } from "@/lib/media-constants";
import {
  SIGNATURE_BYTES,
  detectMediaSignature,
  type SignatureMatch,
} from "@/lib/file-signature";
import { encodeMediaCursor } from "@/lib/media-cursor";
import { isPlausibleCaptureTime, readCaptureTime } from "@/lib/exif";
import { log, reportError } from "@/lib/observability";
import { mediaContentPath, toPublicMedia } from "@/lib/media-delivery";
import { canUseAlbums } from "@/lib/plans";

// sharp/heic-convert need native/WASM Node bindings, never the edge runtime.
export const runtime = "nodejs";
export const maxDuration = 60;

const registerSchema = z.object({
  mediaId: z.string().min(10).max(64).regex(/^[A-Za-z0-9_-]+$/),
  pathname: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationS: z.number().positive().optional(),
  posterPathname: z.string().min(1).optional(),
  contentHash: z.string().optional(),
  albumId: z.string().min(10).max(64).nullable().optional(),
  // True when the browser already resized/re-encoded the photo before
  // upload, which skips redundant server-side recompression of the same file.
  clientCompressed: z.boolean().optional(),
  // The camera's wall clock, read off the original before the browser's
  // compression pass destroyed it. Zone-less by nature, so it is carried as a
  // plain string and range-checked rather than parsed into an instant here.
  capturedAt: z.string().max(19).optional(),
});

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
  const [event] = await db.select().from(events).where(and(eq(events.slug, slug), isNull(events.deletedAt))).limit(1);
  return event ?? null;
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await loadEvent(slug);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const plan = await getAccountPlan(event.ownerId);

  const viewer = await resolveEventViewer(event, plan.galleryAccessDays);
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
    media: rows.map((item) => toPublicMedia(item, event.slug)),
    // Meaningless in since-mode (the client only reads `media` there); it
    // already knows to keep polling since* regardless of what this says.
    nextCursor: !since && rows.length === limit ? encodeMediaCursor(rows[rows.length - 1]) : null,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await loadEvent(slug);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const plan = await getAccountPlan(event.ownerId);
  if (!canUpload(event, plan.uploadWindowDays)) {
    return NextResponse.json({ error: "Uploads are closed for this event" }, { status: 403 });
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
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }
  const expectedPathname = blobPathnameFor(
    event.id,
    input.mediaId,
    extensionForMime(input.mimeType),
  );
  if (input.pathname !== expectedPathname) {
    return NextResponse.json({ error: "Invalid upload path" }, { status: 400 });
  }

  const viewer = await resolveEventViewer(event, plan.galleryAccessDays);
  if (!viewer.access.allowed) {
    return NextResponse.json({ error: "Gallery access is required to upload" }, { status: 403 });
  }
  if (!viewer.ownerSession && !viewer.guestId) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  if (input.albumId) {
    if (!canUseAlbums(plan.key)) {
      return NextResponse.json(
        { error: "Multiple albums are available on the Klik Premium plan" },
        { status: 403 },
      );
    }
    const [album] = await db
      .select({ id: albums.id })
      .from(albums)
      .where(and(eq(albums.id, input.albumId), eq(albums.eventId, event.id)))
      .limit(1);
    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }
  }

  // Deliberately does NOT filter deleted_at. A soft-deleted row still owns its
  // R2 pathname for 30 days, so letting an id be reused would overwrite an
  // object sitting in the trash and silently destroy the thing the recovery
  // window exists to protect.
  const [existingMedia] = await db
    .select({ id: media.id })
    .from(media)
    .where(eq(media.id, input.mediaId))
    .limit(1);
  if (existingMedia) {
    return NextResponse.json({ error: "Upload identifier is already in use" }, { status: 409 });
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
      { error: `File is too large for the ${plan.name} plan`, maxBytes },
      { status: 413 },
    );
  }

  const kind = isVideoMime(input.mimeType) ? "video" : "photo";

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
      { error: "Only photos and videos can be uploaded to a gallery." },
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
    input.capturedAt && isPlausibleCaptureTime(input.capturedAt) ? input.capturedAt : null;
  let sizeBytes = actualSizeBytes;
  let storedMimeType = input.mimeType;
  let width = input.width;
  let height = input.height;

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
          { error: "That photo could not be processed. Try saving it as a JPEG first." },
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
        { error: "That photo could not be processed. Try saving it as a JPEG first." },
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
      return NextResponse.json({ error: "Upload could not be completed" }, { status: 500 });
    }

    sizeBytes = sanitized.data.byteLength;
    storedMimeType = "image/jpeg";
    width = sanitized.info.width;
    height = sanitized.info.height;
  }

  const [row] = await db
    .insert(media)
    .values({
      id: input.mediaId,
      eventId: event.id,
      guestId: viewer.ownerSession ? null : viewer.guestId,
      albumId: input.albumId ?? null,
      kind,
      status: event.moderation && !viewer.ownerSession ? "pending" : "approved",
      blobUrl,
      blobPathname: input.pathname,
      contentHash: input.contentHash ?? null,
      mimeType: storedMimeType,
      sizeBytes,
      width: width ?? null,
      height: height ?? null,
      durationS: input.durationS ?? null,
      posterPathname: kind === "video" ? (input.posterPathname ?? null) : null,
      capturedAt,
    })
    .returning();

  return NextResponse.json(
    {
      media: toPublicMedia(
        { ...row, mine: !viewer.ownerSession && row.guestId === viewer.guestId },
        event.slug,
      ),
    },
    { status: 201 },
  );
}
