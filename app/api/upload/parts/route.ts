import { NextResponse } from "next/server";
import { z } from "zod";
import { uploadMediaId } from "@/lib/media-id";
import { ListPartsCommand, type Part } from "@aws-sdk/client-s3";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, media } from "@/lib/schema";
import { canUpload } from "@/lib/access";
import { eventPlan } from "@/lib/license";
import { resolveEventViewer } from "@/lib/event-viewer";
import { clientIp, consume } from "@/lib/ratelimit";
import { blobPathnameFor, extensionForMime, isAllowedMime, maxBytesForMime, r2 } from "@/lib/storage";
import { MAX_POSTER_BYTES, MAX_THUMB_BYTES } from "@/lib/thumbnail-size";
import { MULTIPART_THRESHOLD, PART_SIZE, partSizes } from "@/lib/upload-parts";
import { signPartUrls, signStillSlots } from "@/lib/upload-slots";

const requestSchema = z.object({
  eventId: z.string().min(1),
  mediaId: uploadMediaId,
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  uploadId: z.string().min(1).max(1024),
  /** Stills that have not arrived yet, so the resumed upload can still send them. */
  posterBytes: z.number().int().positive().max(MAX_POSTER_BYTES).optional(),
  thumbBytes: z.number().int().positive().max(MAX_THUMB_BYTES).optional(),
});

/**
 * OPS-3: picks up a large upload where it stopped, across a reload or a phone
 * that slept through the evening.
 *
 * The device kept the upload id; this asks R2 which parts arrived whole, and
 * signs fresh URLs for the rest only. Nothing here trusts the device's own
 * account of what it sent: a part counts when R2 holds it at exactly the
 * length the cut says. The key comes from the media id, never the request, so
 * an upload id can only be resumed where it was started, and the same checks
 * as starting an upload apply, because a gallery can close or fill meanwhile.
 *
 * A 404 tells the device that R2 no longer has the upload (a failed join
 * aborts it, and the bucket's lifecycle rule clears abandoned ones after
 * seven days), so it starts the file again.
 */
export async function POST(request: Request) {
  // Signs URLs, so it is throttled like starting an upload, on its own budget:
  // a venue full of phones coming back online all resume at once.
  const ipLimit = await consume(`upload-resume:ip:${clientIp(request)}`, 300, 60 * 60);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many uploads. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfter) } },
    );
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { eventId, mediaId, mimeType, sizeBytes, uploadId } = parsed.data;
  if (!isAllowedMime(mimeType)) return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  if (sizeBytes <= MULTIPART_THRESHOLD) {
    return NextResponse.json({ error: "That file goes up in one piece" }, { status: 400 });
  }

  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), isNull(events.deletedAt)))
    .limit(1);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (!canUpload(event)) return NextResponse.json({ error: "Uploads are closed for this event" }, { status: 403 });
  const plan = eventPlan(event);
  const maxBytes = maxBytesForMime(mimeType, plan);
  if (sizeBytes > maxBytes) {
    return NextResponse.json({ error: `File is too large for the ${plan.name} plan`, maxBytes }, { status: 413 });
  }

  // Registered already: the device lost the answer, not the upload. Same rule
  // as starting one: a trashed row still owns its key.
  const [existing] = await db
    .select({ id: media.id })
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.eventId, event.id)))
    .limit(1);
  if (existing) return NextResponse.json({ error: "Upload identifier is already in use" }, { status: 409 });

  const viewer = await resolveEventViewer(event);
  if (!viewer.access.allowed) {
    return NextResponse.json({ error: "Gallery access is required to upload" }, { status: 403 });
  }
  if (!viewer.ownerSession && !viewer.guestId) {
    return NextResponse.json({ error: "Not authorized to upload to this event" }, { status: 401 });
  }

  const key = blobPathnameFor(event.id, mediaId, extensionForMime(mimeType));
  const parts: Part[] = [];
  try {
    let marker: string | undefined;
    do {
      const page = await r2.send(
        new ListPartsCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, UploadId: uploadId, PartNumberMarker: marker }),
      );
      parts.push(...(page.Parts ?? []));
      marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
    } while (marker);
  } catch {
    return NextResponse.json({ error: "That upload has expired. It will start again." }, { status: 404 });
  }

  const expected = partSizes(sizeBytes);
  const arrived = new Set(
    parts
      .filter((part) => part.PartNumber && part.Size === expected[part.PartNumber - 1] && part.ETag)
      .map((part) => part.PartNumber!),
  );
  const missing = expected
    .map((length, index) => ({ number: index + 1, length }))
    .filter((part) => !arrived.has(part.number));
  const urls = await signPartUrls(key, uploadId, missing);
  const stills = await signStillSlots(event.id, mediaId, mimeType, parsed.data);

  return NextResponse.json({
    partSize: PART_SIZE,
    parts: missing.map((part, index) => ({ number: part.number, url: urls[index] })),
    arrived: [...arrived].sort((a, b) => a - b),
    ...stills,
  });
}
