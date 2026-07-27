import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
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
import { encodeMediaCursor } from "@/lib/media-cursor";
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
  contentHash: z.string().optional(),
  albumId: z.string().min(10).max(64).nullable().optional(),
  // True when the browser already resized/re-encoded the photo before
  // upload - skips redundant server-side recompression of the same file.
  clientCompressed: z.boolean().optional(),
});

async function loadEvent(slug: string) {
  const [event] = await db.select().from(events).where(eq(events.slug, slug)).limit(1);
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
      console.error("Failed to remove invalid upload:", error);
    });
    return NextResponse.json({ error: "Uploaded file size did not match" }, { status: 400 });
  }

  if (actualSizeBytes > maxBytes) {
    await deleteBlobs([input.pathname]).catch((error) => {
      console.error("Failed to remove oversized upload:", error);
    });
    return NextResponse.json(
      { error: `File is too large for the ${plan.name} plan`, maxBytes },
      { status: 413 },
    );
  }

  const kind = isVideoMime(input.mimeType) ? "video" : "photo";
  const blobUrl = mediaContentPath(event.slug, input.mediaId);
  let sizeBytes = actualSizeBytes;
  let storedMimeType = input.mimeType;
  let width = input.width;
  let height = input.height;

  if (kind === "photo" && !input.clientCompressed) {
    try {
      const storedObject = await r2.send(
        new GetObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: input.pathname,
        }),
      );
      if (!storedObject.Body) throw new Error("Uploaded photo did not return a readable body");
      let buffer: Buffer<ArrayBufferLike> = Buffer.from(
        await storedObject.Body.transformToByteArray(),
      );

      // sharp's bundled libheif can decode AVIF but not HEIC/HEIF (the format
      // iPhones shoot by default), so those need converting to JPEG first.
      if (input.mimeType === "image/heic" || input.mimeType === "image/heif") {
        buffer = await heicConvert({ buffer, format: "JPEG", quality: 1 });
      }

      const compressed = await sharp(buffer)
        .rotate()
        .resize({
          width: COMPRESS_MAX_DIMENSION,
          height: COMPRESS_MAX_DIMENSION,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: COMPRESS_QUALITY, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });

      await r2.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: input.pathname,
          Body: compressed.data,
          ContentType: "image/jpeg",
        }),
      );

      sizeBytes = compressed.data.byteLength;
      storedMimeType = "image/jpeg";
      width = compressed.info.width;
      height = compressed.info.height;
    } catch (error) {
      // Compression is a best-effort optimization - fall back to the original upload untouched.
      console.error("Photo compression failed, storing original:", error);
    }
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
