import { NextResponse } from "next/server";
import { z } from "zod";
import { uploadMediaId } from "@/lib/media-id";
import { CreateMultipartUploadCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, guests, media } from "@/lib/schema";
import { KIOSK_UPLOADS_PER_HOUR } from "@/lib/kiosks";
import { canUpload } from "@/lib/access";
import { eventPlan } from "@/lib/license";
import { GALLERY_FULL_MESSAGE, wouldExceedStorage } from "@/lib/usage";
import { MULTIPART_THRESHOLD, PART_SIZE, partSizes } from "@/lib/upload-parts";
import { resolveEventViewer } from "@/lib/event-viewer";
import { clientIp, consume } from "@/lib/ratelimit";
import { blobPathnameFor, extensionForMime, isAllowedMime, isVideoMime, maxBytesForMime, r2 } from "@/lib/storage";
import { MAX_POSTER_BYTES, MAX_THUMB_BYTES } from "@/lib/thumbnail-size";
import { signPartUrls, signStillSlots } from "@/lib/upload-slots";

const requestSchema = z.object({
  eventId: z.string().min(1),
  mediaId: uploadMediaId,
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  /** Size of the poster still, when the client extracted one for a video. */
  posterBytes: z.number().int().positive().max(MAX_POSTER_BYTES).optional(),
  /** Size of the grid thumbnail, when the client made one. */
  thumbBytes: z.number().int().positive().max(MAX_THUMB_BYTES).optional(),
});

function throttled(retryAfter: number) {
  return NextResponse.json(
    { error: "Too many uploads. Try again shortly." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  // Checked before any database work: this endpoint mints presigned URLs, so
  // an unthrottled caller can request them in a loop and write objects into
  // the bucket faster than anything reaps them. See ROADMAP.md SEC-2.
  const ipLimit = await consume(`upload:ip:${clientIp(request)}`, 200, 60 * 60);
  if (!ipLimit.allowed) return throttled(ipLimit.retryAfter);

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const { eventId, mediaId, mimeType, sizeBytes } = parsed.data;

  const [event] = await db.select().from(events).where(and(eq(events.id, eventId), isNull(events.deletedAt))).limit(1);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  const plan = eventPlan(event);
  if (!canUpload(event)) {
    return NextResponse.json({ error: "Uploads are closed for this event" }, { status: 403 });
  }
  if (!isAllowedMime(mimeType)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }
  // PAY-6: the event's storage, from the counter the triggers keep on the row.
  // Checked here, before a byte is sent, so a full gallery refuses the upload
  // rather than accepting it and refusing it afterwards. Guests are told it is
  // full and nothing about plans, which are the host's business.
  if (wouldExceedStorage(event, plan, sizeBytes + (parsed.data.posterBytes ?? 0) + (parsed.data.thumbBytes ?? 0))) {
    return NextResponse.json({ error: GALLERY_FULL_MESSAGE, full: true }, { status: 413 });
  }

  const maxBytes = maxBytesForMime(mimeType, plan);
  if (sizeBytes > maxBytes) {
    return NextResponse.json(
      { error: `File is too large for the ${plan.name} plan`, maxBytes },
      { status: 413 },
    );
  }

  // Deliberately does NOT filter deleted_at. A soft-deleted row still owns its
  // R2 pathname for 30 days, so letting an id be reused would overwrite an
  // object sitting in the trash and silently destroy the thing the recovery
  // window exists to protect.
  const [existingMedia] = await db
    .select({ id: media.id })
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.eventId, event.id)))
    .limit(1);
  if (existingMedia) {
    return NextResponse.json({ error: "Upload identifier is already in use" }, { status: 409 });
  }

  const viewer = await resolveEventViewer(event);
  if (!viewer.access.allowed) {
    return NextResponse.json({ error: "Gallery access is required to upload" }, { status: 403 });
  }
  if (!viewer.ownerSession && !viewer.guestId) {
    return NextResponse.json({ error: "Not authorized to upload to this event" }, { status: 401 });
  }

  // Per-guest bucket on top of the per-IP one above, since a whole venue shares
  // one NAT address and would otherwise exhaust a single IP budget between them.
  // Organizers are exempt: they legitimately bulk-upload their own galleries.
  // A kiosk is a queue of guests on one device, so it has a bigger bucket.
  if (!viewer.ownerSession && viewer.guestId) {
    const perHour = viewer.kioskId ? KIOSK_UPLOADS_PER_HOUR : 60;
    const guestLimit = await consume(`upload:guest:${viewer.guestId}`, perHour, 60 * 60);
    if (!guestLimit.allowed) return throttled(guestLimit.retryAfter);
  }

  // CAM-4: a disposable roll is photos, and a fixed number of them. Checked
  // here so a spent roll refuses before any bytes move; the shot itself is
  // spent at registration, by a conditional update that two racing uploads
  // cannot both pass.
  if (event.disposableMode && !viewer.ownerSession && viewer.guestId && !viewer.kioskId) {
    if (isVideoMime(mimeType)) {
      return NextResponse.json({ error: "This event is a disposable camera: photos only." }, { status: 403 });
    }
    const [guest] = await db
      .select({ shotsUsed: guests.shotsUsed })
      .from(guests)
      .where(eq(guests.id, viewer.guestId))
      .limit(1);
    if (guest && guest.shotsUsed >= event.shotsPerGuest) {
      return NextResponse.json({ error: "Your roll is finished. Every shot has been taken.", rollFinished: true }, { status: 403 });
    }
  }

  const pathname = blobPathnameFor(event.id, mediaId, extensionForMime(mimeType));

  // OPS-2: a large file goes up in parts, so a wifi drop at 90 percent costs one
  // 8 MB part rather than the whole 200 MB clip. Each part URL binds that part's
  // exact length, the same way the single PUT binds the whole size, so the
  // total still cannot exceed what was checked against the plan above. The
  // URLs live an hour, because a slow venue connection can take most of that
  // to reach the last part, and R2 checks the signature when a part starts.
  let multipart: { uploadId: string; partSize: number; urls: string[] } | null = null;
  if (sizeBytes > MULTIPART_THRESHOLD) {
    const created = await r2.send(
      new CreateMultipartUploadCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: pathname,
        ContentType: mimeType,
      }),
    );
    const uploadId = created.UploadId!;
    const urls = await signPartUrls(
      pathname,
      uploadId,
      partSizes(sizeBytes).map((length, index) => ({ number: index + 1, length })),
    );
    multipart = { uploadId, partSize: PART_SIZE, urls };
  }

  // ContentLength is signed, not advisory: it lands in X-Amz-SignedHeaders, so
  // R2 rejects the PUT outright if the body is not exactly the size we checked
  // against the plan cap above. Without it the signature binds only the key and
  // content type, and a client could declare 1 MB here and then upload
  // unlimited bytes. The browser sets Content-Length itself from the blob and
  // scripts cannot override it, so the honest path matches automatically.
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: pathname,
    ContentType: mimeType,
    ContentLength: sizeBytes,
  });
  const uploadUrl = multipart ? null : await getSignedUrl(r2, command, { expiresIn: 5 * 60 });

  // The poster still and the grid thumbnail the client made, each bound to
  // its size the same way, so neither slot can carry a large upload.
  const stills = await signStillSlots(event.id, mediaId, mimeType, parsed.data);

  return NextResponse.json({ uploadUrl, multipart, pathname, maxBytes, ...stills });
}
